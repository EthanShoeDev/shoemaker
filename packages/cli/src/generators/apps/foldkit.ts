import { type App, renderingOf } from '../../config/schema.ts';
import type { Contribution, GenContext } from '../../engine/types.ts';
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
import { appStylesheet, themeDependency } from './theme.ts';

// Mirrors create-foldkit-app's templates: `ssr` its SSG template (a server
// entry whose listed paths are prerendered; the host renders the rest), `spa`
// its SPA template (base + counter example). Both leave out @foldkit/ui so the
// starter has no component library to unpick.
const dependencies = ['@effect/platform-browser', 'effect', 'foldkit'];
const devDependencies = [
  ...toolchainDevDependencies,
  '@foldkit/devtools',
  '@foldkit/vite-plugin',
  '@tailwindcss/vite',
  'happy-dom',
  'tailwindcss',
  'vite',
];

const spaViteConfig = `import { foldkit } from '@foldkit/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), foldkit()],
  optimizeDeps: {
    entries: ['src/entry.ts'],
  },
});
`;

// Prerendering builds each page's Request.url on the site's own origin when
// it has one, so canonical and Open Graph URLs derived from it are right.
const ssrViteConfig = (
  app: App,
) => `import { foldkit } from '@foldkit/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    foldkit({
      ssr: {
        serverEntry: '/src/entry.server.ts',
        clientEntry: '/src/entry.ts',
        build: { prerender: ${app.domain === undefined ? 'true' : `{ origin: 'https://${app.domain}' }`} },
      },
    }),
  ],
  optimizeDeps: {
    entries: ['src/entry.ts'],
  },
});
`;

const indexHtml = (app: App) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${app.name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/entry.ts"></script>
  </body>
</html>
`;

// Imported here (as foldkit's SSR/SSG examples do) rather than linked from
// index.html, so Vite and knip both trace the stylesheet from the entry.
const spaEntrySource = `import { Runtime } from 'foldkit';

import { Message, Model, init, update, view } from './main.ts';
import './styles.css';

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  container: document.querySelector('#root'),
  devTools: { Message },
});

Runtime.run(application);
`;

const spaMainSource = `import { Schema } from 'effect';
import type { Runtime, Update } from 'foldkit';
import type { Document, HtmlBuilder } from 'foldkit/html';
import { defineMessageUnion } from 'foldkit/message';
import { modifyFields } from 'foldkit/struct';

// MODEL

export const Model = Schema.Struct({ count: Schema.Finite });
export type Model = typeof Model.Type;

// MESSAGE

export const Message = defineMessageUnion({
  ClickedDecrement: {},
  ClickedIncrement: {},
  ClickedReset: {},
});
export type Message = typeof Message.Type;

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedDecrement: () => ({
      model: modifyFields(model, { count: (count) => count - 1 }),
    }),
    ClickedIncrement: () => ({
      model: modifyFields(model, { count: (count) => count + 1 }),
    }),
    ClickedReset: () => ({ model: modifyFields(model, { count: () => 0 }) }),
  });

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: { count: 0 },
});

// VIEW

const buttonStyle = 'bg-black text-white hover:bg-gray-700 px-4 py-2';

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: \`Counter: \${model.count}\`,
  body: h.div(
    [
      h.Class(
        'min-h-screen flex flex-col items-center justify-center gap-6 p-6',
      ),
    ],
    [
      h.p([h.Class('text-6xl font-bold')], [model.count.toString()]),
      h.div(
        [h.Class('flex gap-4')],
        [
          h.button(
            [h.OnClick(Message.ClickedDecrement()), h.Class(buttonStyle)],
            ['-'],
          ),
          h.button(
            [h.OnClick(Message.ClickedReset()), h.Class(buttonStyle)],
            ['Reset'],
          ),
          h.button(
            [h.OnClick(Message.ClickedIncrement()), h.Class(buttonStyle)],
            ['+'],
          ),
        ],
      ),
    ],
  ),
});
`;

const spaStoryTestSource = `import { Command, given, message, model, story } from 'foldkit/story';
import { describe, expect, test } from 'vitest';

import { Message, type Model, update } from './main.ts';

const initialModel: Model = { count: 0 };

describe('update', () => {
  test('ClickedIncrement adds one to the count', () => {
    story(
      update,
      given(initialModel),
      message(Message.ClickedIncrement()),
      Command.expectNone(),
      model((next) => {
        expect(next.count).toBe(1);
      }),
    );
  });

  test('ClickedReset sets the count back to zero', () => {
    story(
      update,
      given({ count: 42 }),
      message(Message.ClickedReset()),
      model((next) => {
        expect(next.count).toBe(0);
      }),
    );
  });
});
`;

// Namespaced so foldkit's scene \`expect\` is not mistaken for vitest's.
const spaSceneTestSource = `import * as Scene from 'foldkit/scene';
import { describe, test } from 'vitest';

import { type Model, update, view } from './main.ts';

const initialModel: Model = { count: 0 };

describe('view', () => {
  test('clicking + increments the displayed count', () => {
    Scene.scene(
      { update, view },
      Scene.given(initialModel),
      Scene.expect(Scene.text('0')).toExist(),
      Scene.click(Scene.role('button', { name: '+' })),
      Scene.expect(Scene.text('1')).toExist(),
    );
  });
});
`;

const routeSource = `import { Schema, pipe } from 'effect';
import { Route } from 'foldkit';
import { defineRouteUnion, literal } from 'foldkit/route';

export const AppRoute = defineRouteUnion({
  Home: {},
  About: {},
  NotFound: { path: Schema.String },
});
export type AppRoute = typeof AppRoute.Type;

export const homeRouter = pipe(Route.root, Route.mapTo(AppRoute.Home));
export const aboutRouter = pipe(literal('about'), Route.mapTo(AppRoute.About));

const routeParser = Route.oneOf(aboutRouter, homeRouter);

export const urlToAppRoute = Route.parseUrlWithFallback(
  routeParser,
  AppRoute.NotFound,
);
`;

// The server entry @foldkit/vite-plugin builds: \`vite build\` writes a page
// for each of \`prerenderPaths\`, and the deployed host renders any other
// request with \`renderPage\`, answering unknown routes with a 404.
const entryServerSource = `import { Effect, Option } from 'effect';
import { Server } from 'foldkit/experimental';
import { fromString } from 'foldkit/url';

import { init, view } from './main.ts';
import { AppRoute, urlToAppRoute } from './route.ts';

const HTTP_NOT_FOUND = 404;

export const renderDocument = Server.renderDocument;

export const prerenderPaths: ReadonlyArray<string> = ['/', '/about'];

const isNotFound = (url: string) =>
  Option.exists(
    Option.map(fromString(url), urlToAppRoute),
    AppRoute.isAnyOf(['NotFound']),
  );

export const renderPage = (request: Request): Promise<Server.EntryResult> =>
  Effect.runPromise(
    Server.renderToString(
      { routing: {}, init, view },
      { url: request.url },
    ).pipe(
      Effect.map((application) =>
        isNotFound(request.url)
          ? Server.Rendered(application, { status: HTTP_NOT_FOUND })
          : Server.Rendered(application),
      ),
    ),
  );
`;

const ssrEntrySource = `import { Runtime } from 'foldkit';

import { Message, Model, init, update, view } from './main.ts';
import './styles.css';

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  container: document.querySelector('#root'),
  routing: {
    onUrlRequest: (request) => Message.ClickedLink({ request }),
    onUrlChange: (url) => Message.ChangedUrl({ url }),
  },
  devTools: { Message },
});

Runtime.hydrate(application);
`;

const ssrMainSource = (
  app: App,
) => `import { Effect, Schema, pipe } from 'effect';
import { Command, type Runtime, type Update } from 'foldkit';
import type { Document, Html, HtmlBuilder } from 'foldkit/html';
import { defineMessageUnion } from 'foldkit/message';
import { UrlRequest, load, pushUrl } from 'foldkit/navigation';
import { modifyFields } from 'foldkit/struct';
import { Url, toString as urlToString } from 'foldkit/url';

import { AppRoute, aboutRouter, homeRouter, urlToAppRoute } from './route.ts';

// MODEL

export const Model = Schema.Struct({
  route: AppRoute,
  count: Schema.Finite,
});
export type Model = typeof Model.Type;

// MESSAGE

export const Message = defineMessageUnion({
  ClickedIncrement: {},
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedNavigateInternal: {},
  CompletedLoadExternal: {},
});
export type Message = typeof Message.Type;

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message> = (url) => ({
  model: { route: urlToAppRoute(url), count: 0 },
});

// COMMAND

const NavigateInternal = Command.define('NavigateInternal', {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigateInternal],
  execute: ({ url }) =>
    pushUrl(url).pipe(Effect.as(Message.CompletedNavigateInternal())),
});

const LoadExternal = Command.define('LoadExternal', {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadExternal],
  execute: ({ href }) =>
    load(href).pipe(Effect.as(Message.CompletedLoadExternal())),
});

// UPDATE

type UpdateReturn = Update.Return<Model, Message>;

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedIncrement: () => ({
      model: modifyFields(model, { count: (count) => count + 1 }),
    }),
    ClickedLink: ({ request }) =>
      UrlRequest.match<UpdateReturn>(request, {
        Internal: ({ url }) => ({
          model,
          commands: [NavigateInternal({ url: urlToString(url) })],
        }),
        External: ({ href }) => ({
          model,
          commands: [LoadExternal({ href })],
        }),
      }),
    ChangedUrl: ({ url }) => ({
      model: modifyFields(model, { route: () => urlToAppRoute(url) }),
    }),
    CompletedNavigateInternal: () => ({ model }),
    CompletedLoadExternal: () => ({ model }),
  });

// VIEW

const routeTitle = (route: AppRoute) =>
  pipe(
    AppRoute.match(route, {
      Home: () => 'Home',
      About: () => 'About',
      NotFound: () => 'Not Found',
    }),
    (page) => \`\${page} | ${app.name}\`,
  );

const navigationView = (h: HtmlBuilder<Message>): Html =>
  h.nav(
    [h.Class('flex gap-4')],
    [
      h.a([h.Href(homeRouter()), h.Class('underline')], ['Home']),
      h.a([h.Href(aboutRouter()), h.Class('underline')], ['About']),
    ],
  );

const pageView = (model: Model, h: HtmlBuilder<Message>): Html =>
  AppRoute.match(model.route, {
    Home: () =>
      h.section(
        [h.Class('grid gap-4')],
        [
          h.h1([h.Class('text-4xl font-bold')], ['Home']),
          h.p(
            [],
            ['This page was rendered during the build and hydrated in place.'],
          ),
          h.button(
            [
              h.OnClick(Message.ClickedIncrement()),
              h.Class('w-fit bg-black px-4 py-2 text-white hover:bg-gray-700'),
            ],
            [\`Count: \${model.count}\`],
          ),
        ],
      ),
    About: () =>
      h.section(
        [h.Class('grid gap-4')],
        [
          h.h1([h.Class('text-4xl font-bold')], ['About']),
          h.p([], ['The same renderPage function prerendered this page.']),
        ],
      ),
    NotFound: ({ path }) =>
      h.section(
        [h.Class('grid gap-4')],
        [
          h.h1([h.Class('text-4xl font-bold')], ['Not found']),
          h.p([], [\`Nothing lives at \${path}.\`]),
        ],
      ),
  });

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: routeTitle(model.route),
  body: h.main(
    [h.Class('mx-auto grid min-h-screen max-w-3xl content-center gap-10 p-8')],
    [navigationView(h), pageView(model, h)],
  ),
});
`;

const ssrStoryTestSource = `import { Command, given, message, model, story } from 'foldkit/story';
import { describe, expect, test } from 'vitest';

import { Message, type Model, update } from './main.ts';
import { AppRoute } from './route.ts';

const initialModel: Model = { route: AppRoute.Home(), count: 0 };

describe('update', () => {
  test('ClickedIncrement adds one to the count', () => {
    story(
      update,
      given(initialModel),
      message(Message.ClickedIncrement()),
      Command.expectNone(),
      model((next) => {
        expect(next.count).toBe(1);
      }),
    );
  });
});
`;

// Namespaced so foldkit's scene \`expect\` is not mistaken for vitest's.
const ssrSceneTestSource = `import * as Scene from 'foldkit/scene';
import { describe, test } from 'vitest';

import { type Model, update, view } from './main.ts';
import { AppRoute } from './route.ts';

const initialModel: Model = { route: AppRoute.Home(), count: 0 };

describe('view', () => {
  test('clicking the counter increments the count', () => {
    Scene.scene(
      { update, view },
      Scene.given(initialModel),
      Scene.click(Scene.role('button', { name: 'Count: 0' })),
      Scene.expect(Scene.role('button', { name: 'Count: 1' })).toExist(),
    );
  });

  test('an unknown path renders the not-found page', () => {
    Scene.scene(
      { update, view },
      Scene.given({ ...initialModel, route: AppRoute.NotFound({ path: '/nope' }) }),
      Scene.expect(Scene.text('Not found')).toExist(),
    );
  });
});
`;

// The seeds each rendering starts from.
const sources = (ctx: GenContext, app: App) => {
  const dir = appDir(app);
  return renderingOf(app) === 'ssr'
    ? [
        owned(`${dir}/vite.config.ts`, ssrViteConfig(app)),
        seed(`${dir}/src/entry.ts`, ssrEntrySource),
        seed(`${dir}/src/entry.server.ts`, entryServerSource),
        seed(`${dir}/src/route.ts`, routeSource),
        seed(`${dir}/src/main.ts`, ssrMainSource(app)),
        seed(`${dir}/src/story.test.ts`, ssrStoryTestSource),
        seed(`${dir}/src/scene.test.ts`, ssrSceneTestSource),
        seed(
          `${dir}/README.md`,
          `# ${ctx.pkg(app.name)}\n\n[Foldkit](https://foldkit.dev) site. \`vite build\` prerenders the paths \`src/entry.server.ts\` lists, and the deployed host renders every other request with the same entry. \`bun run dev\` to develop.\n`,
        ),
      ]
    : [
        owned(`${dir}/vite.config.ts`, spaViteConfig),
        seed(`${dir}/index.html`, indexHtml(app)),
        seed(`${dir}/src/entry.ts`, spaEntrySource),
        seed(`${dir}/src/main.ts`, spaMainSource),
        seed(`${dir}/src/story.test.ts`, spaStoryTestSource),
        seed(`${dir}/src/scene.test.ts`, spaSceneTestSource),
        seed(
          `${dir}/README.md`,
          `# ${ctx.pkg(app.name)}\n\n[Foldkit](https://foldkit.dev) single-page app. \`bun run dev\` to develop.\n`,
        ),
      ];
};

export const foldkitApp = (ctx: GenContext, app: App): Contribution => {
  const dir = appDir(app);
  return {
    files: [
      workspacePackageJson(ctx, {
        dir,
        name: app.name,
        scripts: {
          dev: 'vite',
          build: 'vite build',
          // An ssr build writes the browser half to dist/client.
          start:
            renderingOf(app) === 'ssr'
              ? 'vite preview --outDir dist/client'
              : 'vite preview',
        },
        dependencies,
        devDependencies,
        workspaceDependencies: themeDependency(ctx),
      }),
      packageTsconfig(dir, {
        compilerOptions: {
          lib: ['ES2024', 'DOM', 'DOM.Iterable'],
          types: ['node', 'vite/client'],
        },
        include: ['src/**/*', '*.ts'],
      }),
      // As in the template: tests sit next to the code and run in happy-dom,
      // with foldkit inlined so vitest transforms its ESM source.
      vitestConfig(dir, {
        include: ['src/**/*.test.ts'],
        extra: [
          "environment: 'happy-dom'",
          "setupFiles: ['./src/vitest-setup.ts']",
          "server: { deps: { inline: ['foldkit', '@foldkit/devtools'] } }",
        ],
      }),
      ...sources(ctx, app),
      seed(`${dir}/src/styles.css`, appStylesheet(ctx, 'web')),
      seed(
        `${dir}/src/vitest-setup.ts`,
        "import { setup } from 'foldkit/test/vitest';\n\nsetup();\n",
      ),
    ],
    catalog: catalogOf(dependencies, devDependencies),
  };
};

export const foldkitGenerator = forApps('foldkit', foldkitApp);
