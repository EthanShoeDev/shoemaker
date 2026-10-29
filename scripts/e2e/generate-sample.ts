// Generates a sample repo from a preset with locally packed shoemaker
// packages, writing files directly (no lockfile, no sync engine), then
// installs it. Use it to prove generator output builds and lints.
//
//   bun scripts/e2e/generate-sample.ts <preset> <outDir> [--no-install]
import { Console, Effect, FileSystem, Path, Record as Rec } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';

import { generate } from '../../packages/cli/src/engine/generate.ts';
import { run, runInherit, runScript } from '../lib/run.ts';
import { packLocal, pinTarballs } from './pack-local.ts';
import { presets } from './presets.ts';

const generateSample = Command.make(
  'generate-sample',
  {
    preset: Argument.Literals('preset', Rec.keys(presets)),
    outDir: Argument.String('outDir'),
    install: Flag.Boolean('install').pipe(
      Flag.withDescription(
        'Run git init and bun install (--no-install to skip)',
      ),
      Flag.withDefault(true),
    ),
  },
  Effect.fnUntraced(function* ({ preset, outDir, install }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = presets[preset];
    if (config === undefined) return;
    const out = path.resolve(outDir);
    yield* fs.remove(out, { recursive: true, force: true });
    yield* fs.makeDirectory(out, { recursive: true });

    const versionOverrides = yield* packLocal(
      path.join(out, '..', `${preset}-packs`),
    );
    const { files } = generate(config, { versionOverrides });
    yield* Effect.forEach(
      files,
      (file) =>
        Effect.gen(function* () {
          const target = path.join(out, file.path);
          yield* fs.makeDirectory(path.dirname(target), { recursive: true });
          yield* fs.writeFileString(target, file.content);
          if (file.executable === true) yield* fs.chmod(target, 0o755);
        }),
      { discard: true },
    );
    yield* pinTarballs(path.join(out, 'package.json'), versionOverrides);
    yield* Console.log(`wrote ${files.length} files to ${out}`);

    if (install) {
      yield* run('git', ['init', '-q'], { cwd: out });
      yield* runInherit('bun', ['install'], { cwd: out });
    }
  }),
).pipe(Command.withDescription('Generate and install a sample repo'));

runScript(Command.run(generateSample, { version: '0.0.0' }));
