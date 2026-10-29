import { Array as Arr, Order, Predicate, Schema } from 'effect';

export const LogEntry = Schema.Struct({
  timestamp: Schema.Finite,
  level: Schema.String,
  message: Schema.String,
  spanName: Schema.NullOr(Schema.String),
});
export type LogEntry = typeof LogEntry.Type;

export const SpanStatus = Schema.Literals(['running', 'ok', 'error']);
export type SpanStatus = typeof SpanStatus.Type;

export const SpanInfo = Schema.Struct({
  spanId: Schema.String,
  // JSON.stringify drops undefined keys, so root spans are exported without it.
  parentSpanId: Schema.optional(Schema.String),
  name: Schema.String,
  startTime: Schema.Finite,
  endTime: Schema.NullOr(Schema.Finite),
  status: SpanStatus,
  errorMessage: Schema.optional(Schema.String),
  attributes: Schema.Record(Schema.String, Schema.Unknown),
  logs: Schema.Array(LogEntry),
});
export type SpanInfo = typeof SpanInfo.Type;

/** Exported trace data for replay. */
export const TraceExport = Schema.Struct({
  version: Schema.Literal(1),
  serviceName: Schema.String,
  exportedAt: Schema.Finite,
  spans: Schema.Array(SpanInfo),
});
export type TraceExport = typeof TraceExport.Type;

/** A trace export as the pretty-printed JSON file the CLI writes and replays. */
export const TraceExportJson = Schema.fromJsonString(TraceExport, { space: 2 });

export const encodeTraceExport = Schema.encodeEffect(TraceExportJson);
export const decodeTraceExport = Schema.decodeEffect(TraceExportJson);

export type SpanEvent =
  | { readonly type: 'start'; readonly span: SpanInfo }
  | {
      readonly type: 'end';
      readonly spanId: string;
      readonly endTime: number;
      readonly status: 'ok' | 'error';
      readonly errorMessage: string | undefined;
    };

/** Applies a span lifecycle event to the span table; an unknown end is ignored. */
export const applySpanEvent = (
  spans: Map<string, SpanInfo>,
  event: SpanEvent,
) => {
  if (event.type === 'start') {
    spans.set(event.span.spanId, event.span);
    return;
  }
  const span = spans.get(event.spanId);
  if (span === undefined) return;
  spans.set(event.spanId, {
    ...span,
    endTime: event.endTime,
    status: event.status,
    ...(event.errorMessage === undefined
      ? {}
      : { errorMessage: event.errorMessage }),
  });
};

/** Attaches a log to its span; returns false when the span is not tracked. */
export const appendLog = (
  spans: Map<string, SpanInfo>,
  spanId: string,
  entry: LogEntry,
) => {
  const span = spans.get(spanId);
  if (span === undefined) return false;
  spans.set(spanId, { ...span, logs: [...span.logs, entry] });
  return true;
};

export type SpanNode = {
  readonly span: SpanInfo;
  readonly children: Array<SpanNode>;
};

const byStartTime = Order.mapInput(
  Order.Number,
  (node: SpanNode) => node.span.startTime,
);

const sortTree = (nodes: Array<SpanNode>): Array<SpanNode> =>
  Arr.map(Arr.sort(nodes, byStartTime), (node) => ({
    span: node.span,
    children: sortTree(node.children),
  }));

/**
 * Builds the span forest. A span whose parent is not in the table (a remote
 * parent, or one not yet started) is shown as a root.
 */
export const buildSpanTree = (spans: ReadonlyMap<string, SpanInfo>) => {
  const nodes = new Map<string, SpanNode>();
  for (const [id, span] of spans) nodes.set(id, { span, children: [] });

  const roots: Array<SpanNode> = [];
  for (const node of nodes.values()) {
    const { parentSpanId } = node.span;
    const parent =
      parentSpanId === undefined ? undefined : nodes.get(parentSpanId);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  return sortTree(roots);
};

/** Depth-first, parents before children. */
export const flattenTree = (roots: ReadonlyArray<SpanNode>): Array<SpanInfo> =>
  Arr.flatMap(roots, (node) => [node.span, ...flattenTree(node.children)]);

export const formatDuration = (ms: number) => {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

/** OpenTelemetry `[seconds, nanoseconds]` to epoch milliseconds. */
export const hrTimeToMillis = ([seconds, nanos]: readonly [number, number]) =>
  seconds * 1000 + nanos / 1_000_000;

/** Joins Effect.log's arguments the way the v3 log collector did. */
export const formatLogMessage = (message: unknown) => {
  const parts = Arr.isArray(message) ? message : [message];
  return Arr.join(
    Arr.map(parts, (part) =>
      Predicate.isString(part) ? part : JSON.stringify(part),
    ),
    ' ',
  );
};
