import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, String as Str } from 'effect';

import type {
  App,
  DeployTarget,
  StateStore,
} from '../../../src/config/schema.ts';
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

const withInfra = (deploy: DeployTarget, state: StateStore) =>
  sampleConfig({ apps, infra: { kind: 'alchemy', deploy, state } });

const run = (deploy: DeployTarget, state: StateStore) =>
  contribute(alchemyInfra, withInfra(deploy, state)).file('alchemy.run.ts')
    .content;

const combos: ReadonlyArray<readonly [DeployTarget, StateStore]> = [
  ['cloudflare', 'local'],
  ['cloudflare', 'cloudflare'],
  ['aws', 'aws'],
  ['none', 'local'],
];

describe.each(combos)(
  'alchemy infra (deploy %s, state %s)',
  (deploy, state) => {
    const { contribution, files, byPath, file } = contribute(
      alchemyInfra,
      withInfra(deploy, state),
    );

    it('emits one root Stack and no infra package', () => {
      assertStrategies(byPath, [
        ['alchemy.run.ts', 'seed'],
        ['package.json', 'json-merge'],
      ]);
      assert.isFalse(
        Arr.some(files, (f) => Str.startsWith('packages/infra/')(f.path)),
      );
    });

    it('wraps the root infra scripts with the secrets manager', () => {
      const scripts = record(parseJson(file('package.json')).scripts);
      assert.deepStrictEqual(scripts, {
        'infra:dev': 'varlock run -- alchemy dev',
        'infra:plan': 'varlock run -- alchemy plan',
        'infra:deploy': 'varlock run -- alchemy deploy',
        'infra:destroy': 'varlock run -- alchemy destroy',
      });
    });

    it('lists every dependency in the catalog', () => {
      assertCatalogComplete(contribution);
    });

    it('leaves credentials to alchemy profiles and gitignores local state', () => {
      assert.deepStrictEqual(
        Arr.map(contribution.env ?? [], (v) => v.key),
        ['ALCHEMY_STAGE', 'ALCHEMY_PROFILE'],
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
        infra: { kind: 'alchemy', deploy: 'cloudflare', state: 'local' },
      }),
    );
    const scripts = record(parseJson(file('package.json')).scripts);
    const via = (verb: string) =>
      `secretspec run --profile development -- bun run alchemy ${verb}`;
    assert.deepStrictEqual(scripts, {
      alchemy: 'alchemy',
      'infra:dev': via('dev'),
      'infra:plan': via('plan'),
      'infra:deploy': via('deploy'),
      'infra:destroy': via('destroy'),
    });
  });
});

describe('deploy targets', () => {
  it('deploys sites and the API Worker to Cloudflare', () => {
    const source = run('cloudflare', 'local');
    assert.include(source, "Cloudflare.Website.Vite('Web'");
    assert.include(source, "Cloudflare.Website.Foldkit('Site'");
    assert.include(
      source,
      "rootDir: path.resolve(import.meta.dirname, 'apps/web')",
    );
    assert.include(source, "import Api from './apps/api/src/worker.ts';");
    assert.include(source, 'const api = yield* Api;');
    assert.include(source, 'providers: Cloudflare.providers()');
    assert.notInclude(source, 'Mobile');
  });

  it("installs the Stack's imports at the root, where alchemy runs", () => {
    const { file } = contribute(alchemyInfra, withInfra('cloudflare', 'local'));
    const devDependencies = record(
      parseJson(file('package.json')).devDependencies,
    );
    assert.strictEqual(devDependencies['@alchemy.run/cloudflare'], 'catalog:');
    assert.isUndefined(devDependencies['@sample/api']);
  });

  it('keys the root typecheck and lint on the Worker sources', () => {
    const { contribution } = contribute(
      alchemyInfra,
      withInfra('cloudflare', 'local'),
    );
    const tasks = contribution.tasks ?? [];
    assert.deepStrictEqual(
      Arr.map(tasks, (task) => [task.name, task.root, task.inputs]),
      Arr.map(['typecheck', 'oxlint:check', 'oxlint:fix'], (name) => [
        name,
        true,
        ['apps/api/package.json', 'apps/api/src/**'],
      ]),
    );
  });

  it('deploys sites to AWS, which has no Worker for the API', () => {
    const source = run('aws', 'aws');
    assert.include(source, "AWS.Website.TanStackStart('Web'");
    assert.include(source, "AWS.Website.Foldkit('Site'");
    assert.notInclude(source, 'Api');
    const { contribution } = contribute(alchemyInfra, withInfra('aws', 'aws'));
    assert.deepStrictEqual(contribution.tasks, []);
  });

  it('starts an empty Stack with no providers when nothing deploys', () => {
    const source = run('none', 'local');
    assert.include(source, 'providers: Layer.empty');
    assert.include(source, 'Effect.succeed({})');
    assert.notInclude(source, '@alchemy.run/');
  });

  it('contributes nothing without alchemy', () => {
    const { files } = contribute(alchemyInfra, sampleConfig({ apps }));
    assert.deepStrictEqual(files, []);
  });
});

describe('state stores', () => {
  it('keeps state where the config says, independent of the deploy target', () => {
    assert.include(run('cloudflare', 'local'), 'state: Alchemy.localState()');
    assert.include(
      run('cloudflare', 'cloudflare'),
      'state: Cloudflare.state()',
    );
    const mixed = run('cloudflare', 'aws');
    assert.include(mixed, 'state: AWS.state()');
    assert.include(mixed, "import * as AWS from '@alchemy.run/aws';");
    assert.include(mixed, 'providers: Cloudflare.providers()');
    assert.include(run('none', 'aws'), 'providers: Layer.empty');
  });
});

describe('registration', () => {
  it('is part of the generator pipeline', () => {
    assert.include(infraGenerators, alchemyInfra);
    const { files } = generate(withInfra('cloudflare', 'local'));
    const paths = Arr.map(files, (file) => file.path);
    assert.includeMembers(paths, [
      'alchemy.run.ts',
      'apps/web/vite.config.ts',
      'apps/api/src/worker.ts',
    ]);
    assert.notInclude(paths, 'packages/infra/package.json');
  });
});
