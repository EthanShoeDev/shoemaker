import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Exit } from 'effect';
import { TestClock } from 'effect/testing';

import { liveTracer } from '../src/live-tracer.ts';
import { applySpanEvent } from '../src/trace.ts';
import type { SpanInfo } from '../src/trace.ts';

const record = Effect.fnUntraced(function* <A, E>(
  program: Effect.Effect<A, E>,
) {
  const spans = new Map<string, SpanInfo>();
  const tracer = liveTracer((event) => {
    applySpanEvent(spans, event);
  });
  yield* program.pipe(Effect.withTracer(tracer), Effect.exit);
  return Arr.fromIterable(spans.values());
});

describe('live tracer', () => {
  it.effect('records parents, times and attributes', () =>
    Effect.gen(function* () {
      const spans = yield* record(
        TestClock.adjust('5 millis').pipe(
          Effect.tap(() => Effect.annotateCurrentSpan('rows', 42)),
          Effect.tap(() => Effect.annotateCurrentSpan('big', 1n)),
          Effect.withSpan('child', { attributes: { table: 'users' } }),
          Effect.withSpan('root'),
        ),
      );
      const [root, child] = spans;
      assert.deepStrictEqual(
        Arr.map(spans, (span) => [span.name, span.status]),
        [
          ['root', 'ok'],
          ['child', 'ok'],
        ],
      );
      assert.strictEqual(root?.parentSpanId, undefined);
      assert.strictEqual(child?.parentSpanId, root?.spanId);
      assert.strictEqual((child?.endTime ?? 0) - (child?.startTime ?? 0), 5);
      assert.deepInclude(child?.attributes, {
        table: 'users',
        rows: 42,
        big: '1n',
      });
    }),
  );

  it.effect('reports failures as errors and interruption as ok', () =>
    Effect.gen(function* () {
      const failed = yield* record(
        Effect.die(new Error('boom')).pipe(Effect.withSpan('failed')),
      );
      assert.deepInclude(failed[0], { status: 'error', errorMessage: 'boom' });
      const stopped = yield* record(
        Effect.interrupt.pipe(Effect.withSpan('stopped')),
      );
      assert.strictEqual(stopped[0]?.status, 'ok');
    }),
  );

  it.effect('leaves out unsampled spans and their children', () =>
    Effect.gen(function* () {
      const spans = yield* record(
        Effect.void.pipe(
          Effect.withSpan('child'),
          Effect.withSpan('hidden', { sampled: false }),
        ),
      );
      assert.deepStrictEqual(spans, []);
    }),
  );

  it.effect('keeps the first end of a span ended twice', () =>
    Effect.gen(function* () {
      const spans = new Map<string, SpanInfo>();
      const tracer = liveTracer((event) => {
        applySpanEvent(spans, event);
      });
      yield* Effect.gen(function* () {
        const span = yield* Effect.makeSpan('twice');
        span.end(0n, Exit.void);
        span.attribute('late', true);
        span.end(1_000_000n, Exit.die(new Error('late')));
      }).pipe(Effect.withTracer(tracer));
      const [only] = Arr.fromIterable(spans.values());
      assert.strictEqual(only?.status, 'ok');
      assert.strictEqual(only?.endTime, 0);
      assert.notProperty(only?.attributes ?? {}, 'late');
    }),
  );
});
