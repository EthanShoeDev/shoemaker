import { defaultLimits, type Limits } from '../../src/limits/limits.ts';
import type { Workload } from '../workload.ts';

// The whole of what the scratch stage may do, whatever calls it: the object
// counts these in its own storage.
export const MOST_RUNS = 24;
export const MOST_COLLECTED = 3000;

const open: Limits = {
  ...defaultLimits,
  detailsPerIssuePerHour: 1_000_000,
  newIssuesPerHour: 1_000_000,
};

// Each is one request, and D1 takes 1,000 queries of one, batched or not.
export const scratchWorkloads: ReadonlyArray<Workload> = [
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
    occurrences: 100,
    fingerprints: 5,
    concurrency: 1,
    sends: 1,
    flushes: 0,
    limits: open,
  },
  {
    name: 'details, 32 at once',
    occurrences: 150,
    fingerprints: 5,
    concurrency: 32,
    sends: 1,
    flushes: 0,
    limits: open,
  },
  {
    name: 'counts of 50 issues',
    occurrences: 2000,
    fingerprints: 50,
    concurrency: 32,
    sends: 1,
    flushes: 3,
    limits: { ...open, detailsPerIssuePerHour: 1 },
  },
  {
    name: 'every event sent twice',
    occurrences: 60,
    fingerprints: 5,
    concurrency: 8,
    sends: 2,
    flushes: 0,
    limits: open,
  },
];
