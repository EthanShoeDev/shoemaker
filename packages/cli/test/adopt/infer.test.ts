import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Order } from 'effect';

import { inferConfig } from '../../src/adopt/infer.ts';
import { decodeConfig, defaultConfig } from '../../src/config/schema.ts';
import { makeMemoryRepo } from '../../src/engine/repo-memory.ts';

const json = (value: unknown) => JSON.stringify(value);

const repo = {
  'package.json': json({
    name: '@listening/monorepo',
    description: 'Listen to anything',
    workspaces: { packages: ['apps/*', 'packages/*', 'packages/config/*'] },
  }),
  'apps/web/package.json': json({
    name: '@listening/web',
    dependencies: { '@tanstack/react-start': 'catalog:' },
  }),
  'apps/blog/package.json': json({
    name: '@listening/blog',
    dependencies: { foldkit: 'catalog:' },
  }),
  'apps/mobile/package.json': json({
    name: '@listening/mobile',
    dependencies: { expo: 'catalog:' },
  }),
  'apps/api/package.json': json({
    name: '@listening/api',
    dependencies: { effect: 'catalog:', '@effect/platform-bun': 'catalog:' },
  }),
  'apps/api/src/main.ts': "import { HttpApiBuilder } from 'effect/http-api';\n",
  'apps/tool/package.json': json({
    name: '@listening/tool',
    bin: { tool: './src/bin.ts' },
    dependencies: { effect: 'catalog:' },
  }),
  'apps/tool/src/bin.ts': "import { Command } from 'effect/cli';\n",
  'apps/desktop/package.json': json({
    name: '@listening/desktop',
    dependencies: { electron: '^1' },
  }),
  'packages/domain/package.json': json({
    name: '@listening/domain',
    exports: { '.': './src/index.ts' },
  }),
  'packages/domain/src/index.ts': 'export {};\n',
  'packages/env/package.json': json({
    name: '@listening/env',
    exports: { '.': './src/index.ts' },
  }),
  'packages/env/src/index.ts': '',
  'packages/oxlint-plugins/package.json': json({
    name: '@listening/oxlint-plugins',
    exports: { '.': './src/index.ts' },
  }),
  'packages/oxlint-plugins/src/index.ts': '',
  'packages/config/typescript-config/package.json': json({
    name: '@listening/typescript-config',
    exports: { '.': './x.json' },
  }),
  'packages/no-src/package.json': json({
    name: '@listening/no-src',
    exports: { '.': './index.js' },
  }),
  'turbo.jsonc': '{}',
  '.env.schema': '',
  'alchemy.run.ts':
    "import * as Cloudflare from 'alchemy/Cloudflare';\nexport default Stack('x', { state: Cloudflare.state() });\n",
  'packages/infra/src/aws.ts': "import * as AWS from 'alchemy/AWS';\n",
  '.github/workflows/ci.yml': '',
  '.changeset/config.json': '{}',
  'AGENTS.md': '',
};

describe('inferConfig', () => {
  it.effect('infers name, scope, apps, libraries and repo features', () =>
    Effect.gen(function* () {
      const config = yield* inferConfig(
        makeMemoryRepo(repo, '/home/me/listening-astro'),
      );
      yield* decodeConfig(config);
      assert.strictEqual(config.name, 'listening');
      assert.strictEqual(config.scope, 'listening');
      assert.strictEqual(config.description, 'Listen to anything');
      assert.deepStrictEqual(
        Arr.sort(
          Arr.map(config.apps, (app) => `${app.name}:${app.kind}`),
          Order.String,
        ),
        [
          'api:effect-api',
          'blog:foldkit',
          'mobile:expo',
          'tool:effect-cli',
          'web:tanstack-start',
        ],
      );
      assert.deepStrictEqual(config.packages, [
        { name: 'domain', kind: 'library' },
      ]);
      assert.strictEqual(config.taskRunner, 'turbo');
      assert.strictEqual(config.secrets, 'varlock');
      assert.deepStrictEqual(config.infra, {
        kind: 'alchemy',
        deploy: 'cloudflare',
        state: 'cloudflare',
      });
      assert.strictEqual(config.ci, 'github');
      assert.deepStrictEqual(config.features, {
        changesets: true,
        agents: true,
        vscode: false,
      });
      assert.deepStrictEqual(config.nixPackages, []);
    }),
  );

  it.effect('detects nx, secretspec and the absence of infra/ci', () =>
    Effect.gen(function* () {
      const config = yield* inferConfig(
        makeMemoryRepo({
          'package.json': json({ name: 'My_Project', workspaces: ['apps/*'] }),
          'apps/web/package.json': json({ name: '@mp/web' }),
          'nx.json': '{}',
          'apps/web/secretspec.toml': '',
          '.vscode/settings.json': '{}',
        }),
      );
      assert.strictEqual(config.name, 'my-project');
      assert.strictEqual(config.scope, 'mp');
      assert.strictEqual(config.taskRunner, 'nx');
      assert.strictEqual(config.secrets, 'secretspec');
      assert.deepStrictEqual(config.infra, { kind: 'none' });
      assert.strictEqual(config.ci, 'none');
      assert.isTrue(config.features.vscode);
    }),
  );

  it.effect('falls back to the directory name without a package.json', () =>
    Effect.gen(function* () {
      const config = yield* inferConfig(makeMemoryRepo({}, '/x/Some Repo'));
      assert.deepStrictEqual(config, defaultConfig('some-repo'));
    }),
  );
});
