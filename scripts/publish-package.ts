// Publishes the package in the current directory unless npm already has its
// version. Each publishable package runs it as its `release:publish` script,
// which turbo orders after `build` and after its dependencies' publishes.
//
// `bun pm pack` resolves catalog:/workspace: specs and runs prepack/postpack
// (publish-manifest.ts swaps in publishConfig); npm then publishes that
// tarball. npm, not `bun publish`, because only npm speaks trusted publishing
// (OIDC), so CI needs no token (oven-sh/bun#15601). Locally it uses your
// `npm login`. SHOEMAKER_RELEASE_DRY_RUN=true packs with --dry-run instead,
// which needs no npm auth.
import { Config, Console, Effect, FileSystem, Path } from 'effect';

import { readJsonObject } from './lib/json.ts';
import { publishStatus } from './lib/packages.ts';
import { run, runInherit, runScript } from './lib/run.ts';

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = path.resolve('.');
  const manifest = yield* readJsonObject(path.join(cwd, 'package.json'));
  const pkg = {
    name: String(manifest.name),
    version: String(manifest.version),
  };
  const dryRun = yield* Config.Boolean('SHOEMAKER_RELEASE_DRY_RUN').pipe(
    Config.withDefault(false),
  );
  const status = yield* publishStatus(pkg);
  if (status === 'published') {
    return yield* Console.log(`skip ${pkg.name}@${pkg.version} (on npm)`);
  }
  if (status === 'unclaimed') {
    return yield* Console.log(
      `skip ${pkg.name}@${pkg.version} (not on npm yet; publish it once by hand)`,
    );
  }
  if (dryRun) {
    return yield* runInherit('bun', ['pm', 'pack', '--dry-run'], { cwd });
  }
  const tarball = path.join(yield* fs.makeTempDirectoryScoped(), 'package.tgz');
  yield* run('bun', ['pm', 'pack', '--filename', tarball], { cwd });
  yield* runInherit(
    'bun',
    ['run', 'npm', 'publish', tarball, '--access', 'public'],
    { cwd },
  );
});

runScript(Effect.scoped(program));
