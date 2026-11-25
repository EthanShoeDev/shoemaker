import {
  Array as Arr,
  Context,
  DateTime,
  Effect,
  Layer,
  Number as Num,
  Option,
  Order,
  Ref,
  String as Str,
} from 'effect';
import { Cookies, Headers } from 'effect/http';

import {
  type Ban,
  AdminSessions,
  EmailTaken,
  Forbidden,
  LinkNotSent,
  PasswordLinks,
  UserDirectory,
  UserNotFound,
  parseRoles,
} from '../../src/index.ts';
import { Accounts, type Mail } from './accounts.ts';

interface StoredUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly roles: string;
  readonly ban: Ban | null;
  readonly createdAt: DateTime.Utc;
  readonly password: string | null;
}

interface StoredSession {
  readonly token: string;
  readonly userId: string;
  readonly impersonatedBy: string | null;
}

const toAdminUser = (user: StoredUser) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  roles: parseRoles(user.roles),
  banned: user.ban !== null,
  banReason: user.ban?.reason ?? null,
  createdAt: user.createdAt,
});

const tokenIn = (headers: Headers.Headers) =>
  Option.flatMapNullishOr(
    Headers.get(headers, 'cookie'),
    (cookie) => Cookies.parseHeader(cookie).session,
  );

// Accounts and sessions with no auth library at all: what replacing Better
// Auth would look like.
export const MemoryUsers = Layer.effectContext(
  Effect.gen(function* () {
    const users = yield* Ref.make<ReadonlyArray<StoredUser>>([]);
    const sessions = yield* Ref.make<ReadonlyArray<StoredSession>>([]);
    // Never reused, unlike a count of who is left.
    const created = yield* Ref.make(0);
    const mail = yield* Ref.make<ReadonlyArray<Mail>>([]);
    const broken = yield* Ref.make(false);

    const add = Effect.fnUntraced(function* (
      account: Pick<StoredUser, 'email' | 'name' | 'roles'>,
    ) {
      const number = yield* Ref.getAndUpdate(created, Num.increment);
      const user: StoredUser = {
        ...account,
        id: `user-${number}`,
        ban: null,
        createdAt: DateTime.makeUnsafe(number),
        password: null,
      };
      yield* Ref.update(users, Arr.append(user));
      return user;
    });
    const endSessions = (id: string) =>
      Ref.update(sessions, (all) =>
        Arr.filter(
          all,
          (session) => session.userId !== id && session.impersonatedBy !== id,
        ),
      );

    // Some databases find one id by several spellings (`01` for a serial 1, or
    // any letter case under a collation), so this one does too.
    const find = Effect.fnUntraced(function* (id: string) {
      const all = yield* Ref.get(users);
      return Arr.findFirst(all, (user) => user.id === Str.toLowerCase(id));
    });
    const get = Effect.fnUntraced(function* (id: string) {
      const user = yield* find(id);
      if (Option.isNone(user)) return yield* UserNotFound.make({ id });
      return user.value;
    });
    const update = (id: string, change: Partial<StoredUser>) =>
      Ref.update(users, (all) =>
        Arr.map(all, (user) =>
          user.id === id ? { ...user, ...change } : user,
        ),
      );
    const startSession = Effect.fnUntraced(function* (
      userId: string,
      impersonatedBy: string | null,
    ) {
      return yield* Ref.modify(sessions, (all) => {
        const token = `token-${all.length}-${userId}`;
        return [token, Arr.append(all, { token, userId, impersonatedBy })];
      });
    });

    const adminSessions = AdminSessions.of({
      find: Effect.fnUntraced(function* (headers) {
        const token = tokenIn(headers);
        const all = yield* Ref.get(sessions);
        const session = Option.flatMap(token, (wanted) =>
          Arr.findFirst(all, (stored) => stored.token === wanted),
        );
        if (Option.isNone(session)) return Option.none();
        const user = yield* find(session.value.userId);
        return Option.map(user, (stored) => ({
          user: {
            id: stored.id,
            email: stored.email,
            roles: parseRoles(stored.roles),
            ban: stored.ban,
          },
          impersonatedBy: session.value.impersonatedBy,
        }));
      }),
    });

    const directory = UserDirectory.of({
      list: Effect.fnUntraced(function* ({ search, limit, offset }) {
        const all = yield* Ref.get(users);
        const matching = Arr.filter(all, (user) =>
          Str.includes(Str.toLowerCase(search ?? ''))(user.email),
        );
        const newestFirst = Arr.sort(
          matching,
          Order.flip(
            Order.mapInput(
              DateTime.Order,
              (user: StoredUser) => user.createdAt,
            ),
          ),
        );
        return {
          items: Arr.map(
            Arr.take(Arr.drop(newestFirst, offset), limit),
            toAdminUser,
          ),
          total: matching.length,
        };
      }),
      get: (id) => Effect.map(get(id), toAdminUser),
      ban: Effect.fnUntraced(function* (asked, reason) {
        const { id } = yield* get(asked);
        yield* update(id, { ban: { reason, expiresAt: null } });
        yield* endSessions(id);
      }),
      setRoles: Effect.fnUntraced(function* (asked, roles) {
        const { id } = yield* get(asked);
        yield* update(id, { roles: Arr.join(roles, ',') });
        yield* Ref.update(
          sessions,
          Arr.filter(
            (session) =>
              session.impersonatedBy === null ||
              (session.userId !== id && session.impersonatedBy !== id),
          ),
        );
      }),
      create: Effect.fnUntraced(function* ({ email, name, roles }) {
        const all = yield* Ref.get(users);
        if (Arr.some(all, (user) => user.email === email)) {
          return yield* EmailTaken.make({ email });
        }
        const user = yield* add({ email, name, roles: Arr.join(roles, ',') });
        return toAdminUser(user);
      }),
      delete: Effect.fnUntraced(function* (asked) {
        const { id } = yield* get(asked);
        yield* Ref.update(
          users,
          Arr.filter((user) => user.id !== id),
        );
        yield* endSessions(id);
      }),
      unban: Effect.fnUntraced(function* (asked) {
        const { id } = yield* get(asked);
        yield* update(id, { ban: null });
      }),
      impersonate: Effect.fnUntraced(function* ({ id: asked, headers }) {
        const { id } = yield* get(asked);
        const admin = yield* adminSessions.find(headers);
        if (Option.isNone(admin)) {
          return yield* Forbidden.make({
            message: 'Nobody to impersonate as.',
          });
        }
        const token = yield* startSession(id, admin.value.user.id);
        return {
          cookies: Cookies.fromSetCookie([
            `session=${token}; Path=/; HttpOnly`,
          ]),
          undo: Ref.update(
            sessions,
            Arr.filter((session) => session.token !== token),
          ),
        };
      }),
    });

    const links = PasswordLinks.of({
      ready: () => Effect.void,

      send: Effect.fnUntraced(function* ({ userId, landing }) {
        const user = yield* get(userId);
        if (yield* Ref.get(broken)) return yield* LinkNotSent.make({});
        const sent = yield* Ref.get(mail);
        const token = `link-token-${sent.length}`;
        yield* Ref.set(
          mail,
          Arr.append(sent, { to: user.email, token, landing }),
        );
      }),
    });

    const accounts = Accounts.of({
      create: Effect.fnUntraced(function* ({ email, name, roles }) {
        const { id } = yield* add({
          email,
          name: name ?? email,
          roles: roles ?? '',
        });
        return { id, email };
      }),
      signIn: (id) =>
        Effect.map(startSession(id, null), (token) => `session=${token}`),
      setRoles: (id, stored) => update(id, { roles: stored }),
      mail: Ref.get(mail),
      breakMail: Ref.set(broken, true),
      choosePassword: Effect.fnUntraced(function* (token, password) {
        const sent = yield* Ref.get(mail);
        const link = Arr.findFirst(sent, (one) => one.token === token);
        const all = yield* Ref.get(users);
        const owner = Option.flatMap(link, ({ to }) =>
          Arr.findFirst(all, (user) => user.email === to),
        );
        if (Option.isSome(owner)) yield* update(owner.value.id, { password });
      }),
      signInWith: Effect.fnUntraced(function* (email, password) {
        const all = yield* Ref.get(users);
        const user = Arr.findFirst(
          all,
          (stored) => stored.email === email && stored.password === password,
        );
        if (Option.isNone(user)) return Option.none();
        const token = yield* startSession(user.value.id, null);
        return Option.some(`session=${token}`);
      }),
    });

    return Context.empty().pipe(
      Context.add(AdminSessions, adminSessions),
      Context.add(UserDirectory, directory),
      Context.add(PasswordLinks, links),
      Context.add(Accounts, accounts),
    );
  }),
);
