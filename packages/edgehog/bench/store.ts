import { Array as Arr, DateTime, Effect, Schema, String as Str } from 'effect';
import { SecureRandom } from 'effect/crypto';
import { SqlClient } from 'effect/sql';
import { AtomicWrites } from 'shoemaker-admin/sql';

import { detailRows, newIssueRows, rowCosts } from '../src/limits/costs.ts';

export interface Occurrence {
  readonly project: number;
  readonly id: string;
  readonly fingerprint: string;
  readonly rules: number;
  readonly title: string;
  readonly person: string | null;
  readonly traceId: string | null;
  readonly occurredAt: DateTime.Utc;
  readonly receivedAt: DateTime.Utc;
  readonly properties: string;
}

export interface Counted {
  readonly fingerprint: string;
  readonly rules: number;
  readonly total: number;
}

const decodeUsage = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ rows: Schema.Finite })),
);
const decodeFound = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ issue: Schema.String, stored: Schema.Finite })),
);

const DAY_LENGTH = 10;
const HOUR_LENGTH = 13;
export const dayOf = (time: DateTime.Utc) =>
  time.pipe(DateTime.formatIso, Str.slice(0, DAY_LENGTH));
export const hourOf = (time: DateTime.Utc) =>
  time.pipe(DateTime.formatIso, Str.slice(0, HOUR_LENGTH));

// The unit of decision 3. The event comes first, with an id for this attempt,
// and every later statement asks whether that attempt is the one stored: so a
// resend changes nothing, and of two first occurrences one makes the issue.
export const makeStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const atomic = yield* AtomicWrites.make;
  const random = yield* SecureRandom.SecureRandom;

  const storeDetail = Effect.fn('bench.storeDetail')(function* (
    event: Occurrence,
    // Whether the collector knows the fingerprint's issue already.
    known: boolean,
  ) {
    const attempt = yield* random.uuidV7();
    const issue = yield* random.uuidV7();
    const occurredAt = DateTime.formatIso(event.occurredAt);
    const receivedAt = DateTime.formatIso(event.receivedAt);
    const { fingerprint, id, project, rules } = event;

    const thisAttempt = sql`EXISTS (
      SELECT 1 FROM edgehog_event
      WHERE project = ${project} AND id = ${id} AND attempt = ${attempt})`;
    const issueOfFingerprint = sql`(
      SELECT issue FROM edgehog_fingerprint
      WHERE project = ${project} AND fingerprint = ${fingerprint}
        AND rules = ${rules})`;
    const isNewIssue = sql`${thisAttempt}
      AND ${issueOfFingerprint} = ${issue}`;

    const creating = known
      ? []
      : [
          sql`INSERT INTO edgehog_fingerprint (project, fingerprint, rules, issue)
            SELECT ${project}, ${fingerprint}, ${rules}, ${issue}
            WHERE ${thisAttempt}
            ON CONFLICT DO NOTHING`,
          sql`INSERT INTO edgehog_issue
              (id, project, state, title, first_seen, opened_at)
            SELECT ${issue}, ${project}, 'open', ${event.title}, ${occurredAt},
              ${receivedAt}
            WHERE ${isNewIssue}
            ON CONFLICT DO NOTHING`,
          sql`INSERT INTO edgehog_alert (issue, cause, state, sends)
            SELECT ${issue}, 'new', 'pending', 0
            WHERE ${isNewIssue}
            ON CONFLICT DO NOTHING`,
        ];
    const rows = detailRows + (known ? 0 : newIssueRows);

    yield* atomic.run([
      sql`INSERT INTO edgehog_event
          (project, id, attempt, fingerprint, rules, kind, name, person,
            trace_id, span_id, occurred_at, received_at, properties)
        VALUES (${project}, ${id}, ${attempt}, ${fingerprint}, ${rules},
          'error', ${event.title}, ${event.person}, ${event.traceId}, NULL,
          ${occurredAt}, ${receivedAt}, ${event.properties})
        ON CONFLICT DO NOTHING`,
      ...creating,
      sql`UPDATE edgehog_issue SET first_seen = ${occurredAt}
        WHERE id = ${issueOfFingerprint} AND first_seen > ${occurredAt}
          AND ${thisAttempt}`,
      // Only for what was received after the issue was resolved.
      sql`UPDATE edgehog_issue
        SET state = 'open', opened_at = ${receivedAt}, resolved_at = NULL
        WHERE id = ${issueOfFingerprint} AND state = 'resolved'
          AND resolved_at < ${receivedAt} AND ${thisAttempt}`,
      sql`INSERT INTO edgehog_usage (project, day, row_count, stored_bytes)
        SELECT ${project}, ${dayOf(event.receivedAt)}, ${rows},
          ${event.properties.length}
        WHERE ${thisAttempt}
        ON CONFLICT (project, day) DO UPDATE SET
          row_count = edgehog_usage.row_count + excluded.row_count,
          stored_bytes = edgehog_usage.stored_bytes + excluded.stored_bytes`,
    ]);
    return { attempt, rows };
  });

  // The issue a fingerprint belongs to and whether this attempt stored the
  // event. `AtomicWrites` returns no rows, so it is a query of its own here.
  const outcome = Effect.fn('bench.outcome')(function* (
    event: Occurrence,
    attempt: string,
  ) {
    const found = yield* sql`SELECT f.issue AS issue,
        CASE WHEN EXISTS (
          SELECT 1 FROM edgehog_event e
          WHERE e.project = ${event.project} AND e.id = ${event.id}
            AND e.attempt = ${attempt}) THEN 1 ELSE 0 END AS stored
      FROM edgehog_fingerprint f
      WHERE f.project = ${event.project}
        AND f.fingerprint = ${event.fingerprint} AND f.rules = ${event.rules}`;
    const decoded = yield* Effect.orDie(decodeFound(found));
    return Arr.head(decoded);
  });

  // Sets each total, so a repeated write counts once. The usage is added to, so
  // a repeated write is charged twice and never for nothing.
  const writeCounts = Effect.fn('bench.writeCounts')(function* (options: {
    readonly project: number;
    readonly run: string;
    // When they were counted, which a late write may have passed.
    readonly hour: string;
    readonly at: DateTime.Utc;
    readonly counted: ReadonlyArray<Counted>;
  }) {
    if (!Arr.isReadonlyArrayNonEmpty(options.counted)) return { rows: 0 };
    const rows = options.counted.length * rowCosts.counted + rowCosts.usage;
    yield* atomic.run([
      ...Arr.map(
        options.counted,
        (row) => sql`INSERT INTO edgehog_counted
            (project, fingerprint, rules, hour, run, total)
          VALUES (${options.project}, ${row.fingerprint}, ${row.rules},
            ${options.hour}, ${options.run}, ${row.total})
          ON CONFLICT (project, fingerprint, rules, hour, run)
            DO UPDATE SET total = excluded.total`,
      ),
      sql`INSERT INTO edgehog_usage (project, day, row_count, stored_bytes)
        VALUES (${options.project}, ${dayOf(options.at)}, ${rows}, 0)
        ON CONFLICT (project, day) DO UPDATE SET
          row_count = edgehog_usage.row_count + excluded.row_count`,
    ]);
    return { rows };
  });

  const usageOf = Effect.fn('bench.usageOf')(function* (
    project: number,
    day: string,
  ) {
    const found = yield* sql`SELECT row_count AS "rows" FROM edgehog_usage
      WHERE project = ${project} AND day = ${day}`;
    const decoded = yield* Effect.orDie(decodeUsage(found));
    return decoded[0]?.rows ?? 0;
  });

  return { storeDetail, outcome, writeCounts, usageOf };
});

export type Store = Effect.Success<typeof makeStore>;
