// End-to-end proof that generated repos work, through the real CLI path:
// write shoebox.config.ts -> `shoe-box sync` -> bun install -> every check the
// generated repo defines -> `shoe-box sync --check` must report no drift.
//
//   bun scripts/e2e/run-all.ts [preset...] [--out <dir>]
//
// Never runs infra:plan/deploy: alchemy creates state stores even on a plan.
import {
  Array as Arr,
  Console,
  Duration,
  Effect,
  FileSystem,
  Option,
  Path,
  Record as Rec,
  Schema,
  String as Str,
} from 'effect';
import { Argument, Command, Flag } from 'effect/cli';

import { renderConfigFile } from '../../packages/cli/src/config/render.ts';
import { readJsonObject, stringRecord, writeJson } from '../lib/json.ts';
import { repoRoot } from '../lib/packages.ts';
import { run, runScript } from '../lib/run.ts';
import { packLocal } from './pack-local.ts';
import { presets } from './presets.ts';

class PresetsFailed extends Schema.TaggedError<
  PresetsFailed,
  { readonly brand: unique symbol }
>()('PresetsFailed', { failures: Schema.Array(Schema.String) }) {
  override get message() {
    return `Failed:\n${Arr.join(
      Arr.map(this.failures, (f) => `  ${f}`),
      '\n',
    )}`;
  }
}

const runAll = Command.make(
  'run-all',
  {
    names: Argument.Literals('preset', Rec.keys(presets)).pipe(
      Argument.withDescription('Presets to run (default: all)'),
      Argument.variadic(),
    ),
    out: Flag.String('out').pipe(
      Flag.withDescription('Output directory (default: .e2e)'),
      Flag.optional,
    ),
  },
  Effect.fnUntraced(function* ({ names, out }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* repoRoot;
    const outRoot = path.resolve(
      Option.getOrElse(out, () => path.join(root, '.e2e')),
    );
    const chosen = names.length > 0 ? names : Rec.keys(presets);
    const cli = path.join(root, 'packages/cli/src/bin.ts');

    yield* fs.remove(outRoot, { recursive: true, force: true });
    yield* fs.makeDirectory(outRoot, { recursive: true });
    const overrides = yield* packLocal(path.join(outRoot, 'packs'));
    const overridesFile = path.join(outRoot, 'version-overrides.json');
    yield* writeJson(overridesFile, overrides);
    const env = { SHOEBOX_VERSION_OVERRIDES: overridesFile };

    const failures: Array<string> = [];
    const step = <A, E, R>(
      preset: string,
      label: string,
      effect: Effect.Effect<A, E, R>,
    ) =>
      effect.pipe(
        Effect.timed,
        Effect.matchEffect({
          onSuccess: ([duration]) =>
            Console.log(
              `  ok   ${label} (${Math.round(Duration.toMillis(duration))}ms)`,
            ),
          onFailure: (error) => {
            failures.push(`${preset}: ${label}`);
            return Console.log(`  FAIL ${label}\n${String(error)}`);
          },
        }),
      );

    for (const name of chosen) {
      const config = presets[name];
      if (config === undefined) continue;
      const dir = path.join(outRoot, name);
      yield* fs.makeDirectory(dir, { recursive: true });
      yield* Console.log(
        `\n== ${name} (${config.taskRunner}, secrets: ${config.secrets}) ==`,
      );
      yield* fs.writeFileString(
        path.join(dir, 'shoebox.config.ts'),
        renderConfigFile(config),
      );

      yield* step(
        name,
        'shoe-box sync',
        run('bun', [cli, 'sync', '--allow-dirty'], { cwd: dir, env }),
      );
      // Tarballs depend on each other at versions not on npm yet.
      const manifestPath = path.join(dir, 'package.json');
      const manifest = yield* readJsonObject(manifestPath);
      manifest.overrides = Rec.fromEntries(
        Arr.sort(
          Rec.toEntries({ ...stringRecord(manifest.overrides), ...overrides }),
          ([a]: readonly [string, string], [b]: readonly [string, string]) =>
            Str.localeCompare(b)(a),
        ),
      );
      yield* writeJson(manifestPath, manifest);
      yield* step(
        name,
        'bun install',
        Effect.gen(function* () {
          yield* run('git', ['init', '-q'], { cwd: dir });
          yield* run('bun', ['install'], { cwd: dir, env });
          yield* run('git', ['add', '-A'], { cwd: dir });
        }),
      );

      yield* config.taskRunner === 'turbo'
        ? step(
            name,
            'turbo lint:check typecheck test build',
            run(
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
            ),
          )
        : step(
            name,
            'nx lint:check typecheck test build',
            run(
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
              {
                cwd: dir,
                env: { ...env, NX_DAEMON: 'false', NX_NO_CLOUD: 'true' },
              },
            ),
          );
      yield* step(
        name,
        'root test',
        run('bun', ['run', 'test'], { cwd: dir, env }),
      );
      yield* step(
        name,
        'sync is idempotent',
        run('bun', [cli, 'sync', '--check', '--allow-dirty'], {
          cwd: dir,
          env,
        }),
      );
    }

    if (failures.length > 0) return yield* PresetsFailed.make({ failures });
    yield* Console.log('\nAll presets passed.');
  }),
).pipe(Command.withDescription('Generate, install and check every preset'));

runScript(Command.run(runAll, { version: '0.0.0' }));
