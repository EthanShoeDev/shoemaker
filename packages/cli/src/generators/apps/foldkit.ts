import type { App } from '../../config/schema.ts';
import type { Contribution, GenContext } from '../../engine/types.ts';
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
  forApps,
  toolchainDevDependencies,
  vitestConfig,
} from './common.ts';

// Mirrors create-foldkit-app's SPA template (base + counter example),
// minus @foldkit/ui so the starter has no component library to unpick.
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

const viteConfig = `import { foldkit } from '@foldkit/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), foldkit()],
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
const entrySource = `import { Runtime } from 'foldkit';

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

const mainSource = `import { Schema } from 'effect';
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

const storyTestSource = `import { Command, given, message, model, story } from 'foldkit/story';
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
const sceneTestSource = `import * as Scene from 'foldkit/scene';
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
          start: 'vite preview',
          test: 'vitest run',
        },
        dependencies,
        devDependencies,
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
      vitestConfig(dir, app.name, {
        include: ['src/**/*.test.ts'],
        extra: [
          "environment: 'happy-dom'",
          "setupFiles: ['./src/vitest-setup.ts']",
          "server: { deps: { inline: ['foldkit', '@foldkit/devtools'] } }",
        ],
      }),
      owned(`${dir}/vite.config.ts`, viteConfig),
      seed(`${dir}/index.html`, indexHtml(app)),
      seed(`${dir}/src/entry.ts`, entrySource),
      seed(`${dir}/src/main.ts`, mainSource),
      seed(`${dir}/src/styles.css`, "@import 'tailwindcss';\n"),
      seed(
        `${dir}/src/vitest-setup.ts`,
        "import { setup } from 'foldkit/test/vitest';\n\nsetup();\n",
      ),
      seed(`${dir}/src/story.test.ts`, storyTestSource),
      seed(`${dir}/src/scene.test.ts`, sceneTestSource),
      seed(
        `${dir}/README.md`,
        `# ${ctx.pkg(app.name)}\n\n[Foldkit](https://foldkit.dev) single-page app. \`bun run dev\` to develop.\n`,
      ),
    ],
    tasks: [devTask(ctx, app), buildTask(ctx, app, ['dist/**'])],
    catalog: catalogOf(dependencies, devDependencies),
  };
};

export const foldkitGenerator = forApps('foldkit', foldkitApp);
