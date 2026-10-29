#!/usr/bin/env bun
/**
 * Spanoptic CLI - TUI OTEL visualizer for Effect programs
 *
 * Usage:
 *   spanoptic demo [--output <file>]  - Run a demo trace visualization
 *   spanoptic replay <file>           - Replay a previously exported trace
 */

import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Clock, Console, Effect, FileSystem, Option, References } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';

import { demoProgram } from './demo-program.ts';
import {
  decodeTraceExport,
  encodeTraceExport,
  replayVisualize,
  traceVisualize,
} from './index.ts';
import type { TraceExport } from './index.ts';

const writeTrace = Effect.fnUntraced(function* (
  data: TraceExport,
  output: Option.Option<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const now = yield* Clock.currentTimeMillis;
  const filename = Option.getOrElse(output, () => `trace-${now}.json`);
  yield* fs.writeFileString(filename, yield* encodeTraceExport(data));
  yield* Console.log(`\nTrace exported to ${filename}`);
});

// onExport is a plain callback fired from a key press, so the write is
// forked with the command's services rather than awaited by the TUI.
const exportHandler = Effect.fnUntraced(function* (
  output: Option.Option<string>,
) {
  const context = yield* Effect.context<FileSystem.FileSystem>();
  return (data: TraceExport) => {
    Effect.runForkWith(context)(
      writeTrace(data, output).pipe(
        Effect.catch((error) => Console.error(String(error))),
      ),
    );
  };
});

const demoCommand = Command.make(
  'demo',
  {
    output: Flag.File('output').pipe(
      Flag.withAlias('o'),
      Flag.withDescription('Where to write the trace when you press e'),
      Flag.optional,
    ),
  },
  Effect.fnUntraced(function* ({ output }) {
    yield* traceVisualize(demoProgram, {
      serviceName: 'spanoptic-demo',
      onExport: yield* exportHandler(output),
    });
  }),
).pipe(Command.withDescription('Run a demo trace visualization'));

const replayCommand = Command.make(
  'replay',
  {
    file: Argument.File('file', { mustExist: true }).pipe(
      Argument.withDescription('A trace exported with e'),
    ),
  },
  Effect.fnUntraced(function* ({ file }) {
    const fs = yield* FileSystem.FileSystem;
    const data = yield* decodeTraceExport(yield* fs.readFileString(file));

    yield* Console.log(`Replaying trace from ${file}`);
    yield* Console.log(`Service: ${data.serviceName}`);
    yield* Console.log(`Spans: ${data.spans.length}`);
    yield* Console.log('');
    // Leave the summary on screen briefly before the TUI takes over.
    yield* Effect.sleep('500 millis');

    yield* replayVisualize(data, {
      onExport: yield* exportHandler(Option.none()),
    });
  }),
).pipe(Command.withDescription('Replay a previously exported trace'));

const spanoptic = Command.make('spanoptic', {}, () =>
  Console.log(
    'Spanoptic - TUI OTEL visualizer for Effect programs\n\nUse --help to see available commands.',
  ),
).pipe(
  Command.withDescription('TUI OTEL visualizer for Effect programs'),
  Command.withSubcommands([demoCommand, replayCommand]),
);

Command.run(spanoptic, { version: '0.0.1' }).pipe(
  // Effect logs would paint over the TUI; traceVisualize captures its own.
  Effect.provideService(References.MinimumLogLevel, 'None'),
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- this is the entry point
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
