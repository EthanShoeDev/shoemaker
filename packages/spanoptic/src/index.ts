/**
 * @module @shoe-box-tools/spanoptic
 *
 * TUI OTEL visualizer for Effect programs.
 * Inspired by Kit Langton's spanoptic.
 */

import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { SpanStatusCode } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import type {
  ReadableSpan,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  BoxRenderable,
  RGBA,
  TextRenderable,
  createCliRenderer,
} from '@opentui/core';
import type { CliRenderer, KeyEvent } from '@opentui/core';
import {
  Array as Arr,
  Clock,
  Deferred,
  Effect,
  Layer,
  Logger,
  Predicate,
  Queue,
  Record as Rec,
  References,
  String as Str,
} from 'effect';
import type { Tracer } from 'effect';

import {
  appendLog,
  applySpanEvent,
  buildSpanTree,
  flattenTree,
  formatDuration,
  formatLogMessage,
  hrTimeToMillis,
} from './trace.ts';
import type { LogEntry, SpanEvent, SpanInfo, TraceExport } from './trace.ts';

export {
  LogEntry,
  SpanInfo,
  TraceExport,
  TraceExportJson,
  decodeTraceExport,
  encodeTraceExport,
} from './trace.ts';

export type TraceVisualizeOptions = {
  readonly serviceName: string;
  /** Called when the user presses `e` to export the trace. */
  readonly onExport?: (data: TraceExport) => void;
};

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const colors = {
  background: RGBA.fromInts(15, 23, 42, 255), // slate-900
  header: RGBA.fromInts(34, 211, 238, 255), // cyan-400
  running: RGBA.fromInts(251, 191, 36, 255), // amber-400
  success: RGBA.fromInts(74, 222, 128, 255), // green-400
  error: RGBA.fromInts(248, 113, 113, 255), // red-400
  text: RGBA.fromInts(226, 232, 240, 255), // slate-200
  dimText: RGBA.fromInts(148, 163, 184, 255), // slate-400
  selected: RGBA.fromInts(59, 130, 246, 255), // blue-500
  detailsBg: RGBA.fromInts(30, 41, 59, 255), // slate-800
  detailsBorder: RGBA.fromInts(71, 85, 105, 255), // slate-600
  attrKey: RGBA.fromInts(167, 139, 250, 255), // violet-400
  logDebug: RGBA.fromInts(156, 163, 175, 255), // gray-400
  logInfo: RGBA.fromInts(96, 165, 250, 255), // blue-400
  logWarn: RGBA.fromInts(251, 191, 36, 255), // amber-400
  logError: RGBA.fromInts(248, 113, 113, 255), // red-400
} as const;

const levelColor = (level: string) => {
  if (level === 'ERROR') return colors.logError;
  if (level === 'WARN') return colors.logWarn;
  if (level === 'DEBUG') return colors.logDebug;
  return colors.logInfo;
};

const statusColor = (status: SpanInfo['status']) => {
  if (status === 'running') return colors.running;
  if (status === 'error') return colors.error;
  return colors.success;
};

const statusLabel = (status: SpanInfo['status']) => {
  if (status === 'running') return 'Running...';
  if (status === 'error') return 'Error';
  return 'Success';
};

const MAX_LOGS_IN_PANEL = 8;
const DETAILS_WIDTH = 50;
const SPANS_TOP = 3;

class SpanopticTUI {
  readonly #renderer: CliRenderer;
  readonly #serviceName: string;
  readonly #container: BoxRenderable;
  readonly #logsBox: BoxRenderable;
  readonly #summaryText: TextRenderable;
  readonly #helpText: TextRenderable;
  readonly #spanLines = new Map<string, TextRenderable>();
  readonly #indicators = new Map<string, TextRenderable>();
  readonly #spans = new Map<string, SpanInfo>();
  #detailsBox: BoxRenderable | undefined;
  #detailLines: Array<string> = [];
  #logLines: Array<string> = [];
  #flatSpans: Array<SpanInfo> = [];
  #selectedIndex = 0;
  #spinnerFrame = 0;
  #complete = false;
  // Clock time from the last tick or span event; renders read this instead
  // of the wall clock so the TUI stays a plain synchronous view.
  #now: number;

  constructor(renderer: CliRenderer, serviceName: string, now: number) {
    this.#renderer = renderer;
    this.#serviceName = serviceName;
    this.#now = now;

    renderer.setBackgroundColor(colors.background);

    this.#container = new BoxRenderable(renderer, {
      id: 'spanoptic-container',
      zIndex: 10,
    });
    renderer.root.add(this.#container);

    this.#container.add(
      new TextRenderable(renderer, {
        id: 'header',
        content: `● Trace (${serviceName})`,
        position: 'absolute',
        left: 2,
        top: 1,
        fg: colors.header,
        zIndex: 100,
      }),
    );

    const logsHeight = MAX_LOGS_IN_PANEL + 2;
    this.#logsBox = new BoxRenderable(renderer, {
      id: 'logs-box',
      position: 'absolute',
      left: 2,
      top: renderer.terminalHeight - logsHeight - 1,
      width: Math.floor(renderer.terminalWidth * 0.5),
      height: logsHeight,
      backgroundColor: colors.detailsBg,
      borderColor: colors.detailsBorder,
      borderStyle: 'single',
      border: true,
      title: 'Logs',
      titleAlignment: 'left',
      zIndex: 150,
    });
    this.#container.add(this.#logsBox);

    this.#summaryText = this.#addText('summary', SPANS_TOP + 1);
    this.#helpText = this.#addText('help', SPANS_TOP + 2);
  }

  #addText(id: string, top: number) {
    const text = new TextRenderable(this.#renderer, {
      id,
      content: '',
      position: 'absolute',
      left: 2,
      top,
      fg: colors.dimText,
      zIndex: 50,
    });
    this.#container.add(text);
    return text;
  }

  get #selected() {
    return this.#flatSpans[this.#selectedIndex];
  }

  #elapsed(span: SpanInfo) {
    return (span.endTime ?? this.#now) - span.startTime;
  }

  #renderLogsPanel() {
    for (const id of this.#logLines) this.#logsBox.remove(id);
    this.#logLines = [];

    const selected = this.#selected;
    this.#logsBox.title =
      selected === undefined ? 'Logs' : `Logs (${selected.name})`;
    const recentLogs = (selected?.logs ?? []).slice(-MAX_LOGS_IN_PANEL);
    const logsWidth = Math.floor(this.#renderer.terminalWidth * 0.5) - 4;

    const lines =
      recentLogs.length === 0
        ? [{ content: '(no logs)', fg: colors.dimText }]
        : Arr.map(recentLogs, (log) => ({
            content: Str.slice(
              0,
              logsWidth,
            )(`[${Str.padEnd(4)(Str.slice(0, 4)(log.level))}] ${log.message}`),
            fg: levelColor(log.level),
          }));

    for (const [i, line] of lines.entries()) {
      const id = `log-line-${i}`;
      this.#logsBox.add(
        new TextRenderable(this.#renderer, {
          id,
          content: line.content,
          position: 'absolute',
          left: 1,
          top: i + 1,
          fg: line.fg,
          zIndex: 151,
        }),
      );
      this.#logLines.push(id);
    }
  }

  handleEvent(event: SpanEvent) {
    this.#now = event.type === 'start' ? event.span.startTime : event.endTime;
    applySpanEvent(this.#spans, event);
    this.#updateFlatSpans();
    this.render();
  }

  handleLog(spanId: string, entry: LogEntry) {
    if (!appendLog(this.#spans, spanId, entry)) return;
    this.#updateFlatSpans();
    this.#renderLogsPanel();
    this.renderDetails();
  }

  #updateFlatSpans() {
    this.#flatSpans = flattenTree(buildSpanTree(this.#spans));
    if (this.#selectedIndex >= this.#flatSpans.length) {
      this.#selectedIndex = Math.max(0, this.#flatSpans.length - 1);
    }
  }

  moveSelection(delta: number) {
    if (this.#flatSpans.length === 0) return;
    this.#selectedIndex = Math.max(
      0,
      Math.min(this.#flatSpans.length - 1, this.#selectedIndex + delta),
    );
    this.render();
    this.renderDetails();
    this.#renderLogsPanel();
  }

  #isTracked(parentSpanId: string | undefined) {
    return parentSpanId !== undefined && this.#spans.has(parentSpanId);
  }

  #depth(span: SpanInfo) {
    let depth = 0;
    let current = span;
    while (current.parentSpanId !== undefined) {
      const parent = this.#spans.get(current.parentSpanId);
      if (parent === undefined) break;
      depth += 1;
      current = parent;
    }
    return depth;
  }

  #renderSpanLine(span: SpanInfo, index: number, y: number) {
    const isSelected = index === this.#selectedIndex;
    const siblings = this.#isTracked(span.parentSpanId)
      ? Arr.filter(this.#flatSpans, (s) => s.parentSpanId === span.parentSpanId)
      : Arr.filter(this.#flatSpans, (s) => !this.#isTracked(s.parentSpanId));
    const isLast = siblings.at(-1)?.spanId === span.spanId;

    const prefix = Str.repeat(this.#depth(span))('   ');
    const connector = isLast ? '└─' : '├─';
    let icon = '✓';
    if (span.status === 'running') {
      icon = SPINNER_FRAMES[this.#spinnerFrame % SPINNER_FRAMES.length] ?? '';
    } else if (span.status === 'error') {
      icon = '✗';
    }
    const duration =
      span.endTime === null
        ? ` ${formatDuration(this.#elapsed(span))}...`
        : ` ${formatDuration(this.#elapsed(span))}`;
    const logIndicator = span.logs.length > 0 ? ` 📝${span.logs.length}` : '';
    const content = `${prefix}${connector} ${icon} ${span.name}${duration}${logIndicator}`;
    const fg = isSelected ? colors.selected : statusColor(span.status);

    const line = this.#spanLines.get(span.spanId);
    if (line === undefined) {
      const created = new TextRenderable(this.#renderer, {
        id: `span-${span.spanId}`,
        content,
        position: 'absolute',
        left: 2,
        top: y,
        fg,
        zIndex: 50,
      });
      this.#container.add(created);
      this.#spanLines.set(span.spanId, created);
    } else {
      line.content = content;
      line.fg = fg;
      line.y = y;
    }

    const indicator = this.#indicators.get(span.spanId);
    if (!isSelected) {
      if (indicator !== undefined) indicator.visible = false;
    } else if (indicator === undefined) {
      const created = new TextRenderable(this.#renderer, {
        id: `indicator-${span.spanId}`,
        content: '▶',
        position: 'absolute',
        left: 0,
        top: y,
        fg: colors.selected,
        zIndex: 51,
      });
      this.#container.add(created);
      this.#indicators.set(span.spanId, created);
    } else {
      indicator.y = y;
      indicator.visible = true;
    }
  }

  render() {
    for (const [i, span] of this.#flatSpans.entries()) {
      this.#renderSpanLine(span, i, SPANS_TOP + i);
    }
    const y = SPANS_TOP + this.#flatSpans.length;

    const spans = [...this.#spans.values()];
    const running = Arr.filter(spans, (s) => s.status === 'running').length;
    const errors = Arr.filter(spans, (s) => s.status === 'error').length;
    const totalLogs = Arr.reduce(spans, 0, (sum, s) => sum + s.logs.length);
    const summary = Arr.join(
      [
        `${spans.length} spans`,
        ...(running > 0 ? [`${running} running`] : []),
        ...(errors > 0 ? [`${errors} errors`] : []),
        ...(totalLogs > 0 ? [`${totalLogs} logs`] : []),
      ],
      ' • ',
    );

    this.#summaryText.content = summary;
    this.#summaryText.y = y + 1;
    this.#helpText.content = this.#complete
      ? '↑/↓ Navigate • e Export • q Quit'
      : '↑/↓ Navigate';
    this.#helpText.y = y + 2;
  }

  #detailsBoxFor(x: number, height: number) {
    if (this.#detailsBox !== undefined) {
      this.#detailsBox.x = x;
      this.#detailsBox.height = height;
      return this.#detailsBox;
    }
    const box = new BoxRenderable(this.#renderer, {
      id: 'details-box',
      position: 'absolute',
      left: x,
      top: 2,
      width: DETAILS_WIDTH,
      height,
      backgroundColor: colors.detailsBg,
      borderColor: colors.detailsBorder,
      borderStyle: 'single',
      border: true,
      title: 'Span Details',
      titleAlignment: 'center',
      zIndex: 200,
    });
    this.#container.add(box);
    this.#detailsBox = box;
    return box;
  }

  renderDetails() {
    const selected = this.#selected;
    if (selected === undefined) return;

    const height = Math.min(25, this.#renderer.terminalHeight - 4);
    const box = this.#detailsBoxFor(
      this.#renderer.terminalWidth - DETAILS_WIDTH - 2,
      height,
    );
    for (const id of this.#detailLines) box.remove(id);
    this.#detailLines = [];

    const lines: Array<{ content: string; fg: RGBA }> = [
      { content: `Name: ${selected.name}`, fg: colors.text },
      {
        content: `Status: ${statusLabel(selected.status)}`,
        fg: statusColor(selected.status),
      },
      selected.endTime === null
        ? {
            content: `Duration: ${formatDuration(this.#elapsed(selected))} (running)`,
            fg: colors.running,
          }
        : {
            content: `Duration: ${formatDuration(this.#elapsed(selected))}`,
            fg: colors.text,
          },
    ];
    if (selected.errorMessage !== undefined && selected.errorMessage !== '') {
      lines.push(
        { content: '', fg: colors.dimText },
        { content: `Error: ${selected.errorMessage}`, fg: colors.error },
      );
    }
    const attributes = Arr.filter(
      Rec.toEntries(selected.attributes),
      ([key]) => !Str.startsWith('code.')(key),
    );
    if (attributes.length > 0) {
      lines.push(
        { content: '', fg: colors.dimText },
        { content: 'Attributes:', fg: colors.dimText },
        ...Arr.map(attributes, ([key, value]) => ({
          content: `  ${key}: ${JSON.stringify(value)}`,
          fg: colors.attrKey,
        })),
      );
    }
    if (selected.logs.length > 0) {
      lines.push(
        { content: '', fg: colors.dimText },
        { content: `Logs (${selected.logs.length}):`, fg: colors.dimText },
        ...Arr.map(selected.logs, (log) => ({
          content: `  [${log.level}] ${log.message}`,
          fg: levelColor(log.level),
        })),
      );
    }

    for (const [i, line] of lines.slice(0, height - 2).entries()) {
      const id = `detail-line-${i}`;
      box.add(
        new TextRenderable(this.#renderer, {
          id,
          content: Str.slice(0, DETAILS_WIDTH - 4)(line.content),
          position: 'absolute',
          left: 1,
          top: i + 1,
          fg: line.fg,
          zIndex: 201,
        }),
      );
      this.#detailLines.push(id);
    }
  }

  tick(now: number) {
    this.#now = now;
    this.#spinnerFrame += 1;
    if (Arr.some(this.#flatSpans, (s) => s.status === 'running')) {
      this.render();
      this.renderDetails();
    }
  }

  get complete() {
    return this.#complete;
  }

  setComplete() {
    this.#complete = true;
    this.render();
    this.renderDetails();
  }

  destroy() {
    this.#container.destroyRecursively();
  }

  exportTrace(): TraceExport {
    return {
      version: 1,
      serviceName: this.#serviceName,
      exportedAt: this.#now,
      spans: this.#flatSpans,
    };
  }

  loadTrace(data: TraceExport) {
    this.#spans.clear();
    for (const span of data.spans) this.#spans.set(span.spanId, span);
    this.#updateFlatSpans();
    this.render();
    this.renderDetails();
    this.#renderLogsPanel();
  }
}

const liveSpanProcessor = (
  onEvent: (event: SpanEvent) => void,
): SpanProcessor => ({
  onStart: (span: ReadableSpan) => {
    onEvent({
      type: 'start',
      span: {
        spanId: span.spanContext().spanId,
        ...(span.parentSpanContext === undefined
          ? {}
          : { parentSpanId: span.parentSpanContext.spanId }),
        name: span.name,
        startTime: hrTimeToMillis(span.startTime),
        endTime: null,
        status: 'running',
        attributes: { ...span.attributes },
        logs: [],
      },
    });
  },
  onEnd: (span) => {
    const isError = span.status.code === SpanStatusCode.ERROR;
    onEvent({
      type: 'end',
      spanId: span.spanContext().spanId,
      endTime: hrTimeToMillis(span.endTime),
      status: isError ? 'error' : 'ok',
      errorMessage: isError ? span.status.message : undefined,
    });
  },
  shutdown: () => Promise.resolve(),
  forceFlush: () => Promise.resolve(),
});

// Spans reach the TUI through a span processor on a private tracer provider,
// so tracing is scoped to the visualized program rather than registered
// globally.
const tracingLayer = (serviceName: string, processor: SpanProcessor) =>
  OtelTracer.layer.pipe(
    Layer.provide(
      Layer.effect(
        OtelTracer.OtelTracerProvider,
        Effect.acquireRelease(
          Effect.sync(
            () =>
              new BasicTracerProvider({
                resource: resourceFromAttributes({
                  'service.name': serviceName,
                }),
                spanProcessors: [processor],
              }),
          ),
          (provider) => Effect.promise(() => provider.shutdown()),
        ),
      ),
    ),
  );

// Replaces the console loggers so nothing is printed over the TUI; the tracer
// logger stays so logs are still recorded as span events.
const tuiLoggerLayer = (tui: SpanopticTUI) =>
  Logger.layer([
    Logger.make(({ logLevel, message, fiber, date }) => {
      const span = fiber.cache.span;
      if (!Predicate.isTagged(span, 'Span')) return;
      tui.handleLog(span.spanId, {
        timestamp: date.getTime(),
        level: Str.toUpperCase(logLevel),
        message: formatLogMessage(message),
        spanName: span.name,
      });
    }),
    Logger.tracerLogger,
  ]);

const acquireTui = (serviceName: string) =>
  Effect.gen(function* () {
    const renderer = yield* Effect.acquireRelease(
      Effect.promise(() =>
        createCliRenderer({ exitOnCtrlC: true, targetFps: 30 }),
      ),
      (r) => Effect.sync(() => r.destroy()),
    );
    const now = yield* Clock.currentTimeMillis;
    const tui = yield* Effect.acquireRelease(
      Effect.sync(() => new SpanopticTUI(renderer, serviceName, now)),
      (t) => Effect.sync(() => t.destroy()),
    );
    return { renderer, tui };
  });

/**
 * Handles navigation and export keys, and resolves once the user quits
 * (`q` / Escape) after the trace is complete.
 */
const runKeys = (
  renderer: CliRenderer,
  tui: SpanopticTUI,
  onExport: TraceVisualizeOptions['onExport'],
) =>
  Effect.gen(function* () {
    const keys = yield* Queue.unbounded<KeyEvent>();
    const onKey = (key: KeyEvent) => {
      Queue.offerUnsafe(keys, key);
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => renderer.keyInput.on('keypress', onKey)),
      () => Effect.sync(() => renderer.keyInput.off('keypress', onKey)),
    );
    const quit = yield* Deferred.make<void>();
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const key = yield* Queue.take(keys);
          if (key.name === 'up' || key.name === 'k') tui.moveSelection(-1);
          else if (key.name === 'down' || key.name === 'j')
            tui.moveSelection(1);
          else if (key.name === 'e') onExport?.(tui.exportTrace());
          else if ((key.name === 'q' || key.name === 'escape') && tui.complete)
            yield* Deferred.succeed(quit, undefined);
        }),
      ),
    );
    return { quit };
  });

/**
 * Wraps an Effect program with OTEL tracing and visualizes the trace
 * in a real-time TUI with spinners for active spans.
 *
 * @example
 * ```ts
 * import { BunRuntime } from "@effect/platform-bun"
 * import { Effect } from "effect"
 * import { traceVisualize, withTracedSpan } from "@shoe-box-tools/spanoptic"
 *
 * const program = Effect.gen(function* () {
 *   yield* Effect.log("Starting...")
 *   yield* Effect.sleep("100 millis")
 *   yield* Effect.log("Done!")
 *   return "done"
 * }).pipe(withTracedSpan("main"))
 *
 * BunRuntime.runMain(traceVisualize(program, { serviceName: "my-app" }))
 * ```
 */
export const traceVisualize = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: TraceVisualizeOptions,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { renderer, tui } = yield* acquireTui(options.serviceName);
      const { quit } = yield* runKeys(renderer, tui, options.onExport);

      yield* Effect.forkScoped(
        Effect.forever(
          Effect.gen(function* () {
            yield* Effect.sleep('80 millis');
            tui.tick(yield* Clock.currentTimeMillis);
          }),
        ),
      );

      const processor = liveSpanProcessor((event) => {
        tui.handleEvent(event);
      });
      // Built in this scope, so the tracer provider outlives the program and
      // shuts down with the TUI.
      const services = yield* Layer.build(
        Layer.mergeAll(
          tracingLayer(options.serviceName, processor),
          tuiLoggerLayer(tui),
        ),
      );
      const result = yield* effect.pipe(
        Effect.provideContext(services),
        Effect.provideService(References.MinimumLogLevel, 'All'),
      );

      // Let the final span renders land before showing the quit hint.
      yield* Effect.sleep('200 millis');
      tui.setComplete();
      yield* Deferred.await(quit);
      return result;
    }),
  );

/**
 * Replays a previously exported trace in the TUI.
 *
 * @example
 * ```ts
 * import { BunRuntime, BunServices } from "@effect/platform-bun"
 * import { Effect, FileSystem } from "effect"
 * import { decodeTraceExport, replayVisualize } from "@shoe-box-tools/spanoptic"
 *
 * const program = Effect.gen(function* () {
 *   const fs = yield* FileSystem.FileSystem
 *   const data = yield* decodeTraceExport(yield* fs.readFileString("trace.json"))
 *   yield* replayVisualize(data)
 * })
 * BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)))
 * ```
 */
export const replayVisualize = (
  data: TraceExport,
  options?: Pick<TraceVisualizeOptions, 'onExport'>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { renderer, tui } = yield* acquireTui(data.serviceName);
      tui.loadTrace(data);
      tui.setComplete();
      const { quit } = yield* runKeys(renderer, tui, options?.onExport);
      yield* Deferred.await(quit);
    }),
  );

/**
 * Wraps an effect in an Effect log span and a tracing span of the same name.
 * The TUI attaches logs to the current tracing span, so plain
 * `Effect.withSpan` works too; the log span adds the span name to console
 * log output when the program runs outside the TUI.
 *
 * @example
 * ```ts
 * const myEffect = Effect.gen(function* () {
 *   yield* Effect.log("This log will be associated with mySpan");
 *   return "result";
 * }).pipe(withTracedSpan("mySpan"));
 * ```
 */
export const withTracedSpan =
  (name: string, options?: Tracer.SpanOptionsNoTrace) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.withLogSpan(name), Effect.withSpan(name, options));
