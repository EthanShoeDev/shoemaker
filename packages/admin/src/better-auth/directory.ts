import { isAPIErrorLike } from '@alchemy.run/better-auth';
import {
  Array as Arr,
  DateTime,
  Effect,
  Layer,
  Predicate,
  Schema,
  String as Str,
} from 'effect';
import { Cookies } from 'effect/http';

import { EmailTaken, Forbidden, UserNotFound } from '../core/errors.ts';
import { isBanActive, UserDirectory } from '../core/ports.ts';
import { parseRoles } from '../core/roles.ts';
import {
  type AnyAuth,
  type AuthInstance,
  type HasAdminPlugin,
  openAuth,
  type StoredUser,
  toStoredUser,
  toStoredUsers,
  toWebHeaders,
} from './instance.ts';
import { toBan } from './sessions.ts';

const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const SCAN_PAGE = 500;
// D1 binds at most 100 parameters.
const SESSION_BATCH = 50;

type Context = Awaited<AnyAuth['$context']>;
type Where = NonNullable<
  Parameters<Context['internalAdapter']['listUsers']>[3]
>;

const newestFirst = { field: 'createdAt', direction: 'desc' } as const;

const toAdminUser = Effect.fnUntraced(function* (user: StoredUser) {
  const ban = toBan(user);
  const now = yield* DateTime.now;
  const banned = isBanActive(ban, now);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles: parseRoles(user.role),
    banned,
    banReason: banned ? (ban?.reason ?? null) : null,
    createdAt: DateTime.fromDateUnsafe(user.createdAt),
  };
});

const fetchUsers = (
  context: Context,
  options: {
    readonly limit: number;
    readonly offset: number;
    readonly where: Where;
  },
) =>
  Effect.promise(() =>
    context.internalAdapter.listUsers(
      options.limit,
      options.offset,
      newestFirst,
      [...options.where],
    ),
  ).pipe(Effect.flatMap(toStoredUsers));

// LIKE reads these as wildcards or escapes, and Better Auth escapes none.
const WILDCARDS = /[%_\\]/u;

const containing = (segments: ReadonlyArray<string>): Where =>
  Arr.map(segments, (value) => ({
    field: 'email',
    operator: 'contains' as const,
    value,
    mode: 'insensitive' as const,
  }));

// Every user whose email really contains the term. The database narrows by the
// parts that hold no wildcard.
const scan = Effect.fnUntraced(function* (context: Context, term: string) {
  const where = containing(
    Arr.filter(Str.split(term, WILDCARDS), Str.isNonEmpty),
  );
  const found: Array<StoredUser> = [];
  let offset = 0;
  let last = SCAN_PAGE;
  while (last === SCAN_PAGE) {
    const page = yield* fetchUsers(context, {
      limit: SCAN_PAGE,
      offset,
      where,
    });
    found.push(
      ...Arr.filter(page, (user) =>
        Str.includes(term)(Str.toLowerCase(user.email)),
      ),
    );
    last = page.length;
    offset += SCAN_PAGE;
  }
  return found;
});

const list = Effect.fn('UserDirectory.list')(function* (
  instance: AuthInstance<AnyAuth>,
  options: {
    readonly search?: string | undefined;
    readonly limit: number;
    readonly offset: number;
  },
) {
  const { context } = yield* openAuth(instance);
  const term = Str.toLowerCase(options.search ?? '');
  if (WILDCARDS.test(term)) {
    const found = yield* scan(context, term);
    const page = Arr.take(Arr.drop(found, options.offset), options.limit);
    return {
      items: yield* Effect.forEach(page, toAdminUser, { concurrency: 1 }),
      total: found.length,
    };
  }
  const where = term === '' ? [] : containing([term]);
  const [rows, total] = yield* Effect.all(
    [
      fetchUsers(context, {
        limit: options.limit,
        offset: options.offset,
        where,
      }),
      Effect.promise(() => context.internalAdapter.countTotalUsers([...where])),
    ],
    { concurrency: 2 },
  );
  return {
    items: yield* Effect.forEach(rows, toAdminUser, { concurrency: 1 }),
    total,
  };
});

export const findUser = Effect.fnUntraced(function* (
  context: Context,
  id: string,
) {
  const row = yield* Effect.promise(() =>
    context.internalAdapter.findUserById(id),
  );
  if (row === null) return yield* UserNotFound.make({ id });
  return yield* toStoredUser(row);
});

const get = Effect.fn('UserDirectory.get')(function* (
  instance: AuthInstance<AnyAuth>,
  id: string,
) {
  const { context } = yield* openAuth(instance);
  const user = yield* findUser(context, id);
  return yield* toAdminUser(user);
});

// Null is a database hook of the project that refused the update, which no
// admin asked for.
const updateUser = Effect.fnUntraced(function* (
  context: Context,
  id: string,
  data: Record<string, unknown>,
) {
  const updated = yield* Effect.promise(() =>
    context.internalAdapter.updateUser(id, data),
  );
  if (Predicate.isNullish(updated)) {
    return yield* Effect.die(`Better Auth did not update user ${id}.`);
  }
});

const SessionTokens = Schema.Array(
  Schema.Struct({
    token: Schema.String,
    impersonatedBy: Schema.String.pipe(Schema.NullishOr, Schema.optional),
  }),
);
const decodeTokens = Schema.decodeUnknownEffect(SessionTokens);

// Whose sessions: theirs, those somebody started as them, or those they
// started as somebody.
type Owned =
  | { readonly of: string }
  | { readonly as: string }
  | { readonly by: string };

const whereOwned = (owned: Owned) => {
  if ('by' in owned) return [{ field: 'impersonatedBy', value: owned.by }];
  return 'of' in owned
    ? [{ field: 'userId', value: owned.of }]
    : [
        { field: 'userId', value: owned.as },
        { field: 'impersonatedBy', operator: 'ne' as const, value: null },
      ];
};

// Those a request could still use. A project may keep ended ones as rows.
const liveSessions = Effect.fnUntraced(function* (
  context: Context,
  owned: Owned,
) {
  const now = yield* DateTime.now;
  // Not every adapter tells a missing impersonator from none, so a page of
  // ordinary sessions may come before the impersonations.
  for (let offset = 0; ; offset += SESSION_BATCH) {
    const rows = yield* Effect.promise(() =>
      context.adapter.findMany({
        model: 'session',
        where: [
          ...whereOwned(owned),
          {
            field: 'expiresAt',
            operator: 'gt',
            value: DateTime.toDateUtc(now),
          },
        ],
        limit: SESSION_BATCH,
        offset,
      }),
    ).pipe(Effect.flatMap(decodeTokens), Effect.orDie);
    const tokens = Arr.map(
      Arr.filter(
        rows,
        (row) => !('as' in owned) || Predicate.isString(row.impersonatedBy),
      ),
      (row) => row.token,
    );
    if (tokens.length > 0 || rows.length < SESSION_BATCH) return tokens;
  }
});

// Every batch must end something, so this ends too, also where a hook of the
// project refuses.
const endSessions = Effect.fnUntraced(function* (
  context: Context,
  owned: Owned,
) {
  const tried = new Set<string>();
  let tokens = yield* liveSessions(context, owned);
  while (Arr.isReadonlyArrayNonEmpty(tokens)) {
    const batch = tokens;
    if (Arr.every(batch, (token) => tried.has(token))) {
      return yield* Effect.die('Better Auth does not end these sessions.');
    }
    for (const token of batch) tried.add(token);
    yield* Effect.promise(() =>
      context.internalAdapter.deleteSessions([...batch]),
    );
    tokens = yield* liveSessions(context, owned);
  }
});

// Better Auth leaves those they started running, as somebody else.
const endAllSessions = Effect.fnUntraced(function* (
  context: Context,
  id: string,
) {
  yield* endSessions(context, { by: id });
  // Those that began since, or that a hook of the project kept.
  yield* endSessions(context, { of: id });
});

const ban = Effect.fn('UserDirectory.ban')(function* (
  instance: AuthInstance<AnyAuth>,
  id: string,
  reason: string | null,
) {
  const { context } = yield* openAuth(instance);
  yield* findUser(context, id);
  // Marked first: no session can start while the old ones are being ended.
  yield* updateUser(context, id, {
    banned: true,
    banReason: reason,
    banExpires: null,
  });
  yield* Effect.promise(() => context.internalAdapter.deleteUserSessions(id));
  yield* endAllSessions(context, id);
}, Effect.uninterruptible);

const unban = Effect.fn('UserDirectory.unban')(function* (
  instance: AuthInstance<AnyAuth>,
  id: string,
) {
  const { context } = yield* openAuth(instance);
  yield* findUser(context, id);
  yield* updateUser(context, id, {
    banned: false,
    banReason: null,
    banExpires: null,
  });
});

const setRoles = Effect.fn('UserDirectory.setRoles')(function* (
  instance: AuthInstance<AnyAuth>,
  id: string,
  roles: ReadonlyArray<string>,
) {
  const { context } = yield* openAuth(instance);
  yield* findUser(context, id);
  yield* updateUser(context, id, { role: Arr.join(roles, ',') });
  yield* endSessions(context, { as: id });
  yield* endSessions(context, { by: id });
}, Effect.uninterruptible);

class CreationFailed extends Schema.TaggedError<
  CreationFailed,
  { readonly brand: unique symbol }
>()('CreationFailed', { cause: Schema.Defect() }) {}

const findByEmail = Effect.fnUntraced(function* (
  context: Context,
  email: string,
) {
  return yield* Effect.promise(() =>
    context.internalAdapter.findUserByEmail(email),
  );
});

// How the databases say a value is already there.
const DUPLICATE = /unique|duplicate/iu;

const saysDuplicate = (error: unknown): boolean =>
  Predicate.isError(error) &&
  (DUPLICATE.test(error.message) || saysDuplicate(error.cause));

// Another request may have taken the email since it was looked for.
const creationRefusal = (context: Context, email: string) =>
  Effect.fnUntraced(function* ({ cause }: CreationFailed) {
    const taken = yield* findByEmail(context, email);
    if (isAPIErrorLike(cause) && cause.statusCode < HTTP_SERVER_ERROR) {
      return yield* taken === null
        ? Forbidden.make({
            message: cause.body?.message ?? 'Better Auth refused the account.',
          })
        : EmailTaken.make({ email });
    }
    return yield* taken !== null && saysDuplicate(cause)
      ? EmailTaken.make({ email })
      : Effect.die(cause);
  });

const Created = Schema.Struct({ user: Schema.Struct({ id: Schema.String }) });
const decodeCreated = Schema.decodeUnknownEffect(Created);

const create = Effect.fn('UserDirectory.create')(function* (
  instance: AuthInstance<AnyAuth>,
  account: {
    readonly email: string;
    readonly name: string;
    readonly roles: ReadonlyArray<string>;
  },
) {
  const { auth, context } = yield* openAuth(instance);
  const { email, name, roles } = account;
  if ((yield* findByEmail(context, email)) !== null) {
    return yield* EmailTaken.make({ email });
  }
  // Better Auth's endpoint and not its adapter, so the project's rules on who
  // may have an account still hold. It creates no password.
  const result = yield* Effect.tryPromise({
    try: () =>
      auth.api.createUser({
        body: { email, name, data: { emailVerified: true, role: roles } },
      }),
    catch: (cause) => CreationFailed.make({ cause }),
  }).pipe(Effect.catch(creationRefusal(context, email)));
  const { user } = yield* Effect.orDie(decodeCreated(result));
  const stored = yield* Effect.orDie(findUser(context, user.id));
  return yield* toAdminUser(stored);
});

const Accounts = Schema.Array(
  Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [
    Schema.Record(Schema.String, Schema.Unknown),
  ]),
);
const decodeAccounts = Schema.decodeUnknownEffect(Accounts);

const accountsOf = (context: Context, id: string) =>
  Effect.promise(() => context.internalAdapter.findAccounts(id)).pipe(
    Effect.flatMap(decodeAccounts),
    Effect.orDie,
  );

// Better Auth deletes what a user signs in with before the user, whom a hook
// of the project or a foreign key may then keep. D1 has no transaction to undo
// that, so it is put back.
const restoreAccounts = Effect.fnUntraced(function* (
  context: Context,
  id: string,
  before: typeof Accounts.Type,
) {
  const left = yield* accountsOf(context, id);
  const lost = Arr.filter(
    before,
    (account) => !Arr.some(left, (kept) => kept.id === account.id),
  );
  yield* Effect.forEach(
    lost,
    (account) =>
      Effect.promise(() =>
        context.adapter.create({
          model: 'account',
          data: { ...account },
          forceAllowId: true,
        }),
      ),
    { concurrency: 1, discard: true },
  );
});

const remove = Effect.fn('UserDirectory.delete')(function* (
  instance: AuthInstance<AnyAuth>,
  id: string,
) {
  const { context } = yield* openAuth(instance);
  yield* findUser(context, id);
  const accounts = yield* accountsOf(context, id);
  yield* Effect.promise(() => context.internalAdapter.deleteUserSessions(id));
  const deletion = yield* Effect.exit(
    Effect.promise(() => context.internalAdapter.deleteUser(id)),
  );
  const left = yield* Effect.promise(() =>
    context.internalAdapter.findUserById(id),
  );
  if (left !== null) {
    yield* restoreAccounts(context, id, accounts);
    yield* deletion;
    return yield* Effect.die(`Better Auth did not delete user ${id}.`);
  }
  // Last: without the account they can start no more.
  yield* endAllSessions(context, id);
  // A hook of the project may have failed after the user was gone.
  yield* deletion;
}, Effect.uninterruptible);

const WithHeaders = Schema.Struct({
  headers: Schema.instanceOf(Headers),
  response: Schema.Struct({
    session: Schema.Struct({ token: Schema.String }),
  }),
});
const decodeWithHeaders = Schema.decodeUnknownEffect(WithHeaders);

class ImpersonationFailed extends Schema.TaggedError<
  ImpersonationFailed,
  { readonly brand: unique symbol }
>()('ImpersonationFailed', { cause: Schema.Defect() }) {}

const refusal = (id: string) => (failure: ImpersonationFailed) => {
  const error = failure.cause;
  if (!isAPIErrorLike(error) || error.statusCode >= HTTP_SERVER_ERROR) {
    return Effect.die(error);
  }
  return Effect.fail(
    error.statusCode === HTTP_NOT_FOUND
      ? UserNotFound.make({ id })
      : Forbidden.make({
          message:
            error.body?.message ?? 'Better Auth refused the impersonation.',
        }),
  );
};

const impersonate = Effect.fn('UserDirectory.impersonate')(function* (
  instance: AuthInstance<AnyAuth>,
  id: string,
  headers: Headers,
) {
  const { auth, context } = yield* openAuth(instance);
  const result = yield* Effect.tryPromise({
    try: () =>
      auth.api.impersonateUser({
        body: { userId: id },
        headers,
        returnHeaders: true,
      }),
    catch: (cause) => ImpersonationFailed.make({ cause }),
  }).pipe(Effect.catch(refusal(id)));
  const { headers: sent, response } = yield* Effect.orDie(
    decodeWithHeaders(result),
  );
  const { token } = response.session;
  return {
    // Better Auth deletes the session cookie and sets it again. Of two with one
    // name the last is kept.
    cookies: Cookies.fromSetCookie(sent.getSetCookie()),
    undo: Effect.promise(() => context.internalAdapter.deleteSession(token)),
  };
});

export const directoryLayer = <A extends AnyAuth>(
  instance: AuthInstance<A> & HasAdminPlugin<A>,
) =>
  Layer.succeed(UserDirectory, {
    list: (options) => list(instance, options),
    get: (id) => get(instance, id),
    ban: (id, reason) => ban(instance, id, reason),
    unban: (id) => unban(instance, id),
    setRoles: (id, roles) => setRoles(instance, id, roles),
    create: (account) => create(instance, account),
    delete: (id) => remove(instance, id),
    impersonate: ({ id, headers }) =>
      impersonate(instance, id, toWebHeaders(headers)),
  });
