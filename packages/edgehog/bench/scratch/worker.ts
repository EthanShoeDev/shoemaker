import * as Cloudflare from '@alchemy.run/cloudflare';
import { D1Client } from '@effect/sql-d1';
import { sha256 } from 'alchemy/Util/sha256';
import {
  Array as Arr,
  Config,
  DateTime,
  Effect,
  Layer,
  Number as Num,
  Option,
  Schema,
  String as Str,
} from 'effect';
import { SecureRandom } from 'effect/crypto';
import { Headers, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { runMigrations } from 'shoemaker-admin/sql';

import { defaultLimits } from '../../src/limits/limits.ts';
import { makeCollector } from '../collector.ts';
import { benchMigrations } from '../schema.ts';
import { makeStore } from '../store.ts';
import { runWorkload } from '../workload.ts';
import { MOST_COLLECTED, MOST_RUNS, scratchWorkloads } from './plan.ts';

// Only for the scratch stage. `alchemy destroy` deletes it and what is in it.
export const BenchDb = Cloudflare.D1.Database('BenchDb');

type Database = Parameters<typeof D1Client.layer>[0]['db'];

const Unauthorized = HttpServerResponse.empty({ status: 401 });

// D1's own count of the rows its batches write. Nothing else here writes.
const metered = (db: Database) => {
  let written = 0;
  const counting: Database = Object.assign(Object.create(db) as Database, {
    prepare: (query: string) => db.prepare(query),
    batch: <T>(statements: Parameters<Database['batch']>[0]) =>
      db.batch<T>(statements).then((results) => {
        written += Num.sumAll(
          Arr.map(results, ({ meta }) => meta.rows_written),
        );
        return results;
      }),
  });
  return { db: counting, written: Effect.sync(() => written) };
};

// The collector where it would be: one object, in front of one database.
export class BenchCollector extends Cloudflare.DurableObject<BenchCollector>()(
  'BenchCollector',
  Effect.gen(function* () {
    const d1 = yield* Cloudflare.D1.QueryDatabase(BenchDb);
    const state = yield* Cloudflare.DurableObjectState;

    // oxlint-disable-next-line effecttsgo/return-effect-in-gen -- Alchemy runs the outer effect to bind and this one for each instance
    return Effect.gen(function* () {
      const raw = yield* d1.raw;
      const { db, written } = metered(raw);
      const services = yield* Layer.build(
        Layer.mergeAll(D1Client.layer({ db }), SecureRandom.layerWebCrypto),
      ).pipe(Effect.orDie);
      const provided = Effect.provide(services);
      yield* runMigrations(benchMigrations).pipe(provided, Effect.orDie);
      const store = yield* makeStore.pipe(provided);
      const random = yield* SecureRandom.SecureRandom.pipe(provided);
      const run = yield* random.uuidV4();
      const collector = yield* makeCollector({
        project: 1000,
        run,
        limits: defaultLimits,
        store,
      }).pipe(Effect.orDie);

      // Spent before the work, and kept through a restart.
      const spend = Effect.fnUntraced(function* (
        kind: 'runs' | 'collected',
        most: number,
      ) {
        const before = (yield* state.storage.get<number>(kind)) ?? 0;
        if (before >= most) return Option.none();
        yield* state.storage.put(kind, before + 1);
        return Option.some(before + 1);
      });

      return {
        run: (index: number) =>
          Effect.gen(function* () {
            const work = scratchWorkloads[index];
            const spent = yield* spend('runs', MOST_RUNS);
            if (work === undefined || Option.isNone(spent)) return null;
            const before = yield* written;
            const outcome = yield* runWorkload(work, spent.value).pipe(
              provided,
              Effect.orDie,
            );
            const after = yield* written;
            return { ...outcome, measuredRows: after - before };
          }),
        collect: (id: string) =>
          Effect.gen(function* () {
            const spent = yield* spend('collected', MOST_COLLECTED);
            if (Option.isNone(spent)) return 'refused' as const;
            const now = yield* DateTime.now;
            return yield* collector
              .collect({
                project: 1000,
                id,
                fingerprint: 'http',
                rules: 1,
                title: 'Error: over HTTP',
                person: null,
                traceId: null,
                occurredAt: now,
                receivedAt: now,
                properties: '{}',
              })
              .pipe(Effect.orDie);
          }),
        flush: () => collector.flush().pipe(Effect.orDie),
      };
    });
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- a Durable Object is an entry point
  }).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseBinding)),
) {}

const decodeIndex = Schema.decodeUnknownOption(Schema.FiniteFromString);

export default class BenchWorker extends Cloudflare.Worker<BenchWorker>()(
  'BenchWorker',
  { main: import.meta.url },
  Effect.gen(function* () {
    const collectors = yield* BenchCollector;
    const throttle = yield* Cloudflare.RateLimit('THROTTLE', {
      namespaceId: 4711,
      simple: { limit: 1000, period: 10 },
    });
    // The key itself is in no file and no state, only in whoever calls.
    const expected = yield* Config.String('BENCH_KEY_SHA256');

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { headers } = request;
        const url = new URL(request.url, 'http://bench');
        const authorization = Option.getOrElse(
          Headers.get(headers, 'authorization'),
          () => '',
        );
        const digest = yield* sha256(
          Str.replace(/^Bearer /u, '')(authorization),
        );
        // What ingest does with an unknown key: no body, no storage.
        if (digest !== expected || request.method !== 'POST') {
          return Unauthorized;
        }
        const collector = collectors.getByName('bench');
        if (url.pathname === '/run') {
          const index = decodeIndex(url.searchParams.get('work'));
          if (Option.isNone(index))
            return HttpServerResponse.empty({ status: 400 });
          const outcome = yield* collector.run(index.value);
          return yield* HttpServerResponse.json(outcome);
        }
        if (url.pathname === '/collect') {
          const { success } = yield* throttle.limit({ key: 'bench' });
          if (!success) return HttpServerResponse.empty({ status: 429 });
          const decision = yield* collector.collect(
            url.searchParams.get('id') ?? '',
          );
          return yield* HttpServerResponse.json({ decision });
        }
        if (url.pathname === '/flush') {
          const flushed = yield* collector.flush();
          return yield* HttpServerResponse.json(flushed);
        }
        return HttpServerResponse.empty({ status: 404 });
      }).pipe(Effect.orDie),
    };
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- a Worker is an entry point
  }).pipe(Effect.provide(Cloudflare.Workers.RateLimitBinding)),
) {}
