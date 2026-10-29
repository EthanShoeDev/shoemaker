import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Record as Rec } from 'effect';

import { makeMemoryRepo } from '../../src/engine/repo-memory.ts';
import { migrations, planAll } from '../../src/migrations/index.ts';
import { lintScriptNames } from '../../src/migrations/lint-script-names.ts';
import { renameScript } from '../../src/migrations/script-names.ts';
import { tsgoToTsc } from '../../src/migrations/tsgo-to-tsc.ts';
import { json, pkgIn, plan } from './helpers.ts';

describe('renameScript', () => {
  it('maps drifted names to <tool>:check / <tool>:fix', () => {
    const cases: Array<[string, string, string | undefined]> = [
      ['lint:oxlint', 'oxlint --type-aware', 'oxlint:check'],
      ['lint:oxlint', 'oxlint -c oxlint.config.ts --fix .', 'oxlint:fix'],
      ['lint:oxlint:check', 'oxlint .', 'oxlint:check'],
      ['lint:oxlint:unsafe', 'oxlint --fix-dangerously .', 'oxlint:unsafe:fix'],
      [
        'lint:oxlint:fix:fix-suggestions',
        'oxlint --fix --fix-suggestions',
        'oxlint:fix:fix-suggestions',
      ],
      ['lint:oxfmt', 'oxfmt --write .', 'oxfmt:fix'],
      ['lint:jscpd', 'jscpd .', 'jscpd:check'],
      ['lint:nix:deadnix', 'deadnix -f', 'nix:deadnix:check'],
      ['lint:nix:flake-check', 'nix flake check', 'nix:flake:check'],
      ['lint:python', 'uv run ruff check modal/', 'ruff:check'],
      ['fmt:write', 'oxfmt --write', 'oxfmt:fix'],
      ['fmt:check', 'oxfmt --check', 'oxfmt:check'],
      ['fmt:root:nix', 'nix fmt flake.nix', 'nix:fmt:fix'],
      ['fmt:check:root:nix', 'nix fmt flake.nix -- -c', 'nix:fmt:check'],
      ['nix:fmt', 'nix fmt flake.nix', 'nix:fmt:fix'],
      ['knip:fix', 'knip --fix', 'knip:fix:danger'],
      ['lint', 'turbo run lint', undefined],
      ['oxlint:check', 'oxlint .', undefined],
    ];
    for (const [name, command, expected] of cases)
      assert.strictEqual(renameScript(name, command), expected, name);
  });
});

describe('lint-script-names', () => {
  it.effect(
    'renames scripts in place and every task/run reference to them',
    () =>
      Effect.gen(function* () {
        const { applies, file } = yield* plan(lintScriptNames, {
          'package.json': json({
            name: 'demo',
            workspaces: ['apps/*'],
            scripts: {
              'lint:oxlint': 'oxlint --fix .',
              ci: 'bun run lint:oxlint && bun run fmt:check',
              'fmt:check': 'oxfmt --check',
            },
          }),
          'apps/web/package.json': json({
            name: '@demo/web',
            scripts: { 'lint:oxlint': 'oxlint --fix .' },
          }),
          'turbo.jsonc':
            '{\n  // run lint:oxlint everywhere\n  "tasks": { "lint": { "with": ["lint:oxlint", "//#fmt:check"] }, "//#fmt:check": {}, "lint:oxlint": {} },\n}\n',
          '.github/workflows/ci.yml': 'steps:\n  - run: bun run lint:oxlint\n',
        });
        assert.isTrue(applies);
        const root = file('package.json') ?? '';
        assert.deepStrictEqual(Rec.keys(pkgIn(root).scripts), [
          'oxlint:fix',
          'ci',
          'oxfmt:check',
        ]);
        assert.strictEqual(
          pkgIn(root).scripts.ci,
          'bun run oxlint:fix && bun run oxfmt:check',
        );
        assert.deepStrictEqual(
          Rec.keys(pkgIn(file('apps/web/package.json')).scripts),
          ['oxlint:fix'],
        );
        assert.include(
          file('turbo.jsonc') ?? '',
          '"with": ["oxlint:fix", "//#oxfmt:check"] }, "//#oxfmt:check": {}, "oxlint:fix": {}',
        );
        assert.strictEqual(
          file('.github/workflows/ci.yml'),
          'steps:\n  - run: bun run oxlint:fix\n',
        );
      }),
  );

  it.effect('drops a drifted script that duplicates the preferred one', () =>
    Effect.gen(function* () {
      const { file } = yield* plan(lintScriptNames, {
        'package.json': json({
          scripts: {
            'oxlint:check': 'oxlint .',
            'lint:oxlint:check': 'oxlint .',
          },
        }),
      });
      assert.deepStrictEqual(pkgIn(file('package.json')).scripts, {
        'oxlint:check': 'oxlint .',
      });
    }),
  );
});

describe('tsgo-to-tsc', () => {
  it.effect(
    'switches scripts to tsc, drops native-preview, moves typescript to ^7',
    () =>
      Effect.gen(function* () {
        const { applies, file } = yield* plan(tsgoToTsc, {
          'package.json': json({
            name: 'demo',
            workspaces: {
              packages: ['apps/*'],
              catalog: {
                typescript: '~5.9.3',
                '@typescript/native-preview': '7.0.0-dev',
              },
            },
            scripts: {
              typecheck: 'tsgo --noEmit',
              prepare: 'effect-tsgo patch --oxlint',
            },
            devDependencies: {
              '@typescript/native-preview': '7.0.0-dev',
              typescript: 'catalog:',
            },
          }),
          'apps/web/package.json': json({
            name: '@demo/web',
            scripts: { 'tsgo:check': 'tsgo --noEmit' },
            devDependencies: { typescript: '^5.8.0' },
          }),
          'turbo.jsonc': '{ "tasks": { "tsgo:check": {} } }',
        });
        assert.isTrue(applies);
        const root = pkgIn(file('package.json'));
        assert.deepStrictEqual(root.scripts, {
          typecheck: 'tsc --noEmit',
          prepare: 'effect-tsgo patch --oxlint',
        });
        assert.deepStrictEqual(root.catalog, { typescript: '^7.0.2' });
        assert.deepStrictEqual(root.devDependencies, {
          typescript: 'catalog:',
        });
        const web = pkgIn(file('apps/web/package.json'));
        assert.deepStrictEqual(web.scripts, { typecheck: 'tsc --noEmit' });
        assert.strictEqual(web.devDependencies.typescript, 'catalog:');
        assert.strictEqual(
          file('turbo.jsonc'),
          '{ "tasks": { "typecheck": {} } }',
        );
      }),
  );

  it.effect(
    'adds typescript when nothing declares it, and is a no-op on TS 7 repos',
    () =>
      Effect.gen(function* () {
        const { file } = yield* plan(tsgoToTsc, {
          'package.json': json({ name: 'demo' }),
        });
        assert.strictEqual(
          pkgIn(file('package.json')).devDependencies.typescript,
          '^7.0.2',
        );
        assert.isFalse(
          (yield* plan(tsgoToTsc, {
            'package.json': json({ devDependencies: { typescript: '^7.0.2' } }),
          })).applies,
        );
      }),
  );
});

describe('planAll', () => {
  it.effect(
    'chains every migration over an overlay, each seeing the previous changes',
    () =>
      Effect.gen(function* () {
        const { applied, changes } = yield* planAll(
          makeMemoryRepo({
            'package.json': json({
              name: 'demo',
              scripts: {
                'lint:oxlint': 'oxlint -c .oxlintrc.json --type-aware --fix .',
                typecheck: 'tsgo --noEmit',
              },
              devDependencies: { typescript: '^7.0.2' },
            }),
            '.oxlintrc.json': '{ "rules": { "eqeqeq": "warn" } }',
            'turbo.json': '{ "tasks": { "lint:oxlint": {} } }',
            'flake.nix': '{}',
          }),
          migrations,
        );
        assert.deepStrictEqual(applied, [
          '2026-10-28-oxlintrc-to-ts',
          '2026-10-28-turbo-json-to-jsonc',
          '2026-10-28-lint-script-names',
          '2026-10-28-tsgo-to-tsc',
          '2026-10-28-add-envrc',
        ]);
        const byPath = new Map(
          Arr.map(changes, (c) => [c.path, c.content] as const),
        );
        assert.strictEqual(
          byPath.get('turbo.jsonc'),
          '{ "tasks": { "oxlint:fix": {} } }',
        );
        assert.isTrue(
          byPath.has('turbo.json') && byPath.get('turbo.json') === undefined,
        );
        const scripts = pkgIn(byPath.get('package.json')).scripts;
        assert.deepStrictEqual(scripts, {
          'oxlint:fix': 'oxlint -c oxlint.config.ts --fix .',
          typecheck: 'tsc --noEmit',
        });
      }),
  );
});
