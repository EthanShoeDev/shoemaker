import { BunServices } from '@effect/platform-bun';
import { assert, describe, it } from '@effect/vitest';
import { Effect, FileSystem, Path, String as Str } from 'effect';

import { CONFIG_PATH, loadConfig } from '../../src/config/load.ts';
import { renderConfigFile } from '../../src/config/render.ts';
import {
  defaultConfig,
  type ShoemakerConfig,
} from '../../src/config/schema.ts';
import { formatContent } from '../../src/engine/format.ts';

const full: ShoemakerConfig = {
  ...defaultConfig('listening'),
  scope: 'listen',
  description: 'Ethan\'s "listening" app \\ with escapes',
  apps: [
    { name: 'web', kind: 'tanstack-start', api: 'api' },
    { name: 'api', kind: 'effect-api' },
    {
      name: 'mobile',
      kind: 'expo',
      androidRelease: { package: 'dev.listen.mobile' },
    },
  ],
  packages: [
    { name: 'domain', kind: 'library' },
    { name: 'frontend', kind: 'frontend', api: 'api' },
  ],
  taskRunner: 'nx',
  secrets: 'secretspec',
  infra: {
    kind: 'alchemy',
    deploy: 'aws',
    state: 'local',
    providers: ['aws', 'github'],
  },
  features: { changesets: true, agents: true, vscode: false },
  nixPackages: [
    'postgresql_17',
    'redis',
    'imagemagick',
    'ffmpeg-full',
    'google-cloud-sdk',
  ],
  unmanaged: ['apps/web/src/routes/index.tsx'],
};

const roundTrip = (config: ShoemakerConfig) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(
      path.join(dir, CONFIG_PATH),
      renderConfigFile(config),
    );
    return yield* loadConfig(dir);
  });

describe('shoemaker.config.ts', () => {
  it.effect('render -> load round-trips', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* roundTrip(full), full);
      assert.deepStrictEqual(
        yield* roundTrip(defaultConfig('x')),
        defaultConfig('x'),
      );
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect('renders exactly what oxfmt would', () =>
    Effect.gen(function* () {
      for (const config of [full, defaultConfig('x')]) {
        const text = renderConfigFile(config);
        assert.strictEqual(yield* formatContent(CONFIG_PATH, text), text);
      }
    }),
  );

  it('is deterministic and imports defineConfig', () => {
    const text = renderConfigFile(full);
    assert.strictEqual(text, renderConfigFile({ ...full }));
    assert.isTrue(
      Str.startsWith(
        "import { defineConfig } from 'shoemaker/config';\n\nexport default defineConfig({\n",
      )(text),
    );
  });

  it.effect('rejects an invalid config', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        roundTrip({ ...full, name: 'Not Kebab' }),
      );
      assert.strictEqual(error._tag, 'ConfigError');
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect.each([
    [
      'a missing API',
      [{ name: 'web', kind: 'tanstack-start', api: 'nope' }],
      'nope is not an effect-api app',
    ],
    [
      'a host that is not a site',
      [
        { name: 'cli', kind: 'effect-cli', api: 'api' },
        { name: 'api', kind: 'effect-api' },
      ],
      'only a tanstack-start app can serve an API',
    ],
    [
      'an API served twice',
      [
        { name: 'web', kind: 'tanstack-start', api: 'api' },
        { name: 'docs', kind: 'tanstack-start', api: 'api' },
        { name: 'api', kind: 'effect-api' },
      ],
      'api is already served by another app',
    ],
    [
      "a name taken by an API's contract",
      [
        { name: 'api', kind: 'effect-api' },
        { name: 'api-contract', kind: 'effect-cli' },
      ],
      'api-contract is reserved for its HttpApi contract package',
    ],
    [
      'an Android release from a non-Expo app',
      [
        {
          name: 'cli',
          kind: 'effect-cli',
          androidRelease: { package: 'dev.listen.cli' },
        },
        { name: 'api', kind: 'effect-api' },
      ],
      'only an expo app ships Android releases',
    ],
    [
      'an Android application id that is not one',
      [
        {
          name: 'mobile',
          kind: 'expo',
          androidRelease: { package: 'mobile' },
        },
        { name: 'api', kind: 'effect-api' },
      ],
      '["androidRelease"]["package"]',
    ],
    [
      'an app named after the shared theme package',
      [
        { name: 'web', kind: 'tanstack-start' },
        { name: 'mobile', kind: 'expo' },
        { name: 'theme', kind: 'effect-cli' },
        { name: 'api', kind: 'effect-api' },
      ],
      'theme is reserved for the design tokens',
    ],
  ] as const)('rejects %s', ([, apps, message]) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(roundTrip({ ...full, apps }));
      assert.include(error.message, message);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect.each([
    [
      'without changesets',
      { features: { ...full.features, changesets: false } },
      'needs features.changesets',
    ],
    ['without GitHub Actions', { ci: 'none' }, "needs ci: 'github'"],
  ] as const)('rejects an Android release %s', ([, overrides, message]) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(roundTrip({ ...full, ...overrides }));
      assert.include(error.message, message);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect.each([
    [
      'a frontend package without an API',
      [{ name: 'frontend', kind: 'frontend' }],
      'a frontend package names the effect-api app it calls',
    ],
    [
      'a library with an API',
      [{ name: 'domain', kind: 'library', api: 'api' }],
      'only a frontend package calls an API',
    ],
    [
      'a frontend package for a missing API',
      [{ name: 'frontend', kind: 'frontend', api: 'web' }],
      'web is not an effect-api app',
    ],
    [
      'two frontend packages for one API',
      [
        { name: 'frontend', kind: 'frontend', api: 'api' },
        { name: 'client', kind: 'frontend', api: 'api' },
      ],
      'api already has a frontend package',
    ],
  ] as const)('rejects %s', ([, packages, message]) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(roundTrip({ ...full, packages }));
      assert.include(error.message, message);
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
