import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Record as Rec, String as Str } from 'effect';

import {
  bunTest,
  bunVersion,
  catalog,
  copiedScripts,
  effectTsgo,
  gitHooks,
  jscpd,
  knip,
  monorepoLayout,
  nixDevShell,
  scriptNames,
  shoemakerVersions,
  turboFixUncached,
  turboJsonc,
  turboTaskCommands,
  typescript7,
  vscode,
} from '../../src/doctor/tooling.ts';
import { cliVersion } from '../../src/engine/meta.ts';
import { failures, jsonFiles } from './helpers.ts';

const rootWith = (extra: Record<string, unknown>) => ({
  name: 'demo',
  type: 'module',
  packageManager: 'bun@1.4.4',
  devEngines: { packageManager: { name: 'bun', version: '1.4.4' } },
  workspaces: { packages: ['apps/*', 'packages/*'] },
  ...extra,
});

// A repo holding only the root package.json `rootWith(extra)`.
const rootOnly = (extra: Record<string, unknown>) =>
  jsonFiles({ 'package.json': rootWith(extra) });

describe('tooling doctor checks', () => {
  it.effect('shoemaker-versions: a range below this CLI fails', () =>
    Effect.gen(function* () {
      const files = yield* jsonFiles({
        'package.json': rootWith({
          workspaces: {
            packages: ['apps/*'],
            catalog: { 'shoemaker-oxlint-config': '^0.0.1' },
          },
        }),
        'apps/web/package.json': {
          name: '@demo/web',
          devDependencies: {
            'shoemaker-oxlint-config': 'catalog:',
            'shoemaker-knip-config': '0.0.1',
          },
        },
      });
      const found = yield* failures(shoemakerVersions, files);
      assert.deepStrictEqual(
        Arr.map(found, (f) => [f.message, f.path]),
        [
          [
            `shoemaker-oxlint-config@^0.0.1 excludes shoemaker ${cliVersion}`,
            'package.json (catalog)',
          ],
          [
            `shoemaker-knip-config@0.0.1 excludes shoemaker ${cliVersion}`,
            'apps/web/package.json',
          ],
        ],
      );
      const pinned = yield* rootOnly({
        workspaces: {
          packages: [],
          catalog: { 'shoemaker-oxlint-config': `^${cliVersion}` },
        },
      });
      const pinnedVersionFailures = yield* failures(shoemakerVersions, pinned);
      assert.lengthOf(pinnedVersionFailures, 0);
    }),
  );

  it.effect('turbo-jsonc: turbo.json anywhere fails', () =>
    Effect.gen(function* () {
      const found = yield* failures(turboJsonc, {
        'turbo.jsonc': '{}',
        'apps/api/turbo.json': '{}',
      });
      assert.deepStrictEqual(
        Arr.map(found, (f) => f.fix),
        ['rename it to turbo.jsonc'],
      );
      const rootTurboFailures = yield* failures(turboJsonc, {
        'turbo.jsonc': '{}',
      });
      assert.lengthOf(rootTurboFailures, 0);
      const nxOnlyFailures = yield* failures(turboJsonc, { 'nx.json': '{}' });
      assert.lengthOf(nxOnlyFailures, 0);
    }),
  );

  it.effect(
    'turbo-task-commands: copies of a command, scripts in every package',
    () =>
      Effect.gen(function* () {
        const pkg = (name: string, scripts: Record<string, string>) => ({
          name,
          scripts,
        });
        const copied = yield* jsonFiles({
          'package.json': rootWith({ scripts: { typecheck: 'tsc --noEmit' } }),
          'apps/web/package.json': pkg('@demo/web', {
            typecheck: 'tsc  --noEmit',
          }),
          'apps/api/package.json': pkg('@demo/api', {
            typecheck: 'tsc --noEmit -p tsconfig.app.json',
          }),
        });
        const copies = yield* failures(turboTaskCommands, {
          ...copied,
          'turbo.jsonc':
            '{\n  // shared\n  "tasks": { "typecheck": { "command": ["bun", "run", "tsc", "--noEmit"] } },\n}\n',
        });
        assert.deepStrictEqual(
          Arr.map(copies, (f) => f.fix),
          ['delete the copies so the shared turbo.jsonc command applies'],
        );
        const [copy] = copies;
        assert.include(copy?.message, 'apps/web/package.json#typecheck');
        assert.notInclude(copy?.message, 'apps/api');

        const packages = yield* jsonFiles({
          'package.json': rootWith({}),
          'apps/web/package.json': pkg('@demo/web', {
            'oxlint:check': 'oxlint .',
            prepack: 'bun pack.ts',
            build: 'vite build',
          }),
          'apps/api/package.json': pkg('@demo/api', {
            'oxlint:check': 'oxlint .',
            prepack: 'bun pack.ts',
            build: 'tsdown',
          }),
        });
        const everywhere = yield* failures(turboTaskCommands, {
          'turbo.jsonc': '{ "tasks": {} }',
          ...packages,
        });
        assert.lengthOf(everywhere, 1);
        const [shared] = everywhere;
        assert.include(shared?.message, 'oxlint:check');
        assert.notInclude(shared?.message, 'prepack');
        assert.notInclude(shared?.message, 'build');
        // nx runs package scripts, so the copies are how it works there.
        const turboCommandFailures = yield* failures(turboTaskCommands, {
          'nx.json': '{}',
          ...packages,
        });
        assert.lengthOf(turboCommandFailures, 0);
      }),
  );

  it.effect('script-names: lint:* and fmt:* drift', () =>
    Effect.gen(function* () {
      const files = yield* rootOnly({
        scripts: {
          'lint:oxlint': 'oxlint --fix .',
          'fmt:check': 'oxfmt --check',
          lint: 'turbo run lint',
          'oxlint:check': 'oxlint .',
        },
      });
      const found = yield* failures(scriptNames, files);
      assert.include(
        found[0]?.message ?? '',
        'lint:oxlint -> oxlint:fix, fmt:check -> oxfmt:check',
      );
      assert.strictEqual(
        found[0]?.fix,
        'rename them to <tool>:check / <tool>:fix',
      );
    }),
  );

  it.effect('no-bun-test', () =>
    Effect.gen(function* () {
      const bunScript = yield* rootOnly({ scripts: { test: 'bun test' } });
      const bunTestScriptFailures = yield* failures(bunTest, bunScript);
      assert.lengthOf(bunTestScriptFailures, 1);
      const vitestScript = yield* rootOnly({ scripts: { test: 'vitest run' } });
      const vitestScriptFailures = yield* failures(bunTest, vitestScript);
      assert.lengthOf(vitestScriptFailures, 0);
    }),
  );

  it.effect('effect-tsgo-prepare', () =>
    Effect.gen(function* () {
      const ok = yield* rootOnly({
        scripts: { prepare: 'effect-tsgo patch --oxlint' },
        devDependencies: { '@effect/tsgo': 'catalog:' },
      });
      const okTsgoFailures = yield* failures(effectTsgo, ok);
      assert.lengthOf(okTsgoFailures, 0);
      const noOxlint = yield* rootOnly({
        scripts: { prepare: 'effect-tsgo patch' },
        devDependencies: { '@effect/tsgo': 'catalog:' },
      });
      assert.include(
        (yield* failures(effectTsgo, noOxlint))[0]?.message ?? '',
        '"effect-tsgo patch"',
      );
      const ls = yield* rootOnly({
        devDependencies: { '@effect/language-service': '^0.1.0' },
      });
      assert.include(
        (yield* failures(effectTsgo, ls))[0]?.message ?? '',
        'without @effect/tsgo',
      );
    }),
  );

  it.effect('typescript-7: tsgo scripts, native-preview, old typescript', () =>
    Effect.gen(function* () {
      const files = yield* rootOnly({
        scripts: { typecheck: 'tsgo --noEmit', prepare: 'effect-tsgo patch' },
        devDependencies: {
          '@typescript/native-preview': '7.0.0-dev',
          typescript: 'catalog:',
        },
        workspaces: { packages: [], catalog: { typescript: '~5.9.3' } },
      });
      const found = yield* failures(typescript7, files);
      assert.deepStrictEqual(
        Arr.map(found, (f) => f.fix),
        [
          'run tsc (TypeScript 7) instead of tsgo',
          'replace it with typescript ^7',
          'bump typescript to ^7',
        ],
      );
      assert.include(found[2]?.message ?? '', '~5.9.3');
      const current = yield* rootOnly({
        scripts: { typecheck: 'tsc --noEmit' },
        devDependencies: { typescript: '^7.0.2' },
      });
      const typescript7Failures = yield* failures(typescript7, current);
      assert.lengthOf(typescript7Failures, 0);
    }),
  );

  it.effect('bun-version: packageManager, flake pin, Dockerfile', () =>
    Effect.gen(function* () {
      const root = yield* rootOnly({});
      const bunVersionFailures = yield* failures(bunVersion, root);
      assert.lengthOf(bunVersionFailures, 0);
      const oldBun = yield* rootOnly({ packageManager: 'bun@1.3.5' });
      const found = yield* failures(bunVersion, {
        ...oldBun,
        'flake.nix':
          'url = "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip";',
        'apps/api/Dockerfile': 'FROM oven/bun:1.3.5\n',
      });
      assert.deepStrictEqual(
        Arr.map(found, (f) => f.path),
        ['package.json', 'flake.nix'],
      );
    }),
  );

  it.effect('bun-version: devEngines.packageManager is required', () =>
    Effect.gen(function* () {
      const files = yield* jsonFiles({
        'package.json': Rec.remove(rootWith({}), 'devEngines'),
      });
      const found = yield* failures(bunVersion, files);
      assert.deepStrictEqual(
        Arr.map(found, (f) => f.message),
        ['devEngines.packageManager is not bun 1.4.4'],
      );
    }),
  );

  it.effect('turbo-fix-uncached: every fix task sets cache: false', () =>
    Effect.gen(function* () {
      const files = yield* jsonFiles({
        'turbo.jsonc': {
          tasks: {
            'oxlint:fix': {},
            '//#oxfmt:fix': { cache: false },
            '//#knip:fix:danger': { cache: true },
            'oxlint:check': {},
            prefix: {},
          },
        },
        'apps/web/turbo.jsonc': { tasks: { 'lint:fix': {} } },
        // Opted out: the package runs nothing for this task.
        'packages/config/turbo.jsonc': {
          tasks: { 'oxlint:fix': { command: null } },
        },
      });
      const found = yield* failures(turboFixUncached, files);
      assert.lengthOf(found, 1);
      for (const task of [
        'turbo.jsonc#oxlint:fix',
        'turbo.jsonc#//#knip:fix:danger',
        'apps/web/turbo.jsonc#lint:fix',
      ]) {
        assert.include(found[0]?.message, task);
      }
      assert.notInclude(found[0]?.message, 'oxfmt');
      assert.notInclude(found[0]?.message, 'packages/config');
    }),
  );

  it.effect('nix-dev-shell: flake.lock, .envrc, copied description', () =>
    Effect.gen(function* () {
      const portfolio = yield* rootOnly({ name: 'portfolio' });
      const found = yield* failures(nixDevShell, {
        ...portfolio,
        'flake.nix':
          '{ description = "Elden Ring Compass development environment"; }',
      });
      assert.deepStrictEqual(
        Arr.map(found, (f) =>
          f.fix === undefined ? undefined : Str.slice(0, 12)(f.fix),
        ),
        ['run `nix fla', 'add `use fla', 'update the f'],
      );
      const nixShellFailures = yield* failures(nixDevShell, {
        'flake.nix': '{ description = "Expo RN devshells"; }',
        'flake.lock': '{}',
        '.envrc': 'use flake\n',
      });
      assert.lengthOf(nixShellFailures, 0);
    }),
  );

  it.effect('jscpd and knip', () =>
    Effect.gen(function* () {
      const jscpdFiles = yield* jsonFiles({
        '.jscpd.json': { threshold: 0, minTokens: 40, minLines: 33 },
        'package.json': rootWith({ scripts: { 'jscpd:check': 'jscpd' } }),
      });
      const jscpdFound = yield* failures(jscpd, jscpdFiles);
      assert.include(jscpdFound[0]?.message ?? '', 'minTokens 40 (want 50)');
      const knipScript = yield* rootOnly({ scripts: { 'knip:check': 'knip' } });
      const knipFound = yield* failures(knip, {
        'knip.json': '{}',
        ...knipScript,
      });
      assert.lengthOf(knipFound, 2);
      const knipFlags = yield* rootOnly({
        scripts: { 'knip:check': 'knip --no-config-hints --cache' },
      });
      const knipFailures = yield* failures(knip, {
        'knip.ts': '',
        ...knipFlags,
      });
      assert.lengthOf(knipFailures, 0);
    }),
  );

  it.effect('catalog: summarises the catalog check', () =>
    Effect.gen(function* () {
      const files = yield* rootOnly({ devDependencies: { effect: '4.0.6' } });
      const found = yield* failures(catalog, files);
      assert.include(
        found[0]?.message ?? '',
        '1 dep(s) missing from the catalog',
      );
    }),
  );

  it.effect('copied-scripts', () =>
    Effect.gen(function* () {
      const found = yield* failures(copiedScripts, {
        'scripts/catalog-check.ts': '',
        'scripts/lint/effect-versions-check.ts': '',
      });
      assert.include(found[0]?.fix ?? '', 'shoemaker check catalog');
      assert.include(
        found[1]?.message ?? '',
        'shoemaker check effect-versions',
      );
    }),
  );

  it.effect('monorepo-layout: workspaces, scope, root deps', () =>
    Effect.gen(function* () {
      const single = yield* jsonFiles({ 'package.json': { name: 'x' } });
      assert.include(
        (yield* failures(monorepoLayout, single))[0]?.message ?? '',
        'not a monorepo',
      );
      const files = yield* jsonFiles({
        'package.json': rootWith({
          devDependencies: {
            '@repo/db': 'workspace:*',
            '@repo/typescript-config': 'workspace:*',
          },
        }),
        'packages/db/package.json': { name: '@repo/db' },
        'packages/typescript-config/package.json': {
          name: '@repo/typescript-config',
        },
      });
      const found = yield* failures(monorepoLayout, files);
      assert.deepStrictEqual(
        Arr.map(found, (f) => f.message),
        [
          'packages use the @repo/* scope',
          'root depends on internal packages: @repo/db',
        ],
      );
    }),
  );

  it.effect('no-git-hooks and vscode', () =>
    Effect.gen(function* () {
      const husky = yield* rootOnly({ devDependencies: { husky: '^9' } });
      const huskyFailures = yield* failures(gitHooks, {
        ...husky,
        '.husky/pre-commit': '',
      });
      assert.lengthOf(huskyFailures, 1);
      const vscodeFormatterFailures = yield* failures(vscode, {
        '.vscode/settings.json':
          '{ "editor.defaultFormatter": "oxc.oxc-vscode" }',
      });
      assert.lengthOf(vscodeFormatterFailures, 0);
      const emptyVscodeFailures = yield* failures(vscode, {});
      assert.lengthOf(emptyVscodeFailures, 1);
    }),
  );
});
