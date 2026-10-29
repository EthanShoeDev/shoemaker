import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect } from 'effect';

import {
  findDirectives,
  lintIgnoresCheck,
} from '../../src/checks/lint-ignores.ts';
import { packageBoundariesCheck } from '../../src/checks/package-boundaries.ts';
import { makeMemoryRepo } from '../../src/engine/repo-memory.ts';

describe('package-boundaries check', () => {
  const files = (webDeps: Record<string, string>) => ({
    'package.json': JSON.stringify({
      name: 'demo',
      workspaces: ['apps/*', 'packages/*'],
    }),
    'apps/api/package.json': JSON.stringify({ name: '@demo/api' }),
    'apps/web/package.json': JSON.stringify({
      name: '@demo/web',
      dependencies: webDeps,
    }),
    'packages/lib/package.json': JSON.stringify({ name: '@demo/lib' }),
  });

  it.effect('passes when apps are leaves', () =>
    Effect.gen(function* () {
      const result = yield* packageBoundariesCheck.run(
        makeMemoryRepo(files({ '@demo/lib': 'workspace:*' })),
      );
      assert.isTrue(result.ok);
      assert.include(result.report, '4 packages, 2 apps');
    }),
  );

  it.effect('fails when anything depends on an app', () =>
    Effect.gen(function* () {
      const result = yield* packageBoundariesCheck.run(
        makeMemoryRepo(files({ '@demo/api': 'workspace:*' })),
      );
      assert.isFalse(result.ok);
      assert.include(
        result.report,
        'apps/web/package.json -> dependencies."@demo/api" (apps/api)',
      );
    }),
  );
});

describe('lint-ignores check', () => {
  it('tells described directives from bare ones', () => {
    const found = findDirectives(
      'a.ts',
      Arr.join(
        [
          '// oxlint-disable-next-line no-console -- debugging output for the CLI',
          '// eslint-disable-next-line no-console',
          '/* oxlint-disable max-lines */',
          '// @ts-expect-error upstream types are wrong',
          '// @ts-ignore',
          '// biome-ignore lint/style: generated',
          'const re = /oxlint-disable/;',
        ],
        '\n',
      ),
    );
    assert.deepStrictEqual(
      Arr.map(found, (d) => [d.line, d.name, d.described]),
      [
        [1, 'oxlint-disable', true],
        [2, 'eslint-disable', false],
        [3, 'oxlint-disable', false],
        [4, '@ts-expect-error', true],
        [5, '@ts-ignore', false],
        [6, 'biome-ignore', true],
      ],
    );
  });

  it.effect('reports every directive and fails on undescribed ones', () =>
    Effect.gen(function* () {
      const result = yield* lintIgnoresCheck.run(
        makeMemoryRepo({
          'src/a.ts':
            '// oxlint-disable-next-line no-console\nconsole.log(1);\n',
          'src/b.ts': '// oxfmt-ignore keep the table aligned\nconst t = 1;\n',
          'node_modules/x/index.js': '// eslint-disable-next-line\n',
          'dist/out.js': '// @ts-nocheck\n',
          '.gitignore': 'dist\n',
        }),
      );
      assert.isFalse(result.ok);
      assert.include(result.report, '- Directives: 2');
      assert.include(result.report, 'MISSING REASON `src/a.ts:1`');
    }),
  );
});
