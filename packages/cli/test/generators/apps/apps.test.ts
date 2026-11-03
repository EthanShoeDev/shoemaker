import { assert, describe, it } from '@effect/vitest';
import {
  Array as Arr,
  Effect,
  pipe,
  Record as Rec,
  String as Str,
} from 'effect';

import type { App, ShoemakerConfig } from '../../../src/config/schema.ts';
import type { FileStrategy } from '../../../src/engine/types.ts';
import { frontendGenerator } from '../../../src/generators/apps/frontend.ts';
import { appGenerators } from '../../../src/generators/apps/index.ts';
import { libraryGenerator } from '../../../src/generators/apps/library.ts';
import { lookup, record } from '../files.ts';
import {
  assertCatalogComplete,
  assertSourcesParse,
  assertStrategies,
  contribute,
  sampleConfig,
} from './helpers.ts';

const allApps = (config: ShoemakerConfig) => {
  const contributions = Arr.map(appGenerators, (generator) =>
    contribute(generator, config),
  );
  const files = Arr.flatMap(contributions, (c) => c.files);
  return { files, contributions, ...lookup(files) };
};

const cases: ReadonlyArray<{
  readonly app: App;
  readonly files: ReadonlyArray<readonly [string, FileStrategy]>;
}> = [
  {
    app: { name: 'web', kind: 'tanstack-start' },
    files: [
      ['apps/web/package.json', 'json-merge'],
      ['apps/web/tsconfig.json', 'owned'],
      ['apps/web/vitest.config.ts', 'owned'],
      ['apps/web/vite.config.ts', 'owned'],
      ['apps/web/src/router.tsx', 'seed'],
      ['apps/web/src/routeTree.gen.ts', 'seed'],
      ['apps/web/src/routes/__root.tsx', 'seed'],
      ['apps/web/src/routes/index.tsx', 'seed'],
      ['apps/web/src/styles.css', 'seed'],
      ['apps/web/test/welcome.test.tsx', 'seed'],
      ['apps/web/README.md', 'seed'],
    ],
  },
  {
    app: { name: 'site', kind: 'foldkit' },
    files: [
      ['apps/site/package.json', 'json-merge'],
      ['apps/site/tsconfig.json', 'owned'],
      ['apps/site/vitest.config.ts', 'owned'],
      ['apps/site/vite.config.ts', 'owned'],
      ['apps/site/index.html', 'seed'],
      ['apps/site/src/entry.ts', 'seed'],
      ['apps/site/src/main.ts', 'seed'],
      ['apps/site/src/vitest-setup.ts', 'seed'],
      ['apps/site/src/story.test.ts', 'seed'],
      ['apps/site/src/scene.test.ts', 'seed'],
    ],
  },
  {
    app: { name: 'mobile', kind: 'expo' },
    files: [
      ['apps/mobile/package.json', 'json-merge'],
      ['apps/mobile/tsconfig.json', 'owned'],
      ['apps/mobile/vitest.config.mts', 'owned'],
      ['apps/mobile/metro.config.ts', 'owned'],
      ['apps/mobile/app.config.ts', 'seed'],
      ['apps/mobile/app/_layout.tsx', 'seed'],
      ['apps/mobile/app/index.tsx', 'seed'],
      ['apps/mobile/test/greeting.test.ts', 'seed'],
    ],
  },
  {
    app: { name: 'api', kind: 'effect-api' },
    files: [
      ['apps/api/package.json', 'json-merge'],
      ['apps/api/tsconfig.json', 'owned'],
      ['apps/api/vitest.config.ts', 'owned'],
      ['apps/api/tsdown.config.ts', 'owned'],
      ['apps/api/src/handlers.ts', 'seed'],
      ['apps/api/src/bin.ts', 'seed'],
      ['apps/api/test/api.test.ts', 'seed'],
      ['packages/api-contract/package.json', 'json-merge'],
      ['packages/api-contract/tsconfig.json', 'owned'],
      ['packages/api-contract/vitest.config.ts', 'owned'],
      ['packages/api-contract/src/index.ts', 'seed'],
      ['packages/api-contract/test/index.test.ts', 'seed'],
    ],
  },
  {
    app: { name: 'tool', kind: 'effect-cli' },
    files: [
      ['apps/tool/package.json', 'json-merge'],
      ['apps/tool/tsconfig.json', 'owned'],
      ['apps/tool/vitest.config.ts', 'owned'],
      ['apps/tool/tsdown.config.ts', 'owned'],
      ['apps/tool/src/cli.ts', 'seed'],
      ['apps/tool/src/bin.ts', 'seed'],
      ['apps/tool/test/cli.test.ts', 'seed'],
    ],
  },
];

describe.each(cases)('$app.kind app', ({ app, files: expected }) => {
  const config = sampleConfig({ apps: [app] });
  const { files, contributions, byPath, text } = allApps(config);

  it('emits its files with their sync strategies', () => {
    assertStrategies(byPath, expected);
    // An effect-api app also owns its contract package.
    assert.isTrue(
      Arr.every(
        files,
        (file) =>
          Str.startsWith(`apps/${app.name}/`)(file.path) ||
          (app.kind === 'effect-api' &&
            Str.startsWith(`packages/${app.name}-contract/`)(file.path)),
      ),
    );
  });

  it('lists every dependency it uses in the catalog', () => {
    for (const { contribution } of contributions) {
      assertCatalogComplete(contribution);
    }
  });

  it('configures vitest as a project named by its package.json', () => {
    const vitest = text(
      byPath.has(`apps/${app.name}/vitest.config.ts`)
        ? `apps/${app.name}/vitest.config.ts`
        : `apps/${app.name}/vitest.config.mts`,
    );
    assert.include(vitest, 'defineProject(');
    assert.notInclude(vitest, 'name:');
    // A vitest.config replaces vite.config; only Start merges it back in
    // (foldkit follows its upstream template, which does not).
    assert.strictEqual(
      Str.includes("import viteConfig from './vite.config.ts'")(vitest),
      app.kind === 'tanstack-start',
    );
  });

  it('leaves dev and build to the root task definitions', () => {
    const overridden = pipe(
      contributions,
      Arr.flatMap(({ contribution }) => contribution.tasks ?? []),
      Arr.filter((task) => task.name === 'dev' || task.name === 'build'),
    );
    assert.deepStrictEqual(overridden, []);
  });

  it.effect('emits TypeScript that parses', () => assertSourcesParse(files));
});

describe('library package', () => {
  const config = sampleConfig({
    packages: [{ name: 'core', kind: 'library' }],
  });
  const { contribution, byPath, json } = contribute(libraryGenerator, config);

  it('emits a source-exporting package with a test', () => {
    assertStrategies(byPath, [
      ['packages/core/package.json', 'json-merge'],
      ['packages/core/tsconfig.json', 'owned'],
      ['packages/core/vitest.config.ts', 'owned'],
      ['packages/core/src/index.ts', 'seed'],
      ['packages/core/test/index.test.ts', 'seed'],
    ]);
    const manifest = json('packages/core/package.json');
    assert.deepStrictEqual(manifest.exports, {
      '.': './src/index.ts',
      './package.json': './package.json',
    });
    assert.strictEqual(manifest.type, 'module');
  });

  it('lists every dependency in the catalog', () => {
    assertCatalogComplete(contribution);
  });

  it.effect('emits TypeScript that parses', () =>
    assertSourcesParse(contribution.files ?? []),
  );
});

describe('kind specifics', () => {
  it('effect-api reads PORT through Effect Config', () => {
    const config = sampleConfig({
      apps: [{ name: 'api', kind: 'effect-api' }],
    });
    const { contributions, text, json } = allApps(config);
    const env = Arr.flatMap(
      contributions,
      ({ contribution }) => contribution.env ?? [],
    );
    assert.deepInclude(env[0], { key: 'PORT', default: '3000', type: 'port' });
    assert.include(text('apps/api/src/bin.ts'), "Config.Port('PORT')");
    const manifest = json('apps/api/package.json');
    assert.isUndefined(record(manifest.dependencies)['@sample/env']);
  });

  it('effect-api keeps its HttpApi in a contract package clients share', () => {
    const { text, json } = allApps(
      sampleConfig({ apps: [{ name: 'api', kind: 'effect-api' }] }),
    );
    const contract = json('packages/api-contract/package.json');
    assert.strictEqual(contract.name, '@sample/api-contract');
    assert.deepStrictEqual(Rec.keys(record(contract.dependencies)), ['effect']);
    assert.include(
      text('packages/api-contract/src/index.ts'),
      "export class Api extends HttpApi.make('api')",
    );
    const api = json('apps/api/package.json');
    assert.strictEqual(
      record(api.dependencies)['@sample/api-contract'],
      'workspace:*',
    );
    assert.include(
      text('apps/api/src/handlers.ts'),
      "import { Api } from '@sample/api-contract';",
    );
  });

  it('effect-api only ships a Worker entry when Cloudflare deploys it', () => {
    const apps: ReadonlyArray<App> = [{ name: 'api', kind: 'effect-api' }];
    const plain = allApps(sampleConfig({ apps }));
    const cloudflare = allApps(
      sampleConfig({
        apps,
        infra: { kind: 'alchemy', deploy: 'cloudflare', state: 'local' },
      }),
    );
    const worker = (files: typeof plain.files) =>
      Arr.some(files, (f) => f.path === 'apps/api/src/worker.ts');
    assert.isFalse(worker(plain.files));
    assert.isTrue(worker(cloudflare.files));
  });

  it('effect-cli exposes a bin', () => {
    const { json } = allApps(
      sampleConfig({ apps: [{ name: 'tool', kind: 'effect-cli' }] }),
    );
    const manifest = json('apps/tool/package.json');
    assert.deepStrictEqual(manifest.bin, { tool: './src/bin.ts' });
  });

  it('expo is CommonJS and extends Expo’s tsconfig', () => {
    const { text, json } = allApps(
      sampleConfig({ apps: [{ name: 'mobile', kind: 'expo' }] }),
    );
    const manifest = json('apps/mobile/package.json');
    assert.isUndefined(manifest.type);
    assert.strictEqual(manifest.main, 'expo-router/entry');
    const tsconfig = json('apps/mobile/tsconfig.json');
    assert.strictEqual(tsconfig.extends, 'expo/tsconfig.base');
    assert.notProperty(
      record(manifest.devDependencies),
      'shoemaker-typescript-config',
    );
    // ESM config in a CommonJS package: `.mts`, and typechecked.
    assert.include(text('apps/mobile/vitest.config.mts'), 'vitest/config');
    assert.include(tsconfig.include, '*.mts');
  });

  it('expo depends on what its app.config.ts turns on', () => {
    const { text, json } = allApps(
      sampleConfig({ apps: [{ name: 'mobile', kind: 'expo' }] }),
    );
    const manifest = json('apps/mobile/package.json');
    assert.property(record(manifest.dependencies), 'expo-system-ui');
    assert.include(
      text('apps/mobile/app.config.ts'),
      'updates: { enabled: false }',
    );
  });

  it('foldkit imports its stylesheet from the entry module', () => {
    const { text } = allApps(
      sampleConfig({ apps: [{ name: 'site', kind: 'foldkit' }] }),
    );
    assert.include(text('apps/site/src/entry.ts'), "import './styles.css';");
    assert.notInclude(text('apps/site/index.html'), 'styles.css');
  });

  it('tanstack-start wires varlock only outside Cloudflare', () => {
    const apps: ReadonlyArray<App> = [{ name: 'web', kind: 'tanstack-start' }];
    const vite = (config: ShoemakerConfig) =>
      allApps(config).text('apps/web/vite.config.ts');
    assert.include(vite(sampleConfig({ apps })), 'varlockVitePlugin()');
    assert.notInclude(
      vite(sampleConfig({ apps, secrets: 'secretspec' })),
      'varlock',
    );
    assert.notInclude(
      vite(
        sampleConfig({
          apps,
          infra: { kind: 'alchemy', deploy: 'cloudflare', state: 'local' },
        }),
      ),
      'varlock',
    );
  });

  it.effect('every kind together still parses', () =>
    Effect.suspend(() => {
      const config = sampleConfig({
        apps: Arr.map(cases, ({ app }) => app),
        packages: [{ name: 'core', kind: 'library' }],
        infra: { kind: 'alchemy', deploy: 'cloudflare', state: 'local' },
      });
      return assertSourcesParse(allApps(config).files);
    }),
  );
});

describe('tanstack-start serving an effect-api app', () => {
  const apps: ReadonlyArray<App> = [
    { name: 'web', kind: 'tanstack-start', api: 'api' },
    { name: 'api', kind: 'effect-api' },
  ];
  const served = allApps(
    sampleConfig({
      apps,
      infra: { kind: 'alchemy', deploy: 'cloudflare', state: 'local' },
    }),
  );

  it('mounts the API at /api and calls it through one client', () => {
    const paths = Arr.map(served.files, (f) => f.path);
    assert.includeMembers(paths, [
      'apps/web/src/api.server.ts',
      'apps/web/src/api-client.ts',
      'apps/web/src/routes/api.$.ts',
      'apps/web/test/api-client.test.ts',
    ]);
    assert.include(
      served.text('apps/web/src/routes/api.$.ts'),
      "createFileRoute('/api/$')",
    );
    assert.include(
      served.text('apps/web/src/routeTree.gen.ts'),
      "'/api/$': typeof ApiSplatRoute",
    );
    assert.include(
      served.text('packages/api-contract/src/index.ts'),
      ".prefix('/api')",
    );
  });

  it('picks the transport at the compiler boundary', () => {
    const client = served.text('apps/web/src/api-client.ts');
    assert.include(client, 'createIsomorphicFn()');
    assert.include(client, "from './api.server.ts'");
    assert.include(client, "import { Api } from '@sample/api-contract';");
    assert.include(served.text('apps/web/src/routes/index.tsx'), 'callApi(');
  });

  it("denies the API's handlers in the browser bundle", () => {
    assert.include(
      served.text('apps/web/vite.config.ts'),
      "client: { specifiers: ['@sample/api/handlers'] }",
    );
  });

  it('depends on the contract, and on the API package for its handlers', () => {
    const web = served.json('apps/web/package.json');
    assert.strictEqual(record(web.dependencies)['@sample/api'], 'workspace:*');
    assert.strictEqual(
      record(web.dependencies)['@sample/api-contract'],
      'workspace:*',
    );
    const api = served.json('apps/api/package.json');
    assert.strictEqual(record(api.exports)['./handlers'], './src/handlers.ts');
  });

  it('deploys the API inside the site, with no Worker of its own', () => {
    const paths = Arr.map(served.files, (f) => f.path);
    assert.notInclude(paths, 'apps/api/src/worker.ts');
    const api = served.json('apps/api/package.json');
    assert.notProperty(record(api.dependencies), '@alchemy.run/cloudflare');
  });

  it('leaves a site without `api` unchanged', () => {
    const plain = allApps(
      sampleConfig({
        apps: [
          { name: 'web', kind: 'tanstack-start' },
          { name: 'api', kind: 'effect-api' },
        ],
      }),
    );
    const paths = Arr.map(plain.files, (f) => f.path);
    assert.notInclude(paths, 'apps/web/src/api-client.ts');
    assert.notInclude(
      plain.text('packages/api-contract/src/index.ts'),
      'prefix',
    );
    assert.notInclude(
      plain.text('apps/web/vite.config.ts'),
      'importProtection',
    );
  });

  it.effect('emits TypeScript that parses', () =>
    assertSourcesParse(served.files),
  );
});

describe('frontend package', () => {
  const apps: ReadonlyArray<App> = [
    { name: 'web', kind: 'tanstack-start', api: 'api' },
    { name: 'api', kind: 'effect-api' },
  ];
  const config = sampleConfig({
    apps,
    packages: [{ name: 'frontend', kind: 'frontend', api: 'api' }],
  });
  const { contribution, byPath, text, json } = contribute(
    frontendGenerator,
    config,
  );
  const site = allApps(config);

  it('emits atoms over the contract, with a test', () => {
    assertStrategies(byPath, [
      ['packages/frontend/package.json', 'json-merge'],
      ['packages/frontend/tsconfig.json', 'owned'],
      ['packages/frontend/vitest.config.ts', 'owned'],
      ['packages/frontend/src/api-client.ts', 'seed'],
      ['packages/frontend/src/greetings.ts', 'seed'],
      ['packages/frontend/test/greetings.test.ts', 'seed'],
      ['packages/frontend/README.md', 'seed'],
    ]);
    assert.include(
      text('packages/frontend/src/api-client.ts'),
      "import { Api } from '@sample/api-contract';",
    );
  });

  it('exports each module by path and imports no React', () => {
    const manifest = json('packages/frontend/package.json');
    assert.deepStrictEqual(manifest.exports, {
      './*': './src/*.ts',
      './package.json': './package.json',
    });
    const deps = record(manifest.dependencies);
    assert.strictEqual(deps['@sample/api-contract'], 'workspace:*');
    assert.notProperty(deps, 'react');
    assert.notProperty(record(manifest.devDependencies), 'bun-types');
  });

  it('wires the site through raf-effect-atom instead of callApi', () => {
    const paths = Arr.map(site.files, (f) => f.path);
    assert.includeMembers(paths, [
      'apps/web/src/api-transport.ts',
      'apps/web/test/api-transport.test.ts',
    ]);
    assert.notInclude(paths, 'apps/web/src/api-client.ts');
    assert.include(
      site.text('apps/web/src/router.tsx'),
      'withApiTransport(pageApiTransport())',
    );
    assert.include(
      site.text('apps/web/src/routes/__root.tsx'),
      "<WaterfallDetection mode='throw'>",
    );
    const index = site.text('apps/web/src/routes/index.tsx');
    assert.include(index, "context.atoms.ensure(greeting, 'world')");
    assert.include(index, "from '@sample/frontend/greetings'");
  });

  it('depends on the frontend package instead of the contract', () => {
    const web = site.json('apps/web/package.json');
    const deps = record(web.dependencies);
    assert.strictEqual(deps['@sample/frontend'], 'workspace:*');
    assert.strictEqual(deps['@sample/api'], 'workspace:*');
    assert.notProperty(deps, '@sample/api-contract');
    assert.strictEqual(deps['raf-effect-atom'], 'catalog:');
  });

  it('lists every dependency in the catalog', () => {
    assertCatalogComplete(contribution);
    for (const { contribution: app } of site.contributions) {
      assertCatalogComplete(app);
    }
  });

  it.effect('emits TypeScript that parses', () =>
    assertSourcesParse([...(contribution.files ?? []), ...site.files]),
  );
});
