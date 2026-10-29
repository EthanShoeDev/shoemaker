import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Option, pipe, String as Str } from 'effect';

import type { App, ShoemakerConfig } from '../../../src/config/schema.ts';
import type { FileStrategy } from '../../../src/engine/types.ts';
import { appGenerators } from '../../../src/generators/apps/index.ts';
import { libraryGenerator } from '../../../src/generators/apps/library.ts';
import {
  assertCatalogComplete,
  assertSourcesParse,
  assertStrategies,
  contribute,
  parseJson,
  record,
  sampleConfig,
} from './helpers.ts';

const allApps = (config: ShoemakerConfig) => {
  const contributions = Arr.map(appGenerators, (generator) =>
    contribute(generator, config),
  );
  const files = Arr.flatMap(contributions, (c) => c.files);
  const file = (path: string) =>
    pipe(
      Arr.findFirst(files, (candidate) => candidate.path === path),
      Option.getOrThrowWith(() => new Error(`${path} was not generated`)),
    );
  return { files, file, contributions };
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
      ['apps/api/src/api.ts', 'seed'],
      ['apps/api/src/handlers.ts', 'seed'],
      ['apps/api/src/bin.ts', 'seed'],
      ['apps/api/test/api.test.ts', 'seed'],
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
  const { files, contributions } = allApps(config);
  const byPath = new Map(Arr.map(files, (file) => [file.path, file] as const));

  it('emits its files with their sync strategies', () => {
    assertStrategies(byPath, expected);
    assert.isTrue(
      Arr.every(files, (file) =>
        Str.startsWith(`apps/${app.name}/`)(file.path),
      ),
    );
  });

  it('lists every dependency it uses in the catalog', () => {
    for (const { contribution } of contributions) {
      assertCatalogComplete(contribution);
    }
  });

  it('configures vitest as a project named by its package.json', () => {
    const vitest =
      byPath.get(`apps/${app.name}/vitest.config.ts`) ??
      byPath.get(`apps/${app.name}/vitest.config.mts`);
    assert.include(vitest?.content, 'defineProject(');
    assert.notInclude(vitest?.content, 'name:');
    // A vitest.config replaces vite.config; only Start merges it back in
    // (foldkit follows its upstream template, which does not).
    assert.strictEqual(
      Str.includes("import viteConfig from './vite.config.ts'")(
        vitest?.content ?? '',
      ),
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
  const { contribution, byPath, file } = contribute(libraryGenerator, config);

  it('emits a source-exporting package with a test', () => {
    assertStrategies(byPath, [
      ['packages/core/package.json', 'json-merge'],
      ['packages/core/tsconfig.json', 'owned'],
      ['packages/core/vitest.config.ts', 'owned'],
      ['packages/core/src/index.ts', 'seed'],
      ['packages/core/test/index.test.ts', 'seed'],
    ]);
    const manifest = parseJson(file('packages/core/package.json'));
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
    const { contributions, file } = allApps(config);
    const env = Arr.flatMap(
      contributions,
      ({ contribution }) => contribution.env ?? [],
    );
    assert.deepInclude(env[0], { key: 'PORT', default: '3000', type: 'port' });
    assert.include(file('apps/api/src/bin.ts').content, "Config.Port('PORT')");
    const manifest = parseJson(file('apps/api/package.json'));
    assert.isUndefined(record(manifest.dependencies)['@sample/env']);
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
    const { file } = allApps(
      sampleConfig({ apps: [{ name: 'tool', kind: 'effect-cli' }] }),
    );
    const manifest = parseJson(file('apps/tool/package.json'));
    assert.deepStrictEqual(manifest.bin, { tool: './src/bin.ts' });
  });

  it('expo is CommonJS and extends Expo’s tsconfig', () => {
    const { file } = allApps(
      sampleConfig({ apps: [{ name: 'mobile', kind: 'expo' }] }),
    );
    const read = (path: string) => parseJson(file(path));
    const manifest = read('apps/mobile/package.json');
    assert.isUndefined(manifest.type);
    assert.strictEqual(manifest.main, 'expo-router/entry');
    const tsconfig = read('apps/mobile/tsconfig.json');
    assert.strictEqual(tsconfig.extends, 'expo/tsconfig.base');
    assert.notProperty(
      record(manifest.devDependencies),
      'shoemaker-typescript-config',
    );
    // ESM config in a CommonJS package: `.mts`, and typechecked.
    assert.include(
      file('apps/mobile/vitest.config.mts').content,
      'vitest/config',
    );
    assert.include(tsconfig.include, '*.mts');
  });

  it('expo depends on what its app.config.ts turns on', () => {
    const { file } = allApps(
      sampleConfig({ apps: [{ name: 'mobile', kind: 'expo' }] }),
    );
    const manifest = parseJson(file('apps/mobile/package.json'));
    assert.property(record(manifest.dependencies), 'expo-system-ui');
    assert.include(
      file('apps/mobile/app.config.ts').content,
      'updates: { enabled: false }',
    );
  });

  it('foldkit imports its stylesheet from the entry module', () => {
    const { file } = allApps(
      sampleConfig({ apps: [{ name: 'site', kind: 'foldkit' }] }),
    );
    assert.include(
      file('apps/site/src/entry.ts').content,
      "import './styles.css';",
    );
    assert.notInclude(file('apps/site/index.html').content, 'styles.css');
  });

  it('tanstack-start wires varlock only outside Cloudflare', () => {
    const apps: ReadonlyArray<App> = [{ name: 'web', kind: 'tanstack-start' }];
    const vite = (config: ShoemakerConfig) =>
      allApps(config).file('apps/web/vite.config.ts').content;
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
      served.file('apps/web/src/routes/api.$.ts').content,
      "createFileRoute('/api/$')",
    );
    assert.include(
      served.file('apps/web/src/routeTree.gen.ts').content,
      "'/api/$': typeof ApiSplatRoute",
    );
    assert.include(
      served.file('apps/api/src/api.ts').content,
      ".prefix('/api')",
    );
  });

  it('picks the transport at the compiler boundary', () => {
    const client = served.file('apps/web/src/api-client.ts').content;
    assert.include(client, 'createIsomorphicFn()');
    assert.include(client, "from './api.server.ts'");
    assert.include(
      served.file('apps/web/src/routes/index.tsx').content,
      'callApi(',
    );
  });

  it("denies the API's handlers in the browser bundle", () => {
    assert.include(
      served.file('apps/web/vite.config.ts').content,
      "client: { specifiers: ['@sample/api/handlers'] }",
    );
  });

  it('depends on the API package, which exports its handlers', () => {
    const web = parseJson(served.file('apps/web/package.json'));
    assert.strictEqual(record(web.dependencies)['@sample/api'], 'workspace:*');
    const api = parseJson(served.file('apps/api/package.json'));
    assert.strictEqual(record(api.exports)['./handlers'], './src/handlers.ts');
  });

  it('deploys the API inside the site, with no Worker of its own', () => {
    const paths = Arr.map(served.files, (f) => f.path);
    assert.notInclude(paths, 'apps/api/src/worker.ts');
    const api = parseJson(served.file('apps/api/package.json'));
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
    assert.notInclude(plain.file('apps/api/src/api.ts').content, 'prefix');
    assert.notInclude(
      plain.file('apps/web/vite.config.ts').content,
      'importProtection',
    );
  });

  it.effect('emits TypeScript that parses', () =>
    assertSourcesParse(served.files),
  );
});
