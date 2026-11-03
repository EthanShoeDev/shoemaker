#!/usr/bin/env bun
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';

import { runShoemaker } from './commands/index.ts';

runShoemaker(process.argv.slice(2)).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
