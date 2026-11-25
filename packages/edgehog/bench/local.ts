/* oxlint-disable effecttsgo/strict-effect-provide -- each database is run from an entry point of its own */
// The benchmark on this machine: D1 in local workerd, SQLite and Postgres.
// There is no network in any of them, so it says what the databases and the
// collector cost and nothing of what distance adds. `scratch/` is for that.
//
//   bun bench/local.ts [--database d1|sqlite|postgres]
import { layerRuntime } from '@alchemy.run/cloudflare-runtime/core';
import { withLocalD1Query } from '@alchemy.run/cloudflare/D1/LocalD1Gateway';
import { makeD1DatabaseFromTransport } from '@alchemy.run/cloudflare/D1/QueryDatabaseHttpClient';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { D1Client } from '@effect/sql-d1';
import { SqliteClient } from '@effect/sql-sqlite-node';
import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Layer,
  Number as Num,
  Option,
  Predicate,
  Schema,
} from 'effect';
import { Command, Flag } from 'effect/cli';
import { SecureRandom } from 'effect/crypto';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { runMigrations } from 'shoemaker-admin/sql';
import {
  findPostgres,
  Postgres,
  postgresLayer,
} from 'shoemaker-utils/testing/postgres';

import { benchMigrations } from './schema.ts';
import { ownCost, runWorkload, workloads } from './workload.ts';

const DEADLINE_SECONDS = 120;
// Above this the benchmark refuses to start, wherever it runs.
const MOST_DOLLARS = 0.25;

const Json = Schema.fromJsonString(Schema.Unknown);
const toLine = Schema.encodeEffect(Json);

interface Meter {
  readonly rowsWritten: Effect.Effect<Option.Option<number>>;
}

const unmetered: Meter = { rowsWritten: Effect.succeedNone };

const runAll = Effect.fnUntraced(function* (database: string, meter: Meter) {
  yield* runMigrations(benchMigrations);
  for (const [index, work] of workloads.entries()) {
    const before = yield* meter.rowsWritten;
    const outcome = yield* runWorkload(work, index + 1);
    const after = yield* meter.rowsWritten;
    const measuredRows = Option.getOrNull(
      Option.zipWith(after, before, (to, from) => to - from),
    );
    const line = yield* toLine({ database, ...outcome, measuredRows });
    yield* Console.log(line);
  }
});

const rowsIn = (result: ReadonlyArray<{ readonly meta?: unknown }>) =>
  Num.sumAll(
    Arr.map(result, ({ meta }) =>
      Predicate.hasProperty(meta, 'rows_written') &&
      Predicate.isNumber(meta.rows_written)
        ? meta.rows_written
        : 0,
    ),
  );

// workerd's own D1 over a socket, which says how many rows it wrote.
const onD1 = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'd1' });
  const runtime = layerRuntime({
    api: { accountId: Effect.succeed('local') },
    storage: { directory },
  });
  let written = 0;
  const services = yield* Effect.context();
  const runPromise = Effect.runPromiseWith(services);
  yield* withLocalD1Query('dev:bench', (query) => {
    const db = makeD1DatabaseFromTransport((body) =>
      query(body).pipe(
        Effect.tap(({ result }) =>
          Effect.sync(() => {
            written += rowsIn(result);
          }),
        ),
        runPromise,
      ),
    );
    return runAll('d1 (local workerd)', {
      rowsWritten: Effect.sync(() => Option.some(written)),
    }).pipe(Effect.provide(D1Client.layer({ db })));
  }).pipe(
    Effect.provide(runtime.pipe(Layer.provide(FetchHttpClient.layer))),
    Effect.orDie,
    // This package and the gateway resolve two copies of one runtime, whose
    // services are the same by key and not by type.
    (run) =>
      // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- see above
      run as Effect.Effect<
        void,
        never,
        FileSystem.FileSystem | SecureRandom.SecureRandom
      >,
  );
}).pipe(Effect.scoped);

const onSqlite = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'sqlite' });
  yield* runAll('sqlite (file)', unmetered).pipe(
    Effect.provide(SqliteClient.layer({ filename: `${directory}/bench.db` })),
  );
}).pipe(Effect.scoped);

const onPostgres = Effect.gen(function* () {
  const source = yield* findPostgres;
  if (source.kind === 'none') {
    return yield* Console.log('There is no Postgres here, so none was run.');
  }
  yield* Effect.gen(function* () {
    const { database } = yield* Postgres;
    const layer = yield* database;
    yield* runAll(`postgres (${source.kind}, fsync off)`, unmetered).pipe(
      Effect.provide(layer),
    );
    // The helper is for tests, whose clock it waits past.
  }).pipe(
    Effect.provide(
      postgresLayer(source).pipe(Layer.provide(TestClock.layer())),
    ),
  );
});

const names = ['d1', 'sqlite', 'postgres'] as const;

const bounded = <E, R>(run: Effect.Effect<void, E, R>) =>
  run.pipe(Effect.timeout(`${DEADLINE_SECONDS} seconds`), Effect.orDie);

const runs = [
  { name: 'd1', run: bounded(onD1) },
  { name: 'sqlite', run: bounded(onSqlite) },
  { name: 'postgres', run: bounded(onPostgres) },
] as const;

const bench = Command.make(
  'bench',
  {
    database: Flag.Literals('database', names).pipe(
      Flag.withDescription('Run on one of them only'),
      Flag.optional,
    ),
  },
  Effect.fnUntraced(function* ({ database }) {
    const cost = ownCost({
      works: workloads,
      rounds: 1,
      deadlineSeconds: DEADLINE_SECONDS,
    });
    yield* Console.log(
      `On Cloudflare this would write at most ${cost.rows} rows in ${cost.requests} requests, for at most ${cost.dollars.toFixed(4)} dollars. Here it is free.`,
    );
    if (cost.dollars > MOST_DOLLARS) {
      return yield* Effect.die(
        new Error(`It may cost more than ${MOST_DOLLARS} dollars.`),
      );
    }
    for (const { name, run } of runs) {
      if (Option.isNone(database) || database.value === name) yield* run;
    }
  }),
).pipe(Command.withDescription('Benchmark the collector and the atomic write'));

Command.run(bench, { version: '0.0.0' }).pipe(
  Effect.provide([NodeServices.layer, SecureRandom.layerWebCrypto]),
  NodeRuntime.runMain,
);
