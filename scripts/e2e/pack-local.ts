// Builds and packs every publishable package into a directory, so generated
// sample repos can install them before they exist on npm. `bun pm pack`
// resolves catalog:/workspace: specs but does NOT apply publishConfig.exports,
// so each package swaps its exports in prepack/postpack.
//
//   bun scripts/e2e/pack-local.ts <outDir>   -> prints {name: "file:<tgz>"} JSON
import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Path,
  Record as Rec,
  String as Str,
} from 'effect';
import { Argument, Command } from 'effect/cli';

import { renderJson } from '../../packages/cli/src/engine/json.ts';
import { readJsonObject, stringRecord, writeJson } from '../lib/json.ts';
import { publishablePackages, repoRoot } from '../lib/packages.ts';
import { run, runScript } from '../lib/run.ts';

export const packLocal = Effect.fnUntraced(function* (outDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dest = path.resolve(outDir);
  yield* fs.makeDirectory(dest, { recursive: true });
  const packages = yield* publishablePackages;
  // One turbo run builds them in dependency order (and skips cached builds).
  yield* run(
    'bunx',
    [
      'turbo',
      'run',
      'build',
      ...Arr.flatMap(packages, (pkg) => ['--filter', pkg.name]),
    ],
    { cwd: yield* repoRoot, env: { TURBO_TELEMETRY_DISABLED: '1' } },
  );
  const entries = yield* Effect.forEach(
    packages,
    (pkg) =>
      run('bun', ['pm', 'pack', '--destination', dest, '--quiet'], {
        cwd: pkg.cwd,
      }).pipe(
        Effect.as([
          pkg.name,
          `file:${path.join(dest, `${pkg.name}-${pkg.version}.tgz`)}`,
        ] as const),
      ),
    { concurrency: 'unbounded' },
  );
  return Rec.fromEntries(entries);
});

// The tarballs depend on each other at versions not on npm yet, so pin every
// shoe-box package to its tarball for the whole install tree.
export const pinTarballs = Effect.fnUntraced(function* (
  manifestPath: string,
  overrides: Record<string, string>,
) {
  const manifest = yield* readJsonObject(manifestPath);
  manifest.overrides = Rec.fromEntries(
    Arr.sort(
      Rec.toEntries({ ...stringRecord(manifest.overrides), ...overrides }),
      ([a]: readonly [string, string], [b]: readonly [string, string]) =>
        Str.localeCompare(b)(a),
    ),
  );
  yield* writeJson(manifestPath, manifest);
});

const packLocalCommand = Command.make(
  'pack-local',
  { outDir: Argument.String('outDir') },
  Effect.fnUntraced(function* ({ outDir }) {
    const overrides = yield* packLocal(outDir);
    yield* Console.log(Str.trimEnd(renderJson(overrides)));
  }),
).pipe(Command.withDescription('Pack every publishable package locally'));

if (import.meta.main) {
  runScript(Command.run(packLocalCommand, { version: '0.0.0' }));
}
