import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';

import {
  addOptions,
  oxlintFlagsToOptions,
} from '../../src/migrations/oxlint-flags-to-options.ts';
import { oxlintrcToTs } from '../../src/migrations/oxlintrc-to-ts.ts';
import { json, pkgIn, plan } from './helpers.ts';

const rc = `{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["unicorn", "typescript"],
  "jsPlugins": ["@demo/oxlint-plugins/require-unknown-cast-comment"],
  "extends": ["./node_modules/ultracite/config/oxlint/core/.oxlintrc.json"],
  "ignorePatterns": [
    "docs/**",
    // each app has its own config extending this one
    "apps/**"
  ],
  "rules": {
    // Effect uses thisArg in array methods
    "unicorn/no-array-method-this-argument": "off",
    "unknown-cast/require-comment": "warn",
    "eqeqeq": ["warn", "smart"], // trailing note
    "custom/thing": "error"
  },
  "overrides": [{ "files": ["**/*.test.ts"], "rules": { "no-console": 1 } }]
}
`;

const files = {
  'package.json': json({
    name: '@demo/monorepo',
    workspaces: { packages: ['apps/*'], catalog: { react: '^19.0.0' } },
    scripts: {
      'oxlint:check':
        'oxlint -c .oxlintrc.json --type-aware --type-check --report-unused-disable-directives-severity=error .',
    },
  }),
  '.oxlintrc.json': rc,
  'apps/web/package.json': json({
    name: '@demo/web',
    dependencies: { react: 'catalog:', '@tanstack/react-start': '^1' },
    scripts: { 'oxlint:check': 'oxlint .' },
  }),
  'apps/web/.oxlintrc.json': json({
    extends: ['../../.oxlintrc.json'],
    rules: { 'no-empty-function': 'off' },
  }),
  'apps/api/package.json': json({ name: '@demo/api' }),
  'apps/api/.oxlintrc.json': json({
    $schema: 'x',
    extends: ['../../.oxlintrc.json'],
  }),
};

describe('oxlintrc-to-ts', () => {
  it.effect(
    'converts the root and nested rc files into one oxlint.config.ts',
    () =>
      Effect.gen(function* () {
        const { applies, file } = yield* plan(oxlintrcToTs, files);
        assert.isTrue(applies);
        const config = file('oxlint.config.ts') ?? '';
        assert.include(
          config,
          "import { defineShoeboxConfig } from '@shoe-box-tools/oxlint-config';",
        );
        assert.include(config, "scope: 'demo',");
        assert.include(config, 'react: true,');
        assert.include(config, 'tanstackRouter: true,');
        // Comments travel with their entries; warn becomes error.
        assert.include(
          config,
          "    // Effect uses thisArg in array methods\n    'unicorn/no-array-method-this-argument': 'off',",
        );
        assert.include(
          config,
          "    // trailing note\n    eqeqeq: [\n      'error',\n      'smart',\n    ],",
        );
        assert.include(config, "'no-console': 'error'");
        assert.notInclude(config, "'warn'");
        // Retired and unknown-plugin rules are dropped and listed.
        assert.notInclude(config, "'unknown-cast/require-comment':");
        assert.include(
          config,
          'Dropped retired rules (covered upstream): unknown-cast/require-comment.',
        );
        assert.include(
          config,
          're-add their jsPlugins via an override if still wanted: custom/thing.',
        );
        assert.include(
          config,
          'Replaced extends (the shared config covers them): ./node_modules/ultracite',
        );
        // The nested web config becomes an override; `apps/**` no longer hides it.
        assert.include(
          config,
          "files: [\n        'apps/web/**',\n      ],\n      rules: {\n        'no-empty-function': 'off',",
        );
        assert.notInclude(config, "'apps/**'");
        assert.include(config, "'docs/**'");
      }),
  );

  it.effect(
    'deletes the rc files, repoints scripts, and adds the shared config dependency',
    () =>
      Effect.gen(function* () {
        const { file } = yield* plan(oxlintrcToTs, files);
        assert.isUndefined(file('.oxlintrc.json'));
        assert.isUndefined(file('apps/web/.oxlintrc.json'));
        assert.isUndefined(file('apps/api/.oxlintrc.json'));
        const root = pkgIn(file('package.json'));
        assert.strictEqual(
          root.scripts['oxlint:check'],
          'oxlint -c oxlint.config.ts .',
        );
        assert.strictEqual(
          root.catalog['@shoe-box-tools/oxlint-config'],
          '^0.1.0',
        );
        assert.strictEqual(
          root.devDependencies['@shoe-box-tools/oxlint-config'],
          'catalog:',
        );
        assert.strictEqual(
          pkgIn(file('apps/web/package.json')).scripts['oxlint:check'],
          'oxlint -c ../../oxlint.config.ts .',
        );
      }),
  );

  it.effect(
    'carries nested ignores, overrides and root settings; keeps what it cannot carry',
    () =>
      Effect.gen(function* () {
        const { file } = yield* plan(oxlintrcToTs, {
          'package.json': json({
            name: 'r',
            workspaces: ['apps/*'],
            scripts: { lint: 'oxlint .' },
          }),
          'apps/web/package.json': json({
            name: '@r/web',
            dependencies: { react: '1' },
          }),
          'apps/api/package.json': json({ name: '@r/api' }),
          '.oxlintrc.json': json({
            rules: { 'no-console': 'error' },
            settings: { 'jsx-a11y': { polymorphicPropName: 'as' } },
          }),
          'apps/web/.oxlintrc.json': json({
            extends: ['../../.oxlintrc.json'],
            ignorePatterns: ['src/legacy/**', '*.gen.ts'],
            overrides: [
              { files: ['**/*.test.ts'], rules: { 'no-console': 'off' } },
            ],
            settings: { react: { version: '19' } },
          }),
          'apps/api/.oxlintrc.json': json({
            extends: ['../../.oxlintrc.json'],
            ignorePatterns: ['generated/'],
          }),
        });
        const config = file('oxlint.config.ts') ?? '';
        assert.include(config, "'apps/web/src/legacy/**'");
        assert.include(config, "'apps/web/**/*.gen.ts'");
        assert.include(config, "'apps/api/**/generated/'");
        assert.include(
          config,
          "files: [\n        'apps/web/**/*.test.ts',\n      ],\n      rules: {\n        'no-console': 'off',",
        );
        assert.include(config, "name: 'project/settings'");
        assert.include(config, "polymorphicPropName: 'as'");
        // Nested settings have no home in the root config: the file stays.
        assert.strictEqual(file('apps/web/.oxlintrc.json'), 'unchanged');
        assert.include(
          config,
          '// TODO: apps/web/.oxlintrc.json was kept: its settings could not be carried',
        );
        // Fully carried over: deleted.
        assert.isUndefined(file('apps/api/.oxlintrc.json'));
        assert.isUndefined(file('.oxlintrc.json'));
      }),
  );

  it.effect('does not apply once oxlint.config.ts exists', () =>
    Effect.gen(function* () {
      assert.isFalse(
        (yield* plan(oxlintrcToTs, { ...files, 'oxlint.config.ts': '' }))
          .applies,
      );
    }),
  );
});

describe('oxlint-flags-to-options', () => {
  it('inserts missing options into a hand-rolled config', () => {
    const fresh = addOptions(
      "import { defineConfig } from 'oxlint';\n\nexport default defineConfig({\n  plugins: [],\n});\n",
    );
    assert.include(
      fresh,
      "defineConfig({\n  options: {\n    typeAware: true,\n    typeCheck: true,\n    reportUnusedDisableDirectives: 'error',\n  },\n  plugins: [],",
    );
    const partial = addOptions(
      'export default defineConfig({\n  options: {\n    typeAware: true,\n  },\n});\n',
    );
    assert.include(
      partial,
      "options: {\n    typeCheck: true,\n    reportUnusedDisableDirectives: 'error',\n    typeAware: true,",
    );
    const sharedConfig =
      "import { defineShoeboxConfig } from '@shoe-box-tools/oxlint-config';\n";
    assert.strictEqual(addOptions(sharedConfig), sharedConfig);
  });

  it.effect('strips the CLI flags from scripts', () =>
    Effect.gen(function* () {
      const { applies, file } = yield* plan(oxlintFlagsToOptions, {
        'package.json': json({
          scripts: {
            'oxlint:fix':
              'oxlint -c oxlint.config.ts --type-aware --type-check --report-unused-disable-directives-severity=error --fix .',
          },
        }),
        'oxlint.config.ts': 'export default defineConfig({\n});\n',
      });
      assert.isTrue(applies);
      assert.strictEqual(
        pkgIn(file('package.json')).scripts['oxlint:fix'],
        'oxlint -c oxlint.config.ts --fix .',
      );
      assert.include(file('oxlint.config.ts') ?? '', 'typeAware: true');
    }),
  );
});
