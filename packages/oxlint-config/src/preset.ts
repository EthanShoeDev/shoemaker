import tanstackQuery from '@tanstack/eslint-plugin-query';
import { category, globalIgnores } from 'oxlint-flat-config';
import type {
  FlatConfigItem,
  GlobalConfigItem,
  ScopedConfigItem,
} from 'oxlint-flat-config';

import {
  e2eFiles,
  reactIgnorePatterns,
  routeFiles,
  sharedIgnorePatterns,
  testFiles,
  testingLibraryFiles,
} from './globs.ts';
import {
  effectVitestTestBlocks,
  everyRuleOf,
  resolvedPlugin,
} from './helpers.ts';
import {
  declarationOverride,
  playwrightOverride,
  routesOverride,
  testOverride,
  testingLibraryOverride,
  toolingOverride,
  vendoredOverride,
} from './overrides.ts';
import {
  budgets,
  effectShaped,
  jsdoc,
  modules,
  ownedByOxfmt,
  promises,
  style,
  typescript,
  vitest,
} from './rules/base.ts';
import { antiSlopRules, custom, effect } from './rules/effect.ts';
import { react, reactCompiler } from './rules/react.ts';

export type ShoeboxPresetOptions = {
  /** Workspace scope without the `@` (`myproj` for `@myproj/*`). */
  scope: string;
  /** react, react-perf and jsx-a11y, plus the React Compiler offs. */
  react?: boolean;
  /** route-active/no-render-time-match-route and the file-route override. */
  tanstackRouter?: boolean;
  /** Every @tanstack/eslint-plugin-query rule at error. */
  tanstackQuery?: boolean;
  /** eslint-plugin-playwright for e2e files. */
  playwright?: boolean;
  /** Globs of the Playwright specs (default: `e2eFiles`). */
  playwrightFiles?: Array<string>;
  /** eslint-plugin-testing-library for component tests. */
  testingLibrary?: boolean;
  /** Globs of the Testing Library tests (default: `testingLibraryFiles`). */
  testingLibraryFiles?: Array<string>;
  /** Browser globals and backdrop-filter/no-backdrop-filter. */
  web?: boolean;
};

/** The built-in plugins whose categories are on; react-only ones are added with `react`. */
const categoryPlugins = [
  'eslint',
  'typescript',
  'unicorn',
  'oxc',
  'import',
  'jsdoc',
  'node',
  'promise',
  'vitest',
] as const;

const reactPlugins = ['react', 'react-perf', 'jsx-a11y'] as const;

const plugins = 'shoe-box-oxlint-plugins';

/**
 * The preset in two halves: items without `files` (they compile to `**\/*`
 * overrides) and scoped items. defineShoeboxConfig puts the project's rules
 * between them, where oxlint's root `rules` used to sit.
 */
export const shoeboxPresetParts = (options: ShoeboxPresetOptions) => {
  const {
    scope,
    react: withReact = false,
    tanstackRouter = false,
    tanstackQuery: withTanstackQuery = false,
    playwright = false,
    testingLibrary = false,
    web = false,
  } = options;

  const global: Array<FlatConfigItem> = [
    globalIgnores(
      [...sharedIgnorePatterns, ...(withReact ? reactIgnorePatterns : [])],
      'shoebox/ignores',
    ),
    {
      name: 'shoebox/options',
      options: {
        typeAware: true,
        typeCheck: true,
        reportUnusedDisableDirectives: 'error',
      },
    },
    {
      name: 'shoebox/plugins',
      jsPlugins: [
        resolvedPlugin(
          'disable-comments',
          `${plugins}/require-disable-description`,
        ),
        resolvedPlugin('env-access', `${plugins}/no-raw-env-access`),
        resolvedPlugin(
          'import-boundaries',
          `${plugins}/no-cross-package-relative-imports`,
        ),
        resolvedPlugin(
          'dynamic-import',
          `${plugins}/no-unexplained-dynamic-import`,
        ),
        resolvedPlugin('anti-slop', `${plugins}/vendor/anti-slop`),
        resolvedPlugin(
          'anti-slop-effect',
          `${plugins}/vendor/anti-slop/effect`,
        ),
        ...(tanstackRouter
          ? [
              resolvedPlugin(
                'route-active',
                `${plugins}/no-render-time-match-route`,
              ),
            ]
          : []),
        ...(web
          ? [resolvedPlugin('backdrop-filter', `${plugins}/no-backdrop-filter`)]
          : []),
        ...(withTanstackQuery
          ? [resolvedPlugin('@tanstack/query', '@tanstack/eslint-plugin-query')]
          : []),
        ...(playwright
          ? [resolvedPlugin('playwright', 'eslint-plugin-playwright')]
          : []),
        ...(testingLibrary
          ? [resolvedPlugin('testing-library', 'eslint-plugin-testing-library')]
          : []),
      ],
      ...(web ? { env: { browser: true } } : {}),
    },
    // Every category at `error`: a rule is on unless a later item turns it
    // off. flat-config enables every built-in plugin, so the category's
    // plugin list is what keeps react/jsx-a11y rules out of non-React repos.
    category(
      {
        correctness: 'error',
        perf: 'error',
        restriction: 'error',
        suspicious: 'error',
        pedantic: 'error',
        style: 'error',
        plugins: [...categoryPlugins, ...(withReact ? reactPlugins : [])],
      },
      { name: 'shoebox/categories' },
    ),
    {
      name: 'shoebox/base',
      rules: {
        ...ownedByOxfmt,
        ...budgets,
        ...style,
        ...typescript,
        ...effectShaped,
        ...promises,
        ...modules,
        ...jsdoc,
        ...vitest(effectVitestTestBlocks),
      },
    },
    withReact && {
      name: 'shoebox/react',
      rules: { ...react, ...reactCompiler },
    },
    tanstackRouter && {
      name: 'shoebox/tanstack-router',
      rules: {
        // TanStack Router uses `throw redirect()` / `throw notFound()` as control flow.
        'typescript/only-throw-error': 'off',
        // The React Compiler freezes render-time matchRoute() results
        // (TanStack/router#4499); the rule judges the call site, so event-time
        // uses need no exemption.
        'route-active/no-render-time-match-route': 'error',
      },
    },
    web && {
      name: 'shoebox/web',
      rules: {
        // Backdrop filters re-filter the backdrop every frame and make
        // open/close animations stutter.
        'backdrop-filter/no-backdrop-filter': 'error',
      },
    },
    { name: 'shoebox/effect', rules: effect },
    { name: 'shoebox/custom', rules: custom(scope) },
    { name: 'shoebox/anti-slop', rules: antiSlopRules },
    withTanstackQuery && {
      name: 'shoebox/tanstack-query',
      rules: everyRuleOf('@tanstack/query', tanstackQuery),
    },
  ].filter((item): item is GlobalConfigItem => item !== false);

  const scoped: Array<ScopedConfigItem> = [
    declarationOverride(),
    testOverride({ files: testFiles, react: withReact }),
    ...(withReact && tanstackRouter ? [routesOverride(routeFiles)] : []),
    ...(playwright
      ? [playwrightOverride(options.playwrightFiles ?? e2eFiles)]
      : []),
    ...(testingLibrary
      ? [
          testingLibraryOverride(
            options.testingLibraryFiles ?? testingLibraryFiles,
          ),
        ]
      : []),
    toolingOverride(),
    vendoredOverride(),
  ];

  return { global, scoped };
};

/**
 * The shared config as named flat config items, for oxlint-flat-config's
 * `defineConfig` or `@oxlint-flat-config/composer`. Strictness model: every
 * category at `error`, every jsPlugin rule at `error`, and each rule these
 * codebases reject turned off WITH its reason on the line above it.
 */
// Annotated because the inferred type names flat-config's unexported ConfigFields.
export const shoeboxPreset = (
  options: ShoeboxPresetOptions,
): Array<FlatConfigItem> => {
  const { global, scoped } = shoeboxPresetParts(options);
  return [...global, ...scoped];
};
