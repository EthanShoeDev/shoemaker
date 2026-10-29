import { Config, Context, Effect, FileSystem, Option, Schema } from 'effect';

import type { ShoeboxConfig } from '../config/schema.ts';
import { generate } from './generate.ts';
import { readLock } from './lock.ts';
import { makePlan, type PlanOptions } from './plan.ts';
import { makeRepo } from './repo-live.ts';

// The generator entry point, as a service so tests can swap in a fake file
// list without depending on what the real generators emit.
export const Generate = Context.Reference<typeof generate>('shoebox/Generate', {
  defaultValue: () => generate,
});

export class GenerateError extends Schema.TaggedError<
  GenerateError,
  { readonly brand: unique symbol }
>()('GenerateError', { message: Schema.String }) {}

const Overrides = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.String),
);

// `SHOEBOX_VERSION_OVERRIDES=<file>`: JSON {name: spec}, e.g. the output of
// scripts/e2e/pack-local.ts, to install local tarballs before publishing.
export const versionOverrides = Effect.gen(function* () {
  const file = yield* Config.option(
    Config.String('SHOEBOX_VERSION_OVERRIDES'),
  ).pipe(Effect.orDie);
  if (Option.isNone(file)) return undefined;
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(file.value);
  return yield* Schema.decodeEffect(Overrides)(text).pipe(
    Effect.mapError((issue) =>
      GenerateError.make({
        message: `SHOEBOX_VERSION_OVERRIDES (${file.value}): ${issue.message}`,
      }),
    ),
  );
});

export const renderFiles = Effect.fnUntraced(function* (config: ShoeboxConfig) {
  const run = yield* Generate;
  const overrides = yield* versionOverrides;
  return yield* Effect.try({
    try: () =>
      run(
        config,
        overrides === undefined ? {} : { versionOverrides: overrides },
      ).files,
    catch: (cause) =>
      GenerateError.make({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });
});

// Renders the config and classifies every file against disk and the lock.
export const planRepo = Effect.fnUntraced(function* (
  root: string,
  config: ShoeboxConfig,
  options: PlanOptions = {},
) {
  const repo = yield* makeRepo(root);
  const lock = yield* readLock(repo);
  const files = yield* renderFiles(config);
  const plan = yield* makePlan(repo, files, lock, options);
  return { repo, lock, plan };
});
