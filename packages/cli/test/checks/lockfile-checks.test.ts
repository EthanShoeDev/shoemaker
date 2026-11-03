import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Option, Record as Rec } from 'effect';

import { effectVersionsCheck } from '../../src/checks/effect-versions.ts';
import { patchesCheck } from '../../src/checks/patches.ts';
import { makeMemoryRepo } from '../../src/engine/repo-memory.ts';
import { compactJsonFiles, pkgIn } from './helpers.ts';

const lock = (resolved: Record<string, string>) =>
  `{\n  "lockfileVersion": 1,\n  "packages": {\n${Arr.join(
    Arr.map(
      Rec.toEntries(resolved),
      ([key, value]) => `    "${key}": ["${value}", "", {}, "sha"],`,
    ),
    '\n',
  )}\n  },\n}\n`;

describe('effect-versions check', () => {
  it.effect('passes when every lockstep package matches effect', () =>
    Effect.gen(function* () {
      const result = yield* effectVersionsCheck.run(
        makeMemoryRepo({
          'bun.lock': lock({
            effect: 'effect@4.0.6',
            '@effect/platform-bun': '@effect/platform-bun@4.0.6',
            '@effect/tsgo': '@effect/tsgo@0.63.0',
            '@effect/tsgo-linux-x64': '@effect/tsgo-linux-x64@0.63.0',
          }),
        }),
      );
      assert.isTrue(result.ok);
      assert.include(result.report, 'All 2 effect packages resolve to 4.0.6');
    }),
  );

  it.effect('flags a transitive package on another version', () =>
    Effect.gen(function* () {
      const result = yield* effectVersionsCheck.run(
        makeMemoryRepo({
          'bun.lock': lock({
            effect: 'effect@4.0.6',
            'x/@effect/platform-node-shared':
              '@effect/platform-node-shared@4.0.7',
          }),
        }),
      );
      assert.isFalse(result.ok);
      assert.include(
        result.report,
        '@effect/platform-node-shared@4.0.7 (effect is 4.0.6)',
      );
    }),
  );

  it.effect('passes without a lockfile', () =>
    Effect.gen(function* () {
      assert.isTrue((yield* effectVersionsCheck.run(makeMemoryRepo({}))).ok);
    }),
  );
});

const patch = (file: string, added: string) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+${added}\n`;

describe('patches check', () => {
  // The repo with expo-audio@`version` installed.
  const base = Effect.fnUntraced(function* (version: string) {
    const manifests = yield* compactJsonFiles({
      'package.json': {
        patchedDependencies: {
          'expo-audio@57.0.3': 'patches/expo-audio.patch',
        },
      },
      'node_modules/expo-audio/package.json': { version },
    });
    return {
      ...manifests,
      'patches/expo-audio.patch': patch(
        'build/index.js',
        'const MAX_RATE = 4.0;',
      ),
      'bun.lock': lock({}),
    };
  });

  it.effect(
    'passes when the installed version matches and the patch text is present',
    () =>
      Effect.gen(function* () {
        const installed = yield* base('57.0.3');
        const result = yield* patchesCheck.run(
          makeMemoryRepo({
            ...installed,
            'node_modules/expo-audio/build/index.js':
              'x\nconst MAX_RATE = 4.0;\n',
          }),
        );
        assert.isTrue(result.ok, result.report);
      }),
  );

  it.effect(
    'fails when bun re-resolved the dependency (patch silently skipped)',
    () =>
      Effect.gen(function* () {
        const installed = yield* base('57.0.4');
        const result = yield* patchesCheck.run(makeMemoryRepo(installed));
        assert.isFalse(result.ok);
        assert.include(result.report, 'installed version is 57.0.4');
      }),
  );

  it.effect(
    'fails when the patched lines are missing, and warns about orphan patches',
    () =>
      Effect.gen(function* () {
        const installed = yield* base('57.0.3');
        const result = yield* patchesCheck.run(
          makeMemoryRepo({
            ...installed,
            'patches/howler.patch': patch('a.js', 'something long enough'),
            'node_modules/expo-audio/build/index.js': 'const MAX_RATE = 2.0;\n',
          }),
        );
        assert.isFalse(result.ok);
        assert.include(result.report, 'the patch is NOT applied');
        assert.include(
          result.report,
          'WARN  patches/howler.patch is not referenced',
        );
      }),
  );

  it.effect('passes with no patches', () =>
    Effect.gen(function* () {
      assert.isTrue(
        (yield* patchesCheck.run(makeMemoryRepo({ 'package.json': '{}' }))).ok,
      );
    }),
  );
});

describe('effect-versions check across majors', () => {
  it.effect(
    'compares against the hoisted effect and only notes other majors',
    () =>
      Effect.gen(function* () {
        const result = yield* effectVersionsCheck.run(
          makeMemoryRepo({
            'bun.lock': lock({
              effect: 'effect@4.0.6',
              '@effect/vitest': '@effect/vitest@4.0.6',
              'spanoptic/effect': 'effect@3.22.4',
              '@effect/platform': '@effect/platform@0.94.0',
            }),
          }),
        );
        assert.isTrue(result.ok, result.report);
        assert.include(
          result.report,
          'not compared: @effect/platform@0.94.0, effect@3.22.4',
        );
      }),
  );
});

describe('effect-versions check for alchemy', () => {
  const lockWith = (
    entries: Record<string, readonly [string, Record<string, string>]>,
  ) =>
    `{\n  "lockfileVersion": 1,\n  "packages": {\n${Arr.join(
      Arr.map(
        Rec.toEntries(entries),
        ([key, [resolved, dependencies]]) =>
          `    "${key}": ["${resolved}", "", { "dependencies": { ${Arr.join(
            Arr.map(
              Rec.toEntries(dependencies),
              ([name, spec]) => `"${name}": "${spec}"`,
            ),
            ', ',
          )} } }, "sha"],`,
      ),
      '\n',
    )}\n  },\n}\n`;

  const drifted = lockWith({
    effect: ['effect@4.1.2', {}],
    alchemy: [
      'alchemy@2.0.0-beta.85',
      { '@alchemy.run/sigil': '0.1.0-alpha.1' },
    ],
    '@alchemy.run/sigil': ['@alchemy.run/sigil@0.1.0-alpha.1', {}],
    '@alchemy.run/cloudflare': [
      '@alchemy.run/cloudflare@2.0.0-beta.85',
      {
        '@distilled.cloud/cloudflare': '1.0.0-rc.18',
        alchemy: '2.0.0-beta.85',
      },
    ],
    '@alchemy.run/stripe': [
      '@alchemy.run/stripe@2.0.0-beta.80',
      { '@distilled.cloud/stripe': '1.0.0-rc.15', alchemy: '2.0.0-beta.80' },
    ],
    '@distilled.cloud/cloudflare': [
      '@distilled.cloud/cloudflare@1.0.0-rc.18',
      {},
    ],
    '@distilled.cloud/stripe': ['@distilled.cloud/stripe@1.0.0-rc.15', {}],
  });

  it.effect(
    'flags @alchemy.run and @distilled.cloud packages alchemy does not pin',
    () =>
      Effect.gen(function* () {
        const result = yield* effectVersionsCheck.run(
          makeMemoryRepo({ 'bun.lock': drifted }),
        );
        assert.isFalse(result.ok);
        assert.include(
          result.report,
          '@alchemy.run/stripe@2.0.0-beta.80 (alchemy pins 2.0.0-beta.85)',
        );
        assert.include(
          result.report,
          '@distilled.cloud/stripe@1.0.0-rc.15 (alchemy pins 1.0.0-rc.18)',
        );
        // Not on alchemy's release train: alchemy pins it at its own version.
        assert.notInclude(result.report, 'sigil');
      }),
  );

  it.effect('moves catalog pins behind their family, and no others', () =>
    Effect.gen(function* () {
      const files = yield* compactJsonFiles({
        'package.json': {
          name: 'x',
          workspaces: {
            packages: [],
            catalog: {
              '@alchemy.run/stripe': '2.0.0-beta.80',
              '@distilled.cloud/stripe': '1.0.0-rc.15',
              '@effect/platform-node': '4.1.0',
              '@effect/platform': '0.94.0',
              '@effect/sql-pg': '^4.1.0',
              alchemy: '2.0.0-beta.85',
            },
          },
        },
      });
      const result = yield* effectVersionsCheck.run(
        makeMemoryRepo({ ...files, 'bun.lock': drifted }),
      );
      const root = Arr.findFirst(
        result.fixes,
        (f) => f.path === 'package.json',
      );
      const { catalog } = pkgIn(
        Option.getOrUndefined(Option.map(root, (f) => f.content ?? '')),
      );
      assert.deepStrictEqual(catalog, {
        '@alchemy.run/stripe': '2.0.0-beta.85',
        '@distilled.cloud/stripe': '1.0.0-rc.18',
        '@effect/platform-node': '4.1.2',
        '@effect/platform': '0.94.0',
        '@effect/sql-pg': '^4.1.0',
        alchemy: '2.0.0-beta.85',
      });
    }),
  );
});
