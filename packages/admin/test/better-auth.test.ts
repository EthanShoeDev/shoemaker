import { assert, describe, it } from '@effect/vitest';
import { admin } from 'better-auth/plugins/admin';
import {
  Array as Arr,
  Effect,
  Option,
  Record as Rec,
  Result,
  String as Str,
} from 'effect';

import {
  memoryStorage,
  openInstance,
  PASSWORD,
  type TestDb,
  updateUser,
  cookieHeader,
} from './better-auth-support/auth.ts';
import { toRequest } from './better-auth-support/send.ts';
import {
  HOUR,
  sessionsOf,
  userRow,
  withCookie,
  world,
} from './better-auth-support/world.ts';

const adminRoutes = Arr.map(Rec.values(admin().endpoints), (endpoint) => ({
  path: endpoint.path,
  method: endpoint.options.method,
}));

describe('closed endpoints', () => {
  it.effect('every admin route of the installed plugin answers 404', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      assert.isAtLeast(adminRoutes.length, 15);
      const open = Arr.filter(
        adminRoutes,
        ({ path }) => path !== '/admin/stop-impersonating',
      );
      assert.lengthOf(open, adminRoutes.length - 1);
      for (const { path, method } of open) {
        const response = yield* it_.send({
          path: `/api/auth${path}`,
          method,
          cookie: it_.adaCookie,
          body: { userId: it_.bob.id, role: 'admin' },
        });
        assert.strictEqual(response.status, 404, path);
      }
      assert.strictEqual(userRow(it_.db, it_.bob.id).banned, false);
      assert.strictEqual(userRow(it_.db, it_.bob.id).role, 'user');
      assert.deepStrictEqual(it_.entries, []);
    }),
  );

  it.effect('and does so without the wrapper, too', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const instance = yield* openInstance(it_.auth);
      for (const path of [
        ...Arr.map(adminRoutes, (route) => route.path),
        '/x/../admin/ban-user',
        '/admin/ban-user/',
      ]) {
        for (const method of ['GET', 'POST']) {
          if (method === 'POST' && path === '/admin/stop-impersonating')
            continue;
          const request = yield* toRequest({
            path: `/api/auth${path}`,
            method,
            cookie: it_.adaCookie,
            body: { userId: it_.bob.id, role: 'admin' },
          });
          const response = yield* Effect.promise(() =>
            instance.handler(request),
          );
          assert.strictEqual(response.status, 404, path);
        }
      }
      assert.strictEqual(userRow(it_.db, it_.bob.id).banned, false);
      const stop = yield* toRequest({
        path: '/api/auth/admin/stop-impersonating',
        cookie: yield* it_.impersonate,
      });
      const stopped = yield* Effect.promise(() => instance.handler(stop));
      assert.strictEqual(stopped.status, 200);
    }),
  );

  it.effect('no spelling of the path reaches an endpoint', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const spellings = [
        '/api/auth/admin/ban-user',
        '/api/auth/admin/ban-user/',
        '/api/auth//admin/ban-user',
        '/api/auth/admin//ban-user',
        '//api/auth/admin/ban-user',
        '/api/auth/%61dmin/ban-user',
        '/api/auth/%2561dmin/ban-user',
        '/api/auth/%25252561dmin/ban-user',
        '/api/auth/admin%2fban-user',
        '/api/auth/admin/ban%2Duser',
        '/api/auth/Admin/Ban-User',
        '/API/AUTH/ADMIN/BAN-USER',
        '/api/auth/admin;x/ban-user',
        '/api/auth/admin/ban-user;x=1',
        '/api/auth/./admin/ban-user',
        '/api/auth/x/../admin/ban-user',
        '/api/auth/x/%2e%2e/admin/ban-user',
        '/api/auth/x%2f..%2fadmin/ban-user',
        '/x/../api/auth/admin/ban-user',
        '/api/auth\\admin\\ban-user',
        '/api/auth%5cadmin/ban-user',
        '/api/auth/ad\tmin/ban-user',
        '/api/auth/ad%09min/ban-user',
        '/api/auth/admin/ban-user%00',
        '/api/auth/admin/ban-user%20',
        '/api/auth/admin/ban-user?x=/api/auth/admin/stop-impersonating',
        '/api/auth/admin/stop-impersonating/../ban-user',
        '/api/auth/admin/stop-impersonating%2f..%2fban-user',
        '/api/auth/admin',
      ];
      for (const path of spellings) {
        const response = yield* it_.send({
          path,
          cookie: it_.adaCookie,
          body: { userId: it_.bob.id },
        });
        assert.strictEqual(response.status, 404, path);
      }
      assert.strictEqual(userRow(it_.db, it_.bob.id).banned, false);
      assert.lengthOf(it_.entries, 0);
    }),
  );

  it.effect('under another base path too', () =>
    Effect.gen(function* () {
      const it_ = yield* world({ basePath: '/auth' });
      const body = { userId: it_.bob.id };
      for (const path of ['/auth/admin/ban-user', '/auth/%61dmin/ban-user']) {
        const response = yield* it_.send({ path, cookie: it_.adaCookie, body });
        assert.strictEqual(response.status, 404, path);
      }
      assert.strictEqual(userRow(it_.db, it_.bob.id).banned, false);
      const ok = yield* it_.send({ path: '/auth/ok', method: 'GET' });
      assert.strictEqual(ok.status, 200);
    }),
  );

  it.effect('the rest of Better Auth still answers', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const session = yield* it_.send({
        path: '/api/auth/get-session',
        method: 'GET',
        cookie: it_.adaCookie,
      });
      assert.include(session.body, it_.ada.id);
      const signIn = yield* it_.send({
        path: '/api/auth/sign-in/email',
        body: { email: it_.bob.email, password: PASSWORD },
      });
      assert.strictEqual(signIn.status, 200);
      // Not an admin path, though it starts like one.
      const other = yield* it_.send({ path: '/api/auth/administer' });
      assert.strictEqual(other.status, 404);
    }),
  );

  it.effect('no open endpoint sets what only the core may set', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const cookie = yield* it_.accounts.signIn(it_.bob.id);
      const claims = {
        role: 'admin',
        banned: false,
        impersonatedBy: it_.ada.id,
        expiresAt: '2099-01-01T00:00:00.000Z',
      };
      for (const [path, body] of [
        ['/api/auth/update-user', { name: 'Bob', ...claims }],
        ['/api/auth/update-session', claims],
        [
          '/api/auth/sign-up/email',
          {
            email: 'eve@example.com',
            name: 'Eve',
            password: PASSWORD,
            ...claims,
          },
        ],
      ] as const) {
        yield* it_.send({ path, cookie, body });
      }
      for (const row of it_.db.user) {
        assert.strictEqual(row.role, row.id === it_.ada.id ? 'admin' : 'user');
      }
      for (const row of it_.db.session) {
        assert.isNotOk(row.impersonatedBy);
        assert.isBelow(row.expiresAt.getTime(), Date.UTC(2090));
      }
    }),
  );
});

describe('stopping an impersonation', () => {
  const stop = { path: '/api/auth/admin/stop-impersonating' };
  const cookieCache = {
    session: { cookieCache: { enabled: true, maxAge: 300 } },
  };

  it.effect('restores the admin and is recorded', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const cookie = yield* it_.impersonate;
      const response = yield* it_.send({ ...stop, cookie });
      assert.strictEqual(response.status, 200);
      const restored = cookieHeader(response.cookies);
      const session = yield* it_.sessions.find(withCookie(restored));
      const found = Option.getOrThrow(session);
      assert.strictEqual(found.user.id, it_.ada.id);
      assert.isNull(found.impersonatedBy);
      assert.deepStrictEqual(it_.entries, [
        {
          actorId: it_.ada.id,
          actorEmail: 'ada@example.com',
          action: 'user.stop-impersonating',
          target: { kind: 'user', id: it_.bob.id },
          detail: null,
        },
      ]);
    }),
  );

  it.effect('that fails records nothing', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const cookie = yield* it_.impersonate;
      const visitor = yield* it_.send(stop);
      assert.strictEqual(visitor.status, 401);
      const own = yield* it_.send({ ...stop, cookie: it_.adaCookie });
      assert.strictEqual(own.status, 400);
      const get = yield* it_.send({ ...stop, method: 'GET', cookie });
      assert.strictEqual(get.status, 404);
      // The admin signed out meanwhile.
      it_.db.session = Arr.filter(
        it_.db.session,
        (row) => row.userId !== it_.ada.id,
      );
      const gone = yield* it_.send({ ...stop, cookie });
      assert.strictEqual(gone.status, 500);
      assert.deepStrictEqual(it_.entries, []);
    }),
  );

  it.effect('after the user was banned ends nothing twice', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const cookie = yield* it_.impersonate;
      yield* it_.directory.ban(it_.bob.id, null);
      const response = yield* it_.send({ ...stop, cookie });
      assert.strictEqual(response.status, 401);
      assert.deepStrictEqual(it_.entries, []);
    }),
  );

  // The ban ended the session, and its own entry says so.
  it.effect('through a cookie cache after a ban works, unrecorded', () =>
    Effect.gen(function* () {
      const it_ = yield* world(cookieCache);
      const cookie = yield* it_.impersonate;
      yield* it_.directory.ban(it_.bob.id, null);
      const response = yield* it_.send({ ...stop, cookie });
      assert.strictEqual(response.status, 200);
      const restored = withCookie(cookieHeader(response.cookies));
      const session = yield* it_.sessions.find(restored);
      assert.strictEqual(Option.getOrThrow(session).user.id, it_.ada.id);
      assert.deepStrictEqual(it_.entries, []);
    }),
  );

  it.effect('again with an old cookie is recorded once', () =>
    Effect.gen(function* () {
      const it_ = yield* world(cookieCache);
      const cookie = yield* it_.impersonate;
      for (const _ of Arr.range(1, 3)) {
        const response = yield* it_.send({ ...stop, cookie });
        assert.strictEqual(response.status, 200);
      }
      assert.lengthOf(it_.entries, 1);
    }),
  );

  it.effect('twice at once is recorded once', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const cookie = yield* it_.impersonate;
      const twice = [
        it_.send({ ...stop, cookie }),
        it_.send({ ...stop, cookie }),
      ];
      const responses = yield* Effect.all(twice, { concurrency: 2 });
      assert.include(
        Arr.map(responses, (response) => response.status),
        200,
      );
      assert.lengthOf(it_.entries, 1);
    }),
  );

  it.effect('whose entry cannot be written is not a success', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const cookie = yield* it_.impersonate;
      const response = yield* it_.sendUnaudited({ ...stop, cookie });
      assert.strictEqual(response.status, 500);
      const session = yield* it_.sessions.find(
        withCookie(cookieHeader(response.cookies)),
      );
      assert.strictEqual(Option.getOrThrow(session).user.id, it_.ada.id);
    }),
  );
});

describe('the hour of an impersonation', () => {
  const expiry = (it_: { readonly db: TestDb }, id: string) =>
    Arr.map(sessionsOf(it_.db, id), (row) => row.expiresAt.getTime());

  const impersonations = (it_: { readonly db: TestDb }) =>
    Arr.filterMap(it_.db.session, (row) =>
      row.impersonatedBy === null || row.impersonatedBy === undefined
        ? Result.failVoid
        : Result.succeed(row.expiresAt.getTime()),
    );

  for (const path of ['/get-session', '/list-sessions']) {
    it.effect(`outlasts a dropped cookie on ${path}`, () =>
      Effect.gen(function* () {
        const it_ = yield* world();
        const cookie = yield* it_.impersonate;
        const before = impersonations(it_);
        assert.lengthOf(before, 1);
        const dropped = Arr.join(
          Arr.filter(
            Str.split(cookie, '; '),
            (pair) => !Str.includes('dont_remember')(pair),
          ),
          '; ',
        );
        assert.notStrictEqual(dropped, cookie);
        const response = yield* it_.send({
          path: `/api/auth${path}`,
          method: 'GET',
          cookie: dropped,
        });
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(impersonations(it_), before);
        assert.isAtMost(before[0] ?? 0, Date.now() + HOUR);
      }),
    );
  }

  it.effect('leaves ordinary sessions refreshing', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const cookie = yield* it_.accounts.signIn(it_.bob.id);
      for (const row of sessionsOf(it_.db, it_.bob.id)) {
        row.expiresAt = new Date(Date.now() + HOUR);
      }
      yield* it_.send({ path: '/api/auth/get-session', method: 'GET', cookie });
      for (const time of expiry(it_, it_.bob.id)) {
        if (time > Date.now() + 2 * HOUR) return;
      }
      assert.fail('no session was refreshed');
    }),
  );
});

describe('AdminSessions', () => {
  it.effect('reads the database, not the cookie cache', () =>
    Effect.gen(function* () {
      const it_ = yield* world({
        session: { cookieCache: { enabled: true, maxAge: 300 } },
      });
      const cookie = yield* it_.accounts.signIn(it_.ada.id);
      const headers = withCookie(cookie);
      yield* it_.accounts.setRoles(it_.ada.id, ' host , admin ');
      const found = yield* Effect.map(
        it_.sessions.find(headers),
        Option.getOrThrow,
      );
      assert.deepStrictEqual(found.user.roles, ['host', 'admin']);
      yield* updateUser(it_.auth, it_.ada.id, {
        banned: true,
        banReason: 'Abuse',
      });
      const banned = yield* Effect.map(
        it_.sessions.find(headers),
        Option.getOrThrow,
      );
      assert.deepStrictEqual(banned.user.ban, {
        reason: 'Abuse',
        expiresAt: null,
      });
      it_.db.session = [];
      const ended = yield* it_.sessions.find(headers);
      assert.isTrue(Option.isNone(ended));
    }),
  );

  it.effect('is nobody without a cookie, or with a forged one', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      for (const cookie of ['', 'better-auth.session_token=forged.signature']) {
        const found = yield* it_.sessions.find(withCookie(cookie));
        assert.isTrue(Option.isNone(found));
      }
    }),
  );

  it.effect('does not extend the session it reads', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const soon = new Date(Date.now() + HOUR);
      for (const row of sessionsOf(it_.db, it_.ada.id)) row.expiresAt = soon;
      yield* it_.sessions.find(withCookie(it_.adaCookie));
      for (const row of sessionsOf(it_.db, it_.ada.id)) {
        assert.strictEqual(row.expiresAt.getTime(), soon.getTime());
      }
    }),
  );

  it.effect('dies when the database does, rather than finding nobody', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      Reflect.deleteProperty(it_.db, 'session');
      const exit = yield* Effect.exit(
        it_.sessions.find(withCookie(it_.adaCookie)),
      );
      assert.strictEqual(exit._tag, 'Failure');
    }),
  );
});

describe('with secondary storage', () => {
  it.effect('the database still decides', () =>
    Effect.gen(function* () {
      const it_ = yield* world({ session: { storeSessionInDatabase: true } });
      const headers = withCookie(it_.adaCookie);
      const row = userRow(it_.db, it_.ada.id);
      // As a deploy's SQL would, past Better Auth's copy.
      row.role = 'host';
      const found = yield* it_.sessions.find(headers);
      assert.deepStrictEqual(Option.getOrThrow(found).user.roles, ['host']);
      it_.db.session.length = 0;
      const ended = yield* it_.sessions.find(headers);
      assert.isTrue(Option.isNone(ended));
    }).pipe(Effect.provide(memoryStorage(new Map()))),
  );

  it.effect('a ban ends the sessions in both', () =>
    Effect.gen(function* () {
      const it_ = yield* world({ session: { storeSessionInDatabase: true } });
      const cookie = yield* it_.impersonate;
      yield* it_.directory.ban(it_.ada.id, null);
      for (const held of [cookie, it_.adaCookie]) {
        const response = yield* it_.send({
          path: '/api/auth/get-session',
          method: 'GET',
          cookie: held,
        });
        assert.strictEqual(response.body, 'null');
      }
    }).pipe(Effect.provide(memoryStorage(new Map()))),
  );

  it.effect('an expired row is no session, whatever the copy says', () =>
    Effect.gen(function* () {
      const it_ = yield* world({ session: { storeSessionInDatabase: true } });
      // Before the epoch, where the test clock stands.
      for (const row of it_.db.session) row.expiresAt = new Date(-1);
      const found = yield* it_.sessions.find(withCookie(it_.adaCookie));
      assert.isTrue(Option.isNone(found));
    }).pipe(Effect.provide(memoryStorage(new Map()))),
  );

  it.effect('without rows, nothing is served', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(world());
      assert.include(String(exit), 'UnsafeAuthOptions');
    }).pipe(Effect.provide(memoryStorage(new Map()))),
  );
});

describe('UserDirectory', () => {
  it.effect('searches literally and without regard to case', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      for (const email of ['a_b@example.com', 'acb@example.com']) {
        yield* it_.accounts.create({ email });
      }
      const search = (term: string) =>
        Effect.map(
          it_.directory.list({ search: term, limit: 25, offset: 0 }),
          ({ items, total }) => [Arr.map(items, (user) => user.email), total],
        );
      for (const [term, expected] of [
        ['A_B', ['a_b@example.com']],
        ['%', []],
        ['\\', []],
        ['ADA', ['ada@example.com']],
      ] as const) {
        const found = yield* search(term);
        assert.deepStrictEqual(found, [[...expected], expected.length], term);
      }
      const second = yield* it_.directory.list({
        search: '_',
        limit: 1,
        offset: 1,
      });
      assert.deepStrictEqual([second.items.length, second.total], [0, 1]);
    }),
  );

  it.effect('a ban also ends the sessions the user started as others', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      yield* it_.accounts.signIn(it_.bob.id);
      yield* it_.impersonate;
      assert.lengthOf(sessionsOf(it_.db, it_.bob.id), 1 + 1);
      yield* it_.directory.ban(it_.ada.id, null);
      assert.lengthOf(sessionsOf(it_.db, it_.ada.id), 0);
      assert.lengthOf(
        Arr.filter(it_.db.session, (row) => row.impersonatedBy === it_.ada.id),
        0,
      );
      // Bob's own goes on.
      assert.lengthOf(sessionsOf(it_.db, it_.bob.id), 1);
      assert.isNull(userRow(it_.db, it_.ada.id).banReason);
    }),
  );

  it.effect('an ended ban is no ban', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      yield* updateUser(it_.auth, it_.bob.id, {
        banned: true,
        banReason: 'Abuse',
        banExpires: new Date(-HOUR),
      });
      const user = yield* it_.directory.get(it_.bob.id);
      assert.deepStrictEqual([user.banned, user.banReason], [false, null]);
    }),
  );

  it.effect('impersonates for an admin whose roles hold spaces', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      yield* it_.accounts.setRoles(it_.ada.id, 'host, admin');
      const cookie = yield* it_.impersonate;
      const found = yield* it_.sessions.find(withCookie(cookie));
      const session = Option.getOrThrow(found);
      assert.strictEqual(session.user.id, it_.bob.id);
      assert.strictEqual(session.impersonatedBy, it_.ada.id);
      // Nothing is written: a demotion meanwhile must stand.
      assert.strictEqual(userRow(it_.db, it_.ada.id).role, 'host, admin');
    }),
  );

  it.effect('refuses to impersonate a banned or an unknown user', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const headers = withCookie(it_.adaCookie);
      yield* it_.directory.ban(it_.bob.id, null);
      const banned = yield* Effect.flip(
        it_.directory.impersonate({ id: it_.bob.id, headers }),
      );
      assert.strictEqual(banned._tag, 'Forbidden');
      const unknown = yield* Effect.flip(
        it_.directory.impersonate({ id: 'nobody', headers }),
      );
      assert.strictEqual(unknown._tag, 'UserNotFound');
    }),
  );
});
