import { assert, describe, it } from '@effect/vitest';
import {
  type Context,
  DateTime,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
} from 'effect';
import {
  Headers,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
} from 'effect/http';
import { TestClock } from 'effect/testing';

import {
  type AdminSession,
  AdminSessions,
  AuditLog,
  CurrentAdmin,
  PasswordLinks,
  type UserDirectory,
} from '../src/index.ts';
import {
  AdminAccess,
  type AdminRequest,
  linkTo,
  UsersLive,
  usersLive,
  impersonatedBy,
} from '../src/server.ts';
import { access } from './support/access.ts';
import { ADMIN_ORIGIN, AccessLive, serve } from './support/app.ts';
import { captureLogs } from './support/logs.ts';
import { MemoryAuditLog } from './support/memory-audit-log.ts';
import { MemoryUsers } from './support/memory-users.ts';

const session = (
  user: Partial<AdminSession['user']> = {},
  impersonator: string | null = null,
): AdminSession => ({
  user: {
    id: 'ada',
    email: 'ada@example.com',
    roles: ['admin'],
    ban: null,
    ...user,
  },
  impersonatedBy: impersonator,
});

const signedInAs = (found: AdminSession | null) =>
  Layer.succeed(AdminSessions, {
    find: () => Effect.succeed(Option.fromNullOr(found)),
  });

const request = (changes: Partial<AdminRequest> = {}): AdminRequest => ({
  headers: Headers.fromInput({ origin: ADMIN_ORIGIN }),
  unsafeMethod: false,
  permissions: { user: ['list'] },
  audited: null,
  readOnly: false,
  ...changes,
});

const write = (changes: Partial<AdminRequest> = {}) =>
  request({
    unsafeMethod: true,
    permissions: { user: ['ban'] },
    audited: { action: 'user.ban', targetKind: 'user' },
    targetId: 'bob',
    ...changes,
  });

const authorize = (found: AdminSession | null, call: AdminRequest) =>
  Effect.gen(function* () {
    const admin = yield* AdminAccess;
    return yield* admin.authorize(call);
  }).pipe(
    Effect.provide(AccessLive.pipe(Layer.provide(signedInAs(found)))),
    Effect.match({
      onFailure: (error) => `${error._tag}: ${error.message}`,
      onSuccess: (caller) => caller.id,
    }),
  );

const FORBIDDEN = 'Forbidden: Your account can’t do that.';

describe('AdminAccess', () => {
  it.effect('No session', () =>
    Effect.gen(function* () {
      for (const call of [
        request(),
        write(),
        request({ permissions: null }),
        write({ headers: Headers.empty, audited: null }),
      ]) {
        const refused = yield* authorize(null, call);
        assert.match(refused, /^Unauthorized/u);
      }
    }),
  );

  it.effect('Banned admin', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1000);
      const banned = (expiresAt: number | null) =>
        authorize(
          session({
            ban: {
              reason: null,
              expiresAt:
                expiresAt === null ? null : DateTime.makeUnsafe(expiresAt),
            },
          }),
          request(),
        );
      const forever = yield* banned(null);
      assert.match(forever, /^Unauthorized/u);
      const running = yield* banned(1001);
      assert.match(running, /^Unauthorized/u);
      const ended = yield* banned(1000);
      assert.strictEqual(ended, 'ada');
    }),
  );

  it.effect('Admin impersonating a customer', () =>
    Effect.gen(function* () {
      const refused = yield* authorize(session({}, 'root'), request());
      assert.match(refused, /^Forbidden: Stop impersonating/u);
    }),
  );

  it.effect('Another subdomain, or no origin', () =>
    Effect.gen(function* () {
      for (const origin of [
        undefined,
        '',
        'null',
        'http://other.admin.test',
        'https://admin.test',
        'http://admin.test:8080',
        'http://admin.test.evil.example',
        'http://evil.example/http://admin.test',
      ]) {
        const headers =
          origin === undefined
            ? Headers.empty
            : Headers.fromInput({ origin, referer: `${ADMIN_ORIGIN}/` });
        const refused = yield* authorize(session(), write({ headers }));
        assert.match(refused, /^Forbidden: This did not come/u, origin);
        const query = yield* authorize(
          session(),
          request({ headers, unsafeMethod: true, readOnly: true }),
        );
        assert.match(query, /^Forbidden: This did not come/u, origin);
        // Reads change nothing, so they need none.
        const read = yield* authorize(session(), request({ headers }));
        assert.strictEqual(read, 'ada');
      }
      const written = yield* authorize(session(), write());
      assert.strictEqual(written, 'ada');
    }),
  );

  it.effect('Role grants the permission', () =>
    Effect.gen(function* () {
      const caller = yield* authorize(
        session({ roles: ['host', 'admin'] }),
        request(),
      );
      assert.strictEqual(caller, 'ada');
    }),
  );

  it.effect('Permissions split across roles', () =>
    Effect.gen(function* () {
      const refused = yield* authorize(
        session({ roles: ['lister', 'support'] }),
        request({ permissions: { user: ['list'], billing: ['grant'] } }),
      );
      assert.strictEqual(refused, FORBIDDEN);
    }),
  );

  it.effect('Ordinary user', () =>
    Effect.gen(function* () {
      const refused = yield* authorize(session({ roles: [] }), request());
      assert.strictEqual(refused, FORBIDDEN);
    }),
  );

  it.effect('Project permission', () =>
    Effect.gen(function* () {
      const support = session({ roles: ['support'] });
      const granted = yield* authorize(
        support,
        request({ permissions: { billing: ['grant'] } }),
      );
      assert.strictEqual(granted, 'ada');
      const listing = yield* authorize(support, request());
      assert.strictEqual(listing, FORBIDDEN);
    }),
  );

  it.effect('Forgotten declaration', () =>
    Effect.gen(function* () {
      const none = yield* authorize(session(), request({ permissions: null }));
      assert.match(none, /^Forbidden: This endpoint declares no/u);
      for (const permissions of [{}, { user: [] }, { never: ['defined'] }]) {
        const refused = yield* authorize(session(), request({ permissions }));
        assert.strictEqual(refused, FORBIDDEN);
      }
    }),
  );

  it.effect('a permission the public app checks is not enough', () =>
    Effect.gen(function* () {
      const refused = yield* authorize(
        session({ roles: ['host'] }),
        request({ permissions: { outing: ['host'] } }),
      );
      assert.strictEqual(refused, FORBIDDEN);
    }),
  );

  it.effect('Forgotten action', () =>
    Effect.gen(function* () {
      const refused = yield* authorize(session(), write({ audited: null }));
      assert.match(refused, /^Forbidden: This endpoint names no action/u);
    }),
  );

  it.effect('refuses to start with an origin that is not one', () =>
    Effect.gen(function* () {
      for (const origin of ['admin.test', 'app://', 'http://admin.test/path']) {
        const exit = yield* AdminAccess.layer({ origins: [origin] }).pipe(
          Layer.provide(access.layer),
          Layer.provide(MemoryAuditLog),
          Layer.provide(signedInAs(null)),
          Layer.build,
          Effect.exit,
        );
        assert.strictEqual(exit._tag, 'Failure', origin);
      }
    }),
  );

  it.effect('gives the operation its caller', () =>
    Effect.gen(function* () {
      const admin = yield* AdminAccess;
      const caller = yield* admin.run(request(), CurrentAdmin, () => true);
      assert.deepStrictEqual(caller, {
        id: 'ada',
        email: 'ada@example.com',
        roles: ['admin'],
        credential: { kind: 'session' },
      });
    }).pipe(
      Effect.provide(AccessLive.pipe(Layer.provide(signedInAs(session())))),
    ),
  );

  it.effect('An interrupted request still records what it did', () =>
    Effect.gen(function* () {
      const admin = yield* AdminAccess;
      const log = yield* AuditLog;
      const acted = yield* Deferred.make<void>();
      const proceed = yield* Deferred.make<void>();
      const operation = Effect.andThen(
        Deferred.succeed(acted, undefined),
        Deferred.await(proceed),
      );
      const fiber = yield* admin
        .run(write(), operation, () => true)
        .pipe(Effect.forkChild);
      yield* Deferred.await(acted);
      const interruption = yield* fiber.pipe(Fiber.interrupt, Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Deferred.succeed(proceed, undefined);
      yield* Fiber.join(interruption);
      const { items } = yield* log.list({ limit: 10 });
      assert.strictEqual(items.length, 1);
    }).pipe(
      Effect.provide(AccessLive.pipe(Layer.provide(signedInAs(session())))),
    ),
  );

  it.effect('an action that started and broke is logged, not recorded', () =>
    Effect.gen(function* () {
      const logs = yield* captureLogs;
      const entries = yield* Effect.gen(function* () {
        const admin = yield* AdminAccess;
        const log = yield* AuditLog;
        yield* Effect.exit(admin.run(write(), Effect.die('x'), () => true));
        yield* Effect.exit(admin.run(write(), Effect.fail('x'), () => true));
        // Nothing it could have changed, so nothing to say.
        yield* Effect.exit(admin.run(request(), Effect.die('x'), () => true));
        return yield* log.list({ limit: 10 });
      }).pipe(
        Effect.provide([
          AccessLive.pipe(Layer.provide(signedInAs(session()))),
          logs.layer,
        ]),
      );
      assert.deepStrictEqual(entries.items, []);
      const lines = yield* logs.lines;
      assert.strictEqual(lines.length, 1);
      assert.include(lines[0], 'outcome is unknown');
    }),
  );
});

describe('AdminAccess over HTTP', () => {
  const send = (found: AdminSession, init: RequestInit) =>
    Effect.gen(function* () {
      const app = yield* serve(
        HttpRouter.toWebHandler(
          UsersLive.pipe(
            Layer.provide(AccessLive),
            Layer.provide(signedInAs(found)),
            Layer.provide(MemoryUsers),
            Layer.provide(HttpServer.layerServices),
          ),
          { disableLogger: true },
        ),
      );
      return yield* app('/users', init);
    });

  it.effect('Banned admin', () =>
    Effect.gen(function* () {
      const response = yield* send(
        session({ ban: { reason: null, expiresAt: null } }),
        {},
      );
      assert.strictEqual(response.status, 401);
      const body = yield* Effect.promise(() => response.text());
      assert.include(body, 'banned');
    }),
  );

  it.effect('HEAD is a read, so it needs no origin', () =>
    Effect.gen(function* () {
      for (const method of ['GET', 'HEAD']) {
        const response = yield* send(session(), { method });
        assert.strictEqual(response.status, 200, method);
      }
    }),
  );
});

describe('impersonatedBy', () => {
  it.effect('Project blocks a purchase', () =>
    Effect.gen(function* () {
      const asked = (found: AdminSession | null) =>
        impersonatedBy.pipe(
          Effect.provide(signedInAs(found)),
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            HttpServerRequest.fromWeb(new Request('http://localhost/checkout')),
          ),
        );
      const impersonating = yield* asked(session({}, 'root'));
      assert.deepStrictEqual(impersonating, Option.some('root'));
      const own = yield* asked(session());
      assert.deepStrictEqual(own, Option.none());
      const visitor = yield* asked(null);
      assert.deepStrictEqual(visitor, Option.none());
    }),
  );
});

declare const anyDirectory: Layer.Layer<UserDirectory>;
declare const anySessions: Layer.Layer<AdminSessions>;

declare const anyLinks: Layer.Layer<PasswordLinks>;

// A host provides its choices below the products, and `HttpRouter.toWebHandler`
// takes only a layer that still needs nothing else.
const choices = Layer.mergeAll(AccessLive, HttpServer.layerServices);

// Whether a layer still needs a service, which is what fails the host's
// typecheck.
const needs = <A, E, R, I, S>(
  _layer: Layer.Layer<A, E, R>,
  _service: Context.Key<I, S>,
  answer: I extends R ? true : false,
) => answer;

describe('A missing choice fails before requests are served', () => {
  it('an operation that emails a link, without links', () => {
    for (const operation of [
      usersLive({ invite: linkTo('/welcome') }),
      usersLive({ passwordLink: linkTo('/reset') }),
    ]) {
      const missing = () =>
        needs(
          operation.pipe(Layer.provide([choices, anyDirectory])),
          PasswordLinks,
          true,
        );
      const complete = () =>
        needs(
          operation.pipe(Layer.provide([choices, anyDirectory, anyLinks])),
          PasswordLinks,
          false,
        );
      assert.isFunction(missing);
      assert.isFunction(complete);
    }
    // @ts-expect-error -- where links land is not optional
    const nowhere = () => usersLive({ invite: linkTo() });
    assert.isFunction(nowhere);
  });

  it('No session source', () => {
    const complete = () =>
      HttpRouter.toWebHandler(
        UsersLive.pipe(
          Layer.provide(AccessLive),
          Layer.provide(anySessions),
          Layer.provide(anyDirectory),
          Layer.provide(HttpServer.layerServices),
        ),
      );
    const missing = () =>
      needs(
        UsersLive.pipe(
          Layer.provide(AccessLive),
          Layer.provide(anyDirectory),
          Layer.provide(HttpServer.layerServices),
        ),
        AdminSessions,
        true,
      );
    assert.isFunction(complete);
    assert.isFunction(missing);
  });
});
