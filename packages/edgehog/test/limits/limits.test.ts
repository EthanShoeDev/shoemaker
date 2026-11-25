import { assert, describe, it } from '@effect/vitest';
import { Effect, Exit } from 'effect';

import {
  defaultLimits,
  type InvalidLimit,
  limitNames,
  type Limits,
  resolveLimits,
} from '../../src/limits/limits.ts';
import { deletableRowsPerDay, worstCase } from '../../src/limits/worst-case.ts';

const MOST = 20;

// How far each default may be raised before the month can cost too much. The
// limits that bound no money directly are left out: they bound rows or sends,
// which have limits of their own.
const priced: ReadonlyArray<readonly [keyof Limits, number]> = [
  ['reportsPerHour', 30_000],
  ['samplesPerMinute', 200],
  ['ingestRowsPerDay', 200_000],
  ['cleanupRowsPerDay', 200_000],
  ['otherRowsPerDay', 200_000],
  ['storedBytes', 8 * defaultLimits.storedBytes],
  ['newIssuesPerHour', 2000],
  ['emailsPerDay', 400],
  ['sendsPerAlert', 300],
];

const refused = (configured: Readonly<Record<string, unknown>>) =>
  Effect.flip(resolveLimits(configured));

describe('Every use has a finite limit', () => {
  it.effect('Nothing configured', () =>
    Effect.gen(function* () {
      const limits = yield* resolveLimits();
      assert.deepStrictEqual(limits, defaultLimits);
      for (const name of limitNames) {
        assert.isTrue(Number.isFinite(limits[name]), name);
      }
    }),
  );

  for (const name of limitNames) {
    for (const value of [
      undefined,
      null,
      0,
      -1,
      1.5,
      Number.POSITIVE_INFINITY,
      Number.NaN,
      '100',
      false,
    ]) {
      it.effect(`Limit turned off: ${name} ${String(value)}`, () =>
        Effect.gen(function* () {
          const error: InvalidLimit = yield* refused({ [name]: value });
          assert.strictEqual(error.limit, name);
          assert.include(error.message, name);
        }),
      );
    }
  }

  it.effect('a misspelled limit is not ignored', () =>
    Effect.gen(function* () {
      const error = yield* refused({ emailPerDay: 5 });
      assert.include(error.message, 'emailPerDay');
    }),
  );

  it.effect('a limit can be changed', () =>
    Effect.gen(function* () {
      const limits = yield* resolveLimits({ emailsPerDay: 3 });
      assert.deepStrictEqual(limits, { ...defaultLimits, emailsPerDay: 3 });
    }),
  );

  it.effect('cleanup may not be given less than ingest', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        resolveLimits({ ingestRowsPerDay: 50_000 }),
      );
      assert.isTrue(Exit.isFailure(exit));
    }),
  );
});

describe('The worst case is known', () => {
  it('with the defaults stays within the amount', () => {
    assert.isAtMost(worstCase(defaultLimits).total, MOST);
  });

  it('A default is raised', () => {
    for (const [name, raised] of priced) {
      assert.isAbove(
        worstCase({ ...defaultLimits, [name]: raised }).total,
        MOST,
        name,
      );
    }
  });

  // Open: the spec's amount does not say whether Durable Objects' rounding
  // counts. It is at most one unit of duration for the account, not the project.
  it('is known with Durable Objects rounded up too', () => {
    assert.closeTo(worstCase(defaultLimits).rounded, 26, 1);
  });

  it('writes no more rows than the share of each writer', () => {
    const { ingestRowsPerDay, cleanupRowsPerDay, otherRowsPerDay } =
      defaultLimits;
    assert.strictEqual(
      ingestRowsPerDay + cleanupRowsPerDay + otherRowsPerDay,
      100_000,
    );
  });
});

describe('Cleanup is bounded and keeps up', () => {
  it('may delete in a day what a day of ingest can store', () => {
    assert.isAtMost(
      deletableRowsPerDay(defaultLimits),
      defaultLimits.cleanupRowsPerDay,
    );
  });

  it('would not with the smaller share', () => {
    const smaller = {
      ...defaultLimits,
      ingestRowsPerDay: 50_000,
      cleanupRowsPerDay: 40_000,
    };
    assert.isAbove(deletableRowsPerDay(smaller), smaller.cleanupRowsPerDay);
  });
});
