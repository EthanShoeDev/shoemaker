import { Array as Arr, String as Str } from 'effect';

import type { App, ShoemakerConfig, StateStore } from '../../config/schema.ts';
import type { Contribution, GenContext } from '../../engine/types.ts';
import { pascalCase } from '../apps/common.ts';
import type { EnvVar } from '../secrets/model.ts';
import { catalogDeps, json, seed, withSecrets } from '../shared.ts';
import type { TaskDef } from '../task-runner/model.ts';
import { deployTarget } from './target.ts';

// One Stack at the workspace root deploys every app (alchemy's single-stack
// monorepo layout): alchemy.run.ts names the Stack, picks providers and the
// state store, and yields each app's resource.
// https://alchemy.run/project-structure/monorepo-single-stack/
// https://alchemy.run/infrastructure-as-code/stack/

const providerModules = {
  cloudflare: { name: 'Cloudflare', pkg: '@alchemy.run/cloudflare' },
  aws: { name: 'AWS', pkg: '@alchemy.run/aws' },
} as const;

type Cloud = keyof typeof providerModules;

// A Vite site declared in the Stack itself, its rootDir anchored to
// alchemy.run.ts so it resolves the same wherever alchemy runs.
// https://alchemy.run/cloudflare/frontend/vite/
// https://alchemy.run/cloudflare/frontend/foldkit/
// https://alchemy.run/aws/frontend/tanstack-start/
// https://alchemy.run/aws/frontend/foldkit/
type Website = (id: string, dir: string) => string;

const website =
  (constructor: string): Website =>
  (id, dir) =>
    `${constructor}('${id}', {\n      rootDir: path.resolve(import.meta.dirname, '${dir}'),\n    })`;

const websites: Readonly<Record<Cloud, Partial<Record<App['kind'], Website>>>> =
  {
    cloudflare: {
      'tanstack-start': website('Cloudflare.Website.Vite'),
      foldkit: website('Cloudflare.Website.Foldkit'),
    },
    aws: {
      'tanstack-start': website('AWS.Website.TanStackStart'),
      foldkit: website('AWS.Website.Foldkit'),
    },
  };

// The Effect API declares its own Worker (apps/<name>/src/worker.ts), which
// the Stack imports by path: a root dependency on a workspace package would be
// a cycle, as every package already depends on the root.
// https://alchemy.run/cloudflare/compute/workers/
const workerApps = (config: ShoemakerConfig) =>
  deployTarget(config) === 'cloudflare'
    ? Arr.filter(config.apps, (app) => app.kind === 'effect-api')
    : [];

type Deployed =
  | { readonly app: App; readonly kind: 'website'; readonly statement: string }
  | { readonly app: App; readonly kind: 'worker' };

const deployed = (config: ShoemakerConfig): ReadonlyArray<Deployed> => {
  const target = deployTarget(config);
  if (target === 'none') return [];
  const workers = new Set(workerApps(config));
  return Arr.flatMap(config.apps, (app): ReadonlyArray<Deployed> => {
    if (workers.has(app)) return [{ app, kind: 'worker' }];
    const declare = websites[target][app.kind];
    return declare === undefined
      ? []
      : [
          {
            app,
            kind: 'website',
            statement: declare(pascalCase(app.name), `apps/${app.name}`),
          },
        ];
  });
};

const camelCase = (name: string) => Str.uncapitalize(pascalCase(name));

// Remote stores are created on first use, even by a plan.
// https://alchemy.run/state-store/
const stateExpression = (state: StateStore) =>
  state === 'local'
    ? 'Alchemy.localState()'
    : `${providerModules[state].name}.state()`;

const runSource = (config: ShoemakerConfig, state: StateStore) => {
  const target = deployTarget(config);
  const list = deployed(config);
  const hasWebsite = Arr.some(list, (entry) => entry.kind === 'website');
  const clouds = new Set<Cloud>([
    ...(target === 'none' ? [] : [target]),
    ...(state === 'local' ? [] : [state]),
  ]);
  const effectImports = [
    'Effect',
    ...(target === 'none' ? ['Layer'] : []),
    ...(hasWebsite ? ['Path'] : []),
  ];
  const imports = [
    ...Arr.map(
      [...clouds],
      (cloud) =>
        `import * as ${providerModules[cloud].name} from '${providerModules[cloud].pkg}';`,
    ),
    "import * as Alchemy from 'alchemy';",
    `import { ${Arr.join(effectImports, ', ')} } from 'effect';`,
    ...Arr.map(
      Arr.filter(list, (entry) => entry.kind === 'worker'),
      ({ app }) =>
        `import ${pascalCase(app.name)} from './apps/${app.name}/src/worker.ts';`,
    ),
  ];
  const statements = [
    ...(hasWebsite ? ['    const path = yield* Path.Path;'] : []),
    ...Arr.map(list, (entry) =>
      entry.kind === 'worker'
        ? `    const ${camelCase(entry.app.name)} = yield* ${pascalCase(entry.app.name)};`
        : `    const ${camelCase(entry.app.name)} = yield* ${entry.statement};`,
    ),
  ];
  const outputs = Arr.map(
    list,
    ({ app }) => `      ${camelCase(app.name)}: ${camelCase(app.name)}.url,`,
  );
  const program =
    list.length === 0
      ? 'Effect.succeed({})'
      : `Effect.gen(function* () {\n${Arr.join(statements, '\n')}\n    return {\n${Arr.join(outputs, '\n')}\n    };\n  })`;
  const providers =
    target === 'none'
      ? // No resources yet: add a provider here with the first one.
        'Layer.empty'
      : `${providerModules[target].name}.providers()`;
  return `${Arr.join(imports, '\n')}

// The repo's one Stack. \`infra:dev\` runs it locally, \`infra:deploy\` deploys
// it; the stage defaults to dev_$USER / live_$USER. Paths are anchored to this
// file because alchemy resolves relative paths from where it runs.
export default Alchemy.Stack(
  '${config.name}',
  {
    providers: ${providers},
    state: ${stateExpression(state)},
  },
  ${program},
);
`;
};

// Credentials come from alchemy profiles, so no provider credential vars.
// https://alchemy.run/environments/stages/
// https://alchemy.run/environments/profiles/
const env: ReadonlyArray<EnvVar> = [
  {
    key: 'ALCHEMY_STAGE',
    description:
      'Alchemy stage (defaults to live_$USER for deploy, dev_$USER for dev)',
    required: false,
    sensitive: false,
    tags: ['infra'],
  },
  {
    key: 'ALCHEMY_PROFILE',
    description:
      'Alchemy profile whose credentials deploy (`alchemy profile edit`)',
    required: false,
    sensitive: false,
    tags: ['infra'],
  },
];

// knip reads commands after `varlock run --` but not after `secretspec run
// --`, so under secretspec the alchemy CLI goes through a plain `alchemy`
// script, which keeps the root alchemy (and its Bun peer) visibly used.
// Varlock wraps non-wrangler deploy tools like alchemy in `varlock run`:
// https://varlock.dev/integrations/cloudflare/#non-wrangler-deploy-tools-alchemysstpulumi
// `infra:dev` runs the Stack locally (AWS needs Docker):
// https://alchemy.run/cli/dev/
// https://alchemy.run/cloudflare/local-development/
// https://alchemy.run/aws/local-development/
const infraScripts = (config: ShoemakerConfig) => {
  const indirect = config.secrets === 'secretspec';
  const alchemyCommand = (verb: string) =>
    withSecrets(
      config,
      indirect ? `bun run alchemy ${verb}` : `alchemy ${verb}`,
    );
  return {
    ...(indirect ? { alchemy: 'alchemy' } : {}),
    'infra:dev': alchemyCommand('dev'),
    'infra:plan': alchemyCommand('plan'),
    'infra:deploy': alchemyCommand('deploy'),
    'infra:destroy': alchemyCommand('destroy'),
  };
};

// The root typecheck and lint read alchemy.run.ts, which imports each
// Worker's source, so those sources are part of their cache key.
const rootInputs = (config: ShoemakerConfig) =>
  Arr.flatMap(workerApps(config), (app) => [
    `apps/${app.name}/package.json`,
    `apps/${app.name}/src/**`,
  ]);

const rootTasks = (config: ShoemakerConfig): ReadonlyArray<TaskDef> => {
  const inputs = rootInputs(config);
  return inputs.length === 0
    ? []
    : Arr.map(['typecheck', 'oxlint:check', 'oxlint:fix'], (name) => ({
        name,
        root: true,
        inputs,
      }));
};

export const alchemyInfra = (ctx: GenContext): Contribution => {
  const { config } = ctx;
  if (config.infra.kind !== 'alchemy') return {};
  const { state } = config.infra;
  const target = deployTarget(config);
  const clouds = [
    ...new Set([
      ...(target === 'none' ? [] : [target]),
      ...(state === 'local' ? [] : [state]),
    ]),
  ];
  const hasWebsite = Arr.some(
    deployed(config),
    (entry) => entry.kind === 'website',
  );
  // The CLI runs from the root, so alchemy.run.ts's imports (and alchemy's
  // Bun runtime peer) are root dependencies.
  const devDependencies = [
    '@effect/platform-bun',
    'alchemy',
    'effect',
    ...Arr.map(clouds, (cloud) => providerModules[cloud].pkg),
    // Optional alchemy peer that builds framework sites (Vite, TanStack Start,
    // Foldkit) for deployment.
    ...(hasWebsite ? ['@alchemy.run/frontend-frameworks'] : []),
  ];
  return {
    files: [
      seed('alchemy.run.ts', runSource(config, state)),
      {
        path: 'package.json',
        strategy: 'json-merge',
        content: json({
          scripts: infraScripts(config),
          devDependencies: catalogDeps(devDependencies),
        }),
      },
    ],
    tasks: rootTasks(config),
    env,
    catalog: devDependencies,
    gitignore: ['.alchemy/'],
  };
};
