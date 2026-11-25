import { NodeServices } from '@effect/platform-node';
import { assert, it } from '@effect/vitest';
import { Effect, Schema, Stream, String as Str } from 'effect';
import { ChildProcess } from 'effect/process';

import { Report } from './report.ts';

const decode = Schema.decodeEffect(Report);

const ON = '[true,"STATIC"]';
const OFF = '[false,"DISABLED"]';
const TIMED_OUT = 120_000;

const run = Effect.fnUntraced(function* (worker: string) {
  const handle = yield* ChildProcess.make('bun', [
    `${import.meta.dirname}/run.ts`,
    worker,
  ]);
  const [out, errors, code] = yield* Effect.all(
    [
      handle.stdout.pipe(Stream.decodeText, Stream.mkString),
      handle.stderr.pipe(Stream.decodeText, Stream.mkString),
      handle.exitCode,
    ],
    { concurrency: 'unbounded' },
  );
  assert.strictEqual(Number(code), 0, `${out}${errors}`);
  const report = yield* decode(Str.trim(out));
  // What workerd says when a request waits for another's, or uses what is its.
  assert.notMatch(report.output, /uncaught|hung|different request/iu);
  assert.deepStrictEqual(report.cold, {
    answers: [ON],
    page: '{"new-checkout":{"value":true,"variant":"on","reason":"STATIC"},"nope":{"value":"x","reason":"ERROR","errorCode":"FLAG_NOT_FOUND"}}',
    loads: '1',
  });
  assert.deepStrictEqual(report.changed, {
    before: ON,
    within: ON,
    after: [OFF],
    loads: '2',
  });
  return report;
}, Effect.scoped);

it.layer(NodeServices.layer)('in workerd', (it) => {
  it.effect(
    'a Worker answers, also after a request that took its load with it',
    () =>
      Effect.gen(function* () {
        const { aborted, early, refresh } = yield* run('plain');
        assert.strictEqual(aborted.first, 'gone');
        for (const { loads, next } of [aborted, early]) {
          assert.strictEqual(next.body, ON);
          // It waited for the load to be given up on, and made its own.
          assert.isAbove(next.millis, 5000);
          assert.isBelow(next.millis, 11_000);
          assert.strictEqual(loads, '2');
        }
        // With something held, it waits only as long as a load may take.
        assert.strictEqual(refresh.next.body, ON);
        assert.isBelow(refresh.next.millis, 6000);
      }),
    TIMED_OUT,
  );

  it.effect.each(['kept', 'alchemy'])(
    'a Worker that keeps its loads waits only for them: %s',
    (worker) =>
      Effect.gen(function* () {
        const { aborted, early, refresh } = yield* run(worker);
        assert.strictEqual(aborted.first, 'gone');
        for (const { next } of [aborted, early, refresh]) {
          assert.strictEqual(next.body, ON);
          assert.isBelow(next.millis, 4500);
        }
        assert.deepStrictEqual(
          [aborted.loads, early.loads, refresh.loads],
          ['1', '1', '2'],
        );
      }),
    TIMED_OUT,
  );
});
