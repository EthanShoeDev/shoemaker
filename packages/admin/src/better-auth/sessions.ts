import { DateTime, Effect, Layer, Option, Schema } from 'effect';

import { AdminSessions, type Ban } from '../core/ports.ts';
import { parseRoles } from '../core/roles.ts';
import {
  type AnyAuth,
  type AuthInstance,
  type HasAdminPlugin,
  openAuth,
  type StoredUser,
  toStoredUser,
  toUserId,
  toWebHeaders,
} from './instance.ts';

const SessionResult = Schema.NullOr(
  Schema.Struct({
    session: Schema.Struct({
      token: Schema.String,
      impersonatedBy: Schema.String.pipe(Schema.NullishOr, Schema.optional),
    }),
    // Decoded by whoever needs it, as far as they need it.
    user: Schema.Unknown,
  }),
);

const decodeSession = Schema.decodeUnknownEffect(SessionResult);

// Better Auth's own reading of the headers. A visitor is `null`; anything else
// that goes wrong is a defect.
export const readSession = (
  auth: AnyAuth,
  headers: Headers,
  options: { readonly allowCache: boolean },
) =>
  Effect.promise(() =>
    auth.api.getSession({
      headers,
      query: {
        disableCookieCache: !options.allowCache,
        // A check is not a visit, so it never extends a session.
        disableRefresh: true,
      },
    }),
  ).pipe(Effect.flatMap(decodeSession), Effect.orDie);

export const toBan = (user: StoredUser): Ban | null =>
  user.banned === true
    ? {
        reason: user.banReason ?? null,
        expiresAt:
          user.banExpires === null || user.banExpires === undefined
            ? null
            : DateTime.fromDateUnsafe(user.banExpires),
      }
    : null;

const StoredSession = Schema.NullOr(Schema.Struct({ expiresAt: Schema.Date }));
const decodeStoredSession = Schema.decodeUnknownEffect(StoredSession);

type Context = Awaited<AnyAuth['$context']>;

// The session's user, when both rows are still there.
const storedUser = Effect.fnUntraced(function* (
  context: Context,
  token: string,
  userId: string,
) {
  const session = yield* Effect.promise(() =>
    context.adapter.findOne({
      model: 'session',
      where: [{ field: 'token', value: token }],
    }),
  ).pipe(Effect.flatMap(decodeStoredSession), Effect.orDie);
  const now = yield* DateTime.now;
  if (
    session === null ||
    DateTime.isLessThanOrEqualTo(
      DateTime.fromDateUnsafe(session.expiresAt),
      now,
    )
  ) {
    return null;
  }
  const row = yield* Effect.promise(() =>
    context.internalAdapter.findUserById(userId),
  );
  return row === null ? null : yield* toStoredUser(row);
});

export const findAdminSession = Effect.fn('BetterAuth.findAdminSession')(
  function* (instance: AuthInstance<AnyAuth>, headers: Headers) {
    const { auth, context, secondary } = yield* openAuth(instance);
    const found = yield* readSession(auth, headers, { allowCache: false });
    if (found === null) return Option.none();
    // Read from the database with the session, unless there is a secondary
    // storage, whose copy keeps the roles and the ban it was written with.
    const id = yield* toUserId(found.user);
    const user = secondary
      ? yield* storedUser(context, found.session.token, id)
      : yield* toStoredUser(found.user);
    if (user === null) return Option.none();
    return Option.some({
      user: {
        id: user.id,
        email: user.email,
        roles: parseRoles(user.role),
        ban: toBan(user),
      },
      impersonatedBy: found.session.impersonatedBy ?? null,
    });
  },
);

export const sessionsLayer = <A extends AnyAuth>(
  instance: AuthInstance<A> & HasAdminPlugin<A>,
) =>
  Layer.succeed(AdminSessions, {
    find: (headers) => findAdminSession(instance, toWebHeaders(headers)),
  });
