import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Option, Record as Rec } from 'effect';

import { catalogCheck } from '../../src/checks/catalog.ts';
import { makeMemoryRepo } from '../../src/engine/repo-memory.ts';
import { pkgIn } from './helpers.ts';

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const root = (extra: Record<string, unknown> = {}) =>
  json({
    name: 'demo',
    workspaces: {
      packages: ['apps/*', 'packages/*'],
      catalog: { effect: '4.0.1', zod: '^3.0.0' },
    },
    devDependencies: { effect: 'catalog:' },
    ...extra,
  });

const tabbed = JSON.stringify(
  { name: '@demo/web', dependencies: { effect: '4.0.1' } },
  null,
  '\t',
);

const fileOf = (
  fixes: ReadonlyArray<{ path: string; content: string | undefined }>,
  path: string,
) =>
  pkgIn(
    Option.getOrUndefined(Arr.findFirst(fixes, (fix) => fix.path === path))
      ?.content,
  );

describe('catalog check', () => {
  it.effect('passes when every dependency uses catalog: / workspace:*', () =>
    Effect.gen(function* () {
      const result = yield* catalogCheck.run(
        makeMemoryRepo({
          'package.json': root(),
          'apps/web/package.json': json({
            name: '@demo/web',
            dependencies: { effect: 'catalog:', '@demo/lib': 'workspace:*' },
          }),
          'packages/lib/package.json': json({
            name: '@demo/lib',
            dependencies: { zod: 'catalog:' },
          }),
        }),
      );
      assert.isTrue(result.ok);
      assert.deepStrictEqual(result.fixes, []);
    }),
  );

  it.effect(
    'flags pinned catalog deps and non-workspace internal deps, and fixes both',
    () =>
      Effect.gen(function* () {
        const result = yield* catalogCheck.run(
          makeMemoryRepo({
            'package.json': root(),
            'apps/web/package.json': json({
              name: '@demo/web',
              dependencies: { effect: '4.0.6', '@demo/lib': '^0.1.0' },
            }),
            'packages/lib/package.json': json({ name: '@demo/lib' }),
          }),
        );
        assert.isFalse(result.ok);
        assert.include(
          result.report,
          '"effect" is "4.0.6" but should be "catalog:"',
        );
        assert.include(
          result.report,
          '"@demo/lib" is "^0.1.0" but should be "workspace:*"',
        );
        const web = fileOf(result.fixes, 'apps/web/package.json');
        assert.deepStrictEqual(web.dependencies, {
          effect: 'catalog:',
          '@demo/lib': 'workspace:*',
        });
        // The pinned version was newer than the catalog's, so the catalog moves up.
        assert.strictEqual(
          fileOf(result.fixes, 'package.json').catalog.effect,
          '4.0.6',
        );
      }),
  );

  it.effect(
    'adds missing deps to the catalog in sorted position and rewrites every use',
    () =>
      Effect.gen(function* () {
        const result = yield* catalogCheck.run(
          makeMemoryRepo({
            'package.json': root(),
            'apps/web/package.json': json({
              name: '@demo/web',
              dependencies: { react: '^19.1.0' },
            }),
            'packages/lib/package.json': json({
              name: '@demo/lib',
              peerDependencies: { react: '^19.2.0' },
            }),
          }),
        );
        assert.isFalse(result.ok);
        assert.include(result.report, '"react": "^19.2.0" (used in 2 packages');
        const rootPkg = fileOf(result.fixes, 'package.json');
        assert.deepStrictEqual(Rec.keys(rootPkg.catalog), [
          'effect',
          'react',
          'zod',
        ]);
        assert.strictEqual(rootPkg.catalog.react, '^19.2.0');
        assert.strictEqual(
          fileOf(result.fixes, 'apps/web/package.json').dependencies.react,
          'catalog:',
        );
        assert.strictEqual(
          fileOf(result.fixes, 'packages/lib/package.json').peerDependencies
            .react,
          'catalog:',
        );
      }),
  );

  it.effect('honours per-package catalogSkip and the global skip list', () =>
    Effect.gen(function* () {
      const result = yield* catalogCheck.run(
        makeMemoryRepo({
          'package.json': root(),
          'apps/mobile/package.json': json({
            name: '@demo/mobile',
            catalogSkip: ['effect'],
            dependencies: { effect: '4.0.0', 'electron-updater': '6.0.0' },
          }),
        }),
      );
      assert.isTrue(result.ok);
    }),
  );

  it.effect('keeps the file formatting (tabs) when fixing', () =>
    Effect.gen(function* () {
      const result = yield* catalogCheck.run(
        makeMemoryRepo({
          'package.json': root(),
          'apps/web/package.json': tabbed,
        }),
      );
      const web =
        Option.getOrUndefined(
          Arr.findFirst(
            result.fixes,
            (fix) => fix.path === 'apps/web/package.json',
          ),
        )?.content ?? '';
      assert.include(web, '\t"dependencies": {\n\t\t"effect": "catalog:"');
    }),
  );
});
