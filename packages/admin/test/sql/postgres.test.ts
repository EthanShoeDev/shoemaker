import { NodeServices } from '@effect/platform-node';
import { assert, describe, it, layer } from '@effect/vitest';
import { Array as Arr, Config, Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { equals, fails } from 'shoemaker-utils/testing/assertions';
import {
  findPostgres,
  Postgres,
  postgresLayer,
} from 'shoemaker-utils/testing/postgres';

import { runMigrations } from '../../src/product/migrations.ts';
import { adminMigrations } from '../../src/sql/admin-migrations.ts';
import { promoteAdmins } from '../../src/sql/promote-admins.ts';
import { databaseSuite } from './suite.ts';

const DEPLOYS = 6;
const TIMED_OUT = 60_000;
const ROUNDS = [1, 2, 3, 4, 5];

const { ci, source } = await Effect.runPromise(
  Effect.gen(function* () {
    return {
      ci: yield* Config.Boolean('CI').pipe(Config.withDefault(false)),
      source: yield* findPostgres,
    };
  }).pipe(Effect.provide(NodeServices.layer)),
);

const available = source.kind !== 'none';

it.skipIf(available || !ci)('CI runs the Postgres tests', () => {
  assert.fail(
    'There is no Postgres: set TEST_POSTGRES_URL, or put initdb and postgres on the PATH (nix develop).',
  );
});

describe.skipIf(!available)(
  'with TEST_POSTGRES_URL, or Postgres on the PATH',
  () => {
    layer(postgresLayer(source), { timeout: TIMED_OUT })((it) => {
      describe('two deploys at once', () => {
        it.effect(
          'apply and record each migration once',
          () =>
            Effect.gen(function* () {
              const postgres = yield* Postgres;
              for (const _round of ROUNDS) {
                const database = yield* postgres.database;
                // Each deploy opens its own connections.
                const applied = yield* Effect.all(
                  Arr.makeBy(DEPLOYS, () =>
                    runMigrations(adminMigrations).pipe(
                      Effect.provide(database),
                    ),
                  ),
                  { concurrency: 'unbounded' },
                );
                const names = Arr.map(
                  adminMigrations.migrations,
                  (m) => m.name,
                );
                assert.sameMembers(Arr.flatten(applied), names);
                const recorded = yield* SqlClient.SqlClient.use(
                  (sql) => sql`SELECT name FROM admin_migrations ORDER BY name`,
                ).pipe(Effect.provide(database));
                assert.deepStrictEqual(
                  recorded,
                  Arr.map(names, (name) => ({ name })),
                );
              }
            }),
          TIMED_OUT,
        );

        it.effect(
          'write once what nothing but the record keeps from happening twice',
          () =>
            Effect.gen(function* () {
              const postgres = yield* Postgres;
              const database = yield* postgres.database;
              const product = {
                product: 'probe',
                migrations: [
                  { name: '1', statements: ['CREATE TABLE probe_a (id TEXT)'] },
                  {
                    name: '2',
                    statements: [
                      'INSERT INTO probe_a (id) SELECT $$x$$ FROM pg_sleep(0.1)',
                    ],
                  },
                ],
              };
              yield* Effect.all(
                Arr.makeBy(DEPLOYS, () =>
                  runMigrations(product).pipe(Effect.provide(database)),
                ),
                { concurrency: 'unbounded' },
              );
              const rows = yield* SqlClient.SqlClient.use(
                (sql) => sql`SELECT id FROM probe_a`,
              ).pipe(Effect.provide(database));
              assert.deepStrictEqual(rows, [{ id: 'x' }]);
            }),
          TIMED_OUT,
        );

        it.effect(
          'take turns where one migration raises its own locks',
          () =>
            Effect.gen(function* () {
              const postgres = yield* Postgres;
              const database = yield* postgres.database;
              const product = {
                product: 'probe',
                migrations: [
                  { name: '1', statements: ['CREATE TABLE probe_a (id TEXT)'] },
                  {
                    // Each deploy would hold a weak lock on the table and wait
                    // for the other's before its strong one. The winner is slow
                    // to commit, so the loser would find no record yet.
                    name: '2',
                    statements: [
                      "INSERT INTO probe_a (id) VALUES ('x')",
                      'SELECT pg_sleep(0.3)',
                      'ALTER TABLE probe_a ADD COLUMN extra TEXT',
                      'SELECT pg_sleep(1)',
                    ],
                  },
                ],
              };
              const applied = yield* Effect.all(
                Arr.makeBy(2, () =>
                  runMigrations(product).pipe(Effect.provide(database)),
                ),
                { concurrency: 'unbounded' },
              );
              assert.sameMembers(Arr.flatten(applied), ['1', '2']);
            }),
          TIMED_OUT,
        );

        it.effect(
          'grant admin once',
          () =>
            Effect.gen(function* () {
              const postgres = yield* Postgres;
              const database = yield* postgres.database;
              yield* Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient;
                yield* sql`CREATE TABLE ${sql('user')} (email TEXT, role TEXT)`;
                yield* sql`INSERT INTO ${sql('user')} VALUES ('a@x.com', 'host')`;
              }).pipe(Effect.provide(database));
              yield* Effect.all(
                Arr.makeBy(DEPLOYS, () =>
                  promoteAdmins(['a@x.com']).pipe(Effect.provide(database)),
                ),
                { concurrency: 'unbounded' },
              );
              const rows = yield* SqlClient.SqlClient.use(
                (sql) => sql`SELECT role FROM ${sql('user')}`,
              ).pipe(Effect.provide(database));
              assert.deepStrictEqual(rows, [{ role: 'host,admin' }]);
            }),
          TIMED_OUT,
        );
      });

      describe('an interrupted migration', () => {
        it.effect(
          'whose connection was killed is applied whole by the next deploy',
          () =>
            Effect.gen(function* () {
              const postgres = yield* Postgres;
              const database = yield* postgres.database;
              const product = {
                product: 'probe',
                migrations: [
                  {
                    name: '1',
                    statements: [
                      'CREATE TABLE probe_a (id TEXT)',
                      'CREATE TABLE probe_kill (id TEXT)',
                      "INSERT INTO probe_kill VALUES ('x')",
                    ],
                  },
                  {
                    name: '2',
                    statements: [
                      'ALTER TABLE probe_a ADD COLUMN extra TEXT',
                      'SELECT pg_terminate_backend(pg_backend_pid()) FROM probe_kill',
                    ],
                  },
                ],
              };
              const deploy = runMigrations(product).pipe(
                Effect.provide(database),
              );
              const error = yield* Effect.flip(deploy);
              assert.deepInclude(error, { migration: '2' });
              yield* SqlClient.SqlClient.use((sql) =>
                Effect.andThen(
                  fails(sql`SELECT extra FROM probe_a`),
                  sql`DELETE FROM probe_kill`,
                ),
              ).pipe(Effect.provide(database));
              yield* equals(deploy, ['2']);
            }),
          TIMED_OUT,
        );
      });

      databaseSuite(
        'Postgres',
        Effect.flatMap(Postgres, ({ database }) => database),
        it,
      );
    });
  },
);
