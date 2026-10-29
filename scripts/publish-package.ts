// Publishes the package in the current directory unless npm already has its
// version. Each publishable package runs it as its `release:publish` script,
// which turbo orders after `build` and after its dependencies' publishes.
//
// `bun publish` resolves catalog:/workspace: specs and runs prepack/postpack
// (publish-manifest.ts swaps in publishConfig). SHOE_BOX_RELEASE_DRY_RUN=true
// packs with --dry-run instead, which needs no npm auth.
import { Config, Console, Effect, Path } from 'effect';

import { readJsonObject } from './lib/json.ts';
import { isOnNpm } from './lib/packages.ts';
import { runInherit, runScript } from './lib/run.ts';

const program = Effect.gen(function* () {
  const path = yield* Path.Path;
  const cwd = path.resolve('.');
  const manifest = yield* readJsonObject(path.join(cwd, 'package.json'));
  const pkg = {
    name: String(manifest.name),
    version: String(manifest.version),
  };
  const dryRun = yield* Config.Boolean('SHOE_BOX_RELEASE_DRY_RUN').pipe(
    Config.withDefault(false),
  );
  if (yield* isOnNpm(pkg)) {
    return yield* Console.log(`skip ${pkg.name}@${pkg.version} (on npm)`);
  }
  yield* dryRun
    ? runInherit('bun', ['pm', 'pack', '--dry-run'], { cwd })
    : runInherit('bun', ['publish', '--access', 'public'], { cwd });
});

runScript(program);
