import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, String as Str } from 'effect';

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
  turboJsonc,
  typescript7,
  vscode,
} from '../../src/doctor/tooling.ts';
import { MigrationId } from '../../src/migrations/ids.ts';
import { failures, json } from './helpers.ts';

const rootWith = (extra: Record<string, unknown>) =>
  json({
    name: 'demo',
    type: 'module',
    packageManager: 'bun@1.4.4',
    workspaces: { packages: ['apps/*', 'packages/*'] },
    ...extra,
  });

describe('tooling doctor checks', () => {
  it.effect('turbo-jsonc: turbo.json anywhere fails', () =>
    Effect.gen(function* () {
      const found = yield* failures(turboJsonc, {
        'turbo.jsonc': '{}',
        'apps/api/turbo.json': '{}',
      });
      assert.deepStrictEqual(
        Arr.map(found, (f) => f.migration),
        [MigrationId.turboJsonToJsonc],
      );
      assert.lengthOf(yield* failures(turboJsonc, { 'turbo.jsonc': '{}' }), 0);
      assert.lengthOf(yield* failures(turboJsonc, { 'nx.json': '{}' }), 0);
    }),
  );

  it.effect('script-names: lint:* and fmt:* drift', () =>
    Effect.gen(function* () {
      const found = yield* failures(scriptNames, {
        'package.json': rootWith({
          scripts: {
            'lint:oxlint': 'oxlint --fix .',
            'fmt:check': 'oxfmt --check',
            lint: 'turbo run lint',
            'oxlint:check': 'oxlint .',
          },
        }),
      });
      assert.include(
        found[0]?.message ?? '',
        'lint:oxlint -> oxlint:fix, fmt:check -> oxfmt:check',
      );
      assert.strictEqual(found[0]?.migration, MigrationId.lintScriptNames);
    }),
  );

  it.effect('no-bun-test', () =>
    Effect.gen(function* () {
      assert.lengthOf(
        yield* failures(bunTest, {
          'package.json': rootWith({ scripts: { test: 'bun test' } }),
        }),
        1,
      );
      assert.lengthOf(
        yield* failures(bunTest, {
          'package.json': rootWith({ scripts: { test: 'vitest run' } }),
        }),
        0,
      );
    }),
  );

  it.effect('effect-tsgo-prepare', () =>
    Effect.gen(function* () {
      const ok = rootWith({
        scripts: { prepare: 'effect-tsgo patch --oxlint' },
        devDependencies: { '@effect/tsgo': 'catalog:' },
      });
      assert.lengthOf(yield* failures(effectTsgo, { 'package.json': ok }), 0);
      const noOxlint = rootWith({
        scripts: { prepare: 'effect-tsgo patch' },
        devDependencies: { '@effect/tsgo': 'catalog:' },
      });
      assert.include(
        (yield* failures(effectTsgo, { 'package.json': noOxlint }))[0]
          ?.message ?? '',
        '"effect-tsgo patch"',
      );
      const ls = rootWith({
        devDependencies: { '@effect/language-service': '^0.1.0' },
      });
      assert.include(
        (yield* failures(effectTsgo, { 'package.json': ls }))[0]?.message ?? '',
        'without @effect/tsgo',
      );
    }),
  );

  it.effect('typescript-7: tsgo scripts, native-preview, old typescript', () =>
    Effect.gen(function* () {
      const found = yield* failures(typescript7, {
        'package.json': rootWith({
          scripts: { typecheck: 'tsgo --noEmit', prepare: 'effect-tsgo patch' },
          devDependencies: {
            '@typescript/native-preview': '7.0.0-dev',
            typescript: 'catalog:',
          },
          workspaces: { packages: [], catalog: { typescript: '~5.9.3' } },
        }),
      });
      assert.deepStrictEqual(
        Arr.map(found, (f) => f.migration),
        [MigrationId.tsgoToTsc, MigrationId.tsgoToTsc, MigrationId.tsgoToTsc],
      );
      assert.include(found[2]?.message ?? '', '~5.9.3');
      assert.lengthOf(
        yield* failures(typescript7, {
          'package.json': rootWith({
            scripts: { typecheck: 'tsc --noEmit' },
            devDependencies: { typescript: '^7.0.2' },
          }),
        }),
        0,
      );
    }),
  );

  it.effect('bun-version: packageManager, flake pin, Dockerfile', () =>
    Effect.gen(function* () {
      assert.lengthOf(
        yield* failures(bunVersion, { 'package.json': rootWith({}) }),
        0,
      );
      const found = yield* failures(bunVersion, {
        'package.json': rootWith({ packageManager: 'bun@1.3.5' }),
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

  it.effect('nix-dev-shell: flake.lock, .envrc, copied description', () =>
    Effect.gen(function* () {
      const found = yield* failures(nixDevShell, {
        'package.json': rootWith({ name: 'portfolio' }),
        'flake.nix':
          '{ description = "Elden Ring Compass development environment"; }',
      });
      assert.deepStrictEqual(
        Arr.map(
          found,
          (f) =>
            f.migration ??
            (f.fix === undefined ? undefined : Str.slice(0, 12)(f.fix)),
        ),
        ['run `nix fla', MigrationId.addEnvrc, 'update the f'],
      );
      assert.lengthOf(
        yield* failures(nixDevShell, {
          'flake.nix': '{ description = "Expo RN devshells"; }',
          'flake.lock': '{}',
          '.envrc': 'use flake\n',
        }),
        0,
      );
    }),
  );

  it.effect('jscpd and knip', () =>
    Effect.gen(function* () {
      const jscpdFound = yield* failures(jscpd, {
        '.jscpd.json': json({ threshold: 0, minTokens: 40, minLines: 33 }),
        'package.json': rootWith({ scripts: { 'jscpd:check': 'jscpd' } }),
      });
      assert.include(jscpdFound[0]?.message ?? '', 'minTokens 40 (want 50)');
      const knipFound = yield* failures(knip, {
        'knip.json': '{}',
        'package.json': rootWith({ scripts: { 'knip:check': 'knip' } }),
      });
      assert.lengthOf(knipFound, 2);
      assert.lengthOf(
        yield* failures(knip, {
          'knip.ts': '',
          'package.json': rootWith({
            scripts: { 'knip:check': 'knip --no-config-hints --cache' },
          }),
        }),
        0,
      );
    }),
  );

  it.effect('catalog: summarises the catalog check', () =>
    Effect.gen(function* () {
      const found = yield* failures(catalog, {
        'package.json': rootWith({ devDependencies: { effect: '4.0.6' } }),
      });
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
      assert.strictEqual(
        found[0]?.migration,
        MigrationId.catalogCheckToShoebox,
      );
      assert.include(found[1]?.message ?? '', 'shoe-box check effect-versions');
    }),
  );

  it.effect('monorepo-layout: workspaces, scope, root deps', () =>
    Effect.gen(function* () {
      assert.include(
        (yield* failures(monorepoLayout, {
          'package.json': json({ name: 'x' }),
        }))[0]?.message ?? '',
        'not a monorepo',
      );
      const found = yield* failures(monorepoLayout, {
        'package.json': rootWith({
          devDependencies: {
            '@repo/db': 'workspace:*',
            '@repo/typescript-config': 'workspace:*',
          },
        }),
        'packages/db/package.json': json({ name: '@repo/db' }),
        'packages/typescript-config/package.json': json({
          name: '@repo/typescript-config',
        }),
      });
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
      assert.lengthOf(
        yield* failures(gitHooks, {
          'package.json': rootWith({ devDependencies: { husky: '^9' } }),
          '.husky/pre-commit': '',
        }),
        1,
      );
      assert.lengthOf(
        yield* failures(vscode, {
          '.vscode/settings.json':
            '{ "editor.defaultFormatter": "oxc.oxc-vscode" }',
        }),
        0,
      );
      assert.lengthOf(yield* failures(vscode, {}), 1);
    }),
  );
});
