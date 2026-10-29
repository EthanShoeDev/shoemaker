# shoe-box-spanoptic

TUI OTEL visualizer for Effect programs. Visualize your Effect traces in real-time with a terminal UI.

Inspired by [Kit Langton's spanoptic](https://x.com/kitlangton/status/1994799261406695946).

## Features

- Real-time trace visualization with animated spinners
- Interactive span navigation with arrow keys
- Span details panel showing attributes and logs
- Live logs panel at the bottom of the screen
- Export traces to JSON for later replay
- Replay previously exported traces

## Installation

```bash
bun add shoe-box-spanoptic
```

## Usage

### Programmatic API

Wrap your Effect program with `traceVisualize` to visualize traces:

```typescript
import { BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';
import { traceVisualize, withTracedSpan } from 'shoe-box-spanoptic';
import type { TraceExport } from 'shoe-box-spanoptic';

let lastExport: TraceExport | undefined;

const program = Effect.gen(function* () {
  yield* Effect.log('Starting...');

  yield* Effect.gen(function* () {
    yield* Effect.log('Fetching data');
    yield* Effect.annotateCurrentSpan('user.id', 123);
    yield* Effect.sleep('500 millis');
    yield* Effect.log('Data fetched');
    return { id: 123, name: 'Alice' };
  }).pipe(withTracedSpan('fetchUser'));

  yield* Effect.log('Done!');
}).pipe(withTracedSpan('main'));

// Run with trace visualization
traceVisualize(program, {
  serviceName: 'my-app',
  // Called when the user presses 'e' to export
  onExport: (data) => {
    lastExport = data;
  },
}).pipe(BunRuntime.runMain);
```

### CLI

The package includes a CLI for running demos and replaying traces:

```bash
# Run the built-in demo
bunx shoe-box-spanoptic demo

# Run demo and export to a specific file
bunx shoe-box-spanoptic demo --output trace.json

# Replay a previously exported trace
bunx shoe-box-spanoptic replay trace.json
```

## TUI Layout

- **Left panel**: Trace tree with spans and spinners for running operations
- **Right panel**: Details for the selected span (attributes, status, duration)
- **Bottom panel**: Logs for the selected span (updates as you navigate)

## TUI Controls

| Key            | Action                                     |
| -------------- | ------------------------------------------ |
| `↑` / `k`      | Move selection up                          |
| `↓` / `j`      | Move selection down                        |
| `e`            | Export trace (calls `onExport`)            |
| `q` / `Escape` | Quit (once the program has finished)       |
| `Ctrl+C`       | Exit immediately                           |

## API Reference

### `traceVisualize(effect, options)`

Runs an Effect program with OTEL tracing and visualizes it in a TUI. The
returned effect succeeds with the program's result once the user quits.

```typescript
const traceVisualize: <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: TraceVisualizeOptions,
) => Effect.Effect<A, E, Exclude<R, Scope.Scope>>;

type TraceVisualizeOptions = {
  readonly serviceName: string;
  readonly onExport?: (data: TraceExport) => void;
};
```

Logs are attached to the tracing span that is current when they are emitted,
so both `Effect.withSpan` and `withTracedSpan` spans collect logs.

### `withTracedSpan(name, options?)`

Wraps an effect in a tracing span and an Effect log span of the same name. The
log span adds the span name to console log output when the program runs
outside the TUI.

```typescript
import { withTracedSpan } from 'shoe-box-spanoptic';

const myEffect = Effect.gen(function* () {
  yield* Effect.log('This log will be associated with mySpan');
  return 'result';
}).pipe(withTracedSpan('mySpan'));
```

### `replayVisualize(data, options?)`

Replays a previously exported trace in the TUI.

```typescript
const replayVisualize: (
  data: TraceExport,
  options?: { readonly onExport?: (data: TraceExport) => void },
) => Effect.Effect<void>;
```

### `encodeTraceExport` / `decodeTraceExport`

Convert a `TraceExport` to and from the pretty-printed JSON file the CLI writes
(`TraceExportJson` is the underlying `Schema`):

```typescript
import { decodeTraceExport, replayVisualize } from 'shoe-box-spanoptic';

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const data = yield* decodeTraceExport(yield* fs.readFileString('trace.json'));
  yield* replayVisualize(data);
});
```

### Types

`LogEntry`, `SpanInfo` and `TraceExport` are exported both as Effect `Schema`s
and as their (readonly) types:

```typescript
type TraceExport = {
  readonly version: 1;
  readonly serviceName: string;
  readonly exportedAt: number;
  readonly spans: ReadonlyArray<SpanInfo>;
};

type SpanInfo = {
  readonly spanId: string;
  readonly parentSpanId?: string | undefined;
  readonly name: string;
  readonly startTime: number;
  readonly endTime: number | null;
  readonly status: 'running' | 'ok' | 'error';
  readonly errorMessage?: string | undefined;
  readonly attributes: { readonly [key: string]: unknown };
  readonly logs: ReadonlyArray<LogEntry>;
};

type LogEntry = {
  readonly timestamp: number;
  readonly level: string; // 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | ...
  readonly message: string;
  readonly spanName: string | null;
};
```

## Requirements

- Effect 4 (`effect` and `@effect/opentelemetry` 4.0.6)
- Bun (`@opentui/core` loads its native renderer through `bun:ffi`)

## License

MIT
