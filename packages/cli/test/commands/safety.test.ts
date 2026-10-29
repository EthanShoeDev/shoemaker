import { assert, describe, it } from '@effect/vitest';
import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Record as Rec,
  String as Str,
} from 'effect';

import { loadConfig } from '../../src/config/load.ts';
import type { ShoeboxConfig } from '../../src/config/schema.ts';
import { ensureCleanTree } from '../../src/engine/apply.ts';
import { readLock } from '../../src/engine/lock.ts';
import { makeRepo } from '../../src/engine/repo-live.ts';
import { Generate } from '../../src/engine/sync.ts';
import type { GeneratedFile } from '../../src/engine/types.ts';
import { json } from '../../src/generators/shared.ts';
import { pkgIn } from '../migrations/helpers.ts';
import { git, readText, run, scratch, withBun, writeText } from './helpers.ts';

// Command-level regression tests: shoebox must never overwrite the user's
// work, and must not report its own output as a hand edit.

const emptyAggregate = {
  tasks: [],
  env: [],
  catalog: [],
  nixPackages: [],
  gitignore: [],
  ignore: [],
};

// A generator whose root package.json owns one script, `script` -> `command`.
const scriptGenerate =
  (script: string, command: string) => (config: ShoeboxConfig) => ({
    files: [
      {
        path: 'package.json',
        strategy: 'json-merge',
        content: json({
          name: config.name,
          scripts: { [script]: command },
        }),
      },
    ] satisfies ReadonlyArray<GeneratedFile>,
    aggregate: emptyAggregate,
  });

const handWritten = `import { defineConfig } from 'shoe-box/config';

// Why we picked turbo: see ADR-7
const DESC = 'from a const';

export default defineConfig({
  name: 'my-repo',
  scope: 'my-repo',
  // keep in sync with README
  description: DESC,
  apps: [
    {
      name: 'api',
      kind: 'effect-api', // the first one
    },
  ],
  packages: [],
  taskRunner: 'turbo',
  secrets: 'none',
  infra: { kind: 'none', providers: [] },
  ci: 'none',
  features: { changesets: false, agents: true, vscode: false },
  nixPackages: [],
  unmanaged: [],
});
`;

describe('add', () => {
  it.effect(
    'on a committed repo plans updates, not conflicts, and matches a fresh init',
    () =>
      withBun(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* scratch();
          yield* run(['init', '--yes', '--no-install', '--git', dir], []);
          yield* git(dir, 'add', '-A');
          yield* git(dir, 'commit', '-qm', 'init');

          const out: Array<string> = [];
          yield* run(['add', 'app', 'effect-api', '--cwd', dir], out);
          assert.notMatch(Arr.join(out, '\n'), /conflict/u);
          const pkg = yield* readText(dir, 'package.json');
          const catalog = Rec.keys(pkgIn(pkg).catalog);
          assert.include(catalog, 'effect');
          assert.deepStrictEqual(catalog, Arr.sort(catalog, Str.Order));
          yield* run(['sync', '--check', '--cwd', dir], []);

          // Upgraded and fresh repos are byte-identical.
          const fresh = yield* scratch();
          yield* run(
            [
              'init',
              '--yes',
              '--no-install',
              '--no-git',
              '--apps',
              'effect-api',
              fresh,
            ],
            [],
          );
          // Seeds are written once and never updated, so they may differ.
          const lock = yield* readLock(yield* makeRepo(fresh));
          const files = Arr.flatMap(
            Rec.toEntries(lock?.files ?? {}),
            ([file, entry]) => (entry.strategy === 'seed' ? [] : [file]),
          );
          assert.isAbove(files.length, 20);
          for (const file of files) {
            const target = path.join(fresh, file);
            assert.strictEqual(
              yield* readText(dir, file),
              yield* fs.readFileString(target),
              file,
            );
          }
        }),
      ),
    60_000,
  );

  it.effect(
    'edits a hand-written config in place, keeping comments and consts',
    () =>
      withBun(
        Effect.gen(function* () {
          const dir = yield* scratch();
          yield* writeText(dir, 'shoebox.config.ts', handWritten);
          yield* run(
            ['add', 'app', 'effect-cli', '--allow-dirty', '--cwd', dir],
            [],
          ).pipe(Effect.provideService(Generate, scriptGenerate('x', 'y')));
          const source = yield* readText(dir, 'shoebox.config.ts');
          assert.strictEqual(
            source,
            Str.replace(
              "      kind: 'effect-api', // the first one\n    },\n",
              "      kind: 'effect-api', // the first one\n    },\n    {\n      name: 'cli',\n      kind: 'effect-cli',\n    },\n",
            )(handWritten),
          );
          const config = yield* loadConfig(dir);
          assert.strictEqual(config.description, 'from a const');
          assert.deepStrictEqual(
            Arr.map(config.apps, (app) => app.name),
            ['api', 'cli'],
          );

          yield* run(
            ['add', 'package', 'core', '--allow-dirty', '--cwd', dir],
            [],
          ).pipe(Effect.provideService(Generate, scriptGenerate('x', 'y')));
          assert.include(
            yield* readText(dir, 'shoebox.config.ts'),
            "  packages: [\n    {\n      name: 'core',\n      kind: 'library',\n    },\n  ],",
          );
        }),
      ),
  );

  it.effect(
    'writes nothing and prints the entry when it cannot edit safely',
    () =>
      withBun(
        Effect.gen(function* () {
          const dir = yield* scratch();
          const computed = Str.replace(
            / {2}apps: \[[\s\S]*?\n {2}\],/u,
            '  apps: APPS,',
          )(
            Str.replace(
              'const DESC',
              "const APPS = [{ name: 'api', kind: 'effect-api' as const }];\nconst DESC",
            )(handWritten),
          );
          yield* writeText(dir, 'shoebox.config.ts', computed);
          const out: Array<string> = [];
          const error = yield* Effect.flip(
            run(
              ['add', 'app', 'effect-cli', '--allow-dirty', '--cwd', dir],
              out,
            ).pipe(Effect.provideService(Generate, scriptGenerate('x', 'y'))),
          );
          assert.strictEqual(error._tag, 'CommandFailed');
          assert.strictEqual(
            yield* readText(dir, 'shoebox.config.ts'),
            computed,
          );
          assert.include(
            Arr.join(out, '\n'),
            "{ name: 'cli', kind: 'effect-cli' },",
          );
        }),
      ),
  );
});

describe('migrate', () => {
  it.effect(
    'rebaselines tracked files it edits, so the next sync is clean',
    () =>
      withBun(
        Effect.gen(function* () {
          const dir = yield* scratch();
          const v1 = scriptGenerate('lint:oxlint', 'oxlint .');
          yield* run(
            ['init', '--yes', '--no-install', '--no-git', dir],
            [],
          ).pipe(Effect.provideService(Generate, v1));
          yield* run(
            ['migrate', '2026-10-28-lint-script-names', '--cwd', dir],
            [],
          );
          assert.include(
            yield* readText(dir, 'package.json'),
            '"oxlint:check": "oxlint ."',
          );

          // The next CLI version owns the renamed script with a new command.
          const v2 = scriptGenerate(
            'oxlint:check',
            'oxlint -c oxlint.config.ts .',
          );
          const out: Array<string> = [];
          yield* run(['sync', '--cwd', dir], out).pipe(
            Effect.provideService(Generate, v2),
          );
          assert.notMatch(Arr.join(out, '\n'), /conflict/u);
          assert.include(
            yield* readText(dir, 'package.json'),
            '"oxlint:check": "oxlint -c oxlint.config.ts ."',
          );
        }),
      ),
  );

  it.effect('keeps a hand-edited file a conflict after migrating it', () =>
    withBun(
      Effect.gen(function* () {
        const dir = yield* scratch();
        yield* run(['init', '--yes', '--no-install', '--no-git', dir], []).pipe(
          Effect.provideService(
            Generate,
            scriptGenerate('lint:oxlint', 'oxlint .'),
          ),
        );
        const pkg = yield* readText(dir, 'package.json');
        yield* writeText(
          dir,
          'package.json',
          Str.replace('"name": "my-repo"', '"name": "mine"')(pkg),
        );
        yield* run(
          ['migrate', '2026-10-28-lint-script-names', '--cwd', dir],
          [],
        );
        const out: Array<string> = [];
        const error = yield* Effect.flip(
          run(['sync', '--cwd', dir], out).pipe(
            Effect.provideService(
              Generate,
              scriptGenerate('oxlint:check', 'oxlint -c oxlint.config.ts .'),
            ),
          ),
        );
        assert.strictEqual(error._tag, 'CommandFailed');
        assert.match(Arr.join(out, '\n'), /conflict\s+package\.json/u);
      }),
    ),
  );

  it.effect('--dry-run diffs each migration against the previous one', () =>
    withBun(
      Effect.gen(function* () {
        const dir = yield* scratch();
        yield* writeText(
          dir,
          'package.json',
          json({
            name: 'r',
            scripts: { 'lint:oxlint': 'oxlint -c .oxlintrc.json .' },
          }),
        );
        yield* writeText(dir, '.oxlintrc.json', '{ "rules": {} }\n');
        const out: Array<string> = [];
        yield* run(['migrate', '--dry-run', '--cwd', dir], out);
        const text = Arr.join(out, '\n');
        // lint-script-names runs after oxlintrc-to-ts repointed the script.
        assert.include(
          text,
          '-    "lint:oxlint": "oxlint -c oxlint.config.ts ."',
        );
        assert.include(
          text,
          '+    "oxlint:check": "oxlint -c oxlint.config.ts ."',
        );
      }),
    ),
  );
});

describe('clean-tree check', () => {
  it.effect(
    'passes outside git and fails closed when git cannot report status',
    () =>
      withBun(
        Effect.gen(function* () {
          const dir = yield* scratch();
          yield* writeText(dir, 'a.txt', 'a\n');
          yield* ensureCleanTree(dir);
          yield* git(dir, 'init', '-q');
          yield* git(dir, 'add', '-A');
          yield* git(dir, 'commit', '-qm', 'init');
          yield* ensureCleanTree(dir);
          yield* writeText(dir, '.git/index', 'not an index');
          const error = yield* Effect.flip(ensureCleanTree(dir));
          assert.strictEqual(error._tag, 'DirtyTreeError');
          assert.include(error.message, 'Could not check');
        }),
      ),
  );
});
