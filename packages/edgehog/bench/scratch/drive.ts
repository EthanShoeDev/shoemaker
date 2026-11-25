// Drives the deployed scratch stage. Run by Ethan, as README.md describes.
//
//   node bench/scratch/drive.ts --url https://...            the benchmark
//   node bench/scratch/drive.ts --url https://... --blocked  the edge rule
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import {
  Array as Arr,
  Clock,
  Config,
  Console,
  Duration,
  Effect,
  Number as Num,
  Order,
  Record as Rec,
  Redacted,
} from 'effect';
import { Command, Flag } from 'effect/cli';
import { SecureRandom } from 'effect/crypto';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';

import { defaultLimits } from '../../src/limits/limits.ts';
import { ownCost } from '../workload.ts';
import { MOST_COLLECTED, scratchWorkloads } from './plan.ts';

const DEADLINE_SECONDS = 600;
const MOST_DOLLARS = 0.25;
const COLLECTS = 500;
const REFUSALS = 300;
const BLOCKED = 2000;
const CONCURRENCY = 32;

const timed = Effect.fnUntraced(function* (
  request: HttpClientRequest.HttpClientRequest,
) {
  const from = yield* Clock.currentTimeNanos;
  const response = yield* HttpClient.execute(request);
  const text = yield* response.text;
  const to = yield* Clock.currentTimeNanos;
  return {
    status: response.status,
    text,
    ms: Duration.toMillis(Duration.nanos(to - from)),
  };
});

const summary = (
  results: ReadonlyArray<{ readonly status: number; readonly ms: number }>,
) => {
  const sorted = Arr.sort(
    Arr.map(results, ({ ms }) => ms),
    Order.Number,
  );
  const at = (share: number) =>
    Num.round(sorted[Math.floor((sorted.length - 1) * share)] ?? 0, 1);
  return {
    statuses: Rec.map(
      Arr.groupBy(results, ({ status }) => String(status)),
      (group) => group.length,
    ),
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
  };
};

const benchmark = Effect.fnUntraced(function* (url: string) {
  const key = yield* Config.Redacted('BENCH_KEY');
  const random = yield* SecureRandom.SecureRandom;
  const post = (path: string) =>
    HttpClientRequest.post(`${url}${path}`).pipe(
      HttpClientRequest.bearerToken(Redacted.value(key)),
    );
  const cost = ownCost({
    works: [
      ...scratchWorkloads,
      {
        name: 'over HTTP',
        occurrences: COLLECTS + REFUSALS,
        fingerprints: 1,
        concurrency: CONCURRENCY,
        sends: 1,
        flushes: 1,
        limits: defaultLimits,
      },
    ],
    rounds: 1,
    deadlineSeconds: DEADLINE_SECONDS,
  });
  yield* Console.log(
    `At most ${cost.rows} rows written and ${cost.requests} requests: at most ${cost.dollars.toFixed(4)} dollars, if the account has used up what is included.`,
  );
  if (cost.dollars > MOST_DOLLARS) {
    return yield* Effect.die(
      new Error(`It may cost more than ${MOST_DOLLARS} dollars.`),
    );
  }
  for (const [index] of scratchWorkloads.entries()) {
    const result = yield* timed(post(`/run?work=${index}`));
    yield* Console.log(result.status, result.text);
  }
  const ids = yield* Effect.replicateEffect(random.uuidV4(), COLLECTS);
  const collected = yield* Effect.forEach(
    ids,
    (id) => timed(post(`/collect?id=${id}`)),
    { concurrency: CONCURRENCY },
  );
  yield* Console.log('collected over HTTP', summary(collected));
  const flushed = yield* timed(post('/flush'));
  yield* Console.log('flushed', flushed.text);
  const refused = yield* Effect.forEach(
    Arr.range(1, REFUSALS),
    () => timed(HttpClientRequest.post(`${url}/collect`)),
    { concurrency: CONCURRENCY },
  );
  yield* Console.log('refused for an unknown key', summary(refused));
  yield* Console.log(
    `${COLLECTS} of the ${MOST_COLLECTED} requests this stage will ever collect.`,
  );
});

const blocked = Effect.fnUntraced(function* (url: string) {
  const results = yield* Effect.forEach(
    Arr.range(1, BLOCKED),
    () => timed(HttpClientRequest.post(`${url}/collect`)),
    { concurrency: CONCURRENCY },
  );
  yield* Console.log(summary(results));
  yield* Console.log(
    'A 401 reached the Worker. A 429 was stopped by the edge rule, before it.',
  );
});

const drive = Command.make(
  'drive',
  {
    url: Flag.String('url').pipe(
      Flag.withDescription('The address the deploy printed, or a blocked one'),
    ),
    blocked: Flag.Boolean('blocked').pipe(
      Flag.withDescription('Flood the edge rule instead'),
      Flag.withDefault(false),
    ),
  },
  (flags) =>
    (flags.blocked ? blocked(flags.url) : benchmark(flags.url)).pipe(
      Effect.timeout(`${DEADLINE_SECONDS} seconds`),
    ),
).pipe(Command.withDescription('Drive the scratch stage'));

Command.run(drive, { version: '0.0.0' }).pipe(
  Effect.provide([
    NodeServices.layer,
    FetchHttpClient.layer,
    SecureRandom.layerWebCrypto,
  ]),
  NodeRuntime.runMain,
);
