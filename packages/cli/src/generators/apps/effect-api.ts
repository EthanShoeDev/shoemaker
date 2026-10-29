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
  buildTask,
  catalogOf,
  devTask,
  effectTestDevDependencies,
  forApps,
  pascalCase,
  vitestConfig,
} from './common.ts';

const dependencies = ['@effect/platform-bun', 'effect'];
const workerDependencies = ['@alchemy.run/cloudflare', 'alchemy'];
const devDependencies = [...effectTestDevDependencies, 'tsdown'];

const portKey = 'PORT';

// The contract lives apart from the handlers so a client (web app, tests) can
// import it without pulling in server code.
const apiSource = (app: App) => `import { Schema } from 'effect';
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
  .add(GreetingsGroup) {}
`;

const handlersSource = `import { Effect, Layer } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';

import { Api } from './api.ts';

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

const testSource = `import { assert, layer } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { HttpServer } from 'effect/http';
import { HttpApiTest } from 'effect/http-api';

import { Api } from '../src/api.ts';
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
  const worker = deployTarget(ctx.config) === 'cloudflare';
  return {
    files: [
      workspacePackageJson(ctx, {
        dir,
        name: app.name,
        exports: {
          './api': './src/api.ts',
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
      }),
      packageTsconfig(dir),
      vitestConfig(dir, app.name),
      owned(`${dir}/tsdown.config.ts`, tsdownConfig),
      seed(`${dir}/src/api.ts`, apiSource(app)),
      seed(`${dir}/src/handlers.ts`, handlersSource),
      seed(`${dir}/src/bin.ts`, binSource),
      ...(worker ? [seed(`${dir}/src/worker.ts`, workerSource(app))] : []),
      seed(`${dir}/test/api.test.ts`, testSource),
      seed(
        `${dir}/README.md`,
        `# ${ctx.pkg(app.name)}\n\nEffect HttpApi server. \`bun run dev\` serves it on \`$PORT\` (default 3000); try \`/health\` and \`/greetings/Ada\`.\n`,
      ),
    ],
    tasks: [
      devTask(ctx, app),
      buildTask(ctx, app, ['dist/**']),
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
      devDependencies,
      worker ? workerDependencies : [],
    ),
  };
};

export const effectApiGenerator = forApps('effect-api', effectApi);
