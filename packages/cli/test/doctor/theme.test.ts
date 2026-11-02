import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Record as Rec, String as Str } from 'effect';

import { themeImports, themeTokens } from '../../src/doctor/theme.ts';
import { sampleConfig } from '../generators/apps/helpers.ts';
import { render } from '../generators/root/fixtures.ts';
import { failures, json, runCheck } from './helpers.ts';

const generated = render(
  sampleConfig({
    apps: [
      { name: 'web', kind: 'tanstack-start' },
      { name: 'mobile', kind: 'expo' },
    ],
  }),
);
const tokens = generated.file('packages/theme/tokens.css').content;

const messages = (found: ReadonlyArray<{ readonly message: string }>) =>
  Arr.map(found, (f) => f.message);

describe('theme-tokens doctor check', () => {
  it.effect('says nothing for a repo without themes', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* runCheck(themeTokens, {
          'apps/web/src/styles.css': "@import 'tailwindcss';\n",
        }),
        [],
      );
    }),
  );

  it.effect('passes the tokens shoemaker generates', () =>
    Effect.gen(function* () {
      const findings = yield* runCheck(themeTokens, {
        'packages/theme/tokens.css': tokens,
      });
      assert.deepStrictEqual(
        Arr.map(findings, (f) => [f.ok, f.message]),
        [[true, 'theme tokens consistent in 1 stylesheet']],
      );
    }),
  );

  it.effect('flags a theme missing a color', () =>
    Effect.gen(function* () {
      const broken = Str.replace(
        /(@variant dark \{[^}]*?)\s*--color-ring: [^;]*;/u,
        '$1',
      )(tokens);
      assert.deepStrictEqual(
        messages(
          yield* failures(themeTokens, { 'packages/theme/tokens.css': broken }),
        ),
        ['packages/theme/tokens.css: theme dark is missing --color-ring'],
      );
    }),
  );

  it.effect('flags any app stylesheet whose themes disagree', () =>
    Effect.gen(function* () {
      const sheet = `@layer theme {
  :root {
    @variant light { --color-surface: #fff; --color-text: #111; }
    @variant dark { --color-surface: #000; }
    @variant dracula { --color-surface: #282a36; --color-text: #f8f8f2; }
  }
}
`;
      assert.deepStrictEqual(
        messages(
          yield* failures(themeTokens, { 'apps/mobile/src/global.css': sheet }),
        ),
        ['apps/mobile/src/global.css: theme dark is missing --color-text'],
      );
    }),
  );

  it.effect(
    'keeps the shared tokens declared and free of web-only directives',
    () =>
      Effect.gen(function* () {
        const broken = `@plugin '@tailwindcss/typography';
${Str.replace('--color-ring: unset;', '')(tokens)}`;
        assert.deepStrictEqual(
          messages(
            yield* failures(themeTokens, {
              'packages/theme/tokens.css': broken,
            }),
          ),
          [
            'packages/theme/tokens.css: --color-ring not declared in @theme',
            'packages/theme/tokens.css uses @plugin, which Uniwind cannot parse',
          ],
        );
      }),
  );
});

const workspace = (
  apps: Readonly<Record<string, { deps: Record<string, string>; css: string }>>,
) => ({
  'package.json': json({
    name: 'sample',
    workspaces: ['apps/*', 'packages/*'],
  }),
  'packages/theme/package.json': json({ name: '@sample/theme' }),
  ...Rec.fromEntries(
    Arr.flatMap(Rec.toEntries(apps), ([name, app]) => [
      [
        `apps/${name}/package.json`,
        json({ name: `@sample/${name}`, dependencies: app.deps }),
      ] as const,
      [`apps/${name}/src/styles.css`, app.css] as const,
    ]),
  ),
});

describe('theme-imports doctor check', () => {
  it.effect('says nothing without a theme package', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* runCheck(themeImports, {
          'package.json': json({ name: 'sample', workspaces: ['apps/*'] }),
        }),
        [],
      );
    }),
  );

  it.effect('passes apps that import the theme', () =>
    Effect.gen(function* () {
      const findings = yield* runCheck(
        themeImports,
        workspace({
          web: {
            deps: { tailwindcss: 'catalog:', '@sample/theme': 'workspace:*' },
            css: "@import 'tailwindcss';\n@import '@sample/theme/web.css';\n",
          },
          api: { deps: { effect: 'catalog:' }, css: '' },
        }),
      );
      assert.deepStrictEqual(
        Arr.map(findings, (f) => [f.ok, f.message]),
        [[true, '1 app share @sample/theme']],
      );
    }),
  );

  it.effect('flags a styled app that skips the theme', () =>
    Effect.gen(function* () {
      const found = yield* failures(
        themeImports,
        workspace({
          mobile: {
            deps: { uniwind: 'catalog:' },
            css: "@import 'tailwindcss';\n@import 'uniwind';\n",
          },
        }),
      );
      assert.deepStrictEqual(messages(found), [
        'apps/mobile does not use the shared theme (@sample/theme)',
      ]);
      assert.include(
        found[0]?.fix ?? '',
        "@import '@sample/theme/tokens.css';",
      );
    }),
  );
});
