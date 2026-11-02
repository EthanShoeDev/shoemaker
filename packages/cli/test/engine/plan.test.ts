import { assert, describe, it } from '@effect/vitest';
import {
  Array as Arr,
  Effect,
  Option,
  Record as Rec,
  String as Str,
} from 'effect';

import type { Lock } from '../../src/engine/lock.ts';
import {
  type Action,
  fingerprint,
  lockEntry,
  makePlan,
  nextLock,
  ownedSet,
  type Plan,
} from '../../src/engine/plan.ts';
import { makeMemoryRepo } from '../../src/engine/repo-memory.ts';
import type { FileStrategy, GeneratedFile } from '../../src/engine/types.ts';
import { region } from '../../src/generators/shared.ts';

const file = (
  path: string,
  content: string,
  strategy: FileStrategy = 'owned',
): GeneratedFile => ({ path, content, strategy });

const lockOf = (
  entries: ReadonlyArray<readonly [GeneratedFile, string]>,
): Lock => ({
  cliVersion: '0.0.0',
  files: Rec.fromEntries(
    Arr.map(
      entries,
      ([generated, written]) =>
        [generated.path, lockEntry(generated, written)] as const,
    ),
  ),
});

const actions = (plan: Plan) =>
  Rec.fromEntries(Arr.map(plan.files, (f) => [f.path, f.action] as const));

const actionOf = (plan: Plan, path: string): Action | undefined =>
  Option.getOrUndefined(Arr.findFirst(plan.files, (f) => f.path === path))
    ?.action;

describe('plan', () => {
  it.effect('classifies all six states', () =>
    Effect.gen(function* () {
      const files = [
        file('new.txt', 'new\n'),
        file('same.txt', 'same\n'),
        file('safe.txt', 'v2\n'),
        file('edited.txt', 'v2\n'),
        file('adopted.txt', 'v2\n'),
        file('README.md', '# seed\n', 'seed'),
      ];
      const repo = makeMemoryRepo({
        'same.txt': 'same\n',
        'safe.txt': 'v1\n',
        'edited.txt': 'v1 plus a hand edit\n',
        'adopted.txt': 'theirs\n',
        'README.md': '# my readme\n',
      });
      const lock = lockOf([
        [file('same.txt', 'same\n'), 'same\n'],
        [file('safe.txt', 'v1\n'), 'v1\n'],
        [file('edited.txt', 'v1\n'), 'v1\n'],
      ]);
      const plan = yield* makePlan(repo, files, lock);
      assert.deepStrictEqual(actions(plan), {
        'new.txt': 'create',
        'same.txt': 'unchanged',
        'safe.txt': 'update',
        'edited.txt': 'conflict',
        'adopted.txt': 'untracked',
        'README.md': 'skip',
      });
    }),
  );

  it.effect('--force globs take the generated version for blocked files', () =>
    Effect.gen(function* () {
      const files = [file('a/x.txt', 'gen\n'), file('b/y.txt', 'gen\n')];
      const repo = makeMemoryRepo({ 'a/x.txt': 'mine\n', 'b/y.txt': 'mine\n' });
      const plan = yield* makePlan(repo, files, undefined, { force: ['a/**'] });
      const forced = Option.getOrUndefined(
        Arr.findFirst(plan.files, (f) => f.path === 'a/x.txt'),
      );
      assert.strictEqual(forced?.action, 'update');
      assert.strictEqual(forced?.forced, true);
      assert.strictEqual(actionOf(plan, 'b/y.txt'), 'untracked');
    }),
  );

  it.effect(
    'never drops a list entry from a json-merge file it has no baseline for',
    () =>
      Effect.gen(function* () {
        const manifest = (workspaces: ReadonlyArray<string>) =>
          file('package.json', JSON.stringify({ workspaces }), 'json-merge');
        const generated = manifest(['apps/*', 'packages/*']);
        const text = (workspaces: ReadonlyArray<string>) =>
          `${JSON.stringify({ name: 'x', workspaces })}\n`;
        const disk = (workspaces: ReadonlyArray<string>) =>
          makeMemoryRepo({ 'package.json': text(workspaces) });
        const extended = ['apps/*', 'packages/*', 'tools/*'];
        const force = { force: ['**'] };

        const adopted = yield* makePlan(
          disk(extended),
          [generated],
          undefined,
          force,
        );
        const clash = adopted.files[0];
        assert.strictEqual(clash?.action, 'conflict');
        assert.include(clash?.reason, '/workspaces: "tools/*"');
        assert.isUndefined(clash?.forced);

        // Adding entries drops nothing, so --force applies.
        const grown = yield* makePlan(
          disk(['apps/*']),
          [generated],
          undefined,
          force,
        );
        assert.strictEqual(actionOf(grown, 'package.json'), 'update');

        // Owned files are shoemaker's whole: --force still replaces them.
        const turbo = file('turbo.jsonc', '{ "globalEnv": ["CI"] }\n');
        const owned = yield* makePlan(
          makeMemoryRepo({ 'turbo.jsonc': '{ "globalEnv": ["CI", "TZ"] }\n' }),
          [turbo],
          undefined,
          force,
        );
        assert.strictEqual(actionOf(owned, 'turbo.jsonc'), 'update');

        // With a baseline the list is shoemaker's own, so it may shorten it.
        const tracked = yield* makePlan(
          disk(extended),
          [generated],
          lockOf([[manifest(extended), text(extended)]]),
        );
        assert.strictEqual(actionOf(tracked, 'package.json'), 'update');
      }),
  );

  it.effect('formats TypeScript before comparing', () =>
    Effect.gen(function* () {
      const repo = makeMemoryRepo({ 'a.ts': 'export const a = { b: 1 };\n' });
      const plan = yield* makePlan(
        repo,
        [file('a.ts', 'export const a = {b:1}')],
        undefined,
      );
      assert.strictEqual(actionOf(plan, 'a.ts'), 'unchanged');
    }),
  );

  describe('managed', () => {
    const generated = (body: string) =>
      file(
        'AGENTS.md',
        `# Agents\n\n${region('rules', body, '<!--')}\n`,
        'managed',
      );
    const onDisk = (body: string) =>
      `# My agents\n\nuser notes\n\n${region('rules', body, '<!--')}\n\nmore notes\n`;

    it.effect('ignores edits outside regions', () =>
      Effect.gen(function* () {
        const repo = makeMemoryRepo({ 'AGENTS.md': onDisk('v1') });
        const lock = lockOf([[generated('v1'), onDisk('v1')]]);
        const plan = yield* makePlan(repo, [generated('v1')], lock);
        assert.strictEqual(actionOf(plan, 'AGENTS.md'), 'unchanged');
      }),
    );

    it.effect('updates region bodies when they match the baseline', () =>
      Effect.gen(function* () {
        const repo = makeMemoryRepo({ 'AGENTS.md': onDisk('v1') });
        const lock = lockOf([[generated('v1'), onDisk('v1')]]);
        const plan = yield* makePlan(repo, [generated('v2')], lock);
        const planned = plan.files[0];
        assert.strictEqual(planned?.action, 'update');
        assert.strictEqual(planned?.after, onDisk('v2'));
      }),
    );

    it.effect('conflicts on a hand-edited region body', () =>
      Effect.gen(function* () {
        const repo = makeMemoryRepo({ 'AGENTS.md': onDisk('v1 edited') });
        const lock = lockOf([[generated('v1'), onDisk('v1')]]);
        const plan = yield* makePlan(repo, [generated('v2')], lock);
        assert.strictEqual(actionOf(plan, 'AGENTS.md'), 'conflict');
      }),
    );

    it.effect('conflicts when a region is missing on disk', () =>
      Effect.gen(function* () {
        const repo = makeMemoryRepo({ 'AGENTS.md': '# no regions\n' });
        const lock = lockOf([[generated('v1'), onDisk('v1')]]);
        const plan = yield* makePlan(repo, [generated('v1')], lock);
        const planned = plan.files[0];
        assert.strictEqual(planned?.action, 'conflict');
        assert.include(planned?.reason ?? '', 'rules');
      }),
    );
  });

  describe('json-merge', () => {
    const owned = (version: string) =>
      file(
        'config.json',
        JSON.stringify({ name: 'x', scripts: { build: version } }),
        'json-merge',
      );
    const disk = (build: string, extra = '') =>
      `{\n  "name": "x",\n  "scripts": {\n    "build": "${build}"${extra}\n  }\n}\n`;

    it.effect('keeps user keys and counts them as unchanged', () =>
      Effect.gen(function* () {
        const repo = makeMemoryRepo({
          'config.json': disk('tsdown', ',\n    "mine": "echo"'),
        });
        const lock = lockOf([[owned('tsdown'), disk('tsdown')]]);
        const plan = yield* makePlan(repo, [owned('tsdown')], lock);
        assert.strictEqual(actionOf(plan, 'config.json'), 'unchanged');
      }),
    );

    it.effect('updates owned keys and preserves user keys', () =>
      Effect.gen(function* () {
        const repo = makeMemoryRepo({
          'config.json': disk('tsdown', ',\n    "mine": "echo"'),
        });
        const lock = lockOf([[owned('tsdown'), disk('tsdown')]]);
        const plan = yield* makePlan(repo, [owned('tsdown --watch')], lock);
        const planned = plan.files[0];
        assert.strictEqual(planned?.action, 'update');
        assert.strictEqual(
          planned?.after,
          disk('tsdown --watch', ',\n    "mine": "echo"'),
        );
      }),
    );

    const manifest = (build: string) =>
      file(
        'package.json',
        JSON.stringify({
          name: 'x',
          version: '0.0.0',
          scripts: { build },
          dependencies: { a: '^1.0.0' },
        }),
        'json-merge',
      );
    const manifestOnDisk = (version: string, build: string) =>
      `{\n  "name": "x",\n  "version": "${version}",\n  "scripts": {\n    "build": "${build}"\n  },\n  "dependencies": {\n    "a": "^1.0.0"\n  }\n}\n`;

    it.effect('keeps a package version changesets raised', () =>
      Effect.gen(function* () {
        const repo = makeMemoryRepo({
          'package.json': manifestOnDisk('0.2.0', 'tsdown'),
        });
        const lock = lockOf([
          [manifest('tsdown'), manifestOnDisk('0.0.0', 'tsdown')],
        ]);
        const same = yield* makePlan(repo, [manifest('tsdown')], lock);
        assert.strictEqual(actionOf(same, 'package.json'), 'unchanged');
        const plan = yield* makePlan(repo, [manifest('tsdown -w')], lock);
        assert.strictEqual(plan.files[0]?.action, 'update');
        assert.strictEqual(
          plan.files[0]?.after,
          manifestOnDisk('0.2.0', 'tsdown -w'),
        );
      }),
    );

    it.effect('accepts locks that hashed the package version exactly', () =>
      Effect.gen(function* () {
        const written = manifestOnDisk('0.0.0', 'tsdown');
        const owned = ownedSet(manifest('tsdown')) ?? [];
        const repo = makeMemoryRepo({ 'package.json': written });
        const lock: Lock = {
          cliVersion: '0.0.0',
          files: {
            'package.json': {
              strategy: 'json-merge',
              sha256: fingerprint(
                'json-merge',
                'package.json',
                written,
                { owned },
                'dependencies',
              ),
              owned,
            },
          },
        };
        const plan = yield* makePlan(repo, [manifest('tsdown -w')], lock);
        assert.strictEqual(actionOf(plan, 'package.json'), 'update');
      }),
    );

    it.effect('conflicts when an owned value was hand-edited', () =>
      Effect.gen(function* () {
        const repo = makeMemoryRepo({ 'config.json': disk('custom build') });
        const lock = lockOf([[owned('tsdown'), disk('tsdown')]]);
        const plan = yield* makePlan(repo, [owned('tsdown --watch')], lock);
        assert.strictEqual(actionOf(plan, 'config.json'), 'conflict');
      }),
    );
  });

  it.effect(
    'next lock refreshes written files and keeps blocked baselines',
    () =>
      Effect.gen(function* () {
        const files = [file('a.txt', 'a\n'), file('b.txt', 'b2\n')];
        const repo = makeMemoryRepo({ 'b.txt': 'edited\n', 'gone.txt': 'x' });
        const previous = lockOf([
          [file('b.txt', 'b1\n'), 'b1\n'],
          [file('gone.txt', 'x'), 'x'],
        ]);
        const plan = yield* makePlan(repo, files, previous);
        assert.deepStrictEqual(plan.orphans, ['gone.txt']);
        const next = nextLock(previous, plan, '9.9.9');
        assert.strictEqual(next.cliVersion, '9.9.9');
        assert.deepStrictEqual(Arr.sort(Rec.keys(next.files), Str.Order), [
          'a.txt',
          'b.txt',
        ]);
        assert.deepStrictEqual(next.files['b.txt'], previous.files['b.txt']);
      }),
  );
});
