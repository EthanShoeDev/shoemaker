import { assert, describe, it } from '@effect/vitest';
import { memoryAdapter } from 'better-auth/adapters/memory';
import {
  Array as Arr,
  Context,
  DateTime,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Predicate,
  Schema,
  Scope,
  String as Str,
} from 'effect';
import { Headers, HttpServerRequest } from 'effect/http';

import { adminPlugin } from '../src/better-auth.ts';
import { guardAdapter, watch } from '../src/better-auth/guard.ts';
import { plainPath } from '../src/better-auth/path.ts';
import { AdminSessions, AuditLog, AuditPage } from '../src/index.ts';
import {
  backend,
  makeAuth,
  makeAuthOver,
  memoryStorage,
  openContext,
  type TestDb,
  updateUser,
} from './better-auth-support/auth.ts';
import { recording, send, toRequest } from './better-auth-support/send.ts';
import { openSqlite, sqliteDatabase } from './better-auth-support/sqlite.ts';
import {
  HOUR,
  sessionsOf,
  withCookie,
  world,
  worldOf,
} from './better-auth-support/world.ts';
import { access } from './support/access.ts';
import { Accounts } from './support/accounts.ts';
import { as, cookieFrom, makeHost, post } from './support/app.ts';

// Better Auth reads the real clock, so expiries are compared with it.
const realNow = Effect.sync(() => Date.now());

const sqliteWorld = Effect.fnUntraced(function* (
  extra: Parameters<typeof makeAuthOver>[1] = {},
) {
  const db = yield* openSqlite;
  const auth = yield* makeAuthOver(sqliteDatabase(db), extra);
  return yield* worldOf(auth);
});

const liveOf = Effect.fnUntraced(function* (
  it_: Effect.Success<ReturnType<typeof worldOf>>,
  field: string,
  value: string,
) {
  const context = yield* openContext(it_.auth);
  const now = yield* realNow;
  return yield* Effect.promise(() =>
    context.adapter.findMany({
      model: 'session',
      where: [
        { field, value },
        { field: 'expiresAt', operator: 'gt', value: new Date(now) },
      ],
      limit: 500,
    }),
  ).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown))),
  );
});

const impersonationBy = (it_: {
  readonly db: TestDb;
  readonly ada: { readonly id: string };
}) =>
  Arr.findFirst(
    it_.db.session,
    (session) => session.impersonatedBy === it_.ada.id,
  ).pipe(Option.getOrThrow);

const dropDontRemember = (cookie: string) =>
  Arr.join(
    Arr.filter(
      Str.split(cookie, '; '),
      (pair) => !Str.includes('dont_remember')(pair),
    ),
    '; ',
  );

const farAway = DateTime.toDateUtc(DateTime.makeUnsafe('2099-01-01'));

const getSession = { path: '/api/auth/get-session', method: 'GET' };

const extending = {
  databaseHooks: {
    session: {
      update: {
        before: (data: Record<string, unknown>) =>
          Promise.resolve({ data: { ...data, userAgent: 'x' } }),
      },
    },
  },
};

describe('the hour of an impersonation', () => {
  it.live('outlasts a hook of the project', () =>
    Effect.gen(function* () {
      const it_ = yield* world(extending);
      const cookie = yield* it_.impersonate;
      for (const path of ['/get-session', '/list-sessions']) {
        const response = yield* it_.send({
          path: `/api/auth${path}`,
          method: 'GET',
          cookie: dropDontRemember(cookie),
        });
        assert.strictEqual(response.status, 200);
      }
      const now = yield* realNow;
      const row = impersonationBy(it_);
      assert.isAtMost(row.expiresAt.getTime(), now + HOUR);
    }),
  );

  it.live('outlasts a hook that lengthens it from the start', () =>
    Effect.gen(function* () {
      const it_ = yield* world({
        databaseHooks: {
          session: {
            create: {
              before: (data) =>
                Promise.resolve({
                  data: { ...data, expiresAt: farAway },
                }),
            },
          },
        },
      });
      yield* it_.impersonate;
      const now = yield* realNow;
      const row = impersonationBy(it_);
      assert.isAtMost(row.expiresAt.getTime(), now + HOUR);
    }),
  );

  it.live('outlasts it in secondary storage, too', () => {
    const values = new Map<string, string>();
    const Copy = Schema.fromJsonString(
      Schema.Struct({
        session: Schema.Struct({
          impersonatedBy: Schema.String.pipe(Schema.NullOr, Schema.optional),
          expiresAt: Schema.String,
        }),
      }),
    );
    return Effect.gen(function* () {
      const it_ = yield* world({
        ...extending,
        session: { storeSessionInDatabase: true },
      });
      const cookie = yield* it_.impersonate;
      yield* it_.send({ ...getSession, cookie: dropDontRemember(cookie) });
      const now = yield* realNow;
      const copies = Arr.filter(
        Arr.flatMap([...values.values()], (value) =>
          Option.toArray(Schema.decodeOption(Copy)(value)),
        ),
        ({ session }) => session.impersonatedBy === it_.ada.id,
      );
      assert.lengthOf(copies, 1);
      for (const { session } of copies) {
        assert.isAtMost(new Date(session.expiresAt).getTime(), now + HOUR);
      }
    }).pipe(Effect.provide(memoryStorage(values)));
  });

  it.live('is kept on SQLite', () =>
    Effect.gen(function* () {
      const it_ = yield* sqliteWorld(extending);
      const cookie = yield* it_.impersonate;
      yield* it_.send({ ...getSession, cookie: dropDontRemember(cookie) });
      const context = yield* openContext(it_.auth);
      const now = yield* realNow;
      const later = yield* Effect.promise(() =>
        context.adapter.findMany({
          model: 'session',
          where: [
            { field: 'impersonatedBy', value: it_.ada.id },
            { field: 'expiresAt', operator: 'gt', value: new Date(now + HOUR) },
          ],
          limit: 10,
        }),
      );
      assert.deepStrictEqual(later, []);
    }),
  );
});

describe('a ban', () => {
  it.live('ends more impersonations than D1 binds parameters', () =>
    Effect.gen(function* () {
      const it_ = yield* sqliteWorld();
      yield* Effect.forEach(Arr.range(1, 101), () => it_.impersonate, {
        concurrency: 1,
        discard: true,
      });
      const before = yield* liveOf(it_, 'impersonatedBy', it_.ada.id);
      assert.lengthOf(before, 101);
      yield* it_.directory.ban(it_.ada.id, null);
      const after = yield* liveOf(it_, 'impersonatedBy', it_.ada.id);
      assert.lengthOf(after, 0);
    }),
  );

  it.live('ends them where ended sessions are kept as rows', () =>
    Effect.gen(function* () {
      const it_ = yield* world({
        session: {
          storeSessionInDatabase: true,
          preserveSessionInDatabase: true,
        },
      });
      const cookie = yield* it_.impersonate;
      yield* it_.impersonate;
      yield* it_.directory.ban(it_.ada.id, null);
      const live = yield* liveOf(it_, 'impersonatedBy', it_.ada.id);
      assert.lengthOf(live, 0);
      const rows = Arr.filter(
        it_.db.session,
        (session) => session.impersonatedBy === it_.ada.id,
      );
      assert.lengthOf(rows, 2);
      const response = yield* it_.send({ ...getSession, cookie });
      assert.strictEqual(response.body, 'null');
    }).pipe(Effect.provide(memoryStorage(new Map()))),
  );

  it.live('fails rather than loops where a hook keeps sessions', () =>
    Effect.gen(function* () {
      const it_ = yield* world({
        databaseHooks: {
          session: { delete: { before: () => Promise.resolve(false) } },
        },
      });
      yield* it_.impersonate;
      const impersonator = yield* Effect.exit(
        it_.directory.ban(it_.ada.id, null),
      );
      assert.include(String(impersonator), 'does not end');
      const target = yield* Effect.exit(it_.directory.ban(it_.bob.id, null));
      assert.include(String(target), 'does not end');
    }),
  );

  it.live('is finished once begun', () =>
    Effect.gen(function* () {
      const begun = Promise.withResolvers<boolean>();
      const gate = Promise.withResolvers<boolean>();
      const it_ = yield* world({
        databaseHooks: {
          user: {
            update: {
              before: (data) => {
                if (!('banned' in data)) return Promise.resolve(true);
                begun.resolve(true);
                return gate.promise;
              },
            },
          },
        },
      });
      yield* it_.impersonate;
      const fiber = yield* Effect.forkChild(
        it_.directory.ban(it_.bob.id, null),
      );
      yield* Effect.promise(() => begun.promise);
      const interruption = yield* fiber.pipe(Fiber.interrupt, Effect.forkChild);
      yield* Effect.sleep('10 millis');
      gate.resolve(true);
      yield* Fiber.join(interruption);
      assert.lengthOf(sessionsOf(it_.db, it_.bob.id), 0);
    }),
  );
});

describe('a change of roles', () => {
  it.live('ends impersonations behind many ordinary sessions', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      yield* Effect.forEach(
        Arr.range(1, 60),
        () => it_.accounts.signIn(it_.bob.id),
        {
          concurrency: 1,
          discard: true,
        },
      );
      // Sessions without the field, which the memory adapter's
      // `impersonatedBy ne null` matches.
      assert.isTrue(
        Arr.every(sessionsOf(it_.db, it_.bob.id), (row) =>
          Predicate.isUndefined(row.impersonatedBy),
        ),
      );
      yield* it_.impersonate;
      yield* it_.directory.setRoles(it_.bob.id, ['user', 'host']);
      const live = yield* liveOf(it_, 'impersonatedBy', it_.ada.id);
      assert.lengthOf(live, 0);
    }),
  );
});

describe('stopping an impersonation', () => {
  const stop = { path: '/api/auth/admin/stop-impersonating' };

  it.live('is recorded once begun', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const cookie = yield* it_.impersonate;
      const begun = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const actions: Array<string> = [];
      const slow = Layer.succeed(AuditLog, {
        record: (entry) =>
          Deferred.succeed(begun, undefined).pipe(
            Effect.andThen(Deferred.await(gate)),
            Effect.andThen(Effect.sync(() => void actions.push(entry.action))),
          ),
        list: () => Effect.die('not read'),
      });
      const fiber = yield* Effect.forkChild(
        Effect.provide(send(it_.auth, { ...stop, cookie }), slow),
      );
      yield* Deferred.await(begun);
      const interruption = yield* fiber.pipe(Fiber.interrupt, Effect.forkChild);
      yield* Effect.sleep('10 millis');
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(interruption);
      assert.deepStrictEqual(actions, ['user.stop-impersonating']);
    }),
  );

  it.live('twice at once in one execution is recorded once', () =>
    Effect.gen(function* () {
      const it_ = yield* sqliteWorld();
      const cookie = yield* it_.impersonate;
      const one = Effect.gen(function* () {
        const request = yield* toRequest({ ...stop, cookie });
        return yield* Effect.provideService(
          it_.auth.handler,
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(request),
        );
      }).pipe(Effect.provide(recording(it_.entries)));
      yield* Effect.all([one, one, one], { concurrency: 3 });
      assert.lengthOf(it_.entries, 1);
    }),
  );

  it.live('where ended sessions are kept as rows is recorded once', () =>
    Effect.gen(function* () {
      const it_ = yield* world({
        session: {
          storeSessionInDatabase: true,
          preserveSessionInDatabase: true,
        },
      });
      const cookie = yield* it_.impersonate;
      yield* Effect.all(
        [it_.send({ ...stop, cookie }), it_.send({ ...stop, cookie })],
        { concurrency: 2 },
      );
      assert.lengthOf(it_.entries, 1);
    }).pipe(Effect.provide(memoryStorage(new Map()))),
  );

  it.live('follows the entry of its beginning', () =>
    Effect.gen(function* () {
      const auth = yield* makeAuth({ user: [], session: [], account: [] });
      const host = yield* makeHost(backend(auth));
      const accounts = Context.get(host.services, Accounts);
      const ada = yield* accounts.create({
        email: 'ada@example.com',
        roles: 'admin',
      });
      const bob = yield* accounts.create({ email: 'bob@example.com' });
      const cookie = yield* accounts.signIn(ada.id);
      const begun = yield* host.send(
        `/admin/users/${bob.id}/impersonate`,
        as(cookie, post()),
      );
      const stopped = yield* send(auth, {
        ...stop,
        cookie: cookieFrom(begun),
      }).pipe(Effect.provide(host.services));
      assert.strictEqual(stopped.status, 200);
      const response = yield* host.send('/admin/audit', as(cookie));
      const page = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(AuditPage)),
      );
      assert.deepStrictEqual(
        Arr.map(Arr.reverse(page.items), (entry) => [
          entry.action,
          entry.actorId,
          entry.actorEmail,
          entry.targetUserId,
        ]),
        [
          ['user.impersonate', ada.id, ada.email, bob.id],
          ['user.stop-impersonating', ada.id, ada.email, bob.id],
        ],
      );
    }),
  );
});

describe('a session that another request ended', () => {
  it.effect('is not this one’s to record', () =>
    Effect.gen(function* () {
      const row = {
        id: 's',
        token: 't',
        userId: 'bob',
        impersonatedBy: 'ada',
        expiresAt: farAway,
      };
      const adapter = memoryAdapter({ session: [row], user: [] })({
        plugins: [adminPlugin(access)],
      });
      const guarded = guardAdapter({
        ...adapter,
        updateMany: () => Promise.resolve(0),
      });
      const { watcher } = watch(guarded, 't');
      yield* Effect.promise(() =>
        guarded.updateMany({
          model: 'session',
          where: [{ field: 'token', value: 't' }],
          update: { expiresAt: farAway },
        }),
      );
      assert.isTrue(Option.isNone(watcher.ended));
    }),
  );
});

describe('impersonating', () => {
  it.live('an admin whose roles hold spaces needs the permission too', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      yield* it_.accounts.setRoles(it_.bob.id, 'user, support');
      const refused = yield* Effect.flip(it_.impersonate);
      assert.strictEqual(refused._tag, 'Forbidden');
    }),
  );

  it.live('restores no role that was removed meanwhile', () =>
    Effect.gen(function* () {
      const writes: Array<unknown> = [];
      const it_ = yield* world({
        databaseHooks: {
          user: {
            update: {
              before: (data) => {
                writes.push(data);
                return Promise.resolve(true);
              },
            },
          },
        },
      });
      yield* updateUser(it_.auth, it_.ada.id, { role: 'host, admin' });
      writes.length = 0;
      yield* it_.impersonate;
      assert.deepStrictEqual(writes, []);
    }),
  );
});

// The letter a, percent-encoded that many times.
const encodedOver = (times: number) => `%${Str.repeat(times)('25')}61`;

describe('the wrapper', () => {
  it.effect('hands over nothing that could be an admin path', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const handed: Array<string> = [];
      const handler = it_.auth.handlerOver((request) => {
        handed.push(new URL(request.url).pathname);
        return Promise.resolve(new Response('ok'));
      });
      const reach = Effect.fnUntraced(function* (path: string) {
        const request = yield* toRequest({ path });
        const response = yield* Effect.provideService(
          handler,
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(request),
        ).pipe(Effect.provide(recording([])));
        return response.status;
      });
      for (const path of [
        '/api/auth/admin',
        '/api/auth/admin/anything',
        '/api/auth/%61dmin/x',
        '/api/auth/%2561dmin/x',
        '/api/auth//admin/x',
        '/api/auth/ADMIN/x',
        '/api/auth/x%2f..%2fadmin/x',
        '/api/auth%5Cadmin/x',
        '/api/auth/admin;a=b/x',
        '/api/auth/ad%09min/x',
        '/%61pi/auth/admin/x',
        '/api/auth/admin/stop-impersonating/',
        '/api/auth/admin/stop%2Dimpersonating',
        `/api/auth/${encodedOver(20)}dmin`,
      ]) {
        const status = yield* reach(path);
        assert.strictEqual(status, 404, path);
      }
      assert.deepStrictEqual(handed, []);
      for (const path of ['/api/auth/administer', '/api/auth/x/admin']) {
        const status = yield* reach(path);
        assert.strictEqual(status, 200, path);
      }
      assert.lengthOf(handed, 2);
    }),
  );
});

describe('plainPath', () => {
  for (const [path, plain] of [
    ['/a/b', '/a/b'],
    ['/A/B', '/a/b'],
    ['//a///b//', '/a/b'],
    ['/%61/b', '/a/b'],
    ['/%2561/b', '/a/b'],
    ['/a%2Fb', '/a/b'],
    ['/a\\b', '/a/b'],
    ['/a/./b', '/a/b'],
    ['/a/x/../b', '/a/b'],
    ['/a/x/%2e%2e/b', '/a/b'],
    ['/../../a', '/a'],
    ['/a;x=1/b;y', '/a/b'],
    ['/a%00/b%20', '/a/b'],
    ['/a/%zz', '/a/%zz'],
    ['/a/%ff', '/a/%ff'],
    ['', '/'],
  ] as const) {
    it(`reads ${path} as ${plain}`, () => {
      assert.deepStrictEqual(plainPath(path), Option.some(plain));
    });
  }

  it('has no reading of a path encoded over and over', () => {
    assert.isTrue(Option.isNone(plainPath(`/${encodedOver(20)}`)));
    assert.deepStrictEqual(plainPath(`/${encodedOver(5)}`), Option.some('/a'));
  });
});

describe('the ports', () => {
  it.effect('die without the scope of a request', () =>
    Effect.gen(function* () {
      const it_ = yield* world();
      const exit = yield* it_.sessions.find(Headers.empty).pipe(
        Effect.updateContext((context: Context.Context<never>) =>
          Context.omit(Scope.Scope)(context),
        ),
        Effect.exit,
      );
      assert.include(String(exit), 'needs the scope');
      const services = yield* AdminSessions.pipe(
        Effect.provide(it_.auth.ports),
      );
      const found = yield* services.find(withCookie(it_.adaCookie));
      assert.isTrue(Option.isSome(found));
    }),
  );
});

describe('the admin plugin', () => {
  it('drops options that would bypass a check, even through a cast', () => {
    const plugin = adminPlugin(access, {
      bannedUserMessage: 'Gone.',
      adminUserIds: ['eve'],
      allowImpersonatingAdmins: true,
      defaultRole: 'admin',
    } as never);
    assert.strictEqual(plugin.options?.bannedUserMessage, 'Gone.');
    for (const key of [
      'adminUserIds',
      'allowImpersonatingAdmins',
      'defaultRole',
    ]) {
      assert.notProperty(plugin.options ?? {}, key);
    }
  });
});
