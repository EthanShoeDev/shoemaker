// Runs the interactive `shoemaker init` wizard against locally packed packages,
// so it can be tried before anything is on npm. The repo lands in tmp/<name>
// (gitignored), which is wiped first.
//
//   bun scripts/try-wizard.ts [name]   (or `bun run wizard:local`)
import { Array as Arr, Console, Effect, FileSystem, Path } from 'effect';
import { Argument, Command } from 'effect/cli';

import { writeJson } from './lib/json.ts';
import { packLocal, pinTarballs } from './lib/pack-local.ts';
import { repoRoot } from './lib/packages.ts';
import { runInherit, runScript } from './lib/run.ts';

// Kebab-case only, so the wipe can never reach outside tmp/.
const KEBAB = /^[a-z][a-z0-9-]*$/u;

const tryWizard = Command.make(
  'try-wizard',
  {
    name: Argument.String('name').pipe(
      Argument.withDescription('Directory under tmp/ (default: wizard)'),
      Argument.filter(
        (name) => KEBAB.test(name),
        (name) => `Expected a kebab-case name, got ${name}`,
      ),
      Argument.withDefault('wizard'),
    ),
  },
  Effect.fnUntraced(function* ({ name }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* repoRoot;
    const packs = path.join(root, 'tmp', '.packs');
    const out = path.join(root, 'tmp', name);
    yield* fs.remove(out, { recursive: true, force: true });

    yield* Console.log('Building and packing the local packages...');
    const overrides = yield* packLocal(packs);
    const overridesFile = path.join(packs, 'version-overrides.json');
    yield* writeJson(overridesFile, overrides);

    yield* runInherit(
      'bun',
      [path.join(root, 'packages/cli/src/bin.ts'), 'init', out, '--no-install'],
      { cwd: root, env: { SHOEMAKER_VERSION_OVERRIDES: overridesFile } },
    );
    // Not installed, but pinned so a later `bun install` resolves the
    // tarballs, which depend on each other at versions not on npm yet.
    yield* pinTarballs(path.join(out, 'package.json'), overrides);

    yield* Console.log(
      Arr.join(
        [
          '',
          `Generated ${path.relative(root, out)} (not installed).`,
          '`bun install` in it uses the local tarballs. To run',
          '`bunx shoemaker sync` or `doctor` there without drift on the',
          'shoemaker versions, first:',
          `  export SHOEMAKER_VERSION_OVERRIDES=${overridesFile}`,
        ],
        '\n',
      ),
    );
  }),
).pipe(
  Command.withDescription('Run the init wizard into tmp/ with local packages'),
);

runScript(Command.run(tryWizard, { version: '0.0.0' }));
