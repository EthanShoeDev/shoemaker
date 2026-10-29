import { Array as Arr, pipe, String as Str } from 'effect';

import type { App, ShoeboxConfig } from '../../config/schema.ts';
import type { Contribution, GenContext } from '../../engine/types.ts';
import {
  catalogOf,
  effectTestDevDependencies,
  pascalCase,
  vitestConfig,
} from '../apps/common.ts';
import type { EnvVar } from '../secrets/model.ts';
import {
  json,
  owned,
  packageTsconfig,
  seed,
  withSecrets,
  workspacePackageJson,
} from '../shared.ts';
import { deployTarget } from './target.ts';

const dir = 'packages/infra';

const providerModules = {
  cloudflare: { name: 'Cloudflare', pkg: '@alchemy.run/cloudflare' },
  aws: { name: 'AWS', pkg: '@alchemy.run/aws' },
} as const;

// One deployable resource per app, as an expression yielded inside the
// stack's Effect.gen. Paths are repo-relative: the CLI runs from the root
// `alchemy.run.ts`. Kinds without an entry are not deployed by alchemy.
type ResourceFor = (id: string, rootDir: string) => string;

const cloudflareResources: Partial<Record<App['kind'], ResourceFor>> = {
  'tanstack-start': (id, rootDir) =>
    `Cloudflare.Website.Vite('${id}', {\n    rootDir: '${rootDir}',\n  })`,
  foldkit: (id, rootDir) =>
    `Cloudflare.Website.Foldkit('${id}', {\n    rootDir: '${rootDir}',\n  })`,
  'effect-api': (id, rootDir) =>
    `Cloudflare.Worker('${id}', {\n    main: '${rootDir}/src/worker.ts',\n  })`,
};

const awsResources: Partial<Record<App['kind'], ResourceFor>> = {
  'tanstack-start': (id, rootDir) =>
    `AWS.Website.TanStackStart('${id}', {\n    rootDir: '${rootDir}',\n  })`,
  foldkit: (id, rootDir) =>
    `AWS.Website.Foldkit('${id}', {\n    rootDir: '${rootDir}',\n  })`,
};

const resources = (config: ShoeboxConfig) => {
  const table =
    deployTarget(config) === 'aws' ? awsResources : cloudflareResources;
  return Arr.flatMap(config.apps, (app) => {
    const resourceFor = table[app.kind];
    return resourceFor === undefined
      ? []
      : [
          {
            app,
            statement: resourceFor(pascalCase(app.name), `apps/${app.name}`),
          },
        ];
  });
};

const camelCase = (name: string) => {
  const pascal = pascalCase(name);
  return Str.uncapitalize(pascal);
};

const stackSource = (config: ShoeboxConfig) => {
  const target = deployTarget(config);
  const list = resources(config);
  const imports = [
    ...(target === undefined
      ? []
      : [
          `import * as ${providerModules[target].name} from '${providerModules[target].pkg}';`,
        ]),
    "import { Effect } from 'effect';",
    '',
    "import { stageContext } from './stage.ts';",
  ];
  const declarations = Arr.map(
    list,
    ({ app, statement }) =>
      `  const ${camelCase(app.name)} = yield* ${statement};`,
  );
  const outputs = Arr.map(
    list,
    ({ app }) => `    ${camelCase(app.name)}: ${camelCase(app.name)}.url,`,
  );
  return `${Arr.join(imports, '\n')}

// The resource program. Add resources here (or in sibling modules yielded
// from here); logical ids are state keys, so renaming one replaces it.
export const stack = Effect.gen(function* () {
  const { stage } = yield* stageContext;
${Arr.join(declarations, '\n')}${declarations.length > 0 ? '\n' : ''}
  return {
    stage,
${Arr.join(outputs, '\n')}${outputs.length > 0 ? '\n' : ''}  };
});
`;
};

const providersSource = (config: ShoeboxConfig) => {
  const chosen = Arr.map(config.infra.providers, (p) => providerModules[p]);
  const credentials = config.infra.providers.includes('cloudflare')
    ? 'CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID'
    : 'AWS_PROFILE / AWS_REGION';
  // Provider collections share auth services, so they are chained with
  // provideMerge (built in order) rather than merged in parallel.
  const [head, ...rest] = Arr.map(chosen, (p) => `${p.name}.providers()`);
  const layers =
    rest.length === 0
      ? `${head}`
      : `${head}.pipe(${Arr.join(
          Arr.map(rest, (l) => `Layer.provideMerge(${l})`),
          ', ',
        )})`;
  const success = pipe(
    chosen,
    Arr.map(
      (p) => `\n  | Layer.Success<ReturnType<typeof ${p.name}.providers>>`,
    ),
    Arr.join(''),
  );
  const imports = Arr.sort(
    Arr.map(chosen, (p) => `import * as ${p.name} from '${p.pkg}';`),
    (a: string, b: string) => Str.localeCompare(b)(a),
  );
  return `${Arr.join(imports, '\n')}
import type { StackServices } from 'alchemy';
import { Layer } from 'effect';

// Every cloud the stack talks to. Credentials come from the environment
// (${credentials}), loaded by the secrets manager.
//
// Annotated because the inferred type names services from alchemy's
// transitive packages, which declaration emit cannot reference (TS2883).
export const providers: Layer.Layer<${success},
  never,
  StackServices
> = ${layers};
`;
};

const stageSource = `import { Stage } from 'alchemy';
import { Effect } from 'effect';

// Stage-derived facts declarations branch on. The CLI takes the stage from
// \`--stage\`, else ALCHEMY_STAGE, else \`dev_$USER\`.
export const stageContext = Effect.gen(function* () {
  const stage = yield* Stage;
  return { stage, isProduction: stage === 'production' };
});
`;

const stateExpression = (config: ShoeboxConfig) => {
  if (config.infra.providers.includes('cloudflare')) {
    return {
      imports: ["import * as Cloudflare from '@alchemy.run/cloudflare';"],
      expr: 'Cloudflare.state()',
    };
  }
  if (config.infra.providers.includes('aws')) {
    return {
      imports: ["import * as AWS from '@alchemy.run/aws';"],
      expr: 'AWS.state()',
    };
  }
  return { imports: [], expr: 'Alchemy.localState()' };
};

const runSource = (config: ShoeboxConfig) => {
  const state = stateExpression(config);
  return `${Arr.join(state.imports, '\n')}${state.imports.length > 0 ? '\n' : ''}import * as Alchemy from 'alchemy';

import { providers } from './src/providers.ts';
import { stack } from './src/stack.ts';

// State lives with the provider (not in a local .alchemy/ folder) so deploys
// from CI and other machines share it.
export default Alchemy.Stack(
  '${config.name}',
  { providers, state: ${state.expr} },
  stack,
);
`;
};

const stackTestSource = `import { assert, it } from '@effect/vitest';
import { Stage } from 'alchemy';
import { Effect } from 'effect';

import { stageContext } from '../src/stage.ts';

it.effect('only the production stage is production', () =>
  Effect.gen(function* () {
    const production = yield* stageContext.pipe(
      Effect.provideService(Stage, 'production'),
    );
    const preview = yield* stageContext.pipe(
      Effect.provideService(Stage, 'pr-1'),
    );
    assert.isTrue(production.isProduction);
    assert.isFalse(preview.isProduction);
  }),
);
`;

const env = (config: ShoeboxConfig): ReadonlyArray<EnvVar> => [
  {
    key: 'ALCHEMY_STAGE',
    description: 'Alchemy stage to plan/deploy (defaults to dev_$USER)',
    required: false,
    sensitive: false,
    tags: ['infra'],
  },
  ...(config.infra.providers.includes('cloudflare')
    ? [
        {
          key: 'CLOUDFLARE_API_TOKEN',
          description: 'Cloudflare API token alchemy deploys with',
          required: false,
          sensitive: true,
          tags: ['infra'],
        },
        {
          key: 'CLOUDFLARE_ACCOUNT_ID',
          description: 'Cloudflare account alchemy deploys into',
          required: false,
          sensitive: true,
          tags: ['infra'],
        },
      ]
    : []),
  ...(config.infra.providers.includes('aws')
    ? [
        {
          key: 'AWS_PROFILE',
          description: 'AWS SSO profile alchemy deploys with',
          required: false,
          sensitive: false,
          tags: ['infra'],
        },
        {
          key: 'AWS_REGION',
          description: 'AWS region alchemy deploys into',
          required: false,
          sensitive: false,
          default: 'us-east-1',
          tags: ['infra'],
        },
      ]
    : []),
];

// knip reads commands after `varlock run --` but not after `secretspec run
// --`, so under secretspec the alchemy CLI goes through a plain `alchemy`
// script, which keeps the root alchemy (and its Bun peer) visibly used.
const infraScripts = (config: ShoeboxConfig) => {
  const indirect = config.secrets === 'secretspec';
  const alchemyCommand = (verb: string) =>
    withSecrets(
      config,
      indirect ? `bun run alchemy ${verb}` : `alchemy ${verb}`,
    );
  return {
    ...(indirect ? { alchemy: 'alchemy' } : {}),
    'infra:plan': alchemyCommand('plan'),
    'infra:deploy': alchemyCommand('deploy'),
    'infra:destroy': alchemyCommand('destroy'),
  };
};

export const alchemyInfra = (ctx: GenContext): Contribution => {
  const { config } = ctx;
  if (config.infra.kind !== 'alchemy' || config.infra.providers.length === 0) {
    return {};
  }
  const hasWebsite = Arr.some(
    resources(config),
    ({ app }) => app.kind === 'tanstack-start' || app.kind === 'foldkit',
  );
  const dependencies = [
    '@effect/platform-bun',
    'alchemy',
    'effect',
    ...Arr.map(config.infra.providers, (p) => providerModules[p].pkg),
    // Optional alchemy peer that builds framework sites (Vite, TanStack Start,
    // Foldkit) for deployment.
    ...(hasWebsite ? ['@alchemy.run/frontend-frameworks'] : []),
  ];
  const devDependencies = [...effectTestDevDependencies];
  return {
    files: [
      workspacePackageJson(ctx, {
        dir,
        name: 'infra',
        description: `Alchemy stack for ${config.name}`,
        scripts: { test: 'vitest run' },
        dependencies,
        devDependencies,
      }),
      packageTsconfig(dir),
      vitestConfig(dir, 'infra'),
      seed(`${dir}/alchemy.run.ts`, runSource(config)),
      seed(`${dir}/src/stack.ts`, stackSource(config)),
      seed(`${dir}/src/providers.ts`, providersSource(config)),
      seed(`${dir}/src/stage.ts`, stageSource),
      seed(`${dir}/test/stage.test.ts`, stackTestSource),
      // The alchemy CLI looks for alchemy.run.ts in the directory it runs from.
      owned(
        'alchemy.run.ts',
        "export { default } from './packages/infra/alchemy.run.ts';\n",
      ),
      {
        path: 'package.json',
        strategy: 'json-merge',
        content: json({
          scripts: infraScripts(config),
          // The CLI runs from the root and loads its Bun runtime peer from
          // there.
          devDependencies: {
            '@effect/platform-bun': 'catalog:',
            alchemy: 'catalog:',
          },
        }),
      },
    ],
    env: env(config),
    catalog: catalogOf(dependencies, devDependencies),
    gitignore: ['.alchemy/'],
  };
};
