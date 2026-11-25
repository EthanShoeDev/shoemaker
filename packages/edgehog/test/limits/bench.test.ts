import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Layer } from 'effect';
import { SecureRandom } from 'effect/crypto';
import type { SqlClient } from 'effect/sql';
import { runMigrations } from 'shoemaker-admin/sql';
import { d1, sqlite } from 'shoemaker-utils/testing/databases';

import { benchMigrations } from '../../bench/schema.ts';
import { scratchWorkloads } from '../../bench/scratch/plan.ts';
import { ownCost, runWorkload, workloads } from '../../bench/workload.ts';
import { defaultLimits } from '../../src/limits/limits.ts';

const MOST_DOLLARS = 0.25;

const small = {
  name: 'small',
  occurrences: 40,
  fingerprints: 2,
  concurrency: 8,
  sends: 2,
  flushes: 2,
  limits: { ...defaultLimits, detailsPerIssuePerHour: 10 },
};

describe('the benchmark', () => {
  for (const [name, works] of [
    ['here', workloads],
    ['on a scratch stage', scratchWorkloads],
  ] as const) {
    it(`may cost next to nothing ${name}`, () => {
      const { dollars } = ownCost({ works, rounds: 1, deadlineSeconds: 600 });
      assert.isBelow(dollars, MOST_DOLLARS);
    });
  }

  const databases: ReadonlyArray<
    readonly [string, Layer.Layer<SqlClient.SqlClient>]
  > = [
    ['SQLite', Layer.orDie(sqlite)],
    ['D1', Layer.orDie(d1())],
  ];
  for (const [name, database] of databases) {
    it.effect(
      `stores once, counts the rest and charges for it on ${name}`,
      () =>
        Effect.gen(function* () {
          yield* runMigrations(benchMigrations);
          const outcome = yield* runWorkload(small, 1);
          assert.strictEqual(outcome.failed, 0);
          assert.strictEqual(outcome.stored.events, 10);
          for (const count of ['fingerprints', 'issues', 'alerts'] as const) {
            assert.strictEqual(outcome.stored[count], small.fingerprints);
          }
          // A resend that was counted without details is remembered. Two more
          // are counted between the writes.
          assert.strictEqual(outcome.counted, small.occurrences - 10);
          assert.strictEqual(
            outcome.stored.counted,
            outcome.counted + small.fingerprints,
          );
          const { rows } = ownCost({
            works: [small],
            rounds: 1,
            deadlineSeconds: 1,
          });
          assert.isAtMost(outcome.chargedRows, rows);
        }).pipe(
          Effect.provide(Layer.merge(database, SecureRandom.layerWebCrypto)),
        ),
    );
  }

  it('names each workload once', () => {
    const names = Arr.map(workloads, (work) => work.name);
    assert.strictEqual(Arr.dedupe(names).length, names.length);
  });
});
