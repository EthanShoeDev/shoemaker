import { NodeServices } from '@effect/platform-node';
import { SqliteClient } from '@effect/sql-sqlite-node';
import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, FileSystem, Path } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { SqlClient } from 'effect/sql';
import { equals } from 'shoemaker-utils/testing/assertions';
import { d1, makeD1Server } from 'shoemaker-utils/testing/databases';

import { runMigrations } from '../../src/product/migrations.ts';
import { adminMigrations } from '../../src/sql/admin-migrations.ts';

const DEPLOYS = 5;
const TIMED_OUT = 60_000;
const names = Arr.map(adminMigrations.migrations, ({ name }) => name);

const recorded = SqlClient.SqlClient.use(
  (sql) => sql`SELECT name FROM admin_migrations ORDER BY name`,
);
const columns = SqlClient.SqlClient.use(
  (sql) =>
    sql`SELECT name FROM pragma_table_info('admin_audit_log') WHERE name LIKE 'target_%' ORDER BY name`,
);
const migratedOnce = Effect.gen(function* () {
  yield* equals(
    recorded,
    Arr.map(names, (name) => ({ name })),
  );
  yield* equals(columns, [
    { name: 'target_id' },
    { name: 'target_kind' },
    { name: 'target_user_id' },
  ]);
});

const tempDatabase = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'admin' });
  return path.join(dir, 'db.sqlite');
});

// A process per deploy, since one process would wait for its own lock.
const deploy = Effect.fnUntraced(function* (filename: string, killAt: string) {
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const script = yield* path.fromFileUrl(
    new URL('deploy-sqlite.ts', import.meta.url),
  );
  const child = yield* spawner.spawn(
    ChildProcess.make(process.execPath, [script], {
      env: { DEPLOY_DATABASE: filename, DEPLOY_KILL_AT: killAt },
      extendEnv: true,
      stdout: 'ignore',
      stderr: 'ignore',
    }),
  );
  // A killed process has no exit code.
  return yield* child.exitCode.pipe(
    Effect.map(Number),
    Effect.orElseSucceed(() => 'killed' as const),
  );
});

describe('two deploys at once', () => {
  it.live(
    'apply and record each migration once on one SQLite file',
    () =>
      Effect.gen(function* () {
        const filename = yield* tempDatabase;
        const codes = yield* Effect.all(
          Arr.makeBy(DEPLOYS, () => deploy(filename, '')),
          { concurrency: 'unbounded' },
        );
        assert.deepStrictEqual(
          codes,
          Arr.makeBy(DEPLOYS, () => 0),
        );
        yield* Effect.provide(migratedOnce, SqliteClient.layer({ filename }));
      }).pipe(Effect.provide(NodeServices.layer)),
    TIMED_OUT,
  );

  it.effect('apply and record each migration once on D1', () =>
    Effect.gen(function* () {
      const server = makeD1Server();
      const applied = yield* Effect.all(
        Arr.makeBy(DEPLOYS, () =>
          runMigrations(adminMigrations).pipe(Effect.provide(d1({ server }))),
        ),
        { concurrency: 'unbounded' },
      );
      assert.sameMembers(Arr.flatten(applied), names);
      // They did race: somebody's batch came second.
      assert.isAbove(server.stats.refused, 0);
      yield* Effect.provide(migratedOnce, d1({ server }));
    }),
  );
});

describe('an interrupted migration', () => {
  it.live(
    'that a killed process left is applied whole by the next deploy',
    () =>
      Effect.gen(function* () {
        const filename = yield* tempDatabase;
        const database = SqliteClient.layer({ filename });
        // Between the two columns of one migration.
        yield* equals(deploy(filename, 'ADD COLUMN target_id'), 'killed');
        yield* Effect.provide(
          equals(recorded, [{ name: '0001_audit_log' }]),
          database,
        );
        yield* Effect.provide(
          equals(columns, [{ name: 'target_user_id' }]),
          database,
        );
        yield* equals(deploy(filename, ''), 0);
        yield* Effect.provide(migratedOnce, database);
      }).pipe(Effect.provide(NodeServices.layer)),
    TIMED_OUT,
  );

  it.effect('that D1 gave up on is applied whole by the next deploy', () =>
    Effect.gen(function* () {
      const server = makeD1Server();
      const database = d1({ server });
      server.abandon('ADD COLUMN target_id');
      const error = yield* Effect.flip(
        Effect.provide(runMigrations(adminMigrations), database),
      );
      assert.deepInclude(error, { migration: '0002_audit_target' });
      yield* Effect.provide(
        equals(columns, [{ name: 'target_user_id' }]),
        database,
      );
      yield* Effect.provide(
        equals(runMigrations(adminMigrations), Arr.drop(names, 1)),
        database,
      );
      yield* Effect.provide(migratedOnce, database);
    }),
  );
});
