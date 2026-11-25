import type { AuthContext } from 'better-auth';
import { Array as Arr, DateTime, Option, Predicate, Schema } from 'effect';

import { parseRoles } from '../core/roles.ts';

export const IMPERSONATION_SECONDS = 3600;

type Adapter = AuthContext['adapter'];
type TransactionAdapter = Parameters<Parameters<Adapter['transaction']>[0]>[0];
type Where = Parameters<Adapter['delete']>[0]['where'];

export interface EndedImpersonation {
  readonly userId: string;
  readonly impersonatedBy: string;
}

// Waits for one session to be ended by this process. Two requests may wait for
// the same one; the database gives it to one of them.
export interface Watcher {
  readonly token: string;
  ended: Option.Option<EndedImpersonation>;
}

const watchersOf = new WeakMap<WeakKey, Set<Watcher>>();

export const isGuardedAdapter = (adapter: WeakKey) => watchersOf.has(adapter);

// Registers before the session may be ended, and is forgotten when done.
export const watch = (adapter: WeakKey, token: string) => {
  const watcher: Watcher = { token, ended: Option.none() };
  const watchers = watchersOf.get(adapter);
  watchers?.add(watcher);
  return {
    watcher,
    forget: () => {
      watchers?.delete(watcher);
    },
  };
};

const tell = (
  watchers: ReadonlySet<Watcher>,
  token: string,
  ended: EndedImpersonation,
) =>
  Option.map(
    Arr.findFirst(
      [...watchers],
      (watcher) => watcher.token === token && Option.isNone(watcher.ended),
    ),
    (watcher) => {
      watcher.ended = Option.some(ended);
    },
  );

const earlier = (date: Date, limit: Date) => (date > limit ? limit : date);

const hourAfter = (date: Date) =>
  DateTime.toDateUtc(
    DateTime.add(DateTime.fromDateUnsafe(date), {
      seconds: IMPERSONATION_SECONDS,
    }),
  );

const isImpersonation = (
  row: unknown,
): row is EndedImpersonation & { readonly expiresAt: Date } =>
  Predicate.hasProperty(row, 'impersonatedBy') &&
  Predicate.isString(row.impersonatedBy) &&
  Predicate.hasProperty(row, 'userId') &&
  Predicate.isString(row.userId) &&
  Predicate.hasProperty(row, 'expiresAt') &&
  Predicate.isDate(row.expiresAt);

// Better Auth splits roles on commas without trimming, so it sees them as the
// core reads them.
const withPlainRole = <T>(user: T): T =>
  Predicate.hasProperty(user, 'role') && Predicate.isString(user.role)
    ? { ...user, role: Arr.join(parseRoles(user.role), ',') }
    : user;

const plain = <T>(model: string, row: T): T => {
  if (model === 'user') return withPlainRole(row);
  return model === 'session' &&
    Predicate.hasProperty(row, 'user') &&
    Predicate.isObject(row.user)
    ? { ...row, user: withPlainRole(row.user) }
    : row;
};

const tokenIn = (where: Where) =>
  Option.filter(
    Option.map(
      Arr.findFirst(where, (clause) => clause.field === 'token'),
      (clause) => clause.value,
    ),
    Predicate.isString,
  );

const guardMethods = (
  adapter: TransactionAdapter,
  watchers: ReadonlySet<Watcher>,
): TransactionAdapter => ({
  ...adapter,
  // A hook of the project may have changed the expiry.
  create: (query) =>
    adapter.create(
      query.model === 'session' &&
        isImpersonation(query.data) &&
        Predicate.hasProperty(query.data, 'createdAt') &&
        Predicate.isDate(query.data.createdAt)
        ? {
            ...query,
            data: {
              ...query.data,
              expiresAt: earlier(
                query.data.expiresAt,
                hourAfter(query.data.createdAt),
              ),
            },
          }
        : query,
    ),
  findOne: <T>(query: Parameters<Adapter['findOne']>[0]) =>
    adapter.findOne<T>(query).then((row) => plain(query.model, row)),
  // An impersonation is never extended. This is below every database hook,
  // because the last of them, the project's, decides what is written.
  update: <T>(query: Parameters<Adapter['update']>[0]) => {
    const { expiresAt } = query.update;
    const write = (update: typeof query.update) =>
      adapter
        .update<T>({ ...query, update })
        .then((row) => plain(query.model, row));
    if (query.model !== 'session' || !Predicate.isDate(expiresAt)) {
      return write(query.update);
    }
    return adapter
      .findOne({ model: 'session', where: query.where })
      .then((row) =>
        write(
          isImpersonation(row)
            ? { ...query.update, expiresAt: earlier(expiresAt, row.expiresAt) }
            : query.update,
        ),
      );
  },
  // With `preserveSessionInDatabase`, ending a session is an update.
  updateMany: (query) => {
    const token = tokenIn(query.where);
    if (
      query.model !== 'session' ||
      Option.isNone(token) ||
      !('expiresAt' in query.update)
    ) {
      return adapter.updateMany(query);
    }
    return adapter
      .findOne({ model: 'session', where: query.where })
      .then((row) =>
        adapter.updateMany(query).then((count) => {
          if (count > 0 && isImpersonation(row)) {
            tell(watchers, token.value, row);
          }
          return count;
        }),
      );
  },
  // Deleting answers nothing, so two requests could both believe they ended
  // the session. Consuming gives the row to one.
  delete: (query) => {
    const token = tokenIn(query.where);
    if (query.model !== 'session' || Option.isNone(token)) {
      return adapter.delete(query);
    }
    return adapter
      .consumeOne({ model: 'session', where: query.where })
      .then((row) => {
        if (isImpersonation(row)) tell(watchers, token.value, row);
      });
  },
});

export const guardAdapter = (adapter: Adapter): Adapter => {
  const watchers = new Set<Watcher>();
  const guarded: Adapter = {
    ...adapter,
    ...guardMethods(adapter, watchers),
    transaction: (callback) =>
      adapter.transaction((inner) => callback(guardMethods(inner, watchers))),
  };
  watchersOf.set(guarded, watchers);
  return guarded;
};

const Cached = Schema.fromJsonString(
  Schema.StructWithRest(
    Schema.Struct({
      session: Schema.StructWithRest(
        Schema.Struct({
          impersonatedBy: Schema.String,
          createdAt: Schema.DateFromString,
          expiresAt: Schema.DateFromString,
        }),
        [Schema.Record(Schema.String, Schema.Unknown)],
      ),
    }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
);
const decodeCached = Schema.decodeUnknownOption(Cached);
const encodeCached = Schema.encodeOption(Cached);

type Storage = NonNullable<AuthContext['secondaryStorage']>;

const guardedStorages = new WeakSet<Storage>();

// The same for the copy Better Auth keeps in secondary storage, which it
// writes before, and reads instead of, the row. Better Auth takes the storage
// from its options, so the object itself is changed.
export const guardStorage = (storage: Storage) => {
  if (guardedStorages.has(storage)) return;
  guardedStorages.add(storage);
  const set = storage.set.bind(storage);
  storage.set = (key, value, ttl) =>
    set(
      key,
      decodeCached(value).pipe(
        Option.flatMap(({ session, ...rest }) =>
          encodeCached({
            ...rest,
            session: {
              ...session,
              expiresAt: earlier(
                session.expiresAt,
                hourAfter(session.createdAt),
              ),
            },
          }),
        ),
        Option.getOrElse(() => value),
      ),
      ttl,
    );
};
