import { assert, describe, it } from '@effect/vitest';
import { Cause, Context, Effect, Exit, Layer, String as Str } from 'effect';
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
} from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/http-api';

import { defineAccess } from '../src/access.ts';
import { AdminAuth, UsersApi } from '../src/contract.ts';
import {
  type AccessRules,
  type AuditLog,
  Audited,
  RequiredPermissions,
  type UserDirectory,
  auditProduct,
} from '../src/index.ts';
import {
  AdminAccess,
  AuditLive,
  UsersLive,
  adminApi,
  mountAt,
} from '../src/server.ts';
import { access } from './support/access.ts';
import { Accounts } from './support/accounts.ts';
import { ADMIN_ORIGIN, AccessLive, SITE, as, serve } from './support/app.ts';
import { MemoryAuditLog } from './support/memory-audit-log.ts';
import { MemoryUsers } from './support/memory-users.ts';

class Outside extends HttpApiMiddleware.Service<Outside>()(
  'shoemaker-admin/test/mount.test/Outside',
) {}

const OutsideLive = Layer.succeed(Outside, (httpEffect) => httpEffect);

const HostApi = HttpApi.make('host').add(
  HttpApiGroup.make('public').add(
    HttpApiEndpoint.get('health', '/health', {
      success: HttpApiSchema.NoContent,
    }),
  ),
);

const HostRoutes = HttpApiBuilder.layer(HostApi, {
  openapiPath: '/openapi.json',
}).pipe(
  Layer.provide(
    HttpApiBuilder.group(HostApi, 'public', (handlers) =>
      handlers.handle('health', () => Effect.void),
    ),
  ),
);

const makeHost = Effect.fnUntraced(function* (prefixes: {
  readonly users: `/${string}`;
  readonly audit: `/${string}`;
}) {
  const services = yield* Layer.build(
    AccessLive.pipe(Layer.provideMerge(MemoryUsers)),
  );
  const accounts = Context.get(services, Accounts);
  const ada = yield* accounts.create({
    email: 'ada@example.com',
    roles: 'admin',
  });
  const cookie = yield* accounts.signIn(ada.id);
  const send = yield* serve(
    HttpRouter.toWebHandler(
      Layer.mergeAll(
        HostRoutes,
        mountAt(prefixes.users)(UsersLive),
        mountAt(prefixes.audit)(AuditLive),
      ).pipe(
        Layer.provide(Layer.succeedContext(services)),
        Layer.provide(HttpServer.layerServices),
      ),
      { disableLogger: true },
    ),
  );
  return { ada, cookie, send };
});

const hostAt = (prefix: `/${string}`) =>
  makeHost({ users: prefix, audit: prefix });

describe('The host chooses where a product is mounted', () => {
  for (const prefix of ['/admin', '/api/admin'] as const) {
    it.effect(`Different prefixes: ${prefix}`, () =>
      Effect.gen(function* () {
        const { ada, cookie, send } = yield* hostAt(prefix);
        const client = yield* HttpApiClient.make(UsersApi, {
          baseUrl: `${SITE}${prefix}`,
          transformClient: HttpClient.mapRequest(
            HttpClientRequest.setHeaders({ cookie, origin: ADMIN_ORIGIN }),
          ),
        }).pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make((request, url) =>
              Effect.map(
                send(Str.slice(SITE.length)(url.href), {
                  method: request.method,
                  headers: request.headers,
                }),
                (response) => HttpClientResponse.fromWeb(request, response),
              ),
            ),
          ),
        );
        const user = yield* client.users.get({ params: { id: ada.id } });
        assert.strictEqual(user.email, 'ada@example.com');
        const missing = yield* Effect.flip(
          client.users.get({ params: { id: 'nobody' } }),
        );
        assert.strictEqual(missing._tag, 'UserNotFound');
        const unprefixed = yield* send('/users', as(cookie));
        assert.strictEqual(unprefixed.status, 404);
      }),
    );
  }

  it.effect('each product at its own prefix in one host', () =>
    Effect.gen(function* () {
      const { cookie, send } = yield* makeHost({
        users: '/admin',
        audit: '/api/log',
      });
      for (const path of ['/admin/users', '/api/log/audit']) {
        const response = yield* send(path, as(cookie));
        assert.strictEqual(response.status, 200, path);
      }
      const elsewhere = yield* send('/admin/audit', as(cookie));
      assert.strictEqual(elsewhere.status, 404);
    }),
  );

  it.effect('Public API description', () =>
    Effect.gen(function* () {
      const { send } = yield* hostAt('/admin');
      const response = yield* send('/openapi.json');
      const text = yield* Effect.promise(() => response.text());
      assert.include(text, '/health');
      assert.notInclude(text, '/users');
      assert.notInclude(text, '/audit');
    }),
  );
});

describe('Products share the host’s admin auth', () => {
  it.effect('Product endpoint', () =>
    Effect.gen(function* () {
      const { send } = yield* hostAt('/admin');
      for (const [method, path] of [
        ['GET', '/users'],
        ['GET', '/users/x'],
        ['POST', '/users/x/ban'],
        ['POST', '/users/x/unban'],
        ['POST', '/users/x/impersonate'],
        ['GET', '/audit'],
        // Refused before anything is decoded.
        ['GET', '/users?limit=x'],
      ]) {
        const response = yield* send(`/admin${path}`, { method: method ?? '' });
        assert.strictEqual(response.status, 401, path);
      }
    }),
  );
});

describe('Permissions combine from the project and its products', () => {
  // Builds routes over access rules, and says why that failed.
  const failure = (
    rules: typeof access.layer,
    routes: Layer.Layer<
      never,
      never,
      | AccessRules
      | AdminAccess
      | AuditLog
      | HttpRouter.HttpRouter
      | Layer.Success<typeof HttpServer.layerServices>
      | UserDirectory
    >,
  ) =>
    Layer.build(
      routes.pipe(
        Layer.provide(AdminAccess.layer({ origins: [ADMIN_ORIGIN] })),
        Layer.provide(rules),
        Layer.provide(MemoryAuditLog),
        Layer.provide(MemoryUsers),
        Layer.provide(HttpServer.layerServices),
        Layer.provide(HttpRouter.layer),
      ),
    ).pipe(
      Effect.exit,
      Effect.map(
        Exit.match({
          onFailure: (cause) => Cause.pretty(cause),
          onSuccess: () => 'started',
        }),
      ),
    );

  const api = (
    permissions: Readonly<Record<string, ReadonlyArray<string>>>,
  ) => {
    const Own = HttpApi.make('own')
      .add(
        HttpApiGroup.make('own').add(
          HttpApiEndpoint.get('read', '/read', {
            success: HttpApiSchema.NoContent,
          }).annotate(RequiredPermissions, permissions),
        ),
      )
      .middleware(AdminAuth);
    return adminApi(Own, {
      product: 'host',
      handlers: HttpApiBuilder.group(Own, 'own', (handlers) =>
        handlers.handle('read', () => Effect.void),
      ),
    });
  };

  it.effect('Product mounted without its permissions', () =>
    Effect.gen(function* () {
      // Better Auth defines `user`, so what is missing is the audit product's.
      const bare = defineAccess({ statements: { billing: ['read'] } });
      const own = yield* failure(bare.layer, api(auditProduct.statements));
      assert.include(own, 'host: own.read needs audit:list');
      const product = yield* failure(bare.layer, AuditLive);
      assert.include(product, 'audit: audit.list needs audit:list');
      const users = yield* failure(bare.layer, UsersLive);
      assert.strictEqual(users, 'started');
    }),
  );

  it.effect('Admin endpoint with a public permission', () =>
    Effect.gen(function* () {
      const refused = yield* failure(access.layer, api({ outing: ['host'] }));
      assert.include(refused, 'host: own.read needs only permissions');
      const both = yield* failure(
        access.layer,
        api({ outing: ['host'], billing: ['read'] }),
      );
      assert.strictEqual(both, 'started');
    }),
  );

  it.effect('an endpoint that is not behind the access check', () =>
    Effect.gen(function* () {
      const Open = HttpApi.make('open').add(
        HttpApiGroup.make('open').add(
          HttpApiEndpoint.get('read', '/read', {
            success: HttpApiSchema.NoContent,
          }).annotate(RequiredPermissions, { billing: ['read'] }),
        ),
      );
      const refused = yield* failure(
        access.layer,
        adminApi(Open, {
          product: 'host',
          handlers: HttpApiBuilder.group(Open, 'open', (handlers) =>
            handlers.handle('read', () => Effect.void),
          ),
        }),
      );
      assert.include(refused, 'host: open.read is not behind AdminAuth');
    }),
  );

  const own = HttpApiEndpoint.get('read', '/read', {
    success: HttpApiSchema.NoContent,
  }).annotate(RequiredPermissions, { billing: ['read'] });

  it.effect('handlers of a contract that is not behind the access check', () =>
    Effect.gen(function* () {
      // The served endpoints are those the handlers were built from.
      const Own = HttpApi.make('own').add(HttpApiGroup.make('own').add(own));
      const refused = yield* failure(
        access.layer,
        adminApi(Own.middleware(AdminAuth), {
          product: 'host',
          handlers: HttpApiBuilder.group(Own, 'own', (handlers) =>
            handlers.handle('read', () => Effect.void),
          ),
        }),
      );
      assert.include(refused, 'host: own.read is not behind AdminAuth');
    }),
  );

  it.effect('a middleware outside the access check', () =>
    Effect.gen(function* () {
      const Own = HttpApi.make('own')
        .add(HttpApiGroup.make('own').add(own))
        .middleware(AdminAuth)
        .middleware(Outside);
      const refused = yield* failure(
        access.layer,
        adminApi(Own, {
          product: 'host',
          handlers: HttpApiBuilder.group(Own, 'own', (handlers) =>
            handlers.handle('read', () => Effect.void),
          ),
        }).pipe(Layer.provide(OutsideLive)),
      );
      assert.include(refused, 'host: own.read has a middleware outside');
    }),
  );

  it.effect('a middleware inside it is fine', () =>
    Effect.gen(function* () {
      const Own = HttpApi.make('own')
        .add(HttpApiGroup.make('own').add(own))
        .middleware(Outside)
        .middleware(AdminAuth);
      const started = yield* failure(
        access.layer,
        adminApi(Own, {
          product: 'host',
          handlers: HttpApiBuilder.group(Own, 'own', (handlers) =>
            handlers.handle('read', () => Effect.void),
          ),
        }).pipe(Layer.provide(OutsideLive)),
      );
      assert.strictEqual(started, 'started');
    }),
  );

  it.effect('an audited target with no id to take', () =>
    Effect.gen(function* () {
      const started = (path: '/flags' | '/flags/:id' | '/flags/:identity') => {
        const Own = HttpApi.make('own')
          .add(
            HttpApiGroup.make('own').add(
              HttpApiEndpoint.put('write', path, {
                success: HttpApiSchema.NoContent,
              })
                .annotate(RequiredPermissions, { billing: ['read'] })
                .annotate(Audited, { action: 'flag', targetKind: 'flag' }),
            ),
          )
          .middleware(AdminAuth);
        return failure(
          access.layer,
          adminApi(Own, {
            product: 'host',
            handlers: HttpApiBuilder.group(Own, 'own', (handlers) =>
              handlers.handle('write', () => Effect.void),
            ),
          }),
        );
      };
      for (const path of ['/flags', '/flags/:identity'] as const) {
        const refused = yield* started(path);
        assert.include(refused, 'host: own.write records a flag', path);
      }
      const fine = yield* started('/flags/:id');
      assert.strictEqual(fine, 'started');
    }),
  );
});

describe('Two access checks in one build', () => {
  it.effect('each API keeps its own', () =>
    Effect.gen(function* () {
      const apiAt = (id: string, path: `/${string}`, origin: string) => {
        const Own = HttpApi.make(id)
          .add(
            HttpApiGroup.make('own').add(
              HttpApiEndpoint.post('write', path, {
                success: HttpApiSchema.NoContent,
              })
                .annotate(RequiredPermissions, { billing: ['read'] })
                .annotate(Audited, { action: 'write' }),
            ),
          )
          .middleware(AdminAuth);
        return adminApi(Own, {
          product: id,
          handlers: HttpApiBuilder.group(Own, 'own', (handlers) =>
            handlers.handle('write', () => Effect.void),
          ),
        }).pipe(Layer.provide(AdminAccess.layer({ origins: [origin] })));
      };
      const services = yield* Layer.build(MemoryUsers);
      const accounts = Context.get(services, Accounts);
      const ada = yield* accounts.create({ email: 'a@b.c', roles: 'admin' });
      const cookie = yield* accounts.signIn(ada.id);
      const send = yield* serve(
        HttpRouter.toWebHandler(
          Layer.mergeAll(
            apiAt('one', '/one', 'http://one.test'),
            apiAt('two', '/two', 'http://two.test'),
          ).pipe(
            Layer.provide(access.layer),
            Layer.provide(MemoryAuditLog),
            Layer.provide(Layer.succeedContext(services)),
            Layer.provide(HttpServer.layerServices),
          ),
          { disableLogger: true },
        ),
      );
      const statuses = yield* Effect.forEach(
        [
          ['/one', 'http://one.test'],
          ['/one', 'http://two.test'],
          ['/two', 'http://two.test'],
          ['/two', 'http://one.test'],
        ] as const,
        ([path, origin]) =>
          Effect.map(
            send(path, { method: 'POST', headers: { cookie, origin } }),
            (response) => response.status,
          ),
        { concurrency: 1 },
      );
      assert.deepStrictEqual(statuses, [204, 403, 204, 403]);
    }),
  );
});
