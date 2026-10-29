import type { App } from '../../config/schema.ts';
import type { Contribution, GenContext } from '../../engine/types.ts';
import { deployTarget } from '../infra/target.ts';
import {
  owned,
  packageTsconfig,
  seed,
  workspacePackageJson,
} from '../shared.ts';
import {
  appDir,
  catalogOf,
  effectTestDevDependencies,
  forApps,
  packageDir,
  pascalCase,
  vitestConfig,
} from './common.ts';
import { contractName, isServed } from './mount.ts';

const dependencies = ['@effect/platform-bun', 'effect'];
const contractDependencies = ['effect'];
const workerDependencies = ['@alchemy.run/cloudflare', 'alchemy'];
const devDependencies = [...effectTestDevDependencies, 'tsdown'];

const portKey = 'PORT';

// A site that serves the API mounts it at /api, so its paths carry that
// prefix.
const contractSource = (
  app: App,
  served: boolean,
) => `import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';

export const Health = Schema.Struct({ status: Schema.Literal('ok') });

export const Greeting = Schema.Struct({ message: Schema.String });

export class HealthGroup extends HttpApiGroup.make('health').add(
  HttpApiEndpoint.get('check', '/health', { success: Health }),
) {}

export class GreetingsGroup extends HttpApiGroup.make('greetings').add(
  HttpApiEndpoint.get('greet', '/greetings/:name', {
    params: { name: Schema.String },
    success: Greeting,
  }),
) {}

export class Api extends HttpApi.make('${app.name}')
  .add(HealthGroup)
  .add(GreetingsGroup)${served ? "\n  .prefix('/api')" : ''} {}
`;

const contractTestSource = (served: boolean) => {
  const prefix = served ? '/api' : '';
  return `import { assert, it } from '@effect/vitest';
import { Record as Rec } from 'effect';
import { OpenApi } from 'effect/http-api';

import { Api } from '../src/index.ts';

it('documents every endpoint', () => {
  assert.sameMembers(Rec.keys(OpenApi.fromApi(Api).paths), [
    '${prefix}/health',
    '${prefix}/greetings/{name}',
  ]);
});
`;
};

const handlersSource = (
  contract: string,
) => `import { Effect, Layer } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';

import { Api } from '${contract}';

export const HealthLive = HttpApiBuilder.group(Api, 'health', (handlers) =>
  handlers.handle('check', () => Effect.succeed({ status: 'ok' as const })),
);

export const GreetingsLive = HttpApiBuilder.group(
  Api,
  'greetings',
  (handlers) =>
    handlers.handle('greet', ({ params }) =>
      Effect.succeed({ message: \`Hello, \${params.name}!\` }),
    ),
);

export const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide([HealthLive, GreetingsLive]),
);
`;

const binSource = `#!/usr/bin/env bun
import { BunHttpServer, BunRuntime } from '@effect/platform-bun';
import { Config, Layer } from 'effect';
import { HttpRouter } from 'effect/http';

import { ApiLive } from './handlers.ts';

const ServerLive = HttpRouter.serve(ApiLive).pipe(
  Layer.provide(
    BunHttpServer.layerConfig(
      Config.Port('${portKey}').pipe(
        Config.withDefault(3000),
        Config.map((port) => ({ port })),
      ),
    ),
  ),
);

Layer.launch(ServerLive).pipe(BunRuntime.runMain);
`;

// Cloudflare runs the same API as a Worker: no server, no port. The root
// alchemy.run.ts yields the class; `main: import.meta.url` makes this file the
// Worker's entry wherever alchemy runs from.
const workerSource = (app: App) => {
  const name = pascalCase(app.name);
  return `import * as Cloudflare from '@alchemy.run/cloudflare';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';

import { ApiLive } from './handlers.ts';

export default class ${name} extends Cloudflare.Worker<${name}>()(
  '${name}',
  { main: import.meta.url },
  Effect.succeed({
    fetch: ApiLive.pipe(
      Layer.provide(HttpServer.layerServices),
      HttpRouter.toHttpEffect,
    ),
  }),
) {}
`;
};

const testSource = (
  contract: string,
) => `import { assert, layer } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { HttpServer } from 'effect/http';
import { HttpApiTest } from 'effect/http-api';

import { Api } from '${contract}';

import { GreetingsLive, HealthLive } from '../src/handlers.ts';

const makeClient = HttpApiTest.groups(Api, ['health', 'greetings']);

layer(Layer.mergeAll(HealthLive, GreetingsLive, HttpServer.layerServices))(
  'Api',
  (it) => {
    it.effect('reports healthy', () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const health = yield* client.health.check();
        assert.strictEqual(health.status, 'ok');
      }),
    );

    it.effect('greets by name', () =>
      Effect.gen(function* () {
        const client = yield* makeClient;
        const greeting = yield* client.greetings.greet({
          params: { name: 'Ada' },
        });
        assert.strictEqual(greeting.message, 'Hello, Ada!');
      }),
    );
  },
);
`;

const tsdownConfig = `import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/bin.ts'],
  platform: 'node',
  dts: false,
});
`;

export const effectApi = (ctx: GenContext, app: App): Contribution => {
  const dir = appDir(app);
  const contractDir = packageDir({ name: contractName(app) });
  const contract = ctx.pkg(contractName(app));
  const served = isServed(ctx.config, app);
  // A served API deploys inside its site, not as a Worker of its own.
  const worker = deployTarget(ctx.config) === 'cloudflare' && !served;
  return {
    files: [
      workspacePackageJson(ctx, {
        dir,
        name: app.name,
        exports: {
          // Server-only: the site that serves the API mounts these.
          ...(served ? { './handlers': './src/handlers.ts' } : {}),
          ...(worker ? { './worker': './src/worker.ts' } : {}),
        },
        scripts: {
          dev: 'bun --watch src/bin.ts',
          build: 'tsdown',
          start: 'bun dist/bin.mjs',
        },
        dependencies: worker
          ? [...dependencies, ...workerDependencies]
          : dependencies,
        devDependencies,
        workspaceDependencies: [contractName(app)],
      }),
      packageTsconfig(dir),
      vitestConfig(dir),
      owned(`${dir}/tsdown.config.ts`, tsdownConfig),
      seed(`${dir}/src/handlers.ts`, handlersSource(contract)),
      seed(`${dir}/src/bin.ts`, binSource),
      ...(worker ? [seed(`${dir}/src/worker.ts`, workerSource(app))] : []),
      seed(`${dir}/test/api.test.ts`, testSource(contract)),
      seed(
        `${dir}/README.md`,
        served
          ? `# ${ctx.pkg(app.name)}\n\nImplements the Effect HttpApi in \`${contract}\`, served at \`/api\` by the site that mounts it and deployed with it. \`bun run dev\` also serves it alone on \`$PORT\` (default 3000); try \`/api/health\` and \`/api/greetings/Ada\`.\n`
          : `# ${ctx.pkg(app.name)}\n\nEffect HttpApi server for \`${contract}\`. \`bun run dev\` serves it on \`$PORT\` (default 3000); try \`/health\` and \`/greetings/Ada\`.\n`,
      ),
      workspacePackageJson(ctx, {
        dir: contractDir,
        name: contractName(app),
        exports: { '.': './src/index.ts' },
        dependencies: contractDependencies,
        devDependencies: effectTestDevDependencies,
      }),
      packageTsconfig(contractDir),
      vitestConfig(contractDir),
      seed(`${contractDir}/src/index.ts`, contractSource(app, served)),
      seed(`${contractDir}/test/index.test.ts`, contractTestSource(served)),
      seed(
        `${contractDir}/README.md`,
        `# ${contract}\n\nThe HttpApi contract for \`${ctx.pkg(app.name)}\`: its endpoints and schemas. Clients depend on this package, never on the server, so any app can call the API with \`HttpApiClient.make(Api)\`.\n`,
      ),
    ],
    tasks: [
      {
        name: 'start',
        package: ctx.pkg(app.name),
        dependsOn: ['build'],
        persistent: true,
        cache: false,
      },
    ],
    env: [
      {
        key: portKey,
        description: 'Port the HTTP API listens on',
        required: false,
        sensitive: false,
        default: '3000',
        type: 'port',
        tags: [app.name],
      },
    ],
    catalog: catalogOf(
      dependencies,
      contractDependencies,
      devDependencies,
      worker ? workerDependencies : [],
    ),
  };
};

export const effectApiGenerator = forApps('effect-api', effectApi);
