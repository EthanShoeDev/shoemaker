import { Number as Num, Record as Rec } from 'effect';

import { detailRows, rowCosts } from './costs.ts';
import type { Limits } from './limits.ts';
import { prices, roundedUp } from './prices.ts';

const DAYS = 31;
const HOURS = 24 * DAYS;
const MINUTES = 60 * HOURS;
const SECONDS = 60 * MINUTES;
const MILLION = 1_000_000;
const GB = 1_000_000_000;

// What a limit does not set. The first is held by the Worker's CPU limit.
const assumed = {
  cpuMsPerRequest: 5,
  // Durable Objects are billed for 128 MB whatever they use.
  collectorGb: 0.128,
  // An indexed look-up of each thing an occurrence needs.
  rowsReadPerDetail: 100,
  cleanupCpuMsPerDay: 30_000,
  // To find it, and to find the next.
  rowsReadPerDeleted: 2,
  // Written, read and deleted; a retry reads again.
  queueOperationsPerAlert: 3,
} as const;

type Usage = Readonly<Record<keyof typeof prices.perMillion, number>>;

// The most a project can use in the longest month, every limit reached from its
// first minute to its last.
export const worstUsage = (limits: Limits): Usage => {
  const requests =
    limits.reportsPerHour * HOURS + limits.samplesPerMinute * MINUTES;
  const detailsPerDay = limits.ingestRowsPerDay / detailRows;
  const rowsPerDay =
    limits.ingestRowsPerDay + limits.cleanupRowsPerDay + limits.otherRowsPerDay;
  const alerts = limits.newIssuesPerHour * HOURS;
  return {
    // And the daily cleanup.
    workerRequests: requests + DAYS,
    workerCpuMs:
      requests * assumed.cpuMsPerRequest + assumed.cleanupCpuMsPerDay * DAYS,
    // Each request, and a timer a minute that writes the counts.
    durableObjectRequests: requests + MINUTES,
    durableObjectGbSeconds: SECONDS * assumed.collectorGb,
    // Setting the timer.
    durableObjectRowsWritten: MINUTES,
    d1RowsWritten: rowsPerDay * DAYS,
    d1RowsRead:
      (detailsPerDay * assumed.rowsReadPerDetail +
        limits.cleanupRowsPerDay * assumed.rowsReadPerDeleted) *
      DAYS,
    queueOperations:
      alerts * (assumed.queueOperationsPerAlert + limits.sendsPerAlert - 1),
    emails: limits.emailsPerDay * DAYS,
  };
};

const priceOf = (
  usage: Usage,
  units: (name: keyof Usage, millions: number) => number,
) =>
  Rec.map(
    usage,
    (amount, name) => units(name, amount / MILLION) * prices.perMillion[name],
  );

// In dollars a month, for an account that has used up every included amount:
// what the project adds to its bill.
export const worstCase = (limits: Limits) => {
  const usage = worstUsage(limits);
  const storage = (limits.storedBytes / GB) * prices.d1GbMonth;
  const parts = { ...priceOf(usage, (_, millions) => millions), storage };
  // If the account has no other use of a rounded amount, the project pays for
  // the whole of its last unit.
  const rounded = {
    ...priceOf(usage, (name, millions) =>
      roundedUp.includes(name) ? Math.ceil(millions) : millions,
    ),
    storage,
  };
  return {
    parts,
    total: Num.sumAll(Rec.values(parts)),
    rounded: Num.sumAll(Rec.values(rounded)),
  };
};

// Rows that a day of ingest leaves for cleanup. Whatever it wrote was charged
// at least what deleting it costs, so a share as large as its own is enough,
// even were all of it counted rows, which have no more to them.
export const deletableRowsPerDay = (limits: Limits) => {
  const asDetails = Math.ceil(
    (limits.ingestRowsPerDay / detailRows) * rowCosts.event,
  );
  const asCounts = limits.ingestRowsPerDay;
  return Math.max(asDetails, asCounts);
};
