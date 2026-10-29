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
import type { ShoemakerConfig } from '../../src/config/schema.ts';
import { readLock } from '../../src/engine/lock.ts';
import { makeRepo } from '../../src/engine/repo-live.ts';
import { Generate } from '../../src/engine/sync.ts';
import type { GeneratedFile } from '../../src/engine/types.ts';
import { region } from '../../src/generators/shared.ts';
import { run, scratch, withBun } from './helpers.ts';

// Stands in for the real generators so these tests exercise the commands and
// engine, not generator output.
const fakeGenerate = (config: ShoemakerConfig) => ({
  files: [
    {
      path: 'package.json',
      strategy: 'json-merge',
      content: JSON.stringify({ name: config.name, private: true }),
    },
    { path: 'README.md', strategy: 'seed', content: `# ${config.name}\n` },
    {
      path: 'AGENTS.md',
      strategy: 'managed',
      content: `# Agents\n\n${region(
        'rules',
        `apps: ${Arr.join(
          Arr.map(config.apps, (a) => a.name),
          ',',
        )}`,
        '<!--',
      )}\n`,
    },
    {
      path: 'src/index.ts',
      strategy: 'owned',
      content: `export const name = "${config.name}"`,
    },
    {
      path: 'scripts/hello.sh',
      strategy: 'owned',
      content: '#!/bin/sh\necho hi\n',
      executable: true,
    },
  ] satisfies ReadonlyArray<GeneratedFile>,
  aggregate: {
    tasks: [],
    env: [],
    catalog: [],
    nixPackages: [],
    gitignore: [],
    ignore: [],
  },
});

const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  withBun(effect.pipe(Effect.provideService(Generate, fakeGenerate)));

describe('init + sync', () => {
  it.effect('init --yes scaffolds, then sync is a no-op', () =>
    provide(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* scratch();
        const out: Array<string> = [];

        yield* run(
          [
            'init',
            '--yes',
            '--no-git',
            '--apps',
            'effect-api,effect-api:worker',
            dir,
          ],
          out,
        );
        const config = yield* loadConfig(dir);
        assert.strictEqual(config.name, 'my-repo');
        assert.strictEqual(config.scope, 'my-repo');
        assert.strictEqual(config.taskRunner, 'turbo');
        assert.deepStrictEqual(config.apps, [
          { kind: 'effect-api', name: 'api' },
          { kind: 'effect-api', name: 'worker' },
        ]);
        assert.strictEqual(
          yield* fs.readFileString(path.join(dir, 'src/index.ts')),
          "export const name = 'my-repo';\n",
        );
        const mode = (yield* fs.stat(path.join(dir, 'scripts/hello.sh'))).mode;
        assert.strictEqual((mode % 0o1000).toString(8), '755');
        const lock = yield* readLock(yield* makeRepo(dir));
        assert.deepStrictEqual(
          Arr.sort(Rec.keys(lock?.files ?? {}), Str.Order),
          [
            'AGENTS.md',
            'README.md',
            'package.json',
            'scripts/hello.sh',
            'src/index.ts',
          ],
        );

        const sync: Array<string> = [];
        yield* run(['sync', '--dry-run', '--cwd', dir], sync);
        assert.include(Arr.join(sync, '\n'), '4 unchanged, 1 skip');
        assert.notInclude(Arr.join(sync, '\n'), 'create');
      }),
    ),
  );

  it.effect('adds alchemy providers and leaves installing to the user', () =>
    provide(
      Effect.gen(function* () {
        const dir = yield* scratch();
        const out: Array<string> = [];
        yield* run(
          [
            'init',
            '--yes',
            '--no-git',
            '--infra',
            'alchemy:none',
            '--alchemy-providers',
            'github',
            dir,
          ],
          out,
        );
        const config = yield* loadConfig(dir);
        assert.deepStrictEqual(config.infra, {
          kind: 'alchemy',
          deploy: 'none',
          state: 'local',
          providers: ['github'],
        });
        assert.include(Arr.join(out, '\n'), '  bun install');

        const error = yield* Effect.flip(
          run(
            [
              'init',
              '--yes',
              '--alchemy-providers',
              'github',
              yield* scratch(),
            ],
            [],
          ),
        );
        assert.strictEqual(error._tag, 'CommandFailed');
      }),
    ),
  );

  it.effect('serves the API from the site unless told not to', () =>
    provide(
      Effect.gen(function* () {
        const apps = ['--apps', 'tanstack-start,effect-api'];
        const served = yield* scratch();
        yield* run(['init', '--yes', '--no-git', ...apps, served], []);
        assert.deepStrictEqual((yield* loadConfig(served)).apps, [
          { kind: 'tanstack-start', name: 'web', api: 'api' },
          { kind: 'effect-api', name: 'api' },
        ]);

        const apart = yield* scratch();
        yield* run(
          ['init', '--yes', '--no-git', '--no-serve-api', ...apps, apart],
          [],
        );
        assert.deepStrictEqual((yield* loadConfig(apart)).apps, [
          { kind: 'tanstack-start', name: 'web' },
          { kind: 'effect-api', name: 'api' },
        ]);
      }),
    ),
  );

  it.effect('refuses a non-empty directory without --force', () =>
    provide(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* scratch();
        yield* fs.makeDirectory(dir, { recursive: true });
        yield* fs.writeFileString(path.join(dir, 'existing.txt'), 'x');
        const error = yield* Effect.flip(
          run(['init', '--yes', '--no-git', dir], []),
        );
        assert.strictEqual(error._tag, 'CommandFailed');
      }),
    ),
  );

  it.effect(
    'sync reports a hand-edited owned file as a conflict and exits non-zero',
    () =>
      provide(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* scratch();
          yield* run(['init', '--yes', '--no-git', dir], []);
          const target = path.join(dir, 'src/index.ts');
          yield* fs.writeFileString(
            target,
            "export const name = 'hand edited';\n",
          );

          const out: Array<string> = [];
          const error = yield* Effect.flip(
            run(['sync', '--allow-dirty', '--cwd', dir], out),
          );
          assert.strictEqual(error._tag, 'CommandFailed');
          assert.match(Arr.join(out, '\n'), /conflict\s+src\/index\.ts/u);
          // The conflict is left alone.
          assert.strictEqual(
            yield* fs.readFileString(target),
            "export const name = 'hand edited';\n",
          );

          yield* run(
            ['sync', '--allow-dirty', '--force', 'src/**', '--cwd', dir],
            [],
          );
          assert.strictEqual(
            yield* fs.readFileString(target),
            "export const name = 'my-repo';\n",
          );
        }),
      ),
  );

  it.effect('add app updates the config and syncs managed regions', () =>
    provide(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* scratch();
        yield* run(['init', '--yes', '--no-git', dir], []);
        const agents = path.join(dir, 'AGENTS.md');
        const original = yield* fs.readFileString(agents);
        yield* fs.writeFileString(agents, `${original}\n## My notes\n`);

        yield* run(
          ['add', 'app', 'effect-cli', '--allow-dirty', '--cwd', dir],
          [],
        );
        const config = yield* loadConfig(dir);
        assert.deepStrictEqual(config.apps, [
          { kind: 'effect-cli', name: 'cli' },
        ]);
        const updated = yield* fs.readFileString(agents);
        assert.include(updated, 'apps: cli');
        assert.include(updated, '## My notes');
      }),
    ),
  );
});
