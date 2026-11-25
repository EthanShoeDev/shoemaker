import {
  Array as Arr,
  Clock,
  DateTime,
  Effect,
  Option,
  Result,
  Semaphore,
} from 'effect';

import { detailRows, newIssueRows } from '../src/limits/costs.ts';
import type { Limits } from '../src/limits/limits.ts';
import { dayOf, hourOf, type Occurrence, type Store } from './store.ts';

export type Decision = 'refused' | 'detail' | 'counted' | 'resent';

const OVERFLOW = 'overflow';
// Ids counted without details are remembered for ten minutes, and never more
// than these: an hour's reports.
const REMEMBERED_MS = 600_000;

interface Count {
  readonly fingerprint: string;
  readonly rules: number;
  total: number;
  written: number;
}

// One project's collector, as far as the benchmark goes: no samples, no pause, no
// storage limit, and no counts across hours. It is in one place, so what it holds in memory is exact,
// and the only one that writes. Decided before anything is awaited, so two
// requests at once cannot both take the last of an allowance.
export const makeCollector = Effect.fnUntraced(function* (options: {
  readonly project: number;
  readonly run: string;
  readonly limits: Limits;
  readonly store: Store;
}) {
  const { limits, project, run, store } = options;
  // Writes wait for each other, as they would in D1. Deciding does not.
  const writing = yield* Semaphore.make(1);
  const started = yield* DateTime.now;

  let hour = hourOf(started);
  let day = dayOf(started);
  let rowsToday = yield* store.usageOf(project, day);
  let reports = 0;
  let newIssues = 0;
  let detailed = new Map<string, number>();
  const counts = new Map<string, Count>();
  const countedIds = new Map<string, number>();
  // Fingerprints that have an issue. A restart forgets them, and then the
  // first occurrence of each is written as if it were new.
  const known = new Set<string>();
  // Being written for the first time. Another occurrence meanwhile is written
  // as if it were new too, in case the first fails.
  const opening = new Set<string>();

  const keyOf = (fingerprint: string, rules: number) =>
    `${rules}:${fingerprint}`;

  const count = (fingerprint: string, rules: number) => {
    const key = keyOf(fingerprint, rules);
    const row = counts.get(key);
    if (row === undefined) {
      counts.set(key, { fingerprint, rules, total: 1, written: 0 });
    } else {
      row.total += 1;
    }
  };

  const decide = (event: Occurrence, now: number) => {
    const at = DateTime.makeUnsafe(now);
    if (hourOf(at) !== hour) {
      hour = hourOf(at);
      reports = 0;
      newIssues = 0;
      detailed = new Map();
    }
    if (dayOf(at) !== day) {
      day = dayOf(at);
      rowsToday = 0;
    }
    if (reports >= limits.reportsPerHour) return 'refused' as const;
    reports += 1;

    for (const [id, until] of countedIds) {
      if (until > now) break;
      countedIds.delete(id);
    }
    if (countedIds.has(event.id)) return 'resent' as const;

    const key = keyOf(event.fingerprint, event.rules);
    const isNew = !known.has(key);
    const cost = detailRows + (isNew ? newIssueRows : 0);
    const kept = detailed.get(key) ?? 0;
    const fits = rowsToday + cost <= limits.ingestRowsPerDay;
    const overflows =
      isNew && !opening.has(key) && newIssues >= limits.newIssuesPerHour;
    if (!fits || overflows || kept >= limits.detailsPerIssuePerHour) {
      countedIds.set(event.id, now + REMEMBERED_MS);
      count(overflows ? OVERFLOW : event.fingerprint, event.rules);
      return 'counted' as const;
    }
    rowsToday += cost;
    detailed.set(key, kept + 1);
    if (isNew && !opening.has(key)) {
      newIssues += 1;
      opening.add(key);
    }
    return { isNew, key };
  };

  // Answers once the occurrence is written or counted.
  const collect = Effect.fn('bench.collect')(function* (event: Occurrence) {
    const now = yield* Clock.currentTimeMillis;
    const decision = decide(event, now);
    if (
      decision === 'refused' ||
      decision === 'counted' ||
      decision === 'resent'
    )
      return decision satisfies Decision;
    const { attempt } = yield* writing.withPermit(
      store.storeDetail(event, !decision.isNew),
    );
    if (decision.isNew) {
      known.add(decision.key);
      opening.delete(decision.key);
    }
    const outcome = decision.isNew
      ? yield* store.outcome(event, attempt)
      : Option.none();
    const resent = Option.exists(outcome, ({ stored }) => stored === 0);
    return resent ? ('resent' as const) : ('detail' as const);
  });

  // Once a minute. A total that has not moved is not written again.
  const flush = Effect.fn('bench.flush')(function* () {
    const moved = Arr.filterMap([...counts.values()], (row) =>
      row.total === row.written
        ? Result.failVoid
        : Result.succeed({ row, total: row.total }),
    );
    const at = yield* DateTime.now;
    const { rows } = yield* writing.withPermit(
      store.writeCounts({
        project,
        run,
        hour,
        at,
        counted: Arr.map(moved, ({ row, total }) => ({ ...row, total })),
      }),
    );
    for (const { row, total } of moved) row.written = total;
    rowsToday += rows;
    return { rows, counted: moved.length };
  });

  const usage = Effect.sync(() => ({ reports, newIssues, rowsToday }));

  return { collect, flush, usage };
});
