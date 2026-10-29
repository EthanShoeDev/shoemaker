// `bun pm pack` / `bun publish` resolve catalog: and workspace: specs but do
// not apply `publishConfig.exports` / `publishConfig.bin`, so workspace
// packages (which export ./src/*.ts for local use) would publish paths that
// point at source instead of dist. prepack swaps them in; postpack restores
// the file.
//
//   bun ../../scripts/publish-manifest.ts swap|restore   (from a package dir)
import { Effect, FileSystem, Predicate } from 'effect';
import { Argument, Command } from 'effect/cli';

import { readJsonObject, writeJson } from './lib/json.ts';
import { runScript } from './lib/run.ts';

const MANIFEST = 'package.json';
const BACKUP = 'package.json.prepack';

const swap = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const manifest = yield* readJsonObject(MANIFEST);
  yield* fs.copyFile(MANIFEST, BACKUP);
  const published = Predicate.isObject(manifest.publishConfig)
    ? manifest.publishConfig
    : {};
  for (const key of ['exports', 'bin', 'main', 'types']) {
    if (published[key] !== undefined) manifest[key] = published[key];
  }
  yield* writeJson(MANIFEST, manifest);
});

const restore = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  if (yield* fs.exists(BACKUP)) yield* fs.rename(BACKUP, MANIFEST);
});

const publishManifest = Command.make(
  'publish-manifest',
  { mode: Argument.Literals('mode', ['swap', 'restore']) },
  ({ mode }) => (mode === 'swap' ? swap : restore),
).pipe(
  Command.withDescription('Swap publishConfig into package.json for packing'),
);

runScript(Command.run(publishManifest, { version: '0.0.0' }));
