import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Record as Rec } from 'effect';

import { effectVersionsCheck } from '../../src/checks/effect-versions.ts';
import { patchesCheck } from '../../src/checks/patches.ts';
import { makeMemoryRepo } from '../../src/engine/repo-memory.ts';

const json = (value: unknown) => JSON.stringify(value);

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
  const base = {
    'package.json': json({
      patchedDependencies: { 'expo-audio@57.0.3': 'patches/expo-audio.patch' },
    }),
    'patches/expo-audio.patch': patch(
      'build/index.js',
      'const MAX_RATE = 4.0;',
    ),
    'bun.lock': lock({}),
  };

  it.effect(
    'passes when the installed version matches and the patch text is present',
    () =>
      Effect.gen(function* () {
        const result = yield* patchesCheck.run(
          makeMemoryRepo({
            ...base,
            'node_modules/expo-audio/package.json': json({ version: '57.0.3' }),
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
        const result = yield* patchesCheck.run(
          makeMemoryRepo({
            ...base,
            'node_modules/expo-audio/package.json': json({ version: '57.0.4' }),
          }),
        );
        assert.isFalse(result.ok);
        assert.include(result.report, 'installed version is 57.0.4');
      }),
  );

  it.effect(
    'fails when the patched lines are missing, and warns about orphan patches',
    () =>
      Effect.gen(function* () {
        const result = yield* patchesCheck.run(
          makeMemoryRepo({
            ...base,
            'patches/howler.patch': patch('a.js', 'something long enough'),
            'node_modules/expo-audio/package.json': json({ version: '57.0.3' }),
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
