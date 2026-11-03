import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Option, Order } from 'effect';

import { inferConfig } from '../../src/adopt/infer.ts';
import {
  decodeConfig,
  defaultConfig,
  type ShoemakerConfig,
} from '../../src/config/schema.ts';
import { makeMemoryRepo } from '../../src/engine/repo-memory.ts';
import { compactJsonFiles } from '../checks/helpers.ts';

const repo = Effect.map(
  compactJsonFiles({
    'package.json': {
      name: '@listening/monorepo',
      description: 'Listen to anything',
      workspaces: { packages: ['apps/*', 'packages/*', 'packages/config/*'] },
    },
    'apps/web/package.json': {
      name: '@listening/web',
      dependencies: { '@tanstack/react-start': 'catalog:' },
    },
    'apps/blog/package.json': {
      name: '@listening/blog',
      dependencies: { foldkit: 'catalog:' },
    },
    'apps/mobile/package.json': {
      name: '@listening/mobile',
      dependencies: { expo: 'catalog:' },
    },
    'apps/api/package.json': {
      name: '@listening/api',
      dependencies: { effect: 'catalog:', '@effect/platform-bun': 'catalog:' },
    },
    'apps/tool/package.json': {
      name: '@listening/tool',
      bin: { tool: './src/bin.ts' },
      dependencies: { effect: 'catalog:' },
    },
    'apps/desktop/package.json': {
      name: '@listening/desktop',
      dependencies: { electron: '^1' },
    },
    'packages/domain/package.json': {
      name: '@listening/domain',
      exports: { '.': './src/index.ts' },
    },
    'packages/env/package.json': {
      name: '@listening/env',
      exports: { '.': './src/index.ts' },
    },
    'packages/oxlint-plugins/package.json': {
      name: '@listening/oxlint-plugins',
      exports: { '.': './src/index.ts' },
    },
    'packages/config/typescript-config/package.json': {
      name: '@listening/typescript-config',
      exports: { '.': './x.json' },
    },
    'packages/no-src/package.json': {
      name: '@listening/no-src',
      exports: { '.': './index.js' },
    },
  }),
  (manifests) => ({
    ...manifests,
    'apps/api/src/main.ts':
      "import { HttpApiBuilder } from 'effect/http-api';\n",
    'apps/tool/src/bin.ts': "import { Command } from 'effect/cli';\n",
    'packages/domain/src/index.ts': 'export {};\n',
    'packages/env/src/index.ts': '',
    'packages/oxlint-plugins/src/index.ts': '',
    'turbo.jsonc': '{}',
    '.env.schema': '',
    'alchemy.run.ts':
      "import * as Cloudflare from 'alchemy/Cloudflare';\nexport default Stack('x', { state: Cloudflare.state() });\n",
    'packages/infra/src/aws.ts': "import * as AWS from 'alchemy/AWS';\n",
    '.github/workflows/ci.yml': '',
    '.changeset/config.json': '{}',
    'AGENTS.md': '',
  }),
);

describe('inferConfig', () => {
  it.effect('infers name, scope, apps, libraries and repo features', () =>
    Effect.gen(function* () {
      const files = yield* repo;
      const config = yield* inferConfig(
        makeMemoryRepo(files, '/home/me/listening-astro'),
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

  it.effect('keeps how each app renders and runs on disk', () =>
    Effect.gen(function* () {
      const files = yield* repo;
      const appOf = (config: ShoemakerConfig, name: string) =>
        Arr.findFirst(config.apps, (app) => app.name === name);
      const spa = yield* inferConfig(makeMemoryRepo(files));
      assert.deepStrictEqual(Option.getOrUndefined(appOf(spa, 'blog')), {
        name: 'blog',
        kind: 'foldkit',
        rendering: 'spa',
      });
      const rendered = yield* inferConfig(
        makeMemoryRepo({
          ...files,
          'apps/blog/src/entry.server.ts': 'export {};\n',
          'apps/api/src/worker.ts': 'export {};\n',
        }),
      );
      yield* decodeConfig(rendered);
      assert.deepStrictEqual(Option.getOrUndefined(appOf(rendered, 'blog')), {
        name: 'blog',
        kind: 'foldkit',
      });
      assert.deepStrictEqual(Option.getOrUndefined(appOf(rendered, 'api')), {
        name: 'api',
        kind: 'effect-api',
        runtime: 'worker',
      });
    }),
  );

  it.effect('detects nx, secretspec and the absence of infra/ci', () =>
    Effect.gen(function* () {
      const manifests = yield* compactJsonFiles({
        'package.json': { name: 'My_Project', workspaces: ['apps/*'] },
        'apps/web/package.json': { name: '@mp/web' },
      });
      const config = yield* inferConfig(
        makeMemoryRepo({
          ...manifests,
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

  it.effect('lists the GitHub provider, which deploys nothing', () =>
    Effect.gen(function* () {
      const manifests = yield* compactJsonFiles({
        'package.json': { name: 'gh-only' },
      });
      const config = yield* inferConfig(
        makeMemoryRepo({
          ...manifests,
          'alchemy.run.ts':
            "import * as GitHub from '@alchemy.run/github';\nexport default Alchemy.Stack('x', { providers: GitHub.providers() });\n",
        }),
      );
      yield* decodeConfig(config);
      assert.deepStrictEqual(config.infra, {
        kind: 'alchemy',
        deploy: 'none',
        state: 'local',
        providers: ['github'],
      });
    }),
  );

  it.effect('sees a site that serves an effect-api app at /api', () =>
    Effect.gen(function* () {
      const manifests = yield* compactJsonFiles({
        'package.json': { name: 'shop', workspaces: ['apps/*'] },
        'apps/web/package.json': {
          name: '@shop/web',
          dependencies: {
            '@shop/api': 'workspace:*',
            '@tanstack/react-start': 'catalog:',
          },
        },
        'apps/api/package.json': {
          name: '@shop/api',
          dependencies: {
            '@effect/platform-bun': 'catalog:',
            effect: 'catalog:',
          },
        },
      });
      const config = yield* inferConfig(
        makeMemoryRepo({
          ...manifests,
          'apps/web/src/routes/api.$.ts': '',
          'apps/api/src/handlers.ts': 'HttpApiBuilder.group(Api)',
        }),
      );
      yield* decodeConfig(config);
      assert.deepStrictEqual(config.apps, [
        { name: 'api', kind: 'effect-api' },
        { name: 'web', kind: 'tanstack-start', api: 'api' },
      ]);
    }),
  );

  it.effect("takes an API's contract package as part of the API", () =>
    Effect.gen(function* () {
      const manifests = yield* compactJsonFiles({
        'package.json': { name: 'shop', workspaces: ['apps/*', 'packages/*'] },
        'apps/api/package.json': {
          name: '@shop/api',
          dependencies: {
            '@effect/platform-bun': 'catalog:',
            '@shop/api-contract': 'workspace:*',
            effect: 'catalog:',
          },
        },
        'packages/api-contract/package.json': {
          name: '@shop/api-contract',
          exports: { '.': './src/index.ts' },
        },
      });
      const config = yield* inferConfig(
        makeMemoryRepo({
          ...manifests,
          'apps/api/src/handlers.ts': 'HttpApiBuilder.group(Api)',
          'packages/api-contract/src/index.ts': 'HttpApi.make("api")',
        }),
      );
      yield* decodeConfig(config);
      assert.deepStrictEqual(config.apps, [
        { name: 'api', kind: 'effect-api' },
      ]);
      assert.deepStrictEqual(config.packages, []);
    }),
  );

  it.effect('falls back to the directory name without a package.json', () =>
    Effect.gen(function* () {
      const config = yield* inferConfig(makeMemoryRepo({}, '/x/Some Repo'));
      assert.deepStrictEqual(config, defaultConfig('some-repo'));
    }),
  );
});
