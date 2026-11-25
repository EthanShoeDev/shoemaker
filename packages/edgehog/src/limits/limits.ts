import { Effect, Predicate, Record as Rec, Schema } from 'effect';

// What one project may use. Each is finite, has a default, and can be changed
// but not turned off.
export interface Limits {
  // Accepted in an hour; past it, only the sample until the hour ends.
  readonly reportsPerHour: number;
  readonly samplesPerMinute: number;
  // Of one issue, kept with details; past it they are only counted.
  readonly detailsPerIssuePerHour: number;
  // Past it, new errors are counted under one overflow issue.
  readonly newIssuesPerHour: number;
  // Rows written in a day, by what writes them. Deletes are writes.
  readonly ingestRowsPerDay: number;
  readonly cleanupRowsPerDay: number;
  // Usage, alerts and the one row that counts what no other limit lets in.
  readonly otherRowsPerDay: number;
  readonly storedBytes: number;
  // Of one occurrence, after scrubbing.
  readonly occurrenceBytes: number;
  readonly emailsPerDay: number;
  readonly sendsPerAlert: number;
}

const KIB = 1024;
const GIB = KIB * KIB * KIB;

// Whatever ingest may write in a day, cleanup may delete in a day: see
// `worst-case.ts`.
export const defaultLimits: Limits = {
  reportsPerHour: 20_000,
  samplesPerMinute: 10,
  detailsPerIssuePerHour: 100,
  newIssuesPerHour: 50,
  ingestRowsPerDay: 45_000,
  cleanupRowsPerDay: 45_000,
  otherRowsPerDay: 10_000,
  storedBytes: GIB,
  occurrenceBytes: 64 * KIB,
  emailsPerDay: 20,
  sendsPerAlert: 5,
};

export const limitNames = Rec.keys(defaultLimits);

const known: ReadonlySet<string> = new Set(limitNames);

export class InvalidLimit extends Schema.TaggedError<
  InvalidLimit,
  { readonly brand: unique symbol }
>()('InvalidLimit', { limit: Schema.String, value: Schema.Unknown }) {
  override get message() {
    return known.has(this.limit)
      ? `The limit ${this.limit} must be a whole number above zero, and is ${String(this.value)}.`
      : `There is no limit ${this.limit}.`;
  }
}

const isLimit = (value: unknown) =>
  Predicate.isNumber(value) && Number.isSafeInteger(value) && value > 0;

// The limits of a project that configures some. Takes what a config may really
// hold: a limit set to nothing would otherwise be read as its default, and one
// with a misspelled name would be ignored.
export const resolveLimits = Effect.fnUntraced(function* (
  configured: Readonly<Record<string, unknown>> | Partial<Limits> = {},
) {
  for (const [limit, value] of Rec.toEntries<string, unknown>({
    ...configured,
  })) {
    if (!known.has(limit) || !isLimit(value)) {
      return yield* InvalidLimit.make({ limit, value });
    }
  }
  const limits: Limits = { ...defaultLimits, ...configured };
  if (limits.cleanupRowsPerDay < limits.ingestRowsPerDay) {
    return yield* InvalidLimit.make({
      limit: 'cleanupRowsPerDay',
      value: limits.cleanupRowsPerDay,
    });
  }
  return limits;
});
