import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';

import type { ShoemakerConfig } from '../../../src/config/schema.ts';
import { formatFiles } from '../../../src/engine/format.ts';
import { record, textOf } from '../files.ts';
import { render } from '../root/fixtures.ts';
import { sampleConfig } from './helpers.ts';

const themed = sampleConfig({
  apps: [
    { name: 'web', kind: 'tanstack-start' },
    { name: 'site', kind: 'foldkit' },
    { name: 'mobile', kind: 'expo' },
  ],
});

const only = (app: ShoemakerConfig['apps'][number]) =>
  sampleConfig({ apps: [app] });

describe('shared theme', () => {
  const { byPath, file, text, json } = render(themed);

  it('gives a repo with more than one UI app a theme package', () => {
    const manifest = json('packages/theme/package.json');
    assert.strictEqual(manifest.name, '@sample/theme');
    assert.deepStrictEqual(record(manifest.exports), {
      './tokens.css': './tokens.css',
      './web.css': './web.css',
      './package.json': './package.json',
    });
    assert.strictEqual(file('packages/theme/tokens.css').strategy, 'seed');
    assert.strictEqual(file('packages/theme/web.css').strategy, 'owned');
    assert.isFalse(byPath.has('packages/theme/tsconfig.json'));
  });

  it('declares every themed color and sets it in both themes', () => {
    const tokens = text('packages/theme/tokens.css');
    assert.include(tokens, '--color-background: unset;');
    assert.include(tokens, '@variant light {');
    assert.include(tokens, '@variant dark {');
    const web = text('packages/theme/web.css');
    assert.include(web, "@import './tokens.css';");
    assert.include(web, '@custom-variant dark {');
  });

  it('points each app stylesheet at its platform entry', () => {
    for (const app of ['web', 'site']) {
      assert.strictEqual(
        text(`apps/${app}/src/styles.css`),
        "@import 'tailwindcss';\n@import '@sample/theme/web.css';\n",
      );
      assert.strictEqual(
        record(json(`apps/${app}/package.json`).dependencies)['@sample/theme'],
        'workspace:*',
      );
    }
    assert.strictEqual(
      text('apps/mobile/global.css'),
      "@import 'tailwindcss';\n@import 'uniwind';\n@import '@sample/theme/tokens.css';\n",
    );
    assert.include(text('apps/mobile/app/index.tsx'), 'bg-background');
  });

  it('opts the CSS-only package out of the shared commands', () => {
    const tasks = record(json('packages/theme/turbo.jsonc').tasks);
    for (const name of ['typecheck', 'test', 'oxlint:check', 'oxlint:fix']) {
      assert.isNull(record(tasks[name]).command, name);
    }
    assert.notInclude(text('vitest.config.ts'), 'packages/theme');
  });

  it.each([
    ['one web app', { name: 'web', kind: 'tanstack-start' }],
    ['one Expo app', { name: 'mobile', kind: 'expo' }],
  ] as const)('leaves %s without a theme package', (_name, app) => {
    const single = render(only(app));
    assert.isFalse(single.byPath.has('packages/theme/package.json'));
    const sheet =
      app.kind === 'expo'
        ? 'apps/mobile/global.css'
        : 'apps/web/src/styles.css';
    assert.notInclude(single.text(sheet), '@sample/theme');
  });
});

describe('Expo styling', () => {
  const { aggregate, file, text, json } = render(
    only({ name: 'mobile', kind: 'expo' }),
  );

  it('styles with Uniwind through Metro', () => {
    const metro = text('apps/mobile/metro.config.ts');
    assert.include(metro, "import { withUniwindConfig } from 'uniwind/metro';");
    assert.include(metro, "cssEntryFile: './global.css'");
    const manifest = json('apps/mobile/package.json');
    assert.property(record(manifest.dependencies), 'uniwind');
    assert.property(record(manifest.devDependencies), 'tailwindcss');
    assert.include(
      text('apps/mobile/app/_layout.tsx'),
      "import '../global.css';",
    );
    assert.include(text('apps/mobile/app/index.tsx'), 'dark:bg-neutral-950');
  });

  it('seeds the types Uniwind writes, kept out of lint and format', () => {
    assert.strictEqual(file('apps/mobile/uniwind-types.d.ts').strategy, 'seed');
    assert.include(
      text('apps/mobile/uniwind-types.d.ts'),
      '/// <reference types="uniwind/types" />',
    );
    assert.include(aggregate.ignore, 'apps/mobile/uniwind-types.d.ts');
    assert.include(
      record(json('apps/mobile/tsconfig.json').compilerOptions).types,
      'expo/types',
    );
  });

  it.effect(
    'writes the Uniwind types unformatted, as Metro rewrites them',
    () =>
      Effect.gen(function* () {
        const types = file('apps/mobile/uniwind-types.d.ts');
        const [written] = yield* formatFiles([types]);
        assert.isDefined(written);
        assert.strictEqual(textOf(written), textOf(types));
        assert.include(
          textOf(types),
          "    themes: readonly ['light', 'dark']\n",
        );
      }),
  );
});
