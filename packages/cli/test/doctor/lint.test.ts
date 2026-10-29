import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect } from 'effect';

import {
  oxfmtConfigFormat,
  oxfmtSortImports,
  oxlintCliFlags,
  oxlintConfigFormat,
  oxlintNoWarn,
  oxlintSharedConfig,
  oxlintUnusedDirectives,
  retiredPlugins,
} from '../../src/doctor/lint.ts';
import { MigrationId } from '../../src/migrations/ids.ts';
import { failures, json } from './helpers.ts';

const shared =
  "import { defineShoeboxConfig } from 'shoe-box-oxlint-config';\nexport default defineShoeboxConfig({ scope: 'x' });\n";
const handRolled = (categories: string, options: string) =>
  `import { defineConfig } from 'oxlint';\nexport default defineConfig({\n  options: { ${options} },\n  categories: { ${categories} },\n});\n`;
const allCategories =
  "correctness: 'error', perf: 'error', restriction: 'error', suspicious: 'error', pedantic: 'error', style: 'error'";

describe('oxlint doctor checks', () => {
  it.effect(
    'oxlint-config-ts: .oxlintrc.json anywhere fails with the migration',
    () =>
      Effect.gen(function* () {
        const found = yield* failures(oxlintConfigFormat, {
          '.oxlintrc.json': '{}',
          'apps/a/.oxlintrc.json': '{}',
        });
        assert.deepStrictEqual(
          Arr.map(found, (f) => [f.path, f.migration]),
          [
            ['.oxlintrc.json', MigrationId.oxlintrcToTs],
            ['apps/a/.oxlintrc.json', MigrationId.oxlintrcToTs],
          ],
        );
        assert.lengthOf(
          yield* failures(oxlintConfigFormat, { 'oxlint.config.ts': shared }),
          0,
        );
        assert.lengthOf(yield* failures(oxlintConfigFormat, {}), 1);
      }),
  );

  it.effect(
    'oxlint-shared-config: shared passes; hand-rolled needs categories and options',
    () =>
      Effect.gen(function* () {
        assert.lengthOf(
          yield* failures(oxlintSharedConfig, { 'oxlint.config.ts': shared }),
          0,
        );
        const partial = yield* failures(oxlintSharedConfig, {
          'oxlint.config.ts': handRolled(
            "correctness: 'error', style: 'warn'",
            'typeAware: true',
          ),
        });
        assert.include(
          partial[0]?.message ?? '',
          'perf, restriction, suspicious, pedantic, style',
        );
        assert.include(partial[1]?.message ?? '', 'typeCheck');
        assert.strictEqual(
          partial[1]?.migration,
          MigrationId.oxlintFlagsToOptions,
        );
        const complete = yield* failures(oxlintSharedConfig, {
          'oxlint.config.ts': handRolled(
            allCategories,
            'typeAware: true, typeCheck: true',
          ),
        });
        assert.lengthOf(complete, 1);
        assert.include(complete[0]?.message ?? '', 'hand-rolled');
      }),
  );

  it.effect(
    'oxlint-no-warn: finds warn in rc rules, overrides and TS configs',
    () =>
      Effect.gen(function* () {
        const found = yield* failures(oxlintNoWarn, {
          '.oxlintrc.json': json({
            rules: { a: 'warn', b: ['warn', {}], c: 'error' },
            overrides: [{ rules: { d: 1 } }],
          }),
          'oxlint.config.ts':
            "export default {\n  rules: {\n    // 'warn' in a comment is fine\n    eqeqeq: 'warn',\n  },\n};\n",
        });
        assert.include(found[0]?.message ?? '', 'a, b, d');
        assert.include(found[1]?.message ?? '', 'line 4');
        assert.lengthOf(
          yield* failures(oxlintNoWarn, { 'oxlint.config.ts': shared }),
          0,
        );
      }),
  );

  it.effect(
    'oxlint-unused-directives: options or shared config, not CLI flags',
    () =>
      Effect.gen(function* () {
        assert.lengthOf(
          yield* failures(oxlintUnusedDirectives, {
            'oxlint.config.ts': shared,
          }),
          0,
        );
        assert.lengthOf(
          yield* failures(oxlintUnusedDirectives, {
            'oxlint.config.ts': handRolled(
              '',
              "reportUnusedDisableDirectives: 'error'",
            ),
          }),
          0,
        );
        const viaCli = yield* failures(oxlintUnusedDirectives, {
          'oxlint.config.ts': handRolled('', ''),
          'package.json': json({
            scripts: {
              'oxlint:check':
                'oxlint --report-unused-disable-directives-severity=error .',
            },
          }),
        });
        assert.include(viaCli[0]?.message ?? '', 'CLI flag');
      }),
  );

  it.effect('oxlint-cli-flags: type-aware flags in scripts', () =>
    Effect.gen(function* () {
      const files = {
        'package.json': json({
          scripts: {
            'oxlint:check':
              'oxlint -c oxlint.config.ts --type-aware --type-check .',
            other: 'oxlint-tsgolint --type-aware',
          },
        }),
        'oxlint.config.ts': shared,
      };
      const found = yield* failures(oxlintCliFlags, files);
      assert.lengthOf(found, 1);
      assert.include(found[0]?.message ?? '', 'package.json#oxlint:check');
      assert.strictEqual(found[0]?.migration, MigrationId.oxlintFlagsToOptions);
    }),
  );

  it.effect('oxfmt-config-ts and oxfmt-sort-imports', () =>
    Effect.gen(function* () {
      const rc = yield* failures(oxfmtConfigFormat, {
        '.oxfmtrc.jsonc': '{}',
        'apps/web/.oxfmtrc.json': '{}',
      });
      assert.strictEqual(rc[0]?.migration, MigrationId.oxfmtrcToTs);
      assert.isDefined(rc[1]?.fix);
      assert.lengthOf(
        yield* failures(oxfmtSortImports, {
          '.oxfmtrc.jsonc': '{ "experimentalSortImports": {} }',
        }),
        0,
      );
      assert.lengthOf(
        yield* failures(oxfmtSortImports, {
          '.oxfmtrc.jsonc': '{ "singleQuote": true }',
        }),
        1,
      );
      assert.lengthOf(
        yield* failures(oxfmtSortImports, {
          'oxfmt.config.ts': 'export default { sortImports: true };',
        }),
        0,
      );
      assert.lengthOf(
        yield* failures(oxfmtSortImports, {
          'oxfmt.config.ts': '// sortImports: true\nexport default {};',
        }),
        1,
      );
    }),
  );

  it.effect('retired-plugins: rule ids and plugin sources', () =>
    Effect.gen(function* () {
      const found = yield* failures(retiredPlugins, {
        'oxlint.config.ts':
          "export default { rules: { 'unknown-cast/require-comment': 'error', 'prefer-effect/no-node-fs': 'error' } };",
        'packages/oxlint-plugins/src/require-unknown-cast-comment.ts': '',
      });
      assert.include(
        found[0]?.message ?? '',
        'unknown-cast/require-comment, prefer-effect/no-node-fs',
      );
      assert.include(
        found[1]?.message ?? '',
        'require-unknown-cast-comment.ts',
      );
    }),
  );
});
