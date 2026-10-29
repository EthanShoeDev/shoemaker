import { BunServices } from '@effect/platform-bun';
import { assert, beforeAll, describe, it } from '@effect/vitest';
import {
  Array as Arr,
  Config,
  Effect,
  FileSystem,
  Path,
  Record as Rec,
  String as Str,
} from 'effect';

import {
  readJsonObject,
  stringRecord,
  writeJson,
} from '../../../scripts/lib/json.ts';
import { packLocal, pinTarballs } from '../../../scripts/lib/pack-local.ts';
import { repoRoot } from '../../../scripts/lib/packages.ts';
import { run } from '../../../scripts/lib/run.ts';
import { renderConfigFile } from '../src/config/render.ts';
import { presets } from './presets.ts';

// Proves generated repos work through the real CLI path, against locally
// packed packages: write shoemaker.config.ts -> `shoemaker sync` -> bun
// install -> every check the generated repo defines -> `sync --check` must
// report no drift. Samples stay in .e2e/<preset> for inspection.
//
// Never runs infra:*: alchemy creates state stores even on a plan.

const PACK_TIMEOUT = 300_000;
const PRESET_TIMEOUT = 600_000;

const layout = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* repoRoot;
  const out = path.join(root, '.e2e');
  // `bun --bun vitest` puts a `node` -> bun shim first on PATH. The samples run
  // under the real node, as they do for users: under bun, oxlint's config host
  // truncates the `oxlint --rules --format json` output it parses.
  const PATH = Arr.join(
    Arr.filter(
      Str.split(yield* Config.String('PATH'), ':'),
      (dir) => !Str.includes('/bun-node-')(dir),
    ),
    ':',
  );
  return {
    out,
    PATH,
    cli: path.join(root, 'packages/cli/src/bin.ts'),
    overridesFile: path.join(out, 'version-overrides.json'),
  };
});

// Packs once for every preset; the tests read the tarball map back from disk.
beforeAll(
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { out, overridesFile } = yield* layout;
      yield* fs.remove(out, { recursive: true, force: true });
      const overrides = yield* packLocal(path.join(out, 'packs'));
      yield* writeJson(overridesFile, overrides);
    }).pipe(Effect.provide(BunServices.layer)),
  PACK_TIMEOUT,
);

const checkPreset = Effect.fnUntraced(function* (name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { out, PATH, cli, overridesFile } = yield* layout;
  const config = presets[name];
  if (config === undefined) return;
  const overrides = stringRecord(yield* readJsonObject(overridesFile));
  const env = { PATH, SHOEMAKER_VERSION_OVERRIDES: overridesFile };
  const dir = path.join(out, name);

  yield* fs.makeDirectory(dir, { recursive: true });
  yield* fs.writeFileString(
    path.join(dir, 'shoemaker.config.ts'),
    renderConfigFile(config),
  );
  yield* run('bun', [cli, 'sync', '--allow-dirty'], { cwd: dir, env });
  yield* pinTarballs(path.join(dir, 'package.json'), overrides);
  yield* run('git', ['init', '-q'], { cwd: dir });
  yield* run('bun', ['install'], { cwd: dir, env });
  yield* run('git', ['add', '-A'], { cwd: dir });

  yield* config.taskRunner === 'turbo'
    ? run(
        'bunx',
        [
          'turbo',
          'run',
          'lint:check',
          '//#lint:check:root',
          'typecheck',
          'test',
          'build',
          '--continue',
        ],
        { cwd: dir, env: { ...env, TURBO_TELEMETRY_DISABLED: '1' } },
      )
    : run(
        'bunx',
        [
          'nx',
          'run-many',
          '-t',
          'lint:check',
          'typecheck',
          'test',
          'build',
          '--outputStyle=static',
        ],
        { cwd: dir, env: { ...env, NX_DAEMON: 'false', NX_NO_CLOUD: 'true' } },
      );
  yield* run('bun', ['run', 'test'], { cwd: dir, env });
  yield* run('bun', [cli, 'sync', '--check', '--allow-dirty'], {
    cwd: dir,
    env,
  });
  // A fresh repo passes its checks as generated: none of them may write a
  // file (as `nix fmt` once did with an unlocked flake).
  const changed = yield* run('git', ['diff', '--name-only'], { cwd: dir });
  const added = yield* run(
    'git',
    ['ls-files', '--others', '--exclude-standard'],
    { cwd: dir },
  );
  assert.strictEqual(`${changed}${added}`, '');
});

// `full` builds a foldkit site, and foldkit (0.169.0, @foldkit/vite-plugin
// 0.28.0) still imports `Crypto` from effect, which Effect 4.1.0 removed, so
// its build fails. Unskip once a foldkit release supports Effect 4.1.0.
const skipped = new Set(['full']);

describe('generated repos install and pass their own checks', () => {
  for (const name of Rec.keys(presets)) {
    it.live.skipIf(skipped.has(name))(
      name,
      () => checkPreset(name).pipe(Effect.provide(BunServices.layer)),
      PRESET_TIMEOUT,
    );
  }
});
