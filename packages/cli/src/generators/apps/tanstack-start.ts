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
import { contractName, frontendFor, servedApi } from './mount.ts';

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

// With a frontend package, the router owns an atom registry: one per server
// request and one per tab, streamed from the first to the second.
// https://raf-effect-atom.katt.dev/docs/tanstack-start
const atomRouterSource = (
  frontendPackage: string,
) => `import { createRouter } from '@tanstack/react-router';
import { Loader } from 'raf-effect-atom';
import {
  makeRegistry,
  setupRouterAtoms,
} from 'raf-effect-atom/tanstack-router';

import { withApiTransport } from '${frontendPackage}/api-client';

import { pageApiTransport } from './api-transport.ts';
import { routeTree } from './routeTree.gen.ts';

export const getRouter = () => {
  // One atom registry per server request and one per tab. Loaders start atoms
  // in it, and the server's results stream into the browser's, so the
  // browser doesn't request them again.
  const registry = makeRegistry({
    initialValues: [withApiTransport(pageApiTransport())],
  });
  const router = createRouter({
    routeTree,
    context: { atoms: Loader.make(registry) },
    scrollRestoration: true,
    defaultPreload: 'intent',
    // The registry is the cache: loaders always run and ask it.
    defaultPreloadStaleTime: 0,
  });
  setupRouterAtoms({ registry, router });
  return router;
};

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
`;

const rootHead = (app: App) => `  head: () => ({
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

const atomRootRouteSource = (app: App) => `import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router';
import { type Loader, WaterfallDetection } from 'raf-effect-atom';
import type { ReactNode } from 'react';

import appCss from '../styles.css?url';

// In development, a component that reads an atom no loader started throws,
// naming the atom: start every atom a page reads from its route's loader.
const RootDocument = ({ children }: { readonly children: ReactNode }) => (
  <html lang='en'>
    <head>
      <HeadContent />
    </head>
    <body>
      <WaterfallDetection mode='throw'>{children}</WaterfallDetection>
      <Scripts />
    </body>
  </html>
);

export const Route = createRootRouteWithContext<{
  readonly atoms: Loader.Loader;
}>()({
${rootHead(app)}`;

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
${rootHead(app)}`;

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

// With a frontend package, the loader starts the greeting's atom and the page
// reads it through the handle the loader returns.
const atomIndexRouteSource = (
  frontendPackage: string,
) => `import { createFileRoute } from '@tanstack/react-router';
import { useAtomResult } from 'raf-effect-atom';

import { greeting } from '${frontendPackage}/greetings';

import { Welcome } from '../components/welcome.tsx';

const Home = () => {
  const result = useAtomResult(greeting, Route.useLoaderData());
  return <Welcome message={result.value.message} />;
};

// The loader starts the atom and waits for it, and the page reads it through
// the handle the loader returns. While the server renders, the API answers
// in-process.
export const Route = createFileRoute('/')({
  loader: ({ context }) => context.atoms.ensure(greeting, 'world'),
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

// With a frontend package, the app only picks where its atoms' requests go.
const apiTransportSource = (
  frontendPackage: string,
) => `import { createIsomorphicFn } from '@tanstack/react-start';

import { apiTransport } from '${frontendPackage}/api-client';

import { inProcessFetch, inProcessOrigin } from './api.server.ts';

// createIsomorphicFn is the compiler's environment boundary: each build keeps
// one implementation and drops the other's imports, so the in-process
// transport never reaches the browser. In-process while the server renders;
// same-origin fetch to /api in the browser.
export const pageApiTransport = createIsomorphicFn()
  .server(() =>
    apiTransport({ baseUrl: inProcessOrigin, fetch: inProcessFetch }),
  )
  .client(() => apiTransport({ baseUrl: globalThis.location.origin }));
`;

const apiTransportTestSource = (
  frontendPackage: string,
) => `import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import { AtomRegistry } from 'effect/reactivity';

import { withApiTransport } from '${frontendPackage}/api-client';
import { greeting } from '${frontendPackage}/greetings';

import { pageApiTransport } from '../src/api-transport.ts';

describe('pageApiTransport', () => {
  it.effect('reaches the API in-process outside the browser', () =>
    Effect.gen(function* () {
      const registry = AtomRegistry.make({
        initialValues: [withApiTransport(pageApiTransport())],
      });
      const { message } = yield* AtomRegistry.getResult(
        registry,
        greeting('Ada'),
      );
      assert.strictEqual(message, 'Hello, Ada!');
    }),
  );
});
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

// The site's files for a served API: through the frontend package's atoms
// when the API has one, else through a `callApi` promise of its own.
const servedFiles = (
  dir: string,
  apiPackage: string,
  contract: string,
  frontendPackage: string | undefined,
) => [
  seed(`${dir}/src/api.server.ts`, apiServerSource(apiPackage)),
  seed(`${dir}/src/routes/api.$.ts`, apiRouteSource),
  ...(frontendPackage === undefined
    ? [
        seed(`${dir}/src/api-client.ts`, apiClientSource(contract)),
        seed(`${dir}/test/api-client.test.ts`, apiClientTestSource),
      ]
    : [
        seed(
          `${dir}/src/api-transport.ts`,
          apiTransportSource(frontendPackage),
        ),
        seed(
          `${dir}/test/api-transport.test.ts`,
          apiTransportTestSource(frontendPackage),
        ),
      ]),
];

const readme = (
  ctx: GenContext,
  app: App,
  apiPackage: string | undefined,
  frontendPackage: string | undefined,
) => {
  const start = `# ${ctx.pkg(app.name)}\n\nTanStack Start app. \`bun run dev\` to develop, \`bun run build && bun run start\` to preview the production build.\n`;
  if (apiPackage === undefined) return start;
  const served = `\nIt serves \`${apiPackage}\` at \`/api\` (\`src/routes/api.$.ts\`) and deploys it. `;
  return frontendPackage === undefined
    ? `${start}${served}Loaders and components call it through \`callApi\` (\`src/api-client.ts\`): in-process while the server renders, over \`fetch\` in the browser.\n`
    : `${start}${served}Pages read it through \`${frontendPackage}\`'s atoms: a route's loader starts them (\`context.atoms.ensure\` or \`prefetch\`, from [raf-effect-atom](https://raf-effect-atom.katt.dev)) and its component reads them with \`useAtomResult\`. The server's results stream into the browser's registry, so the browser doesn't request them again. Requests go in-process while the server renders and over \`fetch\` in the browser (\`src/api-transport.ts\`).\n`;
};

export const tanstackStart = (ctx: GenContext, app: App): Contribution => {
  const dir = appDir(app);
  const varlock = usesVarlockPlugin(ctx);
  const api = servedApi(ctx.config, app);
  const apiPackage = api === undefined ? undefined : ctx.pkg(api.name);
  const frontend = api === undefined ? undefined : frontendFor(ctx.config, api);
  const frontendPackage =
    frontend === undefined ? undefined : ctx.pkg(frontend.name);
  const dependencies = [
    ...baseDependencies,
    ...(api === undefined ? [] : ['effect']),
    ...(frontend === undefined
      ? []
      : ['@effect/atom-react', 'raf-effect-atom']),
  ];
  const devDependencies = [
    ...baseDevDependencies,
    ...(api === undefined ? [] : ['@effect/vitest']),
    ...(varlock ? ['@varlock/vite-integration', 'varlock'] : []),
  ];
  const workspaceDependencies =
    api === undefined
      ? []
      : [api.name, frontend === undefined ? contractName(api) : frontend.name];
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
        workspaceDependencies,
        // varlock reads `.env.schema` from the cwd unless told otherwise; the
        // schema lives at the repo root.
        ...(varlock ? { extra: { varlock: { loadPath: '../../' } } } : {}),
      }),
      packageTsconfig(dir, {
        react: true,
        // An app emits no declarations, and asking for them makes tsc reject
        // route types it can only name through a dependency's internals
        // (TS2883, raf-effect-atom's Loader on the router context).
        compilerOptions: {
          declaration: false,
          declarationMap: false,
          types: ['node', 'vite/client'],
        },
      }),
      vitestConfig(dir, { mergeViteConfig: true }),
      owned(`${dir}/vite.config.ts`, viteConfig(ctx, apiPackage)),
      seed(
        `${dir}/src/router.tsx`,
        frontendPackage === undefined
          ? routerSource
          : atomRouterSource(frontendPackage),
      ),
      seed(
        `${dir}/src/routeTree.gen.ts`,
        api === undefined ? routeTreeSource : servedRouteTreeSource,
      ),
      seed(
        `${dir}/src/routes/__root.tsx`,
        frontend === undefined
          ? rootRouteSource(app)
          : atomRootRouteSource(app),
      ),
      seed(
        `${dir}/src/routes/index.tsx`,
        api === undefined
          ? indexRouteSource
          : frontendPackage === undefined
            ? servedIndexRouteSource
            : atomIndexRouteSource(frontendPackage),
      ),
      ...(api === undefined || apiPackage === undefined
        ? []
        : servedFiles(
            dir,
            apiPackage,
            ctx.pkg(contractName(api)),
            frontendPackage,
          )),
      seed(`${dir}/src/components/welcome.tsx`, welcomeSource),
      seed(`${dir}/src/styles.css`, "@import 'tailwindcss';\n"),
      seed(`${dir}/test/welcome.test.tsx`, welcomeTestSource),
      seed(`${dir}/README.md`, readme(ctx, app, apiPackage, frontendPackage)),
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
