import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect } from 'effect';
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
});
