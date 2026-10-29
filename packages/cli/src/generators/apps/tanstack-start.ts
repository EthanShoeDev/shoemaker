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
  forApps,
  toolchainDevDependencies,
  vitestConfig,
} from './common.ts';
import { contractName, servedApi } from './mount.ts';

const baseDependencies = [
  '@tanstack/react-router',
  '@tanstack/react-start',
  'react',
  'react-dom',
];

const baseDevDependencies = [
  ...toolchainDevDependencies,
  '@babel/core',
  '@rolldown/plugin-babel',
  '@tailwindcss/vite',
  '@types/react',
  '@types/react-dom',
  '@vitejs/plugin-react',
  'babel-plugin-react-compiler',
  'tailwindcss',
  'vite',
];

// Alchemy's Cloudflare.Website.Vite injects its own Cloudflare plugin and
// bindings, so varlock's Vite plugin is only wired for other targets.
// https://varlock.dev/integrations/vite/
// https://varlock.dev/integrations/cloudflare/
const usesVarlockPlugin = (ctx: GenContext) =>
  ctx.config.secrets === 'varlock' && deployTarget(ctx.config) !== 'cloudflare';

// Import protection keeps \`*.server.*\` files out of the browser bundle, but
// a served API's handlers come from another package, so they are denied by
// name: a build that would ship them to the browser fails.
// https://tanstack.com/start/latest/docs/framework/react/guide/import-protection
const tanstackStartPlugin = (apiPackage: string | undefined) =>
  apiPackage === undefined
    ? 'tanstackStart()'
    : `tanstackStart({
      importProtection: {
        client: { specifiers: ['${apiPackage}/handlers'] },
      },
    })`;

const viteConfig = (ctx: GenContext, apiPackage: string | undefined) => {
  const varlock = usesVarlockPlugin(ctx);
  return `import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
${varlock ? "import { varlockVitePlugin } from '@varlock/vite-integration';\n" : ''}import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
${varlock ? '  // oxlint-disable-next-line typescript/no-unsafe-assignment -- @varlock/vite-integration types its plugin as `any`\n' : ''}  plugins: [
${varlock ? '    varlockVitePlugin(),\n' : ''}    tailwindcss(),
    ${tanstackStartPlugin(apiPackage)},
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
});
`;
};

const routerSource = `import { createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen.ts';

export const getRouter = () =>
  createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
  });

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
`;

const rootRouteSource = (
  app: App,
) => `import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import appCss from '../styles.css?url';

const RootDocument = ({ children }: { readonly children: ReactNode }) => (
  <html lang='en'>
    <head>
      <HeadContent />
    </head>
    <body>
      {children}
      <Scripts />
    </body>
  </html>
);

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: '${app.name}' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
});
`;

const indexRouteSource = `import { createFileRoute } from '@tanstack/react-router';

import { Welcome } from '../components/welcome.tsx';

const Home = () => <Welcome message='Hello, world!' />;

export const Route = createFileRoute('/')({ component: Home });
`;

// With an API served, the page's greeting comes from it: in-process while the
// server renders, over fetch to /api when the browser navigates.
const servedIndexRouteSource = `import { createFileRoute } from '@tanstack/react-router';

import { callApi } from '../api-client.ts';
import { Welcome } from '../components/welcome.tsx';

const Home = () => <Welcome message={Route.useLoaderData().message} />;

export const Route = createFileRoute('/')({
  loader: ({ abortController }) =>
    callApi((api) => api.greetings.greet({ params: { name: 'world' } }), {
      signal: abortController.signal,
    }),
  component: Home,
});
`;

const welcomeSource = `export const Welcome = ({ message }: { readonly message: string }) => (
  <main className='flex min-h-screen items-center justify-center'>
    <h1 className='text-4xl font-bold'>{message}</h1>
  </main>
);
`;

// Server-only (\`.server.ts\`, which import protection keeps out of the
// browser): the API's routes as one fetch handler, which the /api route serves
// and server rendering calls in-process.
const apiServerSource = (
  apiPackage: string,
) => `import { getRequestHeaders } from '@tanstack/react-start/server';
import { Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';

import { ApiLive } from '${apiPackage}/handlers';

export const { handler: apiHandler } = HttpRouter.toWebHandler(
  ApiLive.pipe(Layer.provide(HttpServer.layerServices)),
);

// The handler routes by path, so the origin is a placeholder.
export const inProcessOrigin = 'http://in-process';

// Outside a page request (tests, prerendering) there is no cookie to forward.
const pageCookie = () => {
  try {
    return getRequestHeaders().get('cookie');
  } catch {
    return null;
  }
};

// Server rendering calls the API in this process: no network hop, and no need
// to know the page's own origin. The page request's cookie goes along, so the
// API sees the same session as the browser's own requests.
export const inProcessFetch: typeof fetch = (input, init) => {
  const request = new Request(input, init);
  const cookie = pageCookie();
  if (cookie !== null) request.headers.set('cookie', cookie);
  return apiHandler(request);
};
`;

// TanStack Start reads a route's options statically, so they stay inline here
// rather than imported from the handler's module.
const apiRouteSource = `import { createFileRoute } from '@tanstack/react-router';

import { apiHandler } from '../api.server.ts';

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: { ANY: ({ request }) => apiHandler(request) },
  },
});
`;

// createIsomorphicFn is the compiler's environment boundary: each build keeps
// one implementation and drops the other's imports, so the in-process
// transport never reaches the browser.
const apiClientSource = (
  contract: string,
) => `import { createIsomorphicFn } from '@tanstack/react-start';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';

import { Api } from '${contract}';

import { inProcessFetch, inProcessOrigin } from './api.server.ts';

// In-process while the server renders; same-origin fetch to /api in the
// browser.
const transport = createIsomorphicFn()
  .server(() => ({
    baseUrl: inProcessOrigin,
    layer: FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, inProcessFetch)),
    ),
  }))
  .client(() => ({
    baseUrl: globalThis.location.origin,
    layer: FetchHttpClient.layer,
  }));

const { baseUrl, layer } = transport();

// Loaders and event handlers are where Effect meets React, so this runtime is
// their entry point: it holds the HTTP client that reaches the API.
const apiRuntime = ManagedRuntime.make(layer);

const makeClient = HttpApiClient.make(Api, { baseUrl });

// Runs one typed call, the same way on the server and in the browser. A
// failure rejects the promise.
export const callApi = <A, E>(
  call: (api: Effect.Success<typeof makeClient>) => Effect.Effect<A, E>,
  options?: { readonly signal?: AbortSignal },
) => apiRuntime.runPromise(Effect.flatMap(makeClient, call), options);
`;

const apiClientTestSource = `import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';

import { callApi } from '../src/api-client.ts';

describe('callApi', () => {
  it.effect('reaches the API in-process outside the browser', () =>
    Effect.gen(function* () {
      const greeting = yield* Effect.promise(() =>
        callApi((api) => api.greetings.greet({ params: { name: 'Ada' } })),
      );
      assert.strictEqual(greeting.message, 'Hello, Ada!');
    }),
  );
});
`;

const welcomeTestSource = `import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Welcome } from '../src/components/welcome.tsx';

describe('Welcome', () => {
  it('shows the message', () => {
    expect(renderToString(<Welcome message='Hello, Ada!' />)).toContain(
      'Hello, Ada!',
    );
  });
});
`;

// What `tanstackStart()` writes for the two seed routes. Seeded so a fresh
// clone typechecks before its first `vite dev`/`vite build` regenerates it.
const routeTreeSource = `/* eslint-disable */

// @ts-nocheck

// noinspection JSUnusedGlobalSymbols

// This file was automatically generated by TanStack Router.
// You should NOT make any changes in this file as it will be overwritten.
// Additionally, you should also exclude this file from your linter and/or formatter to prevent it from being checked or modified.

import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'

const IndexRoute = IndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRouteImport,
} as any)

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/': typeof IndexRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: '/'
  fileRoutesByTo: FileRoutesByTo
  to: '/'
  id: '__root__' | '/'
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': {
      id: '/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof IndexRouteImport
      parentRoute: typeof rootRouteImport
    }
  }
}

const rootRouteChildren: RootRouteChildren = {
  IndexRoute: IndexRoute,
}
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()

import type { getRouter } from './router.tsx'
import type { createStart } from '@tanstack/react-start'
declare module '@tanstack/react-start' {
  interface Register {
    ssr: true
    router: Awaited<ReturnType<typeof getRouter>>
  }
}
`;

// The same, with the /api splat route.
const servedRouteTreeSource = `/* eslint-disable */

// @ts-nocheck

// noinspection JSUnusedGlobalSymbols

// This file was automatically generated by TanStack Router.
// You should NOT make any changes in this file as it will be overwritten.
// Additionally, you should also exclude this file from your linter and/or formatter to prevent it from being checked or modified.

import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'
import { Route as ApiSplatRouteImport } from './routes/api.$'

const IndexRoute = IndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiSplatRoute = ApiSplatRouteImport.update({
  id: '/api/$',
  path: '/api/$',
  getParentRoute: () => rootRouteImport,
} as any)

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/api/$': typeof ApiSplatRoute
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute
  '/api/$': typeof ApiSplatRoute
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/': typeof IndexRoute
  '/api/$': typeof ApiSplatRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: '/' | '/api/$'
  fileRoutesByTo: FileRoutesByTo
  to: '/' | '/api/$'
  id: '__root__' | '/' | '/api/$'
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute
  ApiSplatRoute: typeof ApiSplatRoute
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': {
      id: '/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof IndexRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/$': {
      id: '/api/$'
      path: '/api/$'
      fullPath: '/api/$'
      preLoaderRoute: typeof ApiSplatRouteImport
      parentRoute: typeof rootRouteImport
    }
  }
}

const rootRouteChildren: RootRouteChildren = {
  IndexRoute: IndexRoute,
  ApiSplatRoute: ApiSplatRoute,
}
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()

import type { getRouter } from './router.tsx'
import type { createStart } from '@tanstack/react-start'
declare module '@tanstack/react-start' {
  interface Register {
    ssr: true
    router: Awaited<ReturnType<typeof getRouter>>
  }
}
`;

export const tanstackStart = (ctx: GenContext, app: App): Contribution => {
  const dir = appDir(app);
  const varlock = usesVarlockPlugin(ctx);
  const api = servedApi(ctx.config, app);
  const apiPackage = api === undefined ? '' : ctx.pkg(api.name);
  const dependencies = [
    ...baseDependencies,
    ...(api === undefined ? [] : ['effect']),
  ];
  const devDependencies = [
    ...baseDevDependencies,
    ...(api === undefined ? [] : ['@effect/vitest']),
    ...(varlock ? ['@varlock/vite-integration', 'varlock'] : []),
  ];
  return {
    files: [
      workspacePackageJson(ctx, {
        dir,
        name: app.name,
        scripts: {
          dev: 'vite dev',
          build: 'vite build',
          start: 'vite preview',
          clean: 'rm -rf dist .tanstack .turbo',
        },
        dependencies,
        devDependencies,
        ...(api === undefined
          ? {}
          : { workspaceDependencies: [api.name, contractName(api)] }),
        // varlock reads `.env.schema` from the cwd unless told otherwise; the
        // schema lives at the repo root.
        ...(varlock ? { extra: { varlock: { loadPath: '../../' } } } : {}),
      }),
      packageTsconfig(dir, {
        react: true,
        compilerOptions: { types: ['node', 'vite/client'] },
      }),
      vitestConfig(dir, { mergeViteConfig: true }),
      owned(
        `${dir}/vite.config.ts`,
        viteConfig(ctx, api === undefined ? undefined : apiPackage),
      ),
      seed(`${dir}/src/router.tsx`, routerSource),
      seed(
        `${dir}/src/routeTree.gen.ts`,
        api === undefined ? routeTreeSource : servedRouteTreeSource,
      ),
      seed(`${dir}/src/routes/__root.tsx`, rootRouteSource(app)),
      seed(
        `${dir}/src/routes/index.tsx`,
        api === undefined ? indexRouteSource : servedIndexRouteSource,
      ),
      ...(api === undefined
        ? []
        : [
            seed(`${dir}/src/api.server.ts`, apiServerSource(apiPackage)),
            seed(`${dir}/src/routes/api.$.ts`, apiRouteSource),
            seed(
              `${dir}/src/api-client.ts`,
              apiClientSource(ctx.pkg(contractName(api))),
            ),
            seed(`${dir}/test/api-client.test.ts`, apiClientTestSource),
          ]),
      seed(`${dir}/src/components/welcome.tsx`, welcomeSource),
      seed(`${dir}/src/styles.css`, "@import 'tailwindcss';\n"),
      seed(`${dir}/test/welcome.test.tsx`, welcomeTestSource),
      seed(
        `${dir}/README.md`,
        `# ${ctx.pkg(app.name)}\n\nTanStack Start app. \`bun run dev\` to develop, \`bun run build && bun run start\` to preview the production build.\n${
          api === undefined
            ? ''
            : `\nIt serves \`${apiPackage}\` at \`/api\` (\`src/routes/api.$.ts\`) and deploys it. Loaders and components call it through \`callApi\` (\`src/api-client.ts\`): in-process while the server renders, over \`fetch\` in the browser.\n`
        }`,
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
    catalog: catalogOf(dependencies, devDependencies),
    // The base .gitignore's `dist` matters here too: Tailwind skips gitignored
    // paths, and without it the SSR pass scans the client output and hashes a
    // different stylesheet than the one shipped.
    gitignore: ['.tanstack/'],
    ignore: [`${dir}/src/routeTree.gen.ts`],
  };
};

export const tanstackStartGenerator = forApps('tanstack-start', tanstackStart);
