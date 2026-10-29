/**
 * Demo of spanoptic - TUI OTEL visualizer for Effect programs.
 *
 * Run with: bun packages/spanoptic/src/demo.ts
 */

import { BunRuntime } from '@effect/platform-bun';
import { Console, Effect } from 'effect';

import { demoProgram } from './demo-program.ts';
import { traceVisualize } from './index.ts';

traceVisualize(demoProgram, { serviceName: 'trace-demo' }).pipe(
  Effect.tap((result) => Console.log('\nResult:', result)),
  BunRuntime.runMain,
);
