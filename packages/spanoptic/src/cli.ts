#!/usr/bin/env node
/**
 * Spanoptic CLI - TUI OTEL visualizer for Effect programs
 *
 * Usage:
 *   spanoptic demo     - Run a demo trace visualization
 *   spanoptic replay <file> - Replay a previously exported trace
 */

import { Args, Command, Options } from '@effect/cli';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { FileSystem } from '@effect/platform';
import { Console, Effect, Layer, Logger, LogLevel, Option } from 'effect';
import { traceVisualize, replayVisualize, withTracedSpan, type TraceExport } from './index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Demo command
// ─────────────────────────────────────────────────────────────────────────────

// Helper for random delay with jitter
const randomDelay = (min: number, max: number) =>
  Effect.sleep(`${Math.floor(Math.random() * (max - min + 1)) + min} millis`);

// Demo program that showcases tracing
const demoProgram = Effect.gen(function* () {
  yield* Effect.log('Starting API request handler');

  // Fetch user
  const user = yield* Effect.gen(function* () {
    yield* Effect.log('Fetching user from database...');
    yield* Effect.annotateCurrentSpan('user.id', 1);
    yield* Effect.annotateCurrentSpan('user.role', 'admin');
    yield* randomDelay(300, 600);
    yield* Effect.log('User fetched successfully');
    return { id: 1, name: 'Alice' };
  }).pipe(withTracedSpan('fetchUser'));

  // Process data
  yield* Effect.gen(function* () {
    yield* Effect.log('Starting data processing');
    yield* randomDelay(200, 400);
    yield* Effect.logDebug('Processed 42 records');
    yield* Effect.log('Data processing complete');
  }).pipe(withTracedSpan('processData'));

  // Database operations
  yield* Effect.gen(function* () {
    yield* Effect.log('Starting database operations');

    yield* Effect.gen(function* () {
      yield* Effect.log('Establishing database connection');
      yield* randomDelay(100, 200);
      yield* Effect.log('Connected to PostgreSQL');
    }).pipe(withTracedSpan('connectToDatabase'));

    yield* Effect.gen(function* () {
      yield* Effect.log('Executing query: SELECT * FROM users');
      yield* Effect.annotateCurrentSpan('db.table', 'users');
      yield* Effect.annotateCurrentSpan('db.rows_returned', 42);
      yield* randomDelay(250, 500);
      yield* Effect.logDebug('Query returned 42 rows in 234ms');
    }).pipe(withTracedSpan('queryUsers'));

    yield* Effect.gen(function* () {
      yield* Effect.log('Executing query: SELECT * FROM orders');
      yield* Effect.annotateCurrentSpan('db.table', 'orders');
      yield* Effect.annotateCurrentSpan('db.rows_returned', 156);
      yield* randomDelay(300, 600);
      yield* Effect.logDebug('Query returned 156 rows in 412ms');
      yield* Effect.logWarning('Large result set - consider pagination');
    }).pipe(withTracedSpan('queryOrders'));

    yield* Effect.log('Database operations complete');
  }).pipe(withTracedSpan('databaseOperations'));

  // Parallel side effects
  yield* Effect.all(
    [
      Effect.gen(function* () {
        yield* Effect.log('Sending notifications to 3 users');
        yield* randomDelay(400, 800);
        yield* Effect.logInfo('Email sent to user@example.com');
        yield* Effect.logInfo('Push notification sent');
      }).pipe(withTracedSpan('sendNotifications')),

      Effect.gen(function* () {
        yield* Effect.log('Invalidating cache entries');
        yield* randomDelay(150, 300);
        yield* Effect.logDebug('Cache key: user:1 invalidated');
      }).pipe(withTracedSpan('updateCache')),

      Effect.gen(function* () {
        yield* Effect.log('Recording analytics event');
        yield* randomDelay(200, 500);
        yield* Effect.logDebug('Event: page_view recorded');
      }).pipe(withTracedSpan('trackAnalytics')),
    ],
    { concurrency: 'unbounded' }
  ).pipe(withTracedSpan('sideEffects'));

  // Generate report
  yield* Effect.gen(function* () {
    yield* Effect.log('Generating monthly report');
    yield* randomDelay(400, 700);
    yield* Effect.logInfo('Report generated: report_2024_01.pdf');
    yield* Effect.log('Report saved to S3');
  }).pipe(withTracedSpan('generateReport'));

  yield* Effect.sleep('200 millis').pipe(withTracedSpan('finalize'));
  yield* Effect.log('Request completed successfully');
  return user;
}).pipe(withTracedSpan('main'));

// Export handler for saving trace to file
const createExportHandler = (fs: FileSystem.FileSystem) => (data: TraceExport) => {
  const filename = `trace-${Date.now()}.json`;
  const content = JSON.stringify(data, null, 2);
  Effect.runPromise(
    Effect.gen(function* () {
      yield* fs.writeFileString(filename, content);
    })
  ).catch(console.error);
  console.log(`\nTrace exported to ${filename}`);
};

// Demo subcommand
const outputFile = Options.file('output', { shortAlias: 'o' }).pipe(
  Options.optional
);

const demoCommand = Command.make('demo', { outputFile }, ({ outputFile }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const exportHandler = (data: TraceExport) => {
      const filename = Option.getOrElse(outputFile, () => `trace-${Date.now()}.json`);
      const content = JSON.stringify(data, null, 2);
      Effect.runPromise(
        Effect.gen(function* () {
          yield* fs.writeFileString(filename, content);
        })
      ).catch(console.error);
      console.log(`\nTrace exported to ${filename}`);
    };

    yield* traceVisualize(demoProgram, {
      serviceName: 'spanoptic-demo',
      onExport: exportHandler,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Replay command
// ─────────────────────────────────────────────────────────────────────────────

const traceFile = Args.file({ name: 'file', exists: 'yes' });

const replayCommand = Command.make('replay', { traceFile }, ({ traceFile }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // Read the trace file
    const content = yield* fs.readFileString(traceFile);
    const data = JSON.parse(content) as TraceExport;

    if (data.version !== 1) {
      yield* Effect.fail(new Error(`Unsupported trace version: ${data.version}`));
    }

    yield* Console.log(`Replaying trace from ${traceFile}`);
    yield* Console.log(`Service: ${data.serviceName}`);
    yield* Console.log(`Spans: ${data.spans.length}`);
    yield* Console.log('');

    // Small delay so user can see the info
    yield* Effect.sleep('500 millis');

    const exportHandler = (exportData: TraceExport) => {
      const filename = `trace-${Date.now()}.json`;
      const exportContent = JSON.stringify(exportData, null, 2);
      Effect.runPromise(
        Effect.gen(function* () {
          yield* fs.writeFileString(filename, exportContent);
        })
      ).catch(console.error);
      console.log(`\nTrace exported to ${filename}`);
    };

    yield* replayVisualize(data, { onExport: exportHandler });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Main CLI
// ─────────────────────────────────────────────────────────────────────────────

const spanoptic = Command.make('spanoptic', {}, () =>
  Console.log('Spanoptic - TUI OTEL visualizer for Effect programs\n\nUse --help to see available commands.')
);

const command = spanoptic.pipe(
  Command.withSubcommands([demoCommand, replayCommand])
);

const cli = Command.run(command, {
  name: 'Spanoptic',
  version: '0.0.1',
});

// Suppress the default logger to prevent logs from appearing on top of the TUI.
// The traceVisualize function sets up its own log capture for the TUI.
// We use Effect.runPromise instead of NodeRuntime.runMain to avoid the pretty logger.
const program = cli(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  Logger.withMinimumLogLevel(LogLevel.None)
);

Effect.runPromise(program).catch((error) => {
  console.error(error);
  process.exit(1);
});
