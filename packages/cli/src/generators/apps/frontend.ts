import { Array as Arr, Option } from 'effect';

import type { Package } from '../../config/schema.ts';
import type { Contribution, GenContext } from '../../engine/types.ts';
import { packageTsconfig, seed, workspacePackageJson } from '../shared.ts';
import {
  catalogOf,
  forPackages,
  packageDir,
  toolchainDevDependencies,
  vitestConfig,
} from './common.ts';
import { contractName } from './mount.ts';

// Client code every frontend of the repo shares: the API's endpoints as
// Effect atoms (`effect/reactivity`). It imports no React and no UI, so a
// TanStack Start site, an Expo app or a browser extension can each read the
// same atoms through its own bindings; a frontend's UI stays in its app.

const dependencies = ['effect'];
// No bun-types: this code runs in browsers and React Native, not Bun.
const devDependencies = [...toolchainDevDependencies, '@effect/vitest'];

const apiClientSource = (
  ctx: GenContext,
  pkg: Package,
  contract: string,
) => `import { Effect, Layer } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import { Atom, AtomHttpApi } from 'effect/reactivity';

import { Api } from '${contract}';

const fetchLayer = (fetch?: (request: Request) => Promise<Response>) =>
  fetch === undefined
    ? FetchHttpClient.layer
    : FetchHttpClient.layer.pipe(
        Layer.provide(
          Layer.succeed(FetchHttpClient.Fetch, (input, init) =>
            fetch(new Request(input, init)),
          ),
        ),
      );

// Where API requests go: an HTTP client that resolves the contract's paths
// against \`baseUrl\`. \`fetch\` stands in for \`globalThis.fetch\`, so a server
// can answer in-process and a test without a server.
export const apiTransport = (options: {
  readonly baseUrl: string;
  readonly fetch?: (request: Request) => Promise<Response>;
}) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.map(
      HttpClient.HttpClient,
      HttpClient.mapRequest(HttpClientRequest.prependUrl(options.baseUrl)),
    ),
  ).pipe(Layer.provide(fetchLayer(options.fetch)));

// Each app seeds its atom registry with its own transport
// (\`withApiTransport\`): a web app per request and per tab, a mobile app once.
const apiTransportAtom = Atom.make(
  Layer.effect(
    HttpClient.HttpClient,
    Effect.die(
      'The atom registry has no API transport: seed it with withApiTransport.',
    ),
  ),
).pipe(Atom.keepAlive);

export const withApiTransport = (
  transport: Layer.Layer<HttpClient.HttpClient>,
) => Atom.initialValue(apiTransportAtom, transport);

// The API's endpoints as atoms: \`ApiClient.query\` reads, \`ApiClient.mutation\`
// writes. Every app that shares this package calls the API the same way.
export class ApiClient extends AtomHttpApi.Service<ApiClient>()(
  '${ctx.pkg(pkg.name)}/ApiClient',
  { api: Api, httpClient: (get) => get(apiTransportAtom) },
) {}
`;

const greetingsSource = `import { ApiClient } from './api-client.ts';

// A mutation that passes these keys refreshes every greeting.
const reactivityKeys = ['greetings'];

// One atom per name. The serialization key lets a server-rendered result
// reach the browser without a second request; the time to live keeps it a
// minute after its last reader leaves.
export const greeting = (name: string) =>
  ApiClient.query('greetings', 'greet', {
    params: { name },
    reactivityKeys,
    serializationKey: name,
    timeToLive: '1 minute',
  });
`;

const greetingsTestSource = `import { assert, it } from '@effect/vitest';
import { Effect, String as Str } from 'effect';
import { AtomRegistry } from 'effect/reactivity';

import { apiTransport, withApiTransport } from '../src/api-client.ts';
import { greeting } from '../src/greetings.ts';

// Answers like the API would, so the atoms run without a server.
const fakeApi = (request: Request) => {
  const name = Str.replace('/api/greetings/', '')(new URL(request.url).pathname);
  return Promise.resolve(
    Response.json({ message: \`Hello, \${decodeURIComponent(name)}!\` }),
  );
};

it.effect('reads a greeting through the API client', () =>
  Effect.gen(function* () {
    const registry = AtomRegistry.make({
      initialValues: [
        withApiTransport(
          apiTransport({ baseUrl: 'http://api.test', fetch: fakeApi }),
        ),
      ],
    });
    const { message } = yield* AtomRegistry.getResult(
      registry,
      greeting('Ada'),
    );
    assert.strictEqual(message, 'Hello, Ada!');
  }),
);
`;

const readme = (ctx: GenContext, pkg: Package, contract: string) =>
  `# ${ctx.pkg(pkg.name)}

Client code the repo's frontends share: \`${contract}\`'s endpoints as Effect atoms. No React and no UI, so every frontend reads the same atoms through its own bindings (\`@effect/atom-react\` in a React app).

- \`src/api-client.ts\`: \`ApiClient\` (\`AtomHttpApi\`), and \`withApiTransport\`, which each app seeds its atom registry with to say where requests go.
- \`src/greetings.ts\`: one module per resource. A read is an \`ApiClient.query\` atom with a \`serializationKey\`, so a server-rendered result reaches the browser; a write is an \`ApiClient.mutation\` that passes the \`reactivityKeys\` it invalidates.

Each module is imported by path: \`${ctx.pkg(pkg.name)}/greetings\`.
`;

export const frontend = (ctx: GenContext, pkg: Package): Contribution => {
  const dir = packageDir(pkg);
  const api = Option.getOrUndefined(
    Arr.findFirst(
      ctx.config.apps,
      (app) => app.kind === 'effect-api' && app.name === pkg.api,
    ),
  );
  // The config schema guarantees the API exists.
  if (api === undefined) return {};
  const contract = ctx.pkg(contractName(api));
  return {
    files: [
      workspacePackageJson(ctx, {
        dir,
        name: pkg.name,
        exports: { './*': './src/*.ts' },
        dependencies,
        devDependencies,
        workspaceDependencies: [contractName(api)],
      }),
      packageTsconfig(dir, { compilerOptions: { types: ['node'] } }),
      vitestConfig(dir),
      seed(`${dir}/src/api-client.ts`, apiClientSource(ctx, pkg, contract)),
      seed(`${dir}/src/greetings.ts`, greetingsSource),
      seed(`${dir}/test/greetings.test.ts`, greetingsTestSource),
      seed(`${dir}/README.md`, readme(ctx, pkg, contract)),
    ],
    catalog: catalogOf(dependencies, devDependencies),
  };
};

export const frontendGenerator = forPackages('frontend', frontend);
