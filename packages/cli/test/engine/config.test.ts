import { BunServices } from '@effect/platform-bun';
import { assert, describe, it } from '@effect/vitest';
import { Effect, FileSystem, Path, String as Str } from 'effect';

import { CONFIG_PATH, loadConfig } from '../../src/config/load.ts';
import { renderConfigFile } from '../../src/config/render.ts';
import { defaultConfig, type ShoeboxConfig } from '../../src/config/schema.ts';
import { formatContent } from '../../src/engine/format.ts';

const full: ShoeboxConfig = {
  ...defaultConfig('listening'),
  scope: 'listen',
  description: 'Ethan\'s "listening" app \\ with escapes',
  apps: [
    { name: 'web', kind: 'tanstack-start' },
    { name: 'api', kind: 'effect-api' },
  ],
  packages: [{ name: 'domain', kind: 'library' }],
  taskRunner: 'nx',
  secrets: 'secretspec',
  infra: { kind: 'alchemy', deploy: 'aws', state: 'local' },
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

const roundTrip = (config: ShoeboxConfig) =>
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

describe('shoebox.config.ts', () => {
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
        "import { defineConfig } from 'shoe-box/config';\n\nexport default defineConfig({\n",
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
});
