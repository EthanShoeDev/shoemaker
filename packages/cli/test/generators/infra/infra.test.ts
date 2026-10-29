import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, pipe, String as Str } from 'effect';

import type { App, InfraProvider } from '../../../src/config/schema.ts';
import { generate } from '../../../src/engine/generate.ts';
import { alchemyInfra } from '../../../src/generators/infra/alchemy.ts';
import { infraGenerators } from '../../../src/generators/infra/index.ts';
import {
  assertCatalogComplete,
  assertSourcesParse,
  assertStrategies,
  contribute,
  parseJson,
  record,
  sampleConfig,
} from '../apps/helpers.ts';

const apps: ReadonlyArray<App> = [
  { name: 'web', kind: 'tanstack-start' },
  { name: 'site', kind: 'foldkit' },
  { name: 'api', kind: 'effect-api' },
  { name: 'mobile', kind: 'expo' },
];

const withProviders = (providers: ReadonlyArray<InfraProvider>) =>
  sampleConfig({ apps, infra: { kind: 'alchemy', providers } });

const providerSets: ReadonlyArray<ReadonlyArray<InfraProvider>> = [
  ['cloudflare'],
  ['aws'],
  ['cloudflare', 'aws'],
];

describe.each(Arr.map(providerSets, (set) => [set]))(
  'alchemy infra (%j)',
  (providers) => {
    const { contribution, files, byPath, file } = contribute(
      alchemyInfra,
      withProviders(providers),
    );

    it('emits the infra package and the root entrypoint', () => {
      assertStrategies(byPath, [
        ['packages/infra/package.json', 'json-merge'],
        ['packages/infra/tsconfig.json', 'owned'],
        ['packages/infra/vitest.config.ts', 'owned'],
        ['packages/infra/alchemy.run.ts', 'seed'],
        ['packages/infra/src/stack.ts', 'seed'],
        ['packages/infra/src/providers.ts', 'seed'],
        ['packages/infra/src/stage.ts', 'seed'],
        ['alchemy.run.ts', 'owned'],
        ['package.json', 'json-merge'],
      ]);
      assert.strictEqual(
        file('alchemy.run.ts').content,
        "export { default } from './packages/infra/alchemy.run.ts';\n",
      );
    });

    it('wraps the root infra scripts with the secrets manager', () => {
      const scripts = record(parseJson(file('package.json')).scripts);
      assert.deepStrictEqual(scripts, {
        'infra:plan': 'varlock run -- alchemy plan',
        'infra:deploy': 'varlock run -- alchemy deploy',
        'infra:destroy': 'varlock run -- alchemy destroy',
      });
    });

    it('merges a layer per chosen provider', () => {
      const source = file('packages/infra/src/providers.ts').content;
      for (const provider of providers) {
        const name = provider === 'aws' ? 'AWS' : 'Cloudflare';
        assert.include(source, `${name}.providers()`);
      }
    });

    it('lists every dependency in the catalog', () => {
      assertCatalogComplete(contribution);
    });

    it('declares the provider credentials and gitignores local state', () => {
      const keys = Arr.map(contribution.env ?? [], (v) => v.key);
      assert.include(keys, 'ALCHEMY_STAGE');
      if (providers.includes('cloudflare')) {
        assert.includeMembers(keys, [
          'CLOUDFLARE_API_TOKEN',
          'CLOUDFLARE_ACCOUNT_ID',
        ]);
      }
      if (providers.includes('aws')) {
        assert.includeMembers(keys, ['AWS_PROFILE', 'AWS_REGION']);
      }
      assert.isTrue(
        pipe(
          contribution.env ?? [],
          Arr.filter((v) => Str.startsWith('CLOUDFLARE_')(v.key)),
          Arr.every((v) => v.sensitive),
        ),
      );
      assert.include(contribution.gitignore ?? [], '.alchemy/');
    });

    it.effect('emits TypeScript that parses', () => assertSourcesParse(files));
  },
);

describe('infra scripts under secretspec', () => {
  it('routes the CLI through a plain alchemy script knip can trace', () => {
    const { file } = contribute(
      alchemyInfra,
      sampleConfig({
        apps,
        secrets: 'secretspec',
        infra: { kind: 'alchemy', providers: ['cloudflare'] },
      }),
    );
    const scripts = record(parseJson(file('package.json')).scripts);
    assert.deepStrictEqual(scripts, {
      alchemy: 'alchemy',
      'infra:plan':
        'secretspec run --profile development -- bun run alchemy plan',
      'infra:deploy':
        'secretspec run --profile development -- bun run alchemy deploy',
      'infra:destroy':
        'secretspec run --profile development -- bun run alchemy destroy',
    });
  });
});

describe('deploy targets', () => {
  const stack = (providers: ReadonlyArray<InfraProvider>) =>
    contribute(alchemyInfra, withProviders(providers)).file(
      'packages/infra/src/stack.ts',
    ).content;

  it('deploys sites and the API worker to Cloudflare', () => {
    const source = stack(['cloudflare']);
    assert.include(source, "Cloudflare.Website.Vite('Web'");
    assert.include(source, "Cloudflare.Website.Foldkit('Site'");
    assert.include(source, "main: 'apps/api/src/worker.ts'");
    assert.notInclude(source, 'Mobile');
  });

  it('deploys sites to AWS when Cloudflare is not chosen', () => {
    const source = stack(['aws']);
    assert.include(source, "AWS.Website.TanStackStart('Web'");
    assert.include(source, "AWS.Website.Foldkit('Site'");
    assert.notInclude(source, 'Api');
  });

  it('keeps state with the primary provider', () => {
    const run = (providers: ReadonlyArray<InfraProvider>) =>
      contribute(alchemyInfra, withProviders(providers)).file(
        'packages/infra/alchemy.run.ts',
      ).content;
    assert.include(run(['cloudflare', 'aws']), 'state: Cloudflare.state()');
    assert.include(run(['aws']), 'state: AWS.state()');
  });

  it('contributes nothing without alchemy', () => {
    const { files } = contribute(alchemyInfra, sampleConfig({ apps }));
    assert.deepStrictEqual(files, []);
  });
});

describe('registration', () => {
  it('is part of the generator pipeline', () => {
    assert.include(infraGenerators, alchemyInfra);
    const { files } = generate(withProviders(['cloudflare']));
    const paths = Arr.map(files, (file) => file.path);
    assert.includeMembers(paths, [
      'alchemy.run.ts',
      'packages/infra/alchemy.run.ts',
      'apps/web/vite.config.ts',
      'apps/api/src/worker.ts',
    ]);
  });
});
