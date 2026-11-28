import { assert, describe, it, vi } from '@effect/vitest';
import {
  Array as Arr,
  Context,
  Effect,
  Inspectable,
  Layer,
  Option,
  Ref,
  Schema,
  String as Str,
  Tracer,
} from 'effect';
import { Headers } from 'effect/http';

import {
  AdminSessions,
  AdminUser,
  AdminUserPage,
  AuditLog,
  InvitedUser,
  UserOperations,
} from '../../src/index.ts';
import { linkTo, UsersLive, usersLive } from '../../src/server.ts';
import { Accounts } from './accounts.ts';
import {
  type AllUsersLive,
  as,
  type Backend,
  cookieFrom,
  LANDINGS,
  makeHost,
  post,
} from './app.ts';
import { captureLogs } from './logs.ts';

const json = <S extends Schema.Constraint>(schema: S, response: Response) =>
  Effect.promise(() => response.json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
  );

const invitation = { email: 'New@Example.com', name: 'New' };

// Every span a program made, as text.
const captureSpans = Effect.gen(function* () {
  const spans = yield* Ref.make(Arr.empty<Tracer.NativeSpan>());
  const context = yield* Effect.context();
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      Effect.runSyncWith(context)(Ref.update(spans, Arr.append(span)));
      return span;
    },
  });
  return {
    layer: Layer.succeed(Tracer.Tracer, tracer),
    text: Effect.map(Ref.get(spans), (all) =>
      Arr.join(
        Arr.map(all, (span) =>
          Inspectable.toStringUnknown([
            span.name,
            [...span.attributes],
            span.events,
            span.status,
          ]),
        ),
        '\n',
      ),
    ),
  };
});

// The scenarios of `extend-admin-users`, over any backend.
export const operationsSuite = <E>(
  name: string,
  backend: Layer.Layer<Backend, E>,
) => {
  const setup = Effect.fnUntraced(function* (
    users?: typeof AllUsersLive,
    environment?: Layer.Layer<never>,
  ) {
    const host = yield* makeHost(backend, users, environment);
    const accounts = Context.get(host.services, Accounts);
    const sessions = Context.get(host.services, AdminSessions);
    const ada = yield* accounts.create({
      email: 'ada@example.com',
      name: 'Ada',
      roles: 'admin',
    });
    const customer = yield* accounts.create({ email: 'customer@example.com' });
    const cookie = yield* accounts.signIn(ada.id);
    const asAda = (path: string, init?: RequestInit) =>
      host.send(`/admin${path}`, as(cookie, init));
    // Somebody else with these roles.
    const asHolder = Effect.fnUntraced(function* (roles: string) {
      const holder = yield* accounts.create({
        email: 'holder@example.com',
        roles,
      });
      const held = yield* accounts.signIn(holder.id);
      return (path: string, init?: RequestInit) =>
        host.send(`/admin${path}`, as(held, init));
    });
    return {
      ...host,
      accounts,
      ada,
      customer,
      asAda,
      asHolder,
      entries: Effect.map(
        Context.get(host.services, AuditLog).list({ limit: 100 }),
        (page) => page.items,
      ),
      sessionOf: (held: string) =>
        sessions.find(Headers.fromInput({ cookie: held })),
      rolesOf: (id: string) =>
        Effect.flatMap(asAda(`/users/${id}`), (response) =>
          json(AdminUser, response),
        ).pipe(Effect.map((user) => user.roles)),
      setRoles: (id: string, roles: ReadonlyArray<string>) =>
        asAda(`/users/${id}/roles`, post({ roles }, 'PUT')),
      found: (email: string) =>
        Effect.flatMap(asAda(`/users?search=${email}`), (response) =>
          json(AdminUserPage, response),
        ).pipe(Effect.map((page) => page.items)),
    };
  });

  describe(`user operations over ${name}`, () => {
    describe('Admins can set roles', () => {
      it.effect('Several roles', () =>
        Effect.gen(function* () {
          const { ada, customer, entries, rolesOf, setRoles } = yield* setup();
          const response = yield* setRoles(customer.id, [
            'host',
            'admin',
            'host',
          ]);
          assert.strictEqual(response.status, 204);
          const roles = yield* rolesOf(customer.id);
          assert.deepStrictEqual(roles, ['host', 'admin']);
          const recorded = yield* entries;
          assert.strictEqual(recorded.length, 1);
          assert.deepInclude(recorded[0], {
            actorId: ada.id,
            action: 'user.set-roles',
            targetUserId: customer.id,
            detail: 'host, admin',
          });
        }),
      );

      it.effect('replaces what the user held, and takes effect at once', () =>
        Effect.gen(function* () {
          const { asHolder, found, rolesOf, setRoles } = yield* setup();
          const send = yield* asHolder('admin, host');
          const before = yield* send('/users');
          assert.strictEqual(before.status, 200);
          const [holder] = yield* found('holder@');
          const id = holder?.id ?? '';
          yield* setRoles(id, ['host']);
          const roles = yield* rolesOf(id);
          assert.deepStrictEqual(roles, ['host']);
          const after = yield* send('/users');
          assert.strictEqual(after.status, 403);
          yield* setRoles(id, []);
          const none = yield* rolesOf(id);
          assert.deepStrictEqual(none, ['user']);
        }),
      );

      it.effect('ends impersonations as the user, and by them', () =>
        Effect.gen(function* () {
          const {
            accounts,
            asAda,
            asHolder,
            customer,
            found,
            sessionOf,
            setRoles,
          } = yield* setup();
          const own = yield* accounts.signIn(customer.id);
          const send = yield* asHolder('admin');
          const [holder] = yield* found('holder@');
          const path = `/users/${customer.id}/impersonate`;
          const live = (held: string) =>
            Effect.map(sessionOf(held), Option.isSome);
          const as1 = yield* Effect.map(send(path, post()), cookieFrom);
          const as2 = yield* Effect.map(asAda(path, post()), cookieFrom);
          yield* setRoles(holder?.id ?? '', ['host']);
          const afterBy = yield* Effect.forEach([as1, as2, own], live, {
            concurrency: 1,
          });
          assert.deepStrictEqual(afterBy, [false, true, true]);
          yield* setRoles(customer.id, ['admin']);
          const afterAs = yield* Effect.forEach([as2, own], live, {
            concurrency: 1,
          });
          assert.deepStrictEqual(afterAs, [false, true]);
        }),
      );

      it.effect('the same roles change nothing', () =>
        Effect.gen(function* () {
          const { accounts, customer, entries, setRoles } = yield* setup();
          yield* accounts.setRoles(customer.id, 'admin, host');
          const response = yield* setRoles(customer.id, ['host', 'admin']);
          assert.strictEqual(response.status, 204);
          const recorded = yield* entries;
          assert.deepStrictEqual(recorded, []);
        }),
      );

      it.effect('Unknown role', () =>
        Effect.gen(function* () {
          const { customer, entries, rolesOf, setRoles } = yield* setup();
          yield* setRoles(customer.id, ['host']);
          for (const role of [
            'nobody',
            'constructor',
            'host,admin',
            ' admin',
            'Admin',
            '',
          ]) {
            const response = yield* setRoles(customer.id, ['host', role]);
            assert.strictEqual(response.status, 400, role);
          }
          const roles = yield* rolesOf(customer.id);
          assert.deepStrictEqual(roles, ['host']);
          const recorded = yield* entries;
          assert.strictEqual(recorded.length, 1);
        }),
      );

      it.effect('Own roles', () =>
        Effect.gen(function* () {
          const { ada, entries, rolesOf, setRoles } = yield* setup();
          for (const roles of [['admin', 'host'], ['admin'], []]) {
            const response = yield* setRoles(ada.id, roles);
            assert.strictEqual(response.status, 403);
          }
          const roles = yield* rolesOf(ada.id);
          assert.deepStrictEqual(roles, ['admin']);
          const recorded = yield* entries;
          assert.deepStrictEqual(recorded, []);
        }),
      );

      it.effect('needs the permission, and an account', () =>
        Effect.gen(function* () {
          const { asHolder, customer, setRoles } = yield* setup();
          const send = yield* asHolder('lister,inviter');
          const refused = yield* send(
            `/users/${customer.id}/roles`,
            post({ roles: ['host'] }, 'PUT'),
          );
          assert.strictEqual(refused.status, 403);
          const missing = yield* setRoles('nobody', ['host']);
          assert.strictEqual(missing.status, 404);
        }),
      );
    });

    describe('Admins can invite users', () => {
      it.effect('Invite', () =>
        Effect.gen(function* () {
          const { accounts, ada, asAda, entries } = yield* setup();
          const response = yield* asAda('/users', post(invitation));
          assert.strictEqual(response.status, 200);
          const { user, linkSent } = yield* json(InvitedUser, response);
          assert.isTrue(linkSent);
          assert.deepInclude(user, {
            email: 'new@example.com',
            name: 'New',
            roles: ['user'],
            banned: false,
          });
          for (const password of ['', 'correct horse battery']) {
            const session = yield* accounts.signInWith(user.email, password);
            assert.isTrue(Option.isNone(session));
          }
          const mail = yield* accounts.mail;
          assert.strictEqual(mail.length, 1);
          assert.deepInclude(mail[0], {
            to: 'new@example.com',
            landing: LANDINGS.invite,
          });
          const recorded = yield* entries;
          assert.strictEqual(recorded.length, 1);
          assert.deepInclude(recorded[0], {
            actorId: ada.id,
            action: 'user.invite',
            targetUserId: user.id,
            detail: 'user',
          });
        }),
      );

      it.effect('Signing in after an invite', () =>
        Effect.gen(function* () {
          const { accounts, asAda, sessionOf } = yield* setup();
          yield* asAda('/users', post({ ...invitation, roles: ['host'] }));
          const [link] = yield* accounts.mail;
          const password = 'a password they chose';
          yield* accounts.choosePassword(link?.token ?? '', password);
          const cookie = yield* accounts.signInWith(
            'new@example.com',
            password,
          );
          const session = yield* sessionOf(Option.getOrThrow(cookie));
          const { user } = Option.getOrThrow(session);
          assert.deepStrictEqual(user.roles, ['host']);
          const mail = yield* accounts.mail;
          assert.strictEqual(mail.length, 1);
        }),
      );

      it.effect('Invite with a role', () =>
        Effect.gen(function* () {
          const { asHolder, entries, found } = yield* setup();
          const send = yield* asHolder('inviter');
          for (const roles of [['admin'], ['user', 'host']]) {
            const response = yield* send(
              '/users',
              post({ ...invitation, roles }),
            );
            assert.strictEqual(response.status, 403);
          }
          const none = yield* found('new@');
          assert.deepStrictEqual(none, []);
          for (const roles of [undefined, [], ['user']]) {
            const plain = yield* send(
              '/users',
              post({
                email: `p${roles?.length}@example.com`,
                name: 'P',
                roles,
              }),
            );
            assert.strictEqual(plain.status, 200);
          }
          const recorded = yield* entries;
          assert.strictEqual(recorded.length, 3);
        }),
      );

      it.effect('one role must grant both permissions', () =>
        Effect.gen(function* () {
          const { accounts, asHolder, found } = yield* setup();
          const send = yield* asHolder('inviter, promoter');
          const body = post({ ...invitation, roles: ['admin'] });
          const split = yield* send('/users', body);
          assert.strictEqual(split.status, 403);
          const [holder] = yield* found('holder@');
          yield* accounts.setRoles(holder?.id ?? '', 'recruiter');
          const whole = yield* send('/users', body);
          assert.strictEqual(whole.status, 200);
          const invited = yield* found('new@');
          assert.deepStrictEqual(invited[0]?.roles, ['admin']);
        }),
      );

      it.effect('Unknown role', () =>
        Effect.gen(function* () {
          const { accounts, asAda, entries, found } = yield* setup();
          const response = yield* asAda(
            '/users',
            post({ ...invitation, roles: ['toString'] }),
          );
          assert.strictEqual(response.status, 400);
          const none = yield* found('new@');
          assert.deepStrictEqual(none, []);
          const mail = yield* accounts.mail;
          assert.deepStrictEqual(mail, []);
          const recorded = yield* entries;
          assert.deepStrictEqual(recorded, []);
        }),
      );

      it.effect('Email already registered', () =>
        Effect.gen(function* () {
          const { accounts, asAda, entries } = yield* setup();
          for (const email of [
            'customer@example.com',
            'Customer@EXAMPLE.com',
          ]) {
            const response = yield* asAda('/users', post({ email, name: 'C' }));
            assert.strictEqual(response.status, 409, email);
          }
          const mail = yield* accounts.mail;
          assert.deepStrictEqual(mail, []);
          const recorded = yield* entries;
          assert.deepStrictEqual(recorded, []);
        }),
      );

      it.effect('an email or a name that cannot be one', () =>
        Effect.gen(function* () {
          const { asAda, entries } = yield* setup();
          for (const email of [
            '',
            'new',
            'a b@example.com',
            'a@b',
            'a@b.c,d',
            'a@b..c',
            'a@b.',
            `a@${Str.repeat(249)('b')}.com`,
            `a@${Str.repeat(50_000)('b.')}`,
          ]) {
            const response = yield* asAda('/users', post({ email, name: 'N' }));
            assert.strictEqual(response.status, 400, Str.takeLeft(20)(email));
          }
          for (const bad of ['', ' ', ' N']) {
            const response = yield* asAda(
              '/users',
              post({ ...invitation, name: bad }),
            );
            assert.strictEqual(response.status, 400, bad);
          }
          const recorded = yield* entries;
          assert.deepStrictEqual(recorded, []);
        }),
      );

      it.effect('an account whose link was not sent is recorded and said', () =>
        Effect.gen(function* () {
          const logs = yield* captureLogs;
          const { accounts, asAda, entries } = yield* setup(
            undefined,
            logs.layer,
          );
          yield* accounts.breakMail;
          const response = yield* asAda('/users', post(invitation));
          assert.strictEqual(response.status, 200);
          const { user, linkSent } = yield* json(InvitedUser, response);
          assert.isFalse(linkSent);
          const recorded = yield* entries;
          assert.deepStrictEqual(
            Arr.map(recorded, (entry) => [entry.action, entry.targetUserId]),
            [['user.invite', user.id]],
          );
          const lines = yield* logs.lines;
          const said = Arr.filter(
            lines,
            Str.includes('An invited user was sent no link'),
          );
          assert.lengthOf(said, 1);
        }),
      );
    });

    describe('Admins can send a password link', () => {
      it.effect('Link sent', () =>
        Effect.gen(function* () {
          const { accounts, ada, asAda, customer, entries } = yield* setup();
          const response = yield* asAda(
            `/users/${customer.id}/password-link`,
            post(),
          );
          assert.strictEqual(response.status, 204);
          const body = yield* Effect.promise(() => response.text());
          assert.strictEqual(body, '');
          const mail = yield* accounts.mail;
          assert.strictEqual(mail.length, 1);
          assert.deepInclude(mail[0], {
            to: 'customer@example.com',
            landing: LANDINGS.passwordLink,
          });
          yield* accounts.choosePassword(mail[0]?.token ?? '', 'another one');
          const session = yield* accounts.signInWith(
            'customer@example.com',
            'another one',
          );
          assert.isTrue(Option.isSome(session));
          const recorded = yield* entries;
          assert.strictEqual(recorded.length, 1);
          assert.deepInclude(recorded[0], {
            actorId: ada.id,
            action: 'user.password-link',
            targetUserId: customer.id,
            detail: null,
          });
        }),
      );

      it.effect('a mailer that fails, or failed too late', () =>
        Effect.gen(function* () {
          const logs = yield* captureLogs;
          const { accounts, ada, asAda, customer, entries } = yield* setup(
            undefined,
            logs.layer,
          );
          yield* accounts.breakMail;
          const response = yield* asAda(
            `/users/${customer.id}/password-link`,
            post(),
          );
          assert.strictEqual(response.status, 502);
          const recorded = yield* entries;
          assert.deepStrictEqual(recorded, []);
          const lines = yield* logs.lines;
          const said = Arr.findFirst(
            lines,
            Str.includes('outcome is unknown'),
          ).pipe(Option.getOrElse(() => ''));
          for (const part of [
            ada.id,
            'ada@example.com',
            'user.password-link',
            `user:${customer.id}`,
          ]) {
            assert.include(said, part);
          }
        }),
      );

      it.effect('nobody to send one to', () =>
        Effect.gen(function* () {
          const { asAda, entries } = yield* setup();
          const response = yield* asAda('/users/nobody/password-link', post());
          assert.strictEqual(response.status, 404);
          const recorded = yield* entries;
          assert.deepStrictEqual(recorded, []);
        }),
      );
    });

    it.effect('no response, log, span or entry holds a link', () =>
      Effect.gen(function* () {
        const logs = yield* captureLogs;
        const spans = yield* captureSpans;
        const printed: Array<string> = [];
        for (const level of [
          'log',
          'info',
          'warn',
          'error',
          'debug',
        ] as const) {
          const spy = vi.spyOn(console, level).mockImplementation((...args) => {
            printed.push(Arr.join(Arr.map(args, String), ' '));
          });
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => spy.mockRestore()),
          );
        }
        const { accounts, asAda, customer, entries } = yield* setup(
          undefined,
          Layer.merge(logs.layer, spans.layer),
        );
        const texts: Array<string> = [];
        const call = Effect.fnUntraced(function* (
          path: string,
          init: RequestInit,
        ) {
          const response = yield* asAda(path, init);
          const body = yield* Effect.promise(() => response.text());
          texts.push(body, ...[...response.headers].flat());
        });
        yield* call('/users', post(invitation));
        yield* call(`/users/${customer.id}/password-link`, post());
        const mail = yield* accounts.mail;
        const tokens = Arr.map(mail, (link) => link.token);
        assert.strictEqual(tokens.length, 2);
        // What the mailer says when it fails holds a link as well.
        yield* accounts.breakMail;
        yield* call('/users', post({ email: 'other@example.com', name: 'O' }));
        yield* call(`/users/${customer.id}/password-link`, post());
        const recorded = yield* entries;
        const spanText = yield* spans.text;
        const lines = yield* logs.lines;
        assert.include(spanText, 'http.route');
        const everything = Arr.join(
          [
            ...texts,
            ...printed,
            ...lines,
            spanText,
            Inspectable.toStringUnknown(recorded),
          ],
          '\n',
        );
        for (const token of tokens) assert.notInclude(everything, token);
        assert.notMatch(everything, /reset-password\/(?!\[token\])/u);
      }),
    );

    describe('Admins can delete users', () => {
      it.effect('Delete', () =>
        Effect.gen(function* () {
          const { accounts, ada, asAda, customer, entries, sessionOf } =
            yield* setup();
          const held = yield* accounts.signIn(customer.id);
          const response = yield* asAda(`/users/${customer.id}`, {
            method: 'DELETE',
          });
          assert.strictEqual(response.status, 204);
          const gone = yield* asAda(`/users/${customer.id}`);
          assert.strictEqual(gone.status, 404);
          const session = yield* sessionOf(held);
          assert.isTrue(Option.isNone(session));
          const recorded = yield* entries;
          assert.strictEqual(recorded.length, 1);
          assert.deepInclude(recorded[0], {
            actorId: ada.id,
            action: 'user.delete',
            targetId: customer.id,
            targetUserId: customer.id,
          });
          const again = yield* asAda(
            '/users',
            post({ email: 'customer@example.com', name: 'Back' }),
          );
          assert.strictEqual(again.status, 200);
        }),
      );

      it.effect('a deleted admin loses the users they impersonate', () =>
        Effect.gen(function* () {
          const { asAda, asHolder, customer, found, sessionOf } =
            yield* setup();
          const send = yield* asHolder('admin');
          const impersonation = yield* send(
            `/users/${customer.id}/impersonate`,
            post(),
          );
          const held = cookieFrom(impersonation);
          const before = yield* sessionOf(held);
          assert.isTrue(Option.isSome(before));
          const [holder] = yield* found('holder@');
          yield* asAda(`/users/${holder?.id}`, { method: 'DELETE' });
          const after = yield* sessionOf(held);
          assert.isTrue(Option.isNone(after));
          const own = yield* send('/users');
          assert.strictEqual(own.status, 401);
        }),
      );

      it.effect('Deleting yourself, or nobody', () =>
        Effect.gen(function* () {
          const { ada, asAda, entries } = yield* setup();
          const self = yield* asAda(`/users/${ada.id}`, { method: 'DELETE' });
          assert.strictEqual(self.status, 403);
          const still = yield* asAda(`/users/${ada.id}`);
          assert.strictEqual(still.status, 200);
          const nobody = yield* asAda('/users/nobody', { method: 'DELETE' });
          assert.strictEqual(nobody.status, 404);
          const recorded = yield* entries;
          assert.deepStrictEqual(recorded, []);
        }),
      );
    });

    describe('Unsupported operations are absent', () => {
      const attempts = (id: string) =>
        [
          ['invite', '/users', post(invitation)],
          ['passwordLink', `/users/${id}/password-link`, post()],
          ['delete', `/users/${id}`, { method: 'DELETE' }],
        ] as const;

      const declared = {
        none: UsersLive,
        invite: usersLive({ invite: linkTo(LANDINGS.invite) }),
        passwordLink: usersLive({
          passwordLink: linkTo(LANDINGS.passwordLink),
        }),
        delete: usersLive({ delete: true }),
      };

      it.effect('No passwords', () =>
        Effect.gen(function* () {
          for (const only of [
            'none',
            'invite',
            'passwordLink',
            'delete',
          ] as const) {
            const { accounts, asAda, customer, entries } = yield* setup(
              declared[only],
            );
            const response = yield* asAda('/user-operations');
            const operations = yield* json(UserOperations, response);
            assert.deepStrictEqual(operations, {
              invite: only === 'invite',
              passwordLink: only === 'passwordLink',
              delete: only === 'delete',
            });
            for (const [operation, path, init] of attempts(customer.id)) {
              if (operation === only) continue;
              const refused = yield* asAda(path, init);
              assert.strictEqual(refused.status, 501, operation);
              const body = yield* Effect.promise(() => refused.text());
              assert.include(body, operation);
            }
            const mail = yield* accounts.mail;
            assert.deepStrictEqual(mail, []);
            const recorded = yield* entries;
            assert.deepStrictEqual(recorded, []);
            const [, path, init] =
              Arr.findFirst(
                attempts(customer.id),
                ([operation]) => operation === only,
              ).pipe(Option.getOrUndefined) ?? [];
            if (path === undefined) continue;
            const done = yield* asAda(path, init);
            assert.include([200, 204], done.status, only);
          }
        }),
      );

      it.effect('what is supported is for who may list users', () =>
        Effect.gen(function* () {
          const { asHolder, send } = yield* setup();
          const holder = yield* asHolder('support');
          const refused = yield* holder('/user-operations');
          assert.strictEqual(refused.status, 403);
          const visitor = yield* send('/admin/user-operations');
          assert.strictEqual(visitor.status, 401);
        }),
      );
    });

    it.effect('each needs its own permission', () =>
      Effect.gen(function* () {
        const { accounts, asHolder, customer, entries, found } = yield* setup();
        const send = yield* asHolder('lister');
        const [holder] = yield* found('holder@');
        for (const [role, path, init] of [
          ['allButList', '/user-operations', {}],
          [
            'allButSetRole',
            `/users/${customer.id}/roles`,
            post({ roles: ['host'] }, 'PUT'),
          ],
          ['allButCreate', '/users', post(invitation)],
          ['allButSetPassword', `/users/${customer.id}/password-link`, post()],
          ['allButDelete', `/users/${customer.id}`, { method: 'DELETE' }],
        ] as const) {
          yield* accounts.setRoles(holder?.id ?? '', role);
          const response = yield* send(path, init);
          assert.strictEqual(response.status, 403, role);
        }
        const recorded = yield* entries;
        assert.deepStrictEqual(recorded, []);
      }),
    );
  });
};
