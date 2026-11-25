import { assert, describe, it } from '@effect/vitest';
import {
  Array as Arr,
  Context,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
  String as Str,
} from 'effect';
import { Cookies, Headers, HttpRouter, HttpServer } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';

import {
  AdminSessions,
  AuditLog,
  UserDirectory,
  UserNotFound,
} from '../src/index.ts';
import { impersonatedBy } from '../src/server.ts';
import { Accounts } from './support/accounts.ts';
import { as, cookieFrom, makeHost, post, serve } from './support/app.ts';
import { AuditOutage } from './support/memory-audit-log.ts';
import { MemoryUsers } from './support/memory-users.ts';
import { operationsSuite } from './support/operations-suite.ts';
import { usersSuite } from './support/users-suite.ts';

usersSuite('in-memory accounts', MemoryUsers);

operationsSuite('in-memory accounts', MemoryUsers);

const setup = Effect.gen(function* () {
  const { services, send } = yield* makeHost(MemoryUsers);
  const accounts = Context.get(services, Accounts);
  const ada = yield* accounts.create({
    email: 'ada@example.com',
    roles: 'admin, owner',
  });
  const customer = yield* accounts.create({ email: 'customer@example.com' });
  const cookie = yield* accounts.signIn(ada.id);
  return {
    ada,
    customer,
    services,
    asAda: (path: string, init?: RequestInit) =>
      send(`/admin${path}`, as(cookie, init)),
    entries: Effect.map(
      Context.get(services, AuditLog).list({ limit: 100 }),
      (page) => page.items,
    ),
  };
});

describe('an id the database finds by another spelling', () => {
  it.effect('is no way to change or delete oneself', () =>
    Effect.gen(function* () {
      const { ada, asAda, customer, entries, services } = yield* setup;
      const own = `/users/${Str.toUpperCase(ada.id)}`;
      const roles = post({ roles: ['user'] }, 'PUT');
      for (const [path, init] of [
        [`${own}/roles`, roles],
        [own, { method: 'DELETE' }],
      ] as const) {
        const response = yield* asAda(path, init);
        assert.strictEqual(response.status, 403, path);
      }
      const directory = Context.get(services, UserDirectory);
      const self = yield* directory.get(ada.id);
      assert.deepStrictEqual(self.roles, ['admin', 'owner']);
      const other = `/users/${Str.toUpperCase(customer.id)}`;
      yield* asAda(`${other}/roles`, post({ roles: ['host'] }, 'PUT'));
      yield* asAda(`${other}/password-link`, post());
      yield* asAda(other, { method: 'DELETE' });
      const recorded = yield* entries;
      assert.deepStrictEqual(
        Arr.map(recorded, (entry) => entry.targetUserId),
        Arr.replicate(customer.id, 3),
      );
    }),
  );

  it.effect('is still the caller’s own', () =>
    Effect.gen(function* () {
      const { ada, asAda, entries, services } = yield* setup;
      for (const action of ['ban', 'impersonate']) {
        const response = yield* asAda(
          `/users/${Str.toUpperCase(ada.id)}/${action}`,
          post({}),
        );
        assert.strictEqual(response.status, 403, action);
      }
      const directory = Context.get(services, UserDirectory);
      const self = yield* directory.get(ada.id);
      assert.isFalse(self.banned);
      const recorded = yield* entries;
      assert.deepStrictEqual(recorded, []);
    }),
  );

  it.effect('is recorded as the account’s', () =>
    Effect.gen(function* () {
      const { asAda, customer, entries } = yield* setup;
      for (const action of ['impersonate', 'ban', 'unban']) {
        const response = yield* asAda(
          `/users/${Str.toUpperCase(customer.id)}/${action}`,
          post({}),
        );
        assert.strictEqual(response.status, 204, action);
      }
      const recorded = yield* entries;
      assert.deepStrictEqual(
        Arr.map(recorded, (entry) => entry.targetUserId),
        Arr.replicate(customer.id, 3),
      );
    }),
  );
});

describe('an impersonation that started as something changed', () => {
  const banned = { banned: true };
  for (const [change, actor, target] of [
    ['the admin was banned', banned, {}],
    ['the admin was deleted', null, {}],
    ['the admin lost the role', { roles: ['lister'] }, {}],
    ['the user was banned', {}, banned],
    ['the user was deleted', {}, null],
    ['the user became an admin', {}, { roles: ['support'] }],
  ] as const) {
    it.effect(`is ended when ${change}`, () =>
      Effect.gen(function* () {
        // The change comes once the session is there, and after whatever made
        // it has ended the sessions it found.
        const began = yield* Ref.make(Option.none<string>());
        const Changing = Layer.effect(
          UserDirectory,
          Effect.gen(function* () {
            const directory = yield* UserDirectory;
            return UserDirectory.of({
              ...directory,
              get: Effect.fnUntraced(function* (id) {
                const user = yield* directory.get(id);
                const held = yield* Ref.get(began);
                if (Option.isNone(held)) return user;
                const changed = user.roles.includes('admin') ? actor : target;
                if (changed === null) return yield* UserNotFound.make({ id });
                return { ...user, ...changed };
              }),
              impersonate: (options) =>
                Effect.tap(directory.impersonate(options), ({ cookies }) =>
                  Ref.set(
                    began,
                    cookies.pipe(Cookies.toCookieHeader, Option.some),
                  ),
                ),
            });
          }),
        ).pipe(Layer.provideMerge(MemoryUsers));
        const { send, services } = yield* makeHost(Changing);
        const accounts = Context.get(services, Accounts);
        const ada = yield* accounts.create({
          email: 'ada@example.com',
          roles: 'admin',
        });
        const customer = yield* accounts.create({
          email: 'customer@example.com',
        });
        const cookie = yield* accounts.signIn(ada.id);
        const response = yield* send(
          `/admin/users/${customer.id}/impersonate`,
          as(cookie, post()),
        );
        assert.strictEqual(response.status, 403);
        assert.deepStrictEqual(response.headers.getSetCookie(), []);
        const held = yield* Ref.get(began);
        const left = yield* Context.get(services, AdminSessions).find(
          Headers.fromInput({ cookie: Option.getOrThrow(held) }),
        );
        assert.isTrue(Option.isNone(left));
        const page = yield* Context.get(services, AuditLog).list({ limit: 9 });
        assert.deepStrictEqual(page.items, []);
      }),
    );
  }
});

describe('A missing audit entry is never silent', () => {
  it.effect('an impersonation without an entry signs nobody in', () =>
    Effect.gen(function* () {
      const { asAda, customer, services } = yield* setup;
      yield* Ref.set(Context.get(services, AuditOutage), true);
      const response = yield* asAda(
        `/users/${customer.id}/impersonate`,
        post(),
      );
      assert.strictEqual(response.status, 500);
      assert.deepStrictEqual(response.headers.getSetCookie(), []);
    }),
  );
});

class NotWhileImpersonating extends Schema.TaggedError<
  NotWhileImpersonating,
  { readonly brand: unique symbol }
>()('NotWhileImpersonating', {}, { httpApiStatus: 409 }) {}

const ShopApi = HttpApi.make('shop').add(
  HttpApiGroup.make('shop').add(
    HttpApiEndpoint.post('checkout', '/checkout', {
      success: HttpApiSchema.NoContent,
      error: NotWhileImpersonating,
    }),
  ),
);

const ShopHandlers = HttpApiBuilder.group(ShopApi, 'shop', (handlers) =>
  handlers.handle('checkout', () =>
    Effect.gen(function* () {
      const admin = yield* impersonatedBy;
      if (Option.isSome(admin)) return yield* NotWhileImpersonating.make({});
    }),
  ),
);

describe('Projects can tell when a request is impersonated', () => {
  it.effect('Project blocks a purchase', () =>
    Effect.gen(function* () {
      const { asAda, customer, services } = yield* setup;
      const shop = yield* serve(
        HttpRouter.toWebHandler(
          HttpApiBuilder.layer(ShopApi).pipe(
            Layer.provide(ShopHandlers),
            HttpRouter.provideRequest(Layer.succeedContext(services)),
            Layer.provide(HttpServer.layerServices),
          ),
          { disableLogger: true },
        ),
      );
      const impersonation = yield* asAda(
        `/users/${customer.id}/impersonate`,
        post(),
      );
      const refused = yield* shop(
        '/checkout',
        as(cookieFrom(impersonation), post()),
      );
      assert.strictEqual(refused.status, 409);
      const body = yield* Effect.promise(() => refused.text());
      assert.include(body, 'NotWhileImpersonating');
      const accounts = Context.get(services, Accounts);
      const own = yield* accounts.signIn(customer.id);
      const bought = yield* shop('/checkout', as(own, post()));
      assert.strictEqual(bought.status, 204);
    }),
  );
});
