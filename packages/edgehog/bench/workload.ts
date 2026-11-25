import {
  Array as Arr,
  Clock,
  DateTime,
  Duration,
  Effect,
  Exit,
  Number as Num,
  Order,
  Schema,
  String as Str,
} from 'effect';
import { SecureRandom } from 'effect/crypto';
import { SqlClient } from 'effect/sql';

import { detailRows, newIssueRows, rowCosts } from '../src/limits/costs.ts';
import { defaultLimits, type Limits } from '../src/limits/limits.ts';
import { prices } from '../src/limits/prices.ts';
import { makeCollector } from './collector.ts';
import { makeStore, type Occurrence } from './store.ts';

// Every number here is fixed, so what a run may cost is known before it starts.
export interface Workload {
  readonly name: string;
  readonly occurrences: number;
  readonly fingerprints: number;
  readonly concurrency: number;
  // How many times each occurrence is sent.
  readonly sends: number;
  readonly flushes: number;
  readonly limits: Limits;
}

// A typical stack, scrubbed.
const PROPERTY_BYTES = 4096;
const properties = Str.repeat(PROPERTY_BYTES)('x');

const many: Limits = {
  ...defaultLimits,
  detailsPerIssuePerHour: 1_000_000,
  newIssuesPerHour: 1_000_000,
};

export const workloads: ReadonlyArray<Workload> = [
  {
    name: 'one hot issue',
    occurrences: 2000,
    fingerprints: 1,
    concurrency: 32,
    sends: 1,
    flushes: 2,
    limits: defaultLimits,
  },
  {
    name: 'many issues',
    occurrences: 400,
    fingerprints: 400,
    concurrency: 16,
    sends: 1,
    flushes: 1,
    limits: defaultLimits,
  },
  {
    name: 'details, one at a time',
    occurrences: 200,
    fingerprints: 10,
    concurrency: 1,
    sends: 1,
    flushes: 0,
    limits: many,
  },
  {
    name: 'details, 32 at once',
    occurrences: 1000,
    fingerprints: 20,
    concurrency: 32,
    sends: 1,
    flushes: 0,
    limits: many,
  },
  {
    name: 'counts of 50 issues',
    occurrences: 2000,
    fingerprints: 50,
    concurrency: 32,
    sends: 1,
    flushes: 3,
    limits: { ...many, detailsPerIssuePerHour: 1 },
  },
  {
    name: 'every event sent twice',
    occurrences: 200,
    fingerprints: 5,
    concurrency: 8,
    sends: 2,
    flushes: 0,
    limits: many,
  },
];

// What each detail can cost at most, as if nothing were refused or counted.
const mostRows = (work: Workload) => {
  const issues = Num.min(work.fingerprints, work.limits.newIssuesPerHour);
  const details = Num.min(
    work.occurrences,
    work.fingerprints * work.limits.detailsPerIssuePerHour,
  );
  return (
    details * work.sends * detailRows +
    // Written as new by as many as arrive before the first is stored.
    issues * work.concurrency * newIssueRows +
    work.flushes * (work.fingerprints * rowCosts.counted + rowCosts.usage)
  );
};

const MILLION = 1_000_000;
const GB_SECONDS_PER_SECOND = 0.128;
const SETUP_ROWS = 100;

// In dollars, at the prices past what is included, for as long as the deadline.
export const ownCost = (options: {
  readonly works: ReadonlyArray<Workload>;
  readonly rounds: number;
  readonly deadlineSeconds: number;
}) => {
  const { perMillion } = prices;
  const rows =
    SETUP_ROWS + options.rounds * Num.sumAll(Arr.map(options.works, mostRows));
  const requests =
    options.rounds *
    Num.sumAll(
      Arr.map(options.works, (work) => work.occurrences * work.sends + 10),
    );
  const dollars =
    (rows * perMillion.d1RowsWritten +
      // Generous: ten rows read for each written.
      rows * 10 * perMillion.d1RowsRead +
      requests *
        (perMillion.workerRequests + perMillion.durableObjectRequests) +
      requests * 10 * perMillion.workerCpuMs +
      options.deadlineSeconds *
        GB_SECONDS_PER_SECOND *
        perMillion.durableObjectGbSeconds) /
    MILLION;
  return { rows, requests, dollars };
};

const decodeStored = Schema.decodeUnknownEffect(
  Schema.Tuple([
    Schema.Struct({
      events: Schema.Finite,
      fingerprints: Schema.Finite,
      issues: Schema.Finite,
      alerts: Schema.Finite,
      counted: Schema.Finite,
    }),
  ]),
);

const percentile = (sorted: ReadonlyArray<number>, at: number) =>
  sorted[Num.min(sorted.length - 1, Math.floor(sorted.length * at))] ?? 0;

const millis = (from: bigint, to: bigint) =>
  Duration.toMillis(Duration.nanos(to - from));

// Runs one workload through a collector of its own project.
export const runWorkload = Effect.fnUntraced(function* (
  work: Workload,
  project: number,
) {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const store = yield* makeStore;
  const run = yield* random.uuidV4();
  const collector = yield* makeCollector({
    project,
    run,
    limits: work.limits,
    store,
  });
  const ids = yield* Effect.replicateEffect(random.uuidV4(), work.occurrences);
  const now = yield* DateTime.now;
  const singles: ReadonlyArray<Occurrence> = Arr.map(ids, (id, index) => ({
    project,
    id,
    fingerprint: `fingerprint-${index % work.fingerprints}`,
    rules: 1,
    title: 'TypeError: cannot read a property',
    person: `person-${index % 100}`,
    traceId: Str.padStart(32, '0')(String(index)),
    occurredAt: now,
    receivedAt: now,
    properties,
  }));
  const events = Arr.flatMap(singles, (event) =>
    Arr.replicate(event, work.sends),
  );

  const details: Array<number> = [];
  const decisions = { refused: 0, detail: 0, counted: 0, resent: 0 };
  let failed = 0;
  const started = yield* Clock.currentTimeNanos;
  yield* Effect.forEach(
    events,
    Effect.fnUntraced(function* (event) {
      const from = yield* Clock.currentTimeNanos;
      const exit = yield* Effect.exit(collector.collect(event));
      const to = yield* Clock.currentTimeNanos;
      if (Exit.isFailure(exit)) {
        failed += 1;
        return;
      }
      decisions[exit.value] += 1;
      if (exit.value === 'detail') details.push(millis(from, to));
    }),
    { concurrency: work.concurrency, discard: true },
  );
  const collected = yield* Clock.currentTimeNanos;
  const flushes: Array<number> = [];
  for (let index = 0; index < work.flushes; index += 1) {
    // Moves each total, so the next write sets it again.
    if (index > 0) {
      yield* Effect.forEach(
        Arr.take(singles, work.fingerprints),
        (event) => collector.collect({ ...event, id: `${event.id}-${index}` }),
        { concurrency: 1, discard: true },
      );
    }
    const from = yield* Clock.currentTimeNanos;
    yield* collector.flush();
    const to = yield* Clock.currentTimeNanos;
    flushes.push(millis(from, to));
  }
  // Each event once, and one issue and one alert for each fingerprint kept.
  const [stored] = yield* sql`SELECT
      CAST((SELECT COUNT(*) FROM edgehog_event
        WHERE project = ${project}) AS INTEGER) AS events,
      CAST((SELECT COUNT(DISTINCT fingerprint) FROM edgehog_event
        WHERE project = ${project}) AS INTEGER) AS fingerprints,
      CAST((SELECT COUNT(*) FROM edgehog_issue
        WHERE project = ${project}) AS INTEGER) AS issues,
      CAST((SELECT COUNT(*) FROM edgehog_alert a JOIN edgehog_issue i
        ON i.id = a.issue WHERE i.project = ${project}) AS INTEGER) AS alerts,
      CAST((SELECT COALESCE(SUM(total), 0) FROM edgehog_counted
        WHERE project = ${project}) AS INTEGER) AS counted`.pipe(
    Effect.flatMap(decodeStored),
    Effect.orDie,
  );
  const { rowsToday } = yield* collector.usage;
  const sorted = Arr.sort(details, Order.Number);
  const elapsed = millis(started, collected);
  return {
    name: work.name,
    sent: events.length,
    ...decisions,
    failed,
    elapsedMs: Math.round(elapsed),
    perSecond: Math.round((events.length / elapsed) * 1000),
    detailsPerSecond: Math.round((details.length / elapsed) * 1000),
    detailP50: Num.round(percentile(sorted, 0.5), 2),
    detailP95: Num.round(percentile(sorted, 0.95), 2),
    detailP99: Num.round(percentile(sorted, 0.99), 2),
    flushMs: Arr.map(flushes, (ms) => Num.round(ms, 2)),
    stored,
    // What the fixed costs say was written.
    chargedRows: rowsToday,
  };
});
