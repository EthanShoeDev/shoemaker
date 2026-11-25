import { assert, describe, type Vitest } from '@effect/vitest';
import {
  Array as Arr,
  Context,
  DateTime,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  type Scope,
  String as Str,
} from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { SqlClient, Statement } from 'effect/sql';
import {
  dies,
  equals,
  fails,
  sameMembers,
} from 'shoemaker-utils/testing/assertions';

import {
  AuditLog,
  AuditPage,
  type NewAuditEntry,
} from '../../src/core/audit.ts';
import { AtomicWrites } from '../../src/product/atomic.ts';
import { runMigrations } from '../../src/product/migrations.ts';
import { AdminAccess, AuditLive, mountAt } from '../../src/server.ts';
import { adminMigrations } from '../../src/sql/admin-migrations.ts';
import { auditLogLayer } from '../../src/sql/audit-log.ts';
import { promoteAdmins } from '../../src/sql/promote-admins.ts';
import { access } from '../support/access.ts';
import { Accounts } from '../support/accounts.ts';
import { ADMIN_ORIGIN, as, serve } from '../support/app.ts';
import { MemoryUsers } from '../support/memory-users.ts';

const TIMED_OUT = 30_000;

const ban = (id: string): NewAuditEntry => ({
  actorId: 'admin-1',
  actorEmail: 'admin@example.com',
  action: 'user.ban',
  target: { kind: 'user', id },
  detail: 'Abuse',
});

const decodeNames = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ name: Schema.String })),
);

const decodePage = Schema.decodeUnknownEffect(AuditPage);

const decodeTargets = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ targetUserId: Schema.NullOr(Schema.String) })),
);

const decodeRoles = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({ email: Schema.String, role: Schema.NullOr(Schema.String) }),
  ),
);

// The names in a product's history, oldest first.
const history = Effect.fnUntraced(function* (product: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`SELECT name FROM ${sql(`${product}_migrations`)}
    ORDER BY name`;
  const decoded = yield* decodeNames(rows);
  return Arr.map(decoded, (row) => row.name);
});

// What an existing project's own migrations made, and what its code runs.
const makeExisting = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE admin_audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    actor_email TEXT,
    action TEXT NOT NULL,
    target_user_id TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX admin_audit_log_created ON admin_audit_log (created_at DESC)`;
});

const oldInsert = Effect.fnUntraced(function* (
  id: string,
  targetUserId: string | null,
  createdAt: string,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO admin_audit_log
      (id, actor_id, actor_email, action, target_user_id, detail, created_at)
    VALUES (${id}, ${'admin-1'}, ${null},
      ${'user.stop-impersonating'}, ${targetUserId}, ${null}, ${createdAt})`;
});

const oldSelect = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`SELECT id, actor_id AS "actorId",
      actor_email AS "actorEmail", action, target_user_id AS "targetUserId",
      detail, created_at AS "createdAt"
    FROM admin_audit_log WHERE ${sql`1 = 1`}
    ORDER BY created_at DESC LIMIT ${51}`;
  const decoded = yield* decodeTargets(rows);
  return Arr.map(decoded, (row) => row.targetUserId);
});

const makeUsers = Effect.fnUntraced(function* (
  users: ReadonlyArray<readonly [email: string, role: string | null]>,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE ${sql('user')} (id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT)`;
  yield* Effect.forEach(
    users,
    ([email, role]) =>
      sql`INSERT INTO ${sql('user')} (id, email, role)
        VALUES (${email}, ${email}, ${role})`,
    { concurrency: 1, discard: true },
  );
});

const roles = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows =
    yield* sql`SELECT email, role FROM ${sql('user')} ORDER BY email`;
  const decoded = yield* decodeRoles(rows);
  return Arr.map(decoded, (row) => [row.email, row.role]);
});

const readAll = Effect.fnUntraced(function* (limit: number) {
  const log = yield* AuditLog;
  const ids: Array<string> = [];
  let cursor = Option.none<string>();
  do {
    const page = yield* log.list({
      limit,
      cursor: Option.getOrUndefined(cursor),
    });
    ids.push(...Arr.map(page.items, (item) => item.id));
    cursor = Option.fromNullOr(page.nextCursor);
  } while (Option.isSome(cursor));
  return ids;
});

// Everything the core asks of a database. `fresh` opens a new, empty one.
export const databaseSuite = <E, R = never>(
  name: string,
  fresh: Effect.Effect<Layer.Layer<SqlClient.SqlClient, E>, never, R>,
  // The `it` of the layer that provides `R`.
  scope: Pick<Vitest.MethodsNonLive<R>, 'effect'>,
) => {
  const test = <A, E2>(
    title: string,
    body: Effect.Effect<A, E2, AuditLog | Scope.Scope | SqlClient.SqlClient>,
  ) =>
    scope.effect(
      title,
      () =>
        Effect.gen(function* () {
          const layer = yield* fresh;
          return yield* body.pipe(
            Effect.provide(Layer.provideMerge(auditLogLayer, layer)),
          );
        }),
      TIMED_OUT,
    );

  describe(name, () => {
    test(
      'applies every migration once, and nothing the second time',
      Effect.gen(function* () {
        const first = yield* runMigrations(adminMigrations);
        assert.strictEqual(first.length, adminMigrations.migrations.length);
        yield* equals(runMigrations(adminMigrations), []);
        yield* equals(history('admin'), first);
      }),
    );

    test(
      'undoes an interrupted migration that adds a column, and applies it whole later',
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const product = {
          product: 'probe',
          migrations: [
            { name: '1', statements: ['CREATE TABLE probe_a (id TEXT)'] },
            {
              name: '2',
              statements: [
                'ALTER TABLE probe_a ADD COLUMN extra TEXT',
                "INSERT INTO probe_b (id) VALUES ('x')",
              ],
            },
          ],
        };
        const failure = yield* Effect.flip(runMigrations(product));
        assert.strictEqual(failure._tag, 'MigrationFailed');
        assert.strictEqual(failure.migration, '2');
        yield* equals(history('probe'), ['1']);
        yield* fails(sql`SELECT extra FROM probe_a`);

        yield* sql`CREATE TABLE probe_b (id TEXT)`;
        yield* equals(runMigrations(product), ['2']);
        yield* equals(history('probe'), ['1', '2']);
        yield* equals(sql`SELECT extra FROM probe_a`, []);
      }),
    );

    test(
      'undoes a migration that stops between its statements',
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const product = {
          product: 'probe',
          migrations: [
            { name: '1', statements: ['CREATE TABLE probe_a (id TEXT)'] },
            {
              name: '2',
              statements: [
                'ALTER TABLE probe_a ADD COLUMN extra TEXT',
                'ALTER TABLE probe_a ADD COLUMN stops_here TEXT',
              ],
            },
          ],
        };
        const exit = yield* runMigrations(product).pipe(
          Effect.provideService(Statement.CurrentTransformer, (statement) => {
            const [text] = statement.compile();
            return Str.includes('stops_here')(text)
              ? Effect.interrupt
              : Effect.succeed(statement);
          }),
          Effect.exit,
        );
        assert.isTrue(Exit.hasInterrupts(exit));
        yield* equals(history('probe'), ['1']);
        yield* fails(sql`SELECT extra FROM probe_a`);
        yield* equals(runMigrations(product), ['2']);
        yield* equals(sql`SELECT extra, stops_here FROM probe_a`, []);
      }),
    );

    test(
      'serves the audit API, whichever database holds the log',
      Effect.gen(function* () {
        yield* runMigrations(adminMigrations);
        const services = yield* Effect.context<AuditLog>();
        const users = yield* Layer.build(MemoryUsers);
        const admin = AdminAccess.layer({ origins: [ADMIN_ORIGIN] }).pipe(
          Layer.provideMerge(access.layer),
          Layer.provideMerge(Layer.succeedContext(users)),
          Layer.provideMerge(Layer.succeedContext(services)),
        );
        const send = yield* serve(
          HttpRouter.toWebHandler(
            mountAt('/admin')(AuditLive).pipe(
              Layer.provide(admin),
              Layer.provide(HttpServer.layerServices),
            ),
            { disableLogger: true },
          ),
        );
        const log = Context.get(services, AuditLog);
        const ids = ['1', '2', '3'];
        yield* Effect.forEach(ids, (id) => log.record(ban(id)), {
          concurrency: 1,
          discard: true,
        });
        const accounts = Context.get(users, Accounts);
        const account = yield* accounts.create({
          email: 'ada@example.com',
          roles: 'admin',
        });
        const cookie = yield* accounts.signIn(account.id);
        const get = (query: string) =>
          Effect.flatMap(
            send(`/admin/audit?${query}`, as(cookie)),
            (response) => {
              assert.strictEqual(response.status, 200);
              return Effect.promise(() => response.json());
            },
          ).pipe(Effect.flatMap(decodePage));
        const first = yield* get('limit=2');
        const second = yield* get(`limit=2&cursor=${first.nextCursor}`);
        assert.deepStrictEqual(
          Arr.map([...first.items, ...second.items], (item) => item.targetId),
          ['3', '2', '1'],
        );
        assert.isNull(second.nextCursor);
      }),
    );

    test(
      'undoes a migration whose record is refused',
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE probe_migrations (
          name TEXT PRIMARY KEY, applied_at TEXT NOT NULL CHECK (applied_at = 'never')
        )`;
        yield* Effect.flip(
          runMigrations({
            product: 'probe',
            migrations: [
              { name: '1', statements: ['CREATE TABLE probe_a (id TEXT)'] },
            ],
          }),
        );
        yield* fails(sql`SELECT id FROM probe_a`);
      }),
    );

    test(
      'keeps two products and the host apart in one database',
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE host_thing (id TEXT)`;
        yield* runMigrations(adminMigrations);
        const other = {
          product: 'other',
          migrations: [
            // The same name as one of the admin's.
            {
              name: '0001_audit_log',
              statements: ['CREATE TABLE other_thing (id TEXT)'],
            },
          ],
        };
        yield* equals(runMigrations(other), ['0001_audit_log']);
        yield* equals(history('other'), ['0001_audit_log']);
        yield* equals(
          Effect.map(history('admin'), (names) => names.length),
          adminMigrations.migrations.length,
        );
        yield* equals(sql`SELECT * FROM host_thing`, []);
      }),
    );

    test(
      'refuses a product that is not a plain name',
      dies(runMigrations({ product: 'a"; DROP TABLE x; --', migrations: [] })),
    );

    test(
      'refuses two migrations with one name',
      Effect.gen(function* () {
        const migration = { name: '1', statements: [] };
        yield* dies(
          runMigrations({ product: 'p', migrations: [migration, migration] }),
        );
      }),
    );

    test(
      'writes all or nothing',
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const atomic = yield* AtomicWrites.make;
        yield* sql`CREATE TABLE a (id TEXT PRIMARY KEY)`;
        yield* atomic.run([]);
        yield* Effect.flip(
          atomic.run([
            sql`INSERT INTO a (id) VALUES (${'1'})`,
            sql`INSERT INTO a (id) VALUES (${'1'})`,
          ]),
        );
        yield* equals(sql`SELECT id FROM a`, []);
        yield* atomic.run([
          sql`INSERT INTO a (id) VALUES (${'1'})`,
          sql`INSERT INTO a (id) VALUES (${'2'})`,
        ]);
        yield* equals(sql`SELECT id FROM a ORDER BY id`, [
          { id: '1' },
          { id: '2' },
        ]);
      }),
    );

    test(
      'adopts an existing audit table',
      Effect.gen(function* () {
        yield* makeExisting;
        yield* oldInsert('old-1', 'user-1', '2026-01-01T00:00:00.000Z');
        yield* oldInsert('old-2', null, '2026-01-02T00:00:00.000Z');
        yield* runMigrations(adminMigrations);

        const log = yield* AuditLog;
        yield* log.record(ban('user-2'));
        yield* log.record({
          ...ban('flag-1'),
          action: 'flag.set',
          target: { kind: 'flag', id: 'flag-1' },
        });
        // The TestClock starts at 1970, so the old rows come first.
        const { items, nextCursor } = yield* log.list({ limit: 10 });
        assert.isNull(nextCursor);
        assert.deepStrictEqual(
          Arr.map(items, (item) => [
            item.targetKind,
            item.targetId,
            item.targetUserId,
          ]),
          [
            [null, null, null],
            ['user', 'user-1', 'user-1'],
            ['flag', 'flag-1', null],
            ['user', 'user-2', 'user-2'],
          ],
        );
      }),
    );

    test(
      'is still read and written by the code that had the table before',
      Effect.gen(function* () {
        yield* makeExisting;
        yield* runMigrations(adminMigrations);
        const log = yield* AuditLog;
        yield* log.record(ban('user-2'));
        yield* oldInsert('old-3', 'user-3', '2026-01-03T00:00:00.000Z');
        yield* equals(oldSelect, ['user-3', 'user-2']);
        const { items } = yield* log.list({ limit: 10 });
        assert.deepStrictEqual(
          Arr.map(items, (item) => [item.targetKind, item.targetId]),
          [
            ['user', 'user-3'],
            ['user', 'user-2'],
          ],
        );
      }),
    );

    test(
      'records an entry whole',
      Effect.gen(function* () {
        yield* runMigrations(adminMigrations);
        const log = yield* AuditLog;
        const now = yield* DateTime.now;
        yield* log.record({ ...ban('user-1'), detail: null });
        const [entry] = (yield* log.list({ limit: 1 })).items;
        assert.deepStrictEqual(entry, {
          id: entry?.id ?? '',
          actorId: 'admin-1',
          actorEmail: 'admin@example.com',
          action: 'user.ban',
          targetKind: 'user',
          targetId: 'user-1',
          targetUserId: 'user-1',
          detail: null,
          createdAt: now,
        });
      }),
    );

    test(
      'pages across equal timestamps without skipping or repeating',
      Effect.gen(function* () {
        yield* runMigrations(adminMigrations);
        const log = yield* AuditLog;
        // Ids of old rows may differ only by letter case or punctuation, which
        // a language's collation ignores.
        const ids = ['a', 'B', 'b', 'A', '-a', 'a-', 'ä', 'Z'];
        yield* Effect.forEach(
          ids,
          (id) => oldInsert(id, 'user-1', '2026-01-01T00:00:00.000Z'),
          { concurrency: 1, discard: true },
        );
        yield* Effect.forEach(['1', '2', '3'], (id) => log.record(ban(id)), {
          concurrency: 1,
          discard: true,
        });
        const whole = yield* readAll(100);
        assert.strictEqual(whole.length, ids.length + 3);
        yield* equals(readAll(1), whole);
        yield* equals(readAll(2), whole);
        yield* equals(readAll(3), whole);
        const page = yield* log.list({ limit: 100 });
        assert.deepStrictEqual(
          Arr.map(Arr.takeRight(page.items, 3), (item) => item.targetId),
          ['3', '2', '1'],
        );
      }),
    );

    test(
      'refuses a cursor it did not hand out',
      Effect.gen(function* () {
        yield* runMigrations(adminMigrations);
        const log = yield* AuditLog;
        for (const cursor of [
          '',
          '%',
          '2026-01-01T00:00:00.000Z',
          'WzFd',
          // ["", "a"], then a NUL in either half.
          'WyIiLCJhIl0',
          'WyJhXHUwMDAwIiwiYiJd',
          'WyJhIiwiYlx1MDAwMCJd',
        ]) {
          const error = yield* Effect.flip(log.list({ limit: 1, cursor }));
          assert.strictEqual(error._tag, 'InvalidCursor');
        }
      }),
    );

    test(
      'fails a write it could not make',
      Effect.gen(function* () {
        const log = yield* AuditLog;
        const error = yield* Effect.flip(log.record(ban('user-1')));
        assert.strictEqual(error._tag, 'AuditWriteFailed');
      }),
    );

    test(
      'grants admin beside the roles an account holds',
      Effect.gen(function* () {
        yield* makeUsers([
          ['ada@example.com', 'host'],
          ['Bob@example.com', ' user , host '],
          ['cyd@example.com', null],
          ['dan@example.com', 'user, admin'],
          ['eve@example.com', 'user'],
        ]);
        const granted = yield* promoteAdmins([
          ' Ada@Example.com',
          'ada@example.com',
          'bob@example.com',
          'cyd@example.com',
          'dan@example.com',
        ]);
        assert.sameMembers(granted, [
          'ada@example.com',
          'bob@example.com',
          'cyd@example.com',
          'dan@example.com',
        ]);
        yield* sameMembers(roles, [
          ['ada@example.com', 'host,admin'],
          ['Bob@example.com', 'user,host,admin'],
          ['cyd@example.com', 'admin'],
          ['dan@example.com', 'user, admin'],
          ['eve@example.com', 'user'],
        ]);
      }),
    );

    test(
      'grants the accounts that exist, then names the emails that have none',
      Effect.gen(function* () {
        yield* makeUsers([['ada@example.com', 'user']]);
        const error = yield* Effect.flip(
          promoteAdmins(['nobody@example.com', 'ada@example.com']),
        );
        assert.deepInclude(error, {
          _tag: 'AdminNotSignedUp',
          emails: ['nobody@example.com'],
        });
        yield* equals(roles, [['ada@example.com', 'user,admin']]);
      }),
    );

    test(
      'grants nobody from an empty list, without a users table',
      Effect.gen(function* () {
        yield* equals(promoteAdmins([]), []);
        yield* equals(promoteAdmins(['', ' ']), []);
      }),
    );

    test(
      'grants more accounts than one query takes',
      Effect.gen(function* () {
        const emails = Arr.makeBy(120, (index) => `u${index}@example.com`);
        yield* makeUsers(Arr.map(emails, (email) => [email, 'user'] as const));
        yield* sameMembers(promoteAdmins(emails), emails);
      }),
    );
  });
};
