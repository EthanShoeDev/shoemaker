import { assert, describe, it } from '@effect/vitest';

import { parseJsonc } from '../../../src/checks/workspace.ts';
import type { ShoemakerConfig } from '../../../src/config/schema.ts';
import { parseJson, record, render } from '../root/fixtures.ts';
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
  const { byPath, file } = render(themed);

  it('gives a repo with more than one UI app a theme package', () => {
    const manifest = parseJson(file('packages/theme/package.json'));
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
    const tokens = file('packages/theme/tokens.css').content;
    assert.include(tokens, '--color-background: unset;');
    assert.include(tokens, '@variant light {');
    assert.include(tokens, '@variant dark {');
    const web = file('packages/theme/web.css').content;
    assert.include(web, "@import './tokens.css';");
    assert.include(web, '@custom-variant dark {');
  });

  it('points each app stylesheet at its platform entry', () => {
    for (const app of ['web', 'site']) {
      assert.strictEqual(
        file(`apps/${app}/src/styles.css`).content,
        "@import 'tailwindcss';\n@import '@sample/theme/web.css';\n",
      );
      assert.strictEqual(
        record(parseJson(file(`apps/${app}/package.json`)).dependencies)[
          '@sample/theme'
        ],
        'workspace:*',
      );
    }
    assert.strictEqual(
      file('apps/mobile/global.css').content,
      "@import 'tailwindcss';\n@import 'uniwind';\n@import '@sample/theme/tokens.css';\n",
    );
    assert.include(file('apps/mobile/app/index.tsx').content, 'bg-background');
  });

  it('opts the CSS-only package out of the shared commands', () => {
    const tasks = record(
      record(parseJsonc(file('packages/theme/turbo.jsonc').content)).tasks,
    );
    for (const name of ['typecheck', 'test', 'oxlint:check', 'oxlint:fix']) {
      assert.isNull(record(tasks[name]).command, name);
    }
    assert.notInclude(file('vitest.config.ts').content, 'packages/theme');
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
    assert.notInclude(single.file(sheet).content, '@sample/theme');
  });
});

describe('Expo styling', () => {
  const { aggregate, file } = render(only({ name: 'mobile', kind: 'expo' }));

  it('styles with Uniwind through Metro', () => {
    const metro = file('apps/mobile/metro.config.ts').content;
    assert.include(metro, "import { withUniwindConfig } from 'uniwind/metro';");
    assert.include(metro, "cssEntryFile: './global.css'");
    const manifest = parseJson(file('apps/mobile/package.json'));
    assert.property(record(manifest.dependencies), 'uniwind');
    assert.property(record(manifest.devDependencies), 'tailwindcss');
    assert.include(
      file('apps/mobile/app/_layout.tsx').content,
      "import '../global.css';",
    );
    assert.include(
      file('apps/mobile/app/index.tsx').content,
      'dark:bg-neutral-950',
    );
  });

  it('seeds the types Uniwind writes, kept out of lint and format', () => {
    const types = file('apps/mobile/uniwind-types.d.ts');
    assert.strictEqual(types.strategy, 'seed');
    assert.include(types.content, '/// <reference types="uniwind/types" />');
    assert.include(aggregate.ignore, 'apps/mobile/uniwind-types.d.ts');
    assert.include(file('apps/mobile/tsconfig.json').content, '"expo/types"');
  });
});
