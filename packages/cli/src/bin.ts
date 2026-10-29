#!/usr/bin/env bun
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';

import { runShoebox } from './commands/index.ts';

runShoebox(process.argv.slice(2)).pipe(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- this is the entry point
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
