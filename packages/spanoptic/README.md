# @shoe-box-tools/spanoptic

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
bun add @shoe-box-tools/spanoptic
```

## Usage

### Programmatic API

Wrap your Effect program with `traceVisualize` to visualize traces:

```typescript
import { Effect } from 'effect';
import { traceVisualize, withTracedSpan } from '@shoe-box-tools/spanoptic';

const program = Effect.gen(function* () {
  yield* Effect.log('Starting...');

  yield* Effect.gen(function* () {
    yield* Effect.log('Fetching data');
    yield* Effect.annotateCurrentSpan('user.id', 123);
    yield* Effect.sleep('500 millis');
    yield* Effect.log('Data fetched');
    return { id: 123, name: 'Alice' };
  }).pipe(withTracedSpan('fetchUser')); // Use withTracedSpan to capture logs

  yield* Effect.log('Done!');
}).pipe(withTracedSpan('main'));

// Run with trace visualization
Effect.runPromise(
  traceVisualize(program, {
    serviceName: 'my-app',
    onExport: (data) => {
      // Called when user presses 'e' to export
      console.log('Exported:', JSON.stringify(data));
    },
  })
);
```

### CLI

The package includes a CLI for running demos and replaying traces:

```bash
# Run the built-in demo
bunx @shoe-box-tools/spanoptic demo

# Run demo and export to a specific file
bunx @shoe-box-tools/spanoptic demo --output trace.json

# Replay a previously exported trace
bunx @shoe-box-tools/spanoptic replay trace.json
```

## TUI Layout

- **Left panel**: Trace tree with spans and spinners for running operations
- **Right panel**: Details for the selected span (attributes, status, duration)
- **Bottom panel**: Logs for the selected span (updates as you navigate)

## TUI Controls

| Key | Action |
|-----|--------|
| `↑` / `k` | Move selection up |
| `↓` / `j` | Move selection down |
| `e` | Export trace to file |
| `q` / `Escape` | Quit |

## API Reference

### `traceVisualize(effect, options)`

Wraps an Effect program with OTEL tracing and visualizes it in a TUI.

```typescript
function traceVisualize<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: TraceVisualizeOptions
): Effect.Effect<A, E, R>;

interface TraceVisualizeOptions {
  serviceName: string;
  onExport?: (data: TraceExport) => void;
}
```

### `withTracedSpan(name, options?)`

A helper that wraps an effect with both OTEL tracing span and Effect log span.
This ensures logs are properly associated with spans in the TUI.

**Important:** Use this instead of `Effect.withSpan` when you want logs to be captured and displayed in the logs panel.

```typescript
import { withTracedSpan } from '@shoe-box-tools/spanoptic';

const myEffect = Effect.gen(function* () {
  yield* Effect.log("This log will be associated with mySpan");
  return "result";
}).pipe(withTracedSpan("mySpan"));
```

### `replayVisualize(data, options)`

Replays a previously exported trace in the TUI.

```typescript
function replayVisualize(
  data: TraceExport,
  options?: { onExport?: (data: TraceExport) => void }
): Effect.Effect<void>;

interface TraceExport {
  version: 1;
  serviceName: string;
  exportedAt: number;
  spans: SpanInfo[];
}
```

### Types

```typescript
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

interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
  spanId: string | null;
}
```

## Requirements

- Effect 3.x
- @effect/opentelemetry
- Node.js 18+ or Bun

## License

MIT
