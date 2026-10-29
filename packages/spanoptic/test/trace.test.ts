import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Exit, String as Str } from 'effect';

import {
  appendLog,
  applySpanEvent,
  buildSpanTree,
  decodeTraceExport,
  encodeTraceExport,
  flattenTree,
  formatDuration,
  formatLogMessage,
  hrTimeToMillis,
} from '../src/trace.ts';
import type { SpanInfo, TraceExport } from '../src/trace.ts';

const span = (
  spanId: string,
  startTime: number,
  parentSpanId?: string,
): SpanInfo => ({
  spanId,
  ...(parentSpanId === undefined ? {} : { parentSpanId }),
  name: spanId,
  startTime,
  endTime: null,
  status: 'running',
  attributes: {},
  logs: [],
});

const table = (...spans: Array<SpanInfo>) =>
  new Map(Arr.map(spans, (s) => [s.spanId, s] as const));

const ids = (spans: ReadonlyArray<SpanInfo>) => Arr.map(spans, (s) => s.spanId);

describe('span tree', () => {
  it('orders roots and children by start time, parents first', () => {
    const spans = table(
      span('late-root', 50),
      span('child-b', 30, 'root'),
      span('root', 10),
      span('child-a', 20, 'root'),
      span('grandchild', 25, 'child-a'),
    );
    assert.deepStrictEqual(ids(flattenTree(buildSpanTree(spans))), [
      'root',
      'child-a',
      'grandchild',
      'child-b',
      'late-root',
    ]);
  });

  it('shows a span whose parent is not tracked as a root', () => {
    const roots = buildSpanTree(table(span('orphan', 5, 'remote-parent')));
    assert.deepStrictEqual(
      Arr.map(roots, (node) => node.span.spanId),
      ['orphan'],
    );
  });
});

describe('span events', () => {
  it('records start, end, error and logs', () => {
    const spans = new Map<string, SpanInfo>();
    applySpanEvent(spans, { type: 'start', span: span('a', 1) });
    applySpanEvent(spans, {
      type: 'end',
      spanId: 'a',
      endTime: 9,
      status: 'error',
      errorMessage: 'boom',
    });
    const log = {
      timestamp: 5,
      level: 'INFO',
      message: 'hi',
      spanName: 'a',
    };
    assert.isTrue(appendLog(spans, 'a', log));
    assert.isFalse(appendLog(spans, 'missing', log));
    assert.deepStrictEqual(spans.get('a'), {
      ...span('a', 1),
      endTime: 9,
      status: 'error',
      errorMessage: 'boom',
      logs: [log],
    });
  });

  it('ignores the end of a span it never saw start', () => {
    const spans = new Map<string, SpanInfo>();
    applySpanEvent(spans, {
      type: 'end',
      spanId: 'ghost',
      endTime: 1,
      status: 'ok',
      errorMessage: undefined,
    });
    assert.strictEqual(spans.size, 0);
  });
});

describe('trace export', () => {
  const trace: TraceExport = {
    version: 1,
    serviceName: 'svc',
    exportedAt: 1000,
    spans: [
      { ...span('root', 1), endTime: 4, status: 'ok' },
      {
        ...span('child', 2, 'root'),
        attributes: { 'db.table': 'users', 'db.rows_returned': 42 },
        logs: [
          { timestamp: 3, level: 'WARN', message: 'slow', spanName: 'child' },
        ],
      },
    ],
  };

  it.effect('round-trips through the pretty-printed JSON file format', () =>
    Effect.gen(function* () {
      const json = yield* encodeTraceExport(trace);
      assert.include(json, '\n  "serviceName": "svc"');
      assert.deepStrictEqual(yield* decodeTraceExport(json), trace);
    }),
  );

  it.effect('rejects an unsupported version', () =>
    Effect.gen(function* () {
      const json = yield* encodeTraceExport(trace);
      const exit = yield* Effect.exit(
        decodeTraceExport(Str.replace('"version": 1', '"version": 2')(json)),
      );
      assert.isTrue(Exit.isFailure(exit));
    }),
  );
});

describe('formatting', () => {
  it('formats durations by magnitude', () => {
    assert.strictEqual(formatDuration(0.5), '500µs');
    assert.strictEqual(formatDuration(42), '42ms');
    assert.strictEqual(formatDuration(1500), '1.50s');
  });

  it('converts OpenTelemetry hrtime to milliseconds', () => {
    assert.strictEqual(hrTimeToMillis([2, 500_000_000]), 2500);
  });

  it('joins log arguments, JSON-encoding non-strings', () => {
    assert.strictEqual(
      formatLogMessage(['rows', 42, { a: 1 }]),
      'rows 42 {"a":1}',
    );
    assert.strictEqual(formatLogMessage('plain'), 'plain');
  });
});
