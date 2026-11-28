import { assert, describe, it, vi } from '@effect/vitest';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import {
  Array as Arr,
  Context,
  Effect,
  Exit,
  Inspectable,
  Layer,
  Option,
  Result,
  String as Str,
} from 'effect';

import { observedMailer, watch } from '../src/better-auth/mailer.ts';
import { AuditLog, PasswordLinks, UserDirectory } from '../src/index.ts';
import { linkTo, usersLive } from '../src/server.ts';
import {
  backend,
  makeAuth,
  makeAuthOver,
  memoryStorage,
  openInstance,
  PASSWORD,
  type TestAuth,
  type UserRow,
} from './better-auth-support/auth.ts';
import { openSqlite, sqliteDatabase } from './better-auth-support/sqlite.ts';
import {
  sessionsOf,
  userRow,
  withCookie,
  world,
} from './better-auth-support/world.ts';
import { as, makeHost, post } from './support/app.ts';
import { captureLogs } from './support/logs.ts';

const account = { email: 'new@example.com', name: 'New', roles: ['user'] };

const linksOf = (auth: TestAuth) =>
  Effect.map(Layer.build(auth.ports), Context.get(PasswordLinks));

const directoryOf = (auth: TestAuth) =>
  Effect.map(Layer.build(auth.ports), Context.get(UserDirectory));

describe('PasswordLinks', () => {
  it.effect('dies rather than mail a link that would not work', () =>
    Effect.gen(function* () {
      const { auth, bob } = yield* world();
      const links = yield* linksOf(auth);
      const untrusted = yield* Effect.exit(
        links.send({ userId: bob.id, landing: 'https://elsewhere.test/x' }),
      );
      assert.include(String(untrusted), 'does not trust');
      const based = yield* world({ baseURL: undefined });
      const unbased = yield* linksOf(based.auth);
      const adrift = yield* Effect.exit(
        unbased.send({ userId: based.bob.id, landing: '/welcome' }),
      );
      assert.include(String(adrift), 'baseURL');
      assert.deepStrictEqual(auth.mailbox.sent, []);
      assert.deepStrictEqual(based.auth.mailbox.sent, []);
    }),
  );

  it.effect('lands on a path of the site, too', () =>
    Effect.gen(function* () {
      const { auth, bob } = yield* world();
      const links = yield* linksOf(auth);
      yield* links.send({ userId: bob.id, landing: '/welcome' });
      assert.strictEqual(auth.mailbox.sent[0]?.landing, '/welcome');
    }),
  );

  it.effect('tells each of several at once what became of its own', () =>
    Effect.gen(function* () {
      const { ada, auth, bob } = yield* world();
      const links = yield* linksOf(auth);
      const send = (userId: string) =>
        Effect.result(links.send({ userId, landing: '/welcome' }));
      const sent = yield* Effect.all(
        [send(bob.id), send(bob.id), send(ada.id)],
        { concurrency: 'unbounded' },
      );
      assert.isTrue(Arr.every(sent, Result.isSuccess));
      assert.lengthOf(auth.mailbox.sent, 3);
      auth.mailbox.broken = true;
      const failed = yield* send(bob.id);
      assert.isTrue(Result.isFailure(failed));
    }),
  );

  it.effect('leaves a link anybody may ask for as it was', () =>
    Effect.gen(function* () {
      const { auth, bob } = yield* world();
      const instance = yield* openInstance(auth);
      yield* Effect.promise(() =>
        instance.api.requestPasswordReset({
          body: { email: bob.email, redirectTo: '/reset' },
        }),
      );
      assert.lengthOf(auth.mailbox.sent, 1);
    }).pipe(Effect.scoped),
  );

  it.effect('an invite whose link could never work makes no account', () =>
    Effect.gen(function* () {
      const { adaCookie, auth, db } = yield* world();
      const logs = yield* captureLogs;
      const { send, services } = yield* makeHost(
        backend(auth),
        usersLive({ invite: linkTo('https://elsewhere.test/x') }),
        logs.layer,
      );
      const response = yield* send(
        '/admin/users',
        as(adaCookie, post({ email: 'new@example.com', name: 'New' })),
      );
      assert.strictEqual(response.status, 500);
      assert.lengthOf(db.user, 2);
      const page = yield* Context.get(services, AuditLog).list({ limit: 9 });
      assert.deepStrictEqual(page.items, []);
      const lines = yield* logs.lines;
      const said = Arr.filter(lines, Str.includes('outcome is unknown'));
      assert.lengthOf(said, 1);
      assert.include(said[0] ?? '', 'UnsafeAuthOptions');
    }),
  );
});

// Better Auth starts with a copy of its options once a plugin adds to them.
const forking: BetterAuthPlugin = {
  id: 'forking',
  init: () => ({ options: { appName: 'forked' } }),
};

// What was printed meanwhile.
const printing = Effect.gen(function* () {
  const printed: Array<string> = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const spy = vi.spyOn(console, level).mockImplementation((...args) => {
      printed.push(Arr.join(Arr.map(args, Inspectable.toStringUnknown), ' '));
    });
    yield* Effect.addFinalizer(() => Effect.sync(() => spy.mockRestore()));
  }
  return printed;
});

describe('the mailer', () => {
  for (const [order, beside] of [
    ['before', { before: [forking] }],
    ['after', { after: [forking] }],
  ] as const) {
    it.effect(`is watched with a plugin ${order} ours`, () =>
      Effect.gen(function* () {
        const { adaCookie, auth, bob } = yield* world({}, beside);
        const logs = yield* captureLogs;
        const printed = yield* printing;
        const { send } = yield* makeHost(backend(auth), undefined, logs.layer);
        const link = send(
          `/admin/users/${bob.id}/password-link`,
          as(adaCookie, post()),
        );
        const sent = yield* link;
        assert.strictEqual(sent.status, 204);
        auth.mailbox.broken = true;
        const failed = yield* link;
        assert.strictEqual(failed.status, 502);
        yield* Effect.promise(() => Promise.resolve());
        const [lost] = auth.mailbox.lost;
        const lines = yield* logs.lines;
        const said = Arr.join([...printed, ...lines], '\n');
        assert.include(said, 'MailerDown');
        assert.isDefined(lost);
        for (const secret of [lost?.token, btoa(lost?.url ?? '')]) {
          assert.notInclude(said, secret ?? 'nothing lost');
        }
      }),
    );
  }

  it.effect('that fails after it delivered leaves no entry, and a log', () =>
    Effect.gen(function* () {
      const { ada, adaCookie, auth, bob } = yield* world();
      const logs = yield* captureLogs;
      const { send, services } = yield* makeHost(
        backend(auth),
        undefined,
        logs.layer,
      );
      auth.mailbox.late = true;
      const response = yield* send(
        `/admin/users/${bob.id}/password-link`,
        as(adaCookie, post()),
      );
      assert.strictEqual(response.status, 502);
      assert.lengthOf(auth.mailbox.sent, 1);
      const page = yield* Context.get(services, AuditLog).list({ limit: 9 });
      assert.deepStrictEqual(page.items, []);
      const lines = yield* logs.lines;
      const said = Arr.filter(lines, Str.includes('outcome is unknown'));
      assert.lengthOf(said, 1);
      assert.include(said[0] ?? '', ada.id);
      assert.include(said[0] ?? '', `user:${bob.id}`);
    }),
  );

  it.effect('that fails for one user fails for nobody else', () =>
    Effect.gen(function* () {
      const { ada, auth, bob } = yield* world();
      const links = yield* linksOf(auth);
      auth.mailbox.refuses = bob.email;
      const [first, second] = yield* Effect.forEach(
        [bob.id, ada.id],
        (userId) => Effect.result(links.send({ userId, landing: '/welcome' })),
        { concurrency: 'unbounded' },
      );
      assert.isTrue(first !== undefined && Result.isFailure(first));
      assert.isTrue(second !== undefined && Result.isSuccess(second));
    }),
  );

  it.effect('is the project’s own again for a link nobody waits for', () =>
    Effect.gen(function* () {
      let calls = 0;
      const own = {
        enabled: true,
        sendResetPassword: () => {
          calls += 1;
          return Promise.reject(new TypeError('its own business'));
        },
      };
      const options = { appName: 'x', emailAndPassword: own };
      const watchers = Option.getOrThrow(observedMailer({ options }));
      assert.strictEqual(
        Option.getOrThrow(observedMailer({ options })),
        watchers,
      );
      assert.notStrictEqual(options.emailAndPassword, own);
      const { forget } = watch(watchers, 'bob');
      forget();
      const call = options.emailAndPassword.sendResetPassword as (
        link: unknown,
      ) => Promise<void>;
      const exit = yield* Effect.exit(
        Effect.promise(() => call({ user: { id: 'bob' }, url: '', token: '' })),
      );
      assert.isTrue(Exit.isFailure(exit));
      assert.strictEqual(calls, 1);
    }),
  );

  it.effect('is watched for one user, and only for what kind of failure', () =>
    Effect.gen(function* () {
      const options = {
        emailAndPassword: {
          enabled: true,
          sendResetPassword: (_link: unknown) =>
            Promise.reject(new TypeError('the whole mail')),
        },
      };
      const watchers = Option.getOrThrow(observedMailer({ options }));
      const { watcher } = watch(watchers, 'bob');
      const call = (id: string) =>
        Effect.exit(
          Effect.promise(() =>
            options.emailAndPassword.sendResetPassword({ user: { id } }),
          ),
        );
      const other = yield* call('ada');
      assert.isTrue(Exit.isFailure(other));
      assert.isTrue(Option.isNone(watcher.outcome));
      const own = yield* call('bob');
      assert.isTrue(Exit.isSuccess(own));
      const asked = Option.getOrThrow(watcher.outcome);
      const outcome = yield* Effect.promise(() => asked);
      assert.deepStrictEqual(outcome, { sent: false, reason: 'TypeError' });
    }),
  );

  it.effect('is needed, with passwords', () =>
    Effect.gen(function* () {
      const auth = yield* makeAuth(
        { user: [], session: [], account: [] },
        {},
        { passwords: false },
      );
      const links = yield* linksOf(auth);
      for (const attempt of [
        links.ready('/welcome'),
        links.send({ userId: 'bob', landing: '/welcome' }),
      ]) {
        const exit = yield* Effect.exit(attempt);
        assert.include(String(exit), 'cannot email links');
      }
      assert.deepStrictEqual(auth.mailbox.sent, []);
    }),
  );

  it.effect('that Better Auth never called is no link sent', () =>
    Effect.gen(function* () {
      const silent: BetterAuthPlugin = {
        id: 'silent',
        hooks: {
          before: [
            {
              matcher: ({ path }) => path === '/request-password-reset',
              handler: createAuthMiddleware((ctx) =>
                Promise.resolve(ctx.json({ status: true })),
              ),
            },
          ],
        },
      };
      const { auth, bob } = yield* world({}, { after: [silent] });
      const links = yield* linksOf(auth);
      const exit = yield* Effect.exit(
        links.send({ userId: bob.id, landing: '/welcome' }),
      );
      assert.isTrue(Exit.hasDies(exit));
    }),
  );

  it.effect('a link that could not be stored is not repeated', () =>
    Effect.gen(function* () {
      let stored = '';
      const { auth, bob } = yield* world({
        databaseHooks: {
          verification: {
            create: {
              before: ({ identifier }) => {
                stored = identifier;
                return Promise.reject(new TypeError(`insert ${identifier}`));
              },
            },
          },
        },
      });
      const links = yield* linksOf(auth);
      const exit = yield* Effect.exit(
        links.send({ userId: bob.id, landing: '/welcome' }),
      );
      assert.include(String(exit), 'LinkFailed');
      assert.include(stored, 'reset-password:');
      assert.notInclude(Inspectable.toStringUnknown(exit), stored);
      assert.notInclude(String(exit), stored);
    }),
  );

  it.effect('takes the fallback of a dynamic base URL', () =>
    Effect.gen(function* () {
      const dynamic = yield* world({
        baseURL: {
          allowedHosts: ['site.test'],
          fallback: 'https://site.test',
        },
      });
      const links = yield* linksOf(dynamic.auth);
      yield* links.send({
        userId: dynamic.bob.id,
        landing: 'https://site.test/welcome',
      });
      assert.lengthOf(dynamic.auth.mailbox.sent, 1);
      const bare = yield* makeAuth(
        { user: [], session: [], account: [] },
        { baseURL: { allowedHosts: ['site.test'] } },
      );
      const exit = yield* Effect.flatMap(linksOf(bare), (unbased) =>
        Effect.exit(unbased.ready('/welcome')),
      );
      assert.include(String(exit), 'baseURL');
    }),
  );

  it.effect('is not asked to write to an account it would not find', () =>
    Effect.gen(function* () {
      const { ada, auth, bob, db } = yield* world();
      const links = yield* linksOf(auth);
      for (const email of ['ADA@example.com', 'BOB@example.com']) {
        userRow(db, bob.id).email = email;
        const refused = yield* Effect.flip(
          links.send({ userId: bob.id, landing: '/welcome' }),
        );
        assert.strictEqual(refused._tag, 'Forbidden');
      }
      assert.deepStrictEqual(auth.mailbox.sent, []);
      yield* links.send({ userId: ada.id, landing: '/welcome' });
    }),
  );
});

describe('creating an account', () => {
  it.effect('two at once for one email make one', () =>
    Effect.gen(function* () {
      const db = yield* openSqlite;
      const auth = yield* makeAuthOver(sqliteDatabase(db));
      const directory = yield* directoryOf(auth);
      const made = yield* Effect.all(
        Arr.makeBy(5, () => Effect.result(directory.create(account))),
        { concurrency: 'unbounded' },
      );
      assert.lengthOf(Arr.getSuccesses(made), 1);
      assert.deepStrictEqual(
        Arr.dedupe(Arr.map(Arr.getFailures(made), (error) => error._tag)),
        ['EmailTaken'],
      );
    }),
  );

  it.effect('the project’s rules on who may have one still hold', () =>
    Effect.gen(function* () {
      const { auth, db } = yield* world({
        user: {
          validateUserInfo: ({ user }) =>
            user.email === account.email
              ? Promise.reject(
                  APIError.from('FORBIDDEN', {
                    code: 'NOT_HERE',
                    message: 'Not here.',
                  }),
                )
              : Promise.resolve(),
        },
      });
      const directory = yield* directoryOf(auth);
      const refused = yield* Effect.flip(directory.create(account));
      assert.strictEqual(refused._tag, 'Forbidden');
      assert.lengthOf(db.user, 2);
    }),
  );

  it.effect('a failure that is not a taken email is a defect', () =>
    Effect.gen(function* () {
      for (const [message, taken] of [
        ['broken hook', false],
        // Not the email, which nobody has.
        ['duplicate key value', false],
        // Taken since, and not why it failed.
        ['broken hook', true],
      ] as const) {
        const rows: Array<UserRow> = [];
        const { auth, db } = yield* world({
          databaseHooks: {
            user: {
              create: {
                before: (user) => {
                  if (user.email !== account.email) return Promise.resolve();
                  if (taken)
                    rows.push(
                      ...Arr.map(Arr.take(db.user, 1), (row) => ({
                        ...row,
                        email: account.email,
                      })),
                    );
                  db.user.push(...rows);
                  return Promise.reject(new TypeError(message));
                },
              },
            },
          },
        });
        const directory = yield* directoryOf(auth);
        const exit = yield* Effect.exit(directory.create(account));
        assert.isTrue(Exit.hasDies(exit), message);
      }
    }),
  );
});

describe('setting roles', () => {
  it.effect('refused by a hook of the project is not recorded as done', () =>
    Effect.gen(function* () {
      let refuse = false;
      const { adaCookie, auth, bob } = yield* world({
        databaseHooks: {
          user: {
            update: {
              before: () => Promise.resolve(refuse ? false : undefined),
            },
          },
        },
      });
      refuse = true;
      const logs = yield* captureLogs;
      const { send, services } = yield* makeHost(
        backend(auth),
        undefined,
        logs.layer,
      );
      const response = yield* send(
        `/admin/users/${bob.id}/roles`,
        as(adaCookie, post({ roles: ['admin'] }, 'PUT')),
      );
      assert.strictEqual(response.status, 500);
      const page = yield* Context.get(services, AuditLog).list({ limit: 9 });
      assert.deepStrictEqual(page.items, []);
      const lines = yield* logs.lines;
      const said = Arr.filter(lines, Str.includes('outcome is unknown'));
      assert.lengthOf(said, 1);
      assert.include(said[0] ?? '', bob.id);
    }),
  );
});

describe('an impersonation', () => {
  it.effect('can be undone', () =>
    Effect.gen(function* () {
      const { ada, adaCookie, auth, bob, db } = yield* world();
      const directory = yield* directoryOf(auth);
      const { undo } = yield* directory.impersonate({
        id: bob.id,
        headers: withCookie(adaCookie),
      });
      const before = sessionsOf(db, bob.id);
      assert.deepStrictEqual(
        Arr.map(before, (row) => row.impersonatedBy),
        [ada.id],
      );
      yield* undo;
      assert.lengthOf(sessionsOf(db, bob.id), 0);
    }),
  );

  it.effect('is recorded as stopped where a hook fails after it ended', () =>
    Effect.gen(function* () {
      const it_ = yield* world({
        databaseHooks: {
          session: {
            delete: {
              after: () => Promise.reject(new TypeError('broken hook')),
            },
          },
        },
      });
      const cookie = yield* it_.impersonate;
      // Better Auth's router prints what it answers 500 for.
      const printed = yield* printing;
      const exit = yield* Effect.exit(
        it_.send({ path: '/api/auth/admin/stop-impersonating', cookie }),
      );
      const failed = Exit.match(exit, {
        onFailure: () => true,
        onSuccess: ({ status }) => status >= 500,
      });
      assert.isTrue(failed);
      assert.include(Arr.join(printed, '\n'), 'broken hook');
      assert.deepStrictEqual(
        Arr.map(it_.entries, (entry) => [entry.action, entry.target?.id]),
        [['user.stop-impersonating', it_.bob.id]],
      );
    }),
  );
});

describe('deleting an account', () => {
  it.effect('leaves nothing to sign in with', () =>
    Effect.gen(function* () {
      const { accounts, auth, bob, db } = yield* world();
      yield* accounts.signIn(bob.id);
      const directory = yield* directoryOf(auth);
      yield* directory.delete(bob.id);
      assert.lengthOf(sessionsOf(db, bob.id), 0);
      assert.lengthOf(
        Arr.filter(db.account, (row) => row.userId === bob.id),
        0,
      );
    }),
  );

  it.effect('ends sessions kept in secondary storage', () =>
    Effect.gen(function* () {
      const values = new Map<string, string>();
      const { accounts, auth, bob, sessions } = yield* world({
        session: { storeSessionInDatabase: true },
      }).pipe(Effect.provide(memoryStorage(values)));
      const cookie = yield* accounts.signIn(bob.id);
      const before = yield* sessions.find(withCookie(cookie));
      assert.strictEqual(before._tag, 'Some');
      const directory = yield* directoryOf(auth);
      yield* directory.delete(bob.id);
      const after = yield* sessions.find(withCookie(cookie));
      assert.strictEqual(after._tag, 'None');
      assert.notInclude(Arr.join([...values.values()], ' '), bob.id);
    }),
  );

  it.effect('refused by a hook of the project leaves the account usable', () =>
    Effect.gen(function* () {
      const refusing = {
        databaseHooks: {
          user: { delete: { before: () => Promise.resolve(false) } },
        },
      };
      const failing = {
        databaseHooks: {
          user: {
            delete: { before: () => Promise.reject(new TypeError('broken')) },
          },
        },
      };
      for (const extra of [refusing, failing]) {
        const { accounts, auth, bob, db } = yield* world(extra);
        const directory = yield* directoryOf(auth);
        const exit = yield* Effect.exit(directory.delete(bob.id));
        assert.isTrue(Exit.hasDies(exit));
        assert.lengthOf(db.user, 2);
        const cookie = yield* accounts.signInWith(bob.email, PASSWORD);
        assert.isTrue(Option.isSome(cookie));
      }
    }),
  );

  it.effect('whose sessions a hook keeps is a defect', () =>
    Effect.gen(function* () {
      const { accounts, auth, bob } = yield* world({
        databaseHooks: {
          session: { delete: { before: () => Promise.resolve(false) } },
        },
      });
      yield* accounts.signIn(bob.id);
      const directory = yield* directoryOf(auth);
      const exit = yield* Effect.exit(directory.delete(bob.id));
      assert.include(String(exit), 'does not end');
    }),
  );
});
