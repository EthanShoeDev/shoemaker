// One deploy in a process of its own, on the SQLite file it is given. With
// `--kill-at`, the process dies before the first statement that has the text.
import { SqliteClient } from '@effect/sql-sqlite-node';
import { Config, Effect, String as Str } from 'effect';
import { Statement } from 'effect/sql';

import { runMigrations } from '../../src/product/migrations.ts';
import { adminMigrations } from '../../src/sql/admin-migrations.ts';

const program = Effect.gen(function* () {
  const filename = yield* Config.String('DEPLOY_DATABASE');
  const killAt = yield* Config.String('DEPLOY_KILL_AT').pipe(
    Config.withDefault(''),
  );
  yield* runMigrations(adminMigrations).pipe(
    Effect.provideService(Statement.CurrentTransformer, (statement) => {
      const [text] = statement.compile();
      if (killAt !== '' && Str.includes(killAt)(text)) {
        process.kill(process.pid, 'SIGKILL');
      }
      return Effect.succeed(statement);
    }),
    Effect.provide(SqliteClient.layer({ filename })),
  );
});

await Effect.runPromise(program);
