import { assert, describe, it } from '@effect/vitest';
import {
  Array as Arr,
  Context,
  DateTime,
  Effect,
  type Layer,
  Option,
  Schema,
} from 'effect';
import { Headers } from 'effect/http';

import {
  AdminSessions,
  AdminUser,
  AdminUserPage,
  AuditPage,
} from '../../src/index.ts';
import { Accounts } from './accounts.ts';
import { as, type Backend, cookieFrom, makeHost, post } from './app.ts';

const json = <S extends Schema.Constraint>(schema: S, response: Response) =>
  Effect.promise(() => response.json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
  );

// The `admin-user-management` scenarios, over any backend. The backend's
// Better Auth plugin, if any, is built from `access` in ./access.ts. Requests
// go to http://localhost:3000/admin/... from http://admin.test.
export const usersSuite = <E>(
  name: string,
  backend: Layer.Layer<Backend, E>,
) => {
  // A host with an admin signed in, and a customer.
  const setup = Effect.gen(function* () {
    const host = yield* makeHost(backend);
    const accounts = Context.get(host.services, Accounts);
    const sessions = Context.get(host.services, AdminSessions);
    const ada = yield* accounts.create({
      email: 'ada@example.com',
      name: 'Ada',
      roles: 'admin',
    });
    const customer = yield* accounts.create({
      email: 'customer@example.com',
      name: 'Customer',
    });
    const cookie = yield* accounts.signIn(ada.id);
    const asAda = (path: string, init?: RequestInit) =>
      host.send(`/admin${path}`, as(cookie, init));
    const sessionOf = (held: string) =>
      sessions.find(Headers.fromInput({ cookie: held }));
    const audit = Effect.flatMap(asAda('/audit'), (response) =>
      json(AuditPage, response),
    ).pipe(Effect.map((page) => page.items));
    const user = (id: string) =>
      Effect.flatMap(asAda(`/users/${id}`), (response) =>
        json(AdminUser, response),
      );
    return { ...host, accounts, ada, customer, asAda, sessionOf, audit, user };
  });

  describe(`users over ${name}`, () => {
    describe('Admins can find users', () => {
      it.effect('newest first, a page at a time', () =>
        Effect.gen(function* () {
          const { asAda, customer, ada } = yield* setup;
          const first = yield* Effect.flatMap(
            asAda('/users?limit=1'),
            (response) => json(AdminUserPage, response),
          );
          const second = yield* Effect.flatMap(
            asAda('/users?limit=1&offset=1'),
            (response) => json(AdminUserPage, response),
          );
          assert.deepStrictEqual(
            Arr.map([...first.items, ...second.items], (found) => found.id),
            [customer.id, ada.id],
          );
          assert.strictEqual(first.total, 2);
        }),
      );

      it.effect('Search', () =>
        Effect.gen(function* () {
          const { asAda, ada } = yield* setup;
          const page = yield* Effect.flatMap(
            asAda('/users?search=%20ADA%20'),
            (response) => json(AdminUserPage, response),
          );
          assert.deepStrictEqual(
            Arr.map(page.items, (found) => found.id),
            [ada.id],
          );
          assert.strictEqual(page.total, 1);
        }),
      );

      it.effect('Search takes wildcards literally', () =>
        Effect.gen(function* () {
          const { asAda } = yield* setup;
          for (const term of ['%25', '_']) {
            const page = yield* Effect.flatMap(
              asAda(`/users?search=${term}`),
              (response) => json(AdminUserPage, response),
            );
            assert.strictEqual(page.total, 0, term);
          }
        }),
      );

      it.effect('Page limit', () =>
        Effect.gen(function* () {
          const { accounts, asAda } = yield* setup;
          yield* Effect.forEach(
            Arr.range(1, 100),
            (n) => accounts.create({ email: `many-${n}@example.com` }),
            { concurrency: 1, discard: true },
          );
          const page = yield* Effect.flatMap(
            asAda('/users?limit=1000'),
            (response) => json(AdminUserPage, response),
          );
          assert.strictEqual(page.items.length, 100);
          assert.strictEqual(page.total, 102);
          const rest = yield* Effect.flatMap(
            asAda('/users?limit=100&offset=100'),
            (response) => json(AdminUserPage, response),
          );
          const ids = Arr.map(
            [...page.items, ...rest.items],
            (found) => found.id,
          );
          assert.strictEqual(Arr.dedupe(ids).length, 102);
        }),
      );

      it.effect('a page size or offset out of range is brought into it', () =>
        Effect.gen(function* () {
          const { asAda } = yield* setup;
          for (const query of ['limit=0', 'limit=-5', 'limit=0.5']) {
            const page = yield* Effect.flatMap(
              asAda(`/users?${query}`),
              (response) => json(AdminUserPage, response),
            );
            assert.strictEqual(page.items.length, 1, query);
          }
          const page = yield* Effect.flatMap(
            asAda('/users?offset=-3'),
            (response) => json(AdminUserPage, response),
          );
          assert.strictEqual(page.items.length, 2);
          for (const query of ['limit=NaN', 'offset=Infinity', 'limit=x']) {
            const response = yield* asAda(`/users?${query}`);
            assert.strictEqual(response.status, 400, query);
          }
        }),
      );
    });

    describe('Admins can view a user', () => {
      it.effect('account data', () =>
        Effect.gen(function* () {
          const { user, ada } = yield* setup;
          const found = yield* user(ada.id);
          assert.deepInclude(found, {
            id: ada.id,
            email: 'ada@example.com',
            name: 'Ada',
            roles: ['admin'],
            banned: false,
            banReason: null,
          });
        }),
      );

      it.effect('Unknown user', () =>
        Effect.gen(function* () {
          const { asAda } = yield* setup;
          const missing = yield* asAda('/users/nobody');
          assert.strictEqual(missing.status, 404);
          for (const action of ['ban', 'unban', 'impersonate']) {
            const response = yield* asAda(
              `/users/nobody/${action}`,
              post(action === 'ban' ? {} : undefined),
            );
            assert.strictEqual(response.status, 404, action);
          }
        }),
      );
    });

    describe('Admins can ban and unban', () => {
      // Live, as the entry's time is the server's.
      it.live('Ban ends sessions', () =>
        Effect.gen(function* () {
          const { accounts, ada, asAda, audit, customer, sessionOf, user } =
            yield* setup;
          const started = yield* DateTime.now;
          const held = yield* accounts.signIn(customer.id);
          const before = yield* sessionOf(held);
          assert.isTrue(Option.isSome(before));
          const banned = yield* asAda(
            `/users/${customer.id}/ban`,
            post({ reason: 'Abuse' }),
          );
          assert.strictEqual(banned.status, 204);
          const after = yield* sessionOf(held);
          assert.isTrue(Option.isNone(after));
          const found = yield* user(customer.id);
          assert.deepInclude(found, {
            banned: true,
            banReason: 'Abuse',
          });
          const finished = yield* DateTime.now;
          const entries = yield* audit;
          assert.strictEqual(entries.length, 1);
          assert.deepInclude(entries[0], {
            actorId: ada.id,
            actorEmail: 'ada@example.com',
            action: 'user.ban',
            targetKind: 'user',
            targetId: customer.id,
            targetUserId: customer.id,
            detail: 'Abuse',
          });
          const at = entries[0]?.createdAt ?? finished;
          assert.isTrue(
            DateTime.between(at, { minimum: started, maximum: finished }),
          );
        }),
      );

      it.effect('No reason', () =>
        Effect.gen(function* () {
          const { asAda, audit, customer, user } = yield* setup;
          const banned = yield* asAda(`/users/${customer.id}/ban`, post({}));
          assert.strictEqual(banned.status, 204);
          const found = yield* user(customer.id);
          assert.deepInclude(found, {
            banned: true,
            banReason: null,
          });
          const entries = yield* audit;
          assert.strictEqual(entries.length, 1);
          assert.strictEqual(entries[0]?.detail, null);
        }),
      );

      it.effect('Banning yourself', () =>
        Effect.gen(function* () {
          const { ada, asAda, audit, user } = yield* setup;
          const response = yield* asAda(`/users/${ada.id}/ban`, post({}));
          assert.strictEqual(response.status, 403);
          const self = yield* user(ada.id);
          assert.strictEqual(self.banned, false);
          const recorded = yield* audit;
          assert.deepStrictEqual(recorded, []);
        }),
      );

      it.effect('a banned admin loses the users they impersonate', () =>
        Effect.gen(function* () {
          const { accounts, asAda, customer, send, sessionOf } = yield* setup;
          const other = yield* accounts.create({
            email: 'other@example.com',
            roles: 'admin',
          });
          const otherCookie = yield* accounts.signIn(other.id);
          const impersonation = yield* send(
            `/admin/users/${customer.id}/impersonate`,
            as(otherCookie, post()),
          );
          const held = cookieFrom(impersonation);
          const before = yield* sessionOf(held);
          assert.isTrue(Option.isSome(before));
          yield* asAda(`/users/${other.id}/ban`, post({}));
          const after = yield* sessionOf(held);
          assert.isTrue(Option.isNone(after));
        }),
      );

      it.effect('Unban, and unbanning a user who is not banned', () =>
        Effect.gen(function* () {
          const { asAda, audit, customer, user } = yield* setup;
          yield* asAda(`/users/${customer.id}/ban`, post({ reason: 'Abuse' }));
          const unbanned = yield* asAda(`/users/${customer.id}/unban`, post());
          assert.strictEqual(unbanned.status, 204);
          const found = yield* user(customer.id);
          assert.deepInclude(found, {
            banned: false,
            banReason: null,
          });
          const again = yield* asAda(`/users/${customer.id}/unban`, post());
          assert.strictEqual(again.status, 204);
          const recorded = yield* audit;
          assert.sameOrderedMembers(
            Arr.map(recorded, (entry) => entry.action),
            ['user.unban', 'user.ban'],
          );
        }),
      );
    });

    describe('Admins can impersonate users', () => {
      it.effect('Impersonating a customer', () =>
        Effect.gen(function* () {
          const { ada, asAda, audit, customer, send, sessionOf } = yield* setup;
          const response = yield* asAda(
            `/users/${customer.id}/impersonate`,
            post(),
          );
          assert.strictEqual(response.status, 204);
          const held = cookieFrom(response);
          const found = yield* sessionOf(held);
          const session = Option.getOrThrow(found);
          assert.strictEqual(session.user.id, customer.id);
          assert.strictEqual(session.impersonatedBy, ada.id);
          const [entry] = yield* audit;
          assert.deepInclude(entry, {
            actorId: ada.id,
            action: 'user.impersonate',
            targetUserId: customer.id,
          });
          const refused = yield* send('/admin/users', as(held));
          assert.strictEqual(refused.status, 403);
        }),
      );

      it.effect('Role that only the public app checks', () =>
        Effect.gen(function* () {
          const { accounts, asAda, customer } = yield* setup;
          yield* accounts.setRoles(customer.id, 'host, user');
          const response = yield* asAda(
            `/users/${customer.id}/impersonate`,
            post(),
          );
          assert.strictEqual(response.status, 204);
        }),
      );

      it.effect('Impersonating an admin', () =>
        Effect.gen(function* () {
          const { accounts, asAda, audit, customer } = yield* setup;
          for (const roles of ['admin', 'user, support', 'host,lister ']) {
            yield* accounts.setRoles(customer.id, roles);
            const response = yield* asAda(
              `/users/${customer.id}/impersonate`,
              post(),
            );
            assert.strictEqual(response.status, 403, roles);
            assert.deepStrictEqual(response.headers.getSetCookie(), []);
          }
          const recorded = yield* audit;
          assert.deepStrictEqual(recorded, []);
        }),
      );

      it.effect('impersonating an admin with the extra permission', () =>
        Effect.gen(function* () {
          const { accounts, ada, send } = yield* setup;
          const owner = yield* accounts.create({
            email: 'owner@example.com',
            roles: 'user, owner',
          });
          const cookie = yield* accounts.signIn(owner.id);
          const response = yield* send(
            `/admin/users/${ada.id}/impersonate`,
            as(cookie, post()),
          );
          assert.strictEqual(response.status, 204);
        }),
      );

      it.effect('yourself, or a banned user', () =>
        Effect.gen(function* () {
          const { accounts, asAda, customer, send } = yield* setup;
          // One who may impersonate admins, so only the rule against oneself
          // refuses.
          const owner = yield* accounts.create({
            email: 'owner@example.com',
            roles: 'owner',
          });
          const cookie = yield* accounts.signIn(owner.id);
          const self = yield* send(
            `/admin/users/${owner.id}/impersonate`,
            as(cookie, post()),
          );
          assert.strictEqual(self.status, 403);
          assert.deepStrictEqual(self.headers.getSetCookie(), []);
          yield* asAda(`/users/${customer.id}/ban`, post({}));
          const banned = yield* asAda(
            `/users/${customer.id}/impersonate`,
            post(),
          );
          assert.strictEqual(banned.status, 403);
        }),
      );
    });

    it.effect('Role removed moments ago', () =>
      Effect.gen(function* () {
        const { accounts, ada, asAda } = yield* setup;
        const before = yield* asAda('/users');
        assert.strictEqual(before.status, 200);
        yield* accounts.setRoles(ada.id, 'user');
        const after = yield* asAda('/users');
        assert.strictEqual(after.status, 403);
      }),
    );

    it.effect('Admin without the project’s permission', () =>
      Effect.gen(function* () {
        const { accounts, customer, send } = yield* setup;
        yield* accounts.setRoles(customer.id, 'lister');
        const cookie = yield* accounts.signIn(customer.id);
        const list = yield* send('/admin/users', as(cookie));
        assert.strictEqual(list.status, 200);
        const ban = yield* send('/admin/users/x/ban', as(cookie, post({})));
        assert.strictEqual(ban.status, 403);
      }),
    );
  });
};
