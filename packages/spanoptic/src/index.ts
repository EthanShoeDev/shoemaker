/**
 * @module @shoe-box-tools/spanoptic
 *
 * TUI OTEL visualizer for Effect programs.
 * Inspired by Kit Langton's spanoptic.
 */

import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { Context } from '@opentelemetry/api';
import { NodeSdk } from '@effect/opentelemetry';
import { Effect, Layer, Fiber, Logger, LogLevel } from 'effect';
import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
  RGBA,
} from '@opentui/core';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
  spanName: string | null;
}

interface SpanInfo {
  spanId: string;
  parentSpanId: string | undefined;
  name: string;
  startTime: number;
  endTime: number | null;
  status: 'running' | 'ok' | 'error';
  errorMessage?: string;
  attributes: Record<string, unknown>;
  logs: LogEntry[];
}

interface TraceVisualizeOptions {
  serviceName: string;
  /** Called when user presses 'e' to export trace data */
  onExport?: (data: TraceExport) => void;
}

/** Exported trace data for replay */
interface TraceExport {
  version: 1;
  serviceName: string;
  exportedAt: number;
  spans: SpanInfo[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Spinner Animation
// ─────────────────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ─────────────────────────────────────────────────────────────────────────────
// Colors
// ─────────────────────────────────────────────────────────────────────────────

const colors = {
  background: RGBA.fromInts(15, 23, 42, 255),       // slate-900
  header: RGBA.fromInts(34, 211, 238, 255),         // cyan-400
  running: RGBA.fromInts(251, 191, 36, 255),        // amber-400
  success: RGBA.fromInts(74, 222, 128, 255),        // green-400
  error: RGBA.fromInts(248, 113, 113, 255),         // red-400
  text: RGBA.fromInts(226, 232, 240, 255),          // slate-200
  dimText: RGBA.fromInts(148, 163, 184, 255),       // slate-400
  selected: RGBA.fromInts(59, 130, 246, 255),       // blue-500
  selectedBg: RGBA.fromInts(30, 58, 138, 255),      // blue-900
  detailsBg: RGBA.fromInts(30, 41, 59, 255),        // slate-800
  detailsBorder: RGBA.fromInts(71, 85, 105, 255),   // slate-600
  attrKey: RGBA.fromInts(167, 139, 250, 255),       // violet-400
  attrValue: RGBA.fromInts(253, 224, 71, 255),      // yellow-300
  logDebug: RGBA.fromInts(156, 163, 175, 255),      // gray-400
  logInfo: RGBA.fromInts(96, 165, 250, 255),        // blue-400
  logWarn: RGBA.fromInts(251, 191, 36, 255),        // amber-400
  logError: RGBA.fromInts(248, 113, 113, 255),      // red-400
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Duration Formatting
// ─────────────────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Log Collector
// ─────────────────────────────────────────────────────────────────────────────

type LogCallback = (entry: LogEntry) => void;

function createLogCollector(onLog: LogCallback) {
  return Logger.make(({ logLevel, message, spans }) => {
    // Get the innermost span name from Effect's span context
    let spanName: string | null = null;
    if (spans && spans._tag === 'Cons') {
      spanName = spans.head.label;
    }

    // Convert message to string
    const messageStr = Array.isArray(message)
      ? message.map(m => typeof m === 'string' ? m : JSON.stringify(m)).join(' ')
      : typeof message === 'string' ? message : JSON.stringify(message);

    onLog({
      timestamp: Date.now(),
      level: logLevel.label,
      message: messageStr,
      spanName,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Span Processor (Real-time)
// ─────────────────────────────────────────────────────────────────────────────

type SpanEvent =
  | { type: 'start'; span: SpanInfo }
  | { type: 'end'; spanId: string; endTime: number; status: 'ok' | 'error'; errorMessage?: string };

class LiveSpanProcessor implements SpanProcessor {
  private onEvent: (event: SpanEvent) => void;

  constructor(onEvent: (event: SpanEvent) => void) {
    this.onEvent = onEvent;
  }

  onStart(span: ReadableSpan, _parentContext: Context): void {
    const spanContext = span.spanContext();
    this.onEvent({
      type: 'start',
      span: {
        spanId: spanContext.spanId,
        parentSpanId: span.parentSpanId,
        name: span.name,
        startTime: Date.now(),
        endTime: null,
        status: 'running',
        attributes: { ...span.attributes },
        logs: [],
      },
    });
  }

  onEnd(span: ReadableSpan): void {
    const spanContext = span.spanContext();
    const isError = span.status.code === 2;
    this.onEvent({
      type: 'end',
      spanId: spanContext.spanId,
      endTime: Date.now(),
      status: isError ? 'error' : 'ok',
      errorMessage: isError ? span.status.message : undefined,
    });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree Building
// ─────────────────────────────────────────────────────────────────────────────

interface SpanNode {
  span: SpanInfo;
  children: SpanNode[];
}

function buildSpanTree(spans: Map<string, SpanInfo>): SpanNode[] {
  const nodes = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];

  for (const [id, span] of spans) {
    nodes.set(id, { span, children: [] });
  }

  for (const [_id, span] of spans) {
    const node = nodes.get(span.spanId)!;
    if (span.parentSpanId && nodes.has(span.parentSpanId)) {
      nodes.get(span.parentSpanId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortChildren = (node: SpanNode) => {
    node.children.sort((a, b) => a.span.startTime - b.span.startTime);
    node.children.forEach(sortChildren);
  };
  roots.sort((a, b) => a.span.startTime - b.span.startTime);
  roots.forEach(sortChildren);

  return roots;
}

function flattenTree(roots: SpanNode[]): SpanInfo[] {
  const result: SpanInfo[] = [];
  const visit = (node: SpanNode) => {
    result.push(node.span);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// TUI Renderer
// ─────────────────────────────────────────────────────────────────────────────

class SpanopticTUI {
  private renderer: CliRenderer;
  private container: BoxRenderable;
  private headerText: TextRenderable;
  private spans: Map<string, SpanInfo> = new Map();
  private spansByName: Map<string, SpanInfo> = new Map();
  private spinnerFrame = 0;
  private serviceName: string;
  private startY = 3;
  private selectedIndex = 0;
  private flatSpans: SpanInfo[] = [];
  private detailsBox: BoxRenderable | null = null;
  private logsBox: BoxRenderable | null = null;
  private allLogs: LogEntry[] = [];
  private maxLogsInPanel = 8;
  private isComplete = false;

  constructor(renderer: CliRenderer, serviceName: string) {
    this.renderer = renderer;
    this.serviceName = serviceName;

    renderer.setBackgroundColor(colors.background);

    this.container = new BoxRenderable(renderer, {
      id: 'spanoptic-container',
      zIndex: 10,
    });
    renderer.root.add(this.container);

    this.headerText = new TextRenderable(renderer, {
      id: 'header',
      content: `● Trace (${serviceName})`,
      position: 'absolute',
      left: 2,
      top: 1,
      fg: colors.header,
      zIndex: 100,
    });
    this.container.add(this.headerText);

    // Create logs panel at the bottom
    this.createLogsPanel();
  }

  private createLogsPanel(): void {
    const logsHeight = this.maxLogsInPanel + 2; // +2 for border
    const logsY = this.renderer.terminalHeight - logsHeight - 1;
    const logsWidth = Math.floor(this.renderer.terminalWidth * 0.5);

    this.logsBox = new BoxRenderable(this.renderer, {
      id: 'logs-box',
      position: 'absolute',
      left: 2,
      top: logsY,
      width: logsWidth,
      height: logsHeight,
      backgroundColor: colors.detailsBg,
      borderColor: colors.detailsBorder,
      borderStyle: 'single',
      border: true,
      title: 'Logs',
      titleAlignment: 'left',
      zIndex: 150,
    });
    this.container.add(this.logsBox);
  }

  private renderLogsPanel(): void {
    if (!this.logsBox) return;

    // Clear old log lines
    for (let i = 0; i < this.maxLogsInPanel + 5; i++) {
      const old = this.logsBox.getRenderable(`log-line-${i}`);
      if (old) this.logsBox.remove(`log-line-${i}`);
    }

    // Get logs for the selected span only
    const selectedSpan = this.flatSpans[this.selectedIndex];
    const spanLogs = selectedSpan ? selectedSpan.logs : [];
    const recentLogs = spanLogs.slice(-this.maxLogsInPanel);
    const logsWidth = Math.floor(this.renderer.terminalWidth * 0.5) - 4;

    // Update the logs box title to show the span name
    if (this.logsBox && selectedSpan) {
      this.logsBox.title = `Logs (${selectedSpan.name})`;
    } else if (this.logsBox) {
      this.logsBox.title = 'Logs';
    }

    if (recentLogs.length === 0) {
      const emptyText = new TextRenderable(this.renderer, {
        id: 'log-line-0',
        content: '(no logs)',
        position: 'absolute',
        left: 1,
        top: 1,
        fg: colors.dimText,
        zIndex: 151,
      });
      this.logsBox.add(emptyText);
      return;
    }

    for (let i = 0; i < recentLogs.length; i++) {
      const log = recentLogs[i]!;
      const levelColor = log.level === 'ERROR' ? colors.logError
        : log.level === 'WARN' ? colors.logWarn
        : log.level === 'DEBUG' ? colors.logDebug
        : colors.logInfo;

      // Format: [LEVEL] message (truncated)
      const levelBadge = `[${log.level.slice(0, 4).padEnd(4)}]`;
      const content = `${levelBadge} ${log.message}`.slice(0, logsWidth);

      const text = new TextRenderable(this.renderer, {
        id: `log-line-${i}`,
        content,
        position: 'absolute',
        left: 1,
        top: i + 1,
        fg: levelColor,
        zIndex: 151,
      });
      this.logsBox.add(text);
    }
  }

  handleEvent(event: SpanEvent): void {
    if (event.type === 'start') {
      this.spans.set(event.span.spanId, event.span);
      this.spansByName.set(event.span.name, event.span);
    } else {
      const span = this.spans.get(event.spanId);
      if (span) {
        span.endTime = event.endTime;
        span.status = event.status;
        span.errorMessage = event.errorMessage;
      }
    }
    this.updateFlatSpans();
    this.render();
  }

  handleLog(entry: LogEntry): void {
    // Add to global logs list
    this.allLogs.push(entry);

    // Find the span by name and add the log to it
    if (entry.spanName) {
      const span = this.spansByName.get(entry.spanName);
      if (span) {
        span.logs.push(entry);
        this.renderLogsPanel();
        this.renderDetails();
      }
    }
  }

  private updateFlatSpans(): void {
    const roots = buildSpanTree(this.spans);
    this.flatSpans = flattenTree(roots);
    if (this.selectedIndex >= this.flatSpans.length) {
      this.selectedIndex = Math.max(0, this.flatSpans.length - 1);
    }
  }

  moveSelection(delta: number): void {
    if (this.flatSpans.length === 0) return;
    this.selectedIndex = Math.max(0, Math.min(this.flatSpans.length - 1, this.selectedIndex + delta));
    this.render();
    this.renderDetails();
    this.renderLogsPanel();
  }

  private getDepth(spanId: string): number {
    let depth = 0;
    let current = this.spans.get(spanId);
    while (current?.parentSpanId && this.spans.has(current.parentSpanId)) {
      depth++;
      current = this.spans.get(current.parentSpanId);
    }
    return depth;
  }

  private renderSpanLine(span: SpanInfo, index: number, y: number): void {
    const isSelected = index === this.selectedIndex;
    const depth = this.getDepth(span.spanId);

    const parent = span.parentSpanId ? this.spans.get(span.parentSpanId) : null;
    const siblings = parent
      ? this.flatSpans.filter(s => s.parentSpanId === parent.spanId)
      : this.flatSpans.filter(s => !s.parentSpanId || !this.spans.has(s.parentSpanId));
    const isLast = siblings[siblings.length - 1]?.spanId === span.spanId;

    let prefix = '';
    for (let i = 0; i < depth; i++) {
      prefix += '   ';
    }
    const connector = isLast ? '└─' : '├─';

    let icon: string;
    let statusColor: RGBA;
    if (span.status === 'running') {
      icon = SPINNER_FRAMES[this.spinnerFrame % SPINNER_FRAMES.length]!;
      statusColor = colors.running;
    } else if (span.status === 'error') {
      icon = '✗';
      statusColor = colors.error;
    } else {
      icon = '✓';
      statusColor = colors.success;
    }

    let duration = '';
    if (span.endTime !== null) {
      const ms = span.endTime - span.startTime;
      duration = ` ${formatDuration(ms)}`;
    } else {
      const ms = Date.now() - span.startTime;
      duration = ` ${formatDuration(ms)}...`;
    }

    // Show log count indicator
    const logCount = span.logs.length;
    const logIndicator = logCount > 0 ? ` 📝${logCount}` : '';

    const content = `${prefix}${connector} ${icon} ${span.name}${duration}${logIndicator}`;

    const textId = `span-${span.spanId}`;
    let textRenderable = this.container.getRenderable(textId) as TextRenderable | undefined;

    const fgColor = isSelected ? colors.selected : statusColor;

    if (!textRenderable) {
      textRenderable = new TextRenderable(this.renderer, {
        id: textId,
        content,
        position: 'absolute',
        left: 2,
        top: y,
        fg: fgColor,
        zIndex: 50,
      });
      this.container.add(textRenderable);
    } else {
      textRenderable.content = content;
      textRenderable.fg = fgColor;
      textRenderable.y = y;
    }

    const indicatorId = `indicator-${span.spanId}`;
    let indicator = this.container.getRenderable(indicatorId) as TextRenderable | undefined;

    if (isSelected) {
      if (!indicator) {
        indicator = new TextRenderable(this.renderer, {
          id: indicatorId,
          content: '▶',
          position: 'absolute',
          left: 0,
          top: y,
          fg: colors.selected,
          zIndex: 51,
        });
        this.container.add(indicator);
      } else {
        indicator.y = y;
        indicator.visible = true;
      }
    } else if (indicator) {
      indicator.visible = false;
    }
  }

  render(): void {
    let y = this.startY;
    for (let i = 0; i < this.flatSpans.length; i++) {
      const span = this.flatSpans[i]!;
      this.renderSpanLine(span, i, y);
      y++;
    }

    const total = this.spans.size;
    const running = [...this.spans.values()].filter(s => s.status === 'running').length;
    const errors = [...this.spans.values()].filter(s => s.status === 'error').length;
    const totalLogs = [...this.spans.values()].reduce((sum, s) => sum + s.logs.length, 0);

    let summaryContent = `${total} spans`;
    if (running > 0) summaryContent += ` • ${running} running`;
    if (errors > 0) summaryContent += ` • ${errors} errors`;
    if (totalLogs > 0) summaryContent += ` • ${totalLogs} logs`;

    const summaryId = 'summary';
    let summaryText = this.container.getRenderable(summaryId) as TextRenderable | undefined;
    if (!summaryText) {
      summaryText = new TextRenderable(this.renderer, {
        id: summaryId,
        content: summaryContent,
        position: 'absolute',
        left: 2,
        top: y + 1,
        fg: colors.dimText,
        zIndex: 50,
      });
      this.container.add(summaryText);
    } else {
      summaryText.content = summaryContent;
      summaryText.y = y + 1;
    }

    const helpId = 'help';
    let helpText = this.container.getRenderable(helpId) as TextRenderable | undefined;
    const helpContent = this.isComplete
      ? '↑/↓ Navigate • e Export • q Quit'
      : '↑/↓ Navigate';

    if (!helpText) {
      helpText = new TextRenderable(this.renderer, {
        id: helpId,
        content: helpContent,
        position: 'absolute',
        left: 2,
        top: y + 2,
        fg: colors.dimText,
        zIndex: 50,
      });
      this.container.add(helpText);
    } else {
      helpText.content = helpContent;
      helpText.y = y + 2;
    }
  }

  renderDetails(): void {
    if (this.flatSpans.length === 0) return;

    const selectedSpan = this.flatSpans[this.selectedIndex];
    if (!selectedSpan) return;

    const detailsWidth = 50;
    const detailsX = this.renderer.terminalWidth - detailsWidth - 2;
    const detailsY = 2;
    const detailsHeight = Math.min(25, this.renderer.terminalHeight - 4);

    if (!this.detailsBox) {
      this.detailsBox = new BoxRenderable(this.renderer, {
        id: 'details-box',
        position: 'absolute',
        left: detailsX,
        top: detailsY,
        width: detailsWidth,
        height: detailsHeight,
        backgroundColor: colors.detailsBg,
        borderColor: colors.detailsBorder,
        borderStyle: 'single',
        border: true,
        title: 'Span Details',
        titleAlignment: 'center',
        zIndex: 200,
      });
      this.container.add(this.detailsBox);
    } else {
      this.detailsBox.x = detailsX;
      this.detailsBox.height = detailsHeight;
    }

    // Clear old detail lines
    for (let i = 0; i < 50; i++) {
      const old = this.detailsBox.getRenderable(`detail-line-${i}`);
      if (old) this.detailsBox.remove(`detail-line-${i}`);
    }

    let line = 0;
    const addLine = (content: string, color: RGBA) => {
      if (line >= detailsHeight - 2) return;
      const text = new TextRenderable(this.renderer, {
        id: `detail-line-${line}`,
        content: content.slice(0, detailsWidth - 4),
        position: 'absolute',
        left: 1,
        top: line + 1,
        fg: color,
        zIndex: 201,
      });
      this.detailsBox!.add(text);
      line++;
    };

    // Span name
    addLine(`Name: ${selectedSpan.name}`, colors.text);

    // Status
    const statusText = selectedSpan.status === 'running' ? 'Running...'
      : selectedSpan.status === 'error' ? 'Error'
      : 'Success';
    const statusColor = selectedSpan.status === 'running' ? colors.running
      : selectedSpan.status === 'error' ? colors.error
      : colors.success;
    addLine(`Status: ${statusText}`, statusColor);

    // Duration
    if (selectedSpan.endTime !== null) {
      const ms = selectedSpan.endTime - selectedSpan.startTime;
      addLine(`Duration: ${formatDuration(ms)}`, colors.text);
    } else {
      const ms = Date.now() - selectedSpan.startTime;
      addLine(`Duration: ${formatDuration(ms)} (running)`, colors.running);
    }

    // Error message
    if (selectedSpan.errorMessage) {
      addLine('', colors.dimText);
      addLine(`Error: ${selectedSpan.errorMessage}`, colors.error);
    }

    // Attributes
    const attrs = selectedSpan.attributes;
    const attrKeys = Object.keys(attrs).filter(k => !k.startsWith('code.'));

    if (attrKeys.length > 0) {
      addLine('', colors.dimText);
      addLine('Attributes:', colors.dimText);

      for (const key of attrKeys) {
        const value = JSON.stringify(attrs[key]);
        addLine(`  ${key}: ${value}`, colors.attrKey);
      }
    }

    // Logs
    if (selectedSpan.logs.length > 0) {
      addLine('', colors.dimText);
      addLine(`Logs (${selectedSpan.logs.length}):`, colors.dimText);

      for (const log of selectedSpan.logs) {
        const levelColor = log.level === 'ERROR' ? colors.logError
          : log.level === 'WARN' ? colors.logWarn
          : log.level === 'DEBUG' ? colors.logDebug
          : colors.logInfo;

        const levelBadge = `[${log.level}]`;
        addLine(`  ${levelBadge} ${log.message}`, levelColor);
      }
    }
  }

  tick(): void {
    this.spinnerFrame++;
    const hasRunning = [...this.spans.values()].some(s => s.status === 'running');
    if (hasRunning) {
      this.render();
      this.renderDetails();
    }
  }

  setComplete(): void {
    this.isComplete = true;
    this.render();
  }

  destroy(): void {
    this.container.destroyRecursively();
  }

  hasRunningSpans(): boolean {
    return [...this.spans.values()].some(s => s.status === 'running');
  }

  /** Export trace data for replay */
  exportTrace(): TraceExport {
    return {
      version: 1,
      serviceName: this.serviceName,
      exportedAt: Date.now(),
      spans: this.flatSpans,
    };
  }

  /** Load trace data from export for replay */
  loadTrace(data: TraceExport): void {
    this.spans.clear();
    this.spansByName.clear();
    this.allLogs = [];
    for (const span of data.spans) {
      this.spans.set(span.spanId, span);
      this.spansByName.set(span.name, span);
      // Collect all logs from spans
      this.allLogs.push(...span.logs);
    }
    // Sort logs by timestamp
    this.allLogs.sort((a, b) => a.timestamp - b.timestamp);
    this.updateFlatSpans();
    this.render();
    this.renderDetails();
    this.renderLogsPanel();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps an Effect program with OTEL tracing and visualizes the trace
 * in a real-time TUI with spinners for active spans.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { traceVisualize } from "@shoe-box-tools/spanoptic"
 *
 * const program = Effect.gen(function* () {
 *   yield* Effect.log("Starting...")
 *   yield* Effect.sleep("100 millis")
 *   yield* Effect.log("Done!")
 *   return "done"
 * }).pipe(Effect.withSpan("main"))
 *
 * Effect.runPromise(traceVisualize(program, { serviceName: "my-app" }))
 * ```
 */
export function traceVisualize<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: TraceVisualizeOptions
): Effect.Effect<A, E, R> {
  return Effect.gen(function* () {
    const renderer = yield* Effect.promise(() =>
      createCliRenderer({
        exitOnCtrlC: true,
        targetFps: 30,
      })
    );

    const tui = new SpanopticTUI(renderer, options.serviceName);

    const processor = new LiveSpanProcessor((event) => {
      tui.handleEvent(event);
    });

    // Create log collector that sends logs to the TUI
    const logCollector = createLogCollector((entry) => {
      tui.handleLog(entry);
    });

    // Handle keyboard input
    const keyHandler = (key: KeyEvent) => {
      if (key.name === 'up' || key.name === 'k') {
        tui.moveSelection(-1);
      } else if (key.name === 'down' || key.name === 'j') {
        tui.moveSelection(1);
      } else if (key.name === 'e' && options.onExport) {
        options.onExport(tui.exportTrace());
      }
    };
    renderer.keyInput.on('keypress', keyHandler);

    // Animation loop for spinners
    const animationFiber = yield* Effect.fork(
      Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep('80 millis');
          tui.tick();
        }
      })
    );

    const TracingLayer = NodeSdk.layer(() => ({
      resource: { serviceName: options.serviceName },
      spanProcessor: processor,
    }));

    // Use Logger.none to suppress default logger, then add our custom collector
    // This ensures no logs escape to the console
    const LoggingLayer = Layer.mergeAll(
      Logger.remove(Logger.defaultLogger),
      Logger.add(logCollector)
    );

    let result: A;
    try {
      result = yield* effect.pipe(
        Effect.provide(LoggingLayer),
        Effect.provide(TracingLayer as Layer.Layer<never>),
        Logger.withMinimumLogLevel(LogLevel.All)
      );

      // Wait a moment for final render
      yield* Effect.sleep('200 millis');
      tui.setComplete();
      tui.renderDetails();

      // Wait for 'q' to quit
      yield* Effect.async<void>((resume) => {
        const quitHandler = (key: KeyEvent) => {
          if (key.name === 'q' || key.name === 'escape') {
            renderer.keyInput.off('keypress', quitHandler);
            resume(Effect.void);
          }
        };
        renderer.keyInput.on('keypress', quitHandler);
      });

    } finally {
      yield* Fiber.interrupt(animationFiber);
      renderer.keyInput.off('keypress', keyHandler);
      tui.destroy();
      renderer.destroy();
    }

    return result!;
  });
}

/**
 * Replays a previously exported trace in the TUI.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { replayVisualize } from "@shoe-box-tools/spanoptic"
 *
 * const traceData = JSON.parse(fs.readFileSync("trace.json", "utf-8"))
 * Effect.runPromise(replayVisualize(traceData))
 * ```
 */
export function replayVisualize(
  data: TraceExport,
  options?: { onExport?: (data: TraceExport) => void }
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const renderer = yield* Effect.promise(() =>
      createCliRenderer({
        exitOnCtrlC: true,
        targetFps: 30,
      })
    );

    const tui = new SpanopticTUI(renderer, data.serviceName);
    tui.loadTrace(data);
    tui.setComplete();

    // Handle keyboard input
    const keyHandler = (key: KeyEvent) => {
      if (key.name === 'up' || key.name === 'k') {
        tui.moveSelection(-1);
      } else if (key.name === 'down' || key.name === 'j') {
        tui.moveSelection(1);
      } else if (key.name === 'e' && options?.onExport) {
        options.onExport(tui.exportTrace());
      }
    };
    renderer.keyInput.on('keypress', keyHandler);

    // Wait for 'q' to quit
    yield* Effect.async<void>((resume) => {
      const quitHandler = (key: KeyEvent) => {
        if (key.name === 'q' || key.name === 'escape') {
          renderer.keyInput.off('keypress', quitHandler);
          resume(Effect.void);
        }
      };
      renderer.keyInput.on('keypress', quitHandler);
    });

    renderer.keyInput.off('keypress', keyHandler);
    tui.destroy();
    renderer.destroy();
  });
}

/**
 * Helper that wraps an effect with both OTEL tracing span and Effect log span.
 * This ensures logs are properly associated with spans in the TUI.
 *
 * Use this instead of Effect.withSpan when you want logs to be captured.
 *
 * @example
 * ```ts
 * const myEffect = Effect.gen(function* () {
 *   yield* Effect.log("This log will be associated with mySpan");
 *   return "result";
 * }).pipe(withTracedSpan("mySpan"));
 * ```
 */
export function withTracedSpan<A, E, R>(
  name: string,
  options?: Parameters<typeof Effect.withSpan>[1]
) {
  return (effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    effect.pipe(
      Effect.withLogSpan(name),
      Effect.withSpan(name, options)
    );
}

// Re-export types
export type { TraceVisualizeOptions, SpanInfo, LogEntry, TraceExport };
