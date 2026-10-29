import { Array as Arr, Record as Rec, String as Str } from 'effect';

import type { ShoemakerConfig } from '../../config/schema.ts';
import type { Generator, Renderer } from '../../engine/types.ts';
import { effectFamily } from '../../versions.ts';
import { catalogDeps, json } from '../shared.ts';

const BUN_VERSION = '1.4.4';
export const PACKAGE_MANAGER = `bun@${BUN_VERSION}`;

// What the root itself runs: linters, formatters, checkers and the configs
// root-level *.ts files import. The root depends on no internal workspace
// package (turbo would hash that package's whole closure into every task).
export const rootDevDependencies = (config: ShoemakerConfig) => [
  '@effect/tsgo',
  'shoemaker',
  'shoemaker-knip-config',
  'shoemaker-oxfmt-config',
  'shoemaker-oxlint-config',
  'shoemaker-typescript-config',
  '@types/node',
  'bun-types',
  'jscpd',
  'knip',
  'oxfmt',
  'oxlint',
  'oxlint-tsgolint',
  config.taskRunner,
  'typescript',
  'vitest',
  // vitest's required peer; listed so its version comes from the catalog.
  'vite',
  ...(config.secrets === 'varlock' ? ['varlock'] : []),
  ...(config.features.changesets
    ? ['@changesets/changelog-github', '@changesets/cli']
    : []),
];

// Every repo pins these even when only packages use them (effect,
// @effect/vitest), so the catalog is the one place versions live.
export const rootTooling: Generator = (ctx) => ({
  catalog: [...rootDevDependencies(ctx.config), 'effect', '@effect/vitest'],
});

const scripts = (config: ShoemakerConfig) => ({
  prepare: 'effect-tsgo patch --oxlint',
  typecheck: 'tsc --noEmit',
  test: 'vitest run',
  clean: config.taskRunner === 'nx' ? 'rm -rf .nx' : 'rm -rf .turbo',
  'oxlint:check': 'oxlint -c oxlint.config.ts *.ts',
  'oxlint:fix': 'oxlint -c oxlint.config.ts --fix *.ts',
  'oxlint:fix:fix-suggestions':
    'oxlint -c oxlint.config.ts --fix --fix-suggestions .',
  'oxlint:unsafe:fix': 'oxlint -c oxlint.config.ts --fix-dangerously .',
  'oxfmt:check': 'oxfmt -c oxfmt.config.ts --check .',
  'oxfmt:fix': 'oxfmt -c oxfmt.config.ts --write .',
  'jscpd:check': 'jscpd --config .jscpd.json',
  'knip:check': 'knip --no-config-hints --cache',
  'knip:fix:danger': 'knip --fix --no-config-hints --cache',
  'catalog:check': 'shoemaker check catalog',
  'catalog:fix': 'shoemaker check catalog --fix',
  'effect-versions:check': 'shoemaker check effect-versions',
  'nix:fmt:check': 'shoemaker check nix-fmt',
  'nix:fmt:fix': 'shoemaker check nix-fmt --fix',
  'shoemaker:sync': 'shoemaker sync',
  ...(config.features.changesets
    ? {
        changeset: 'changeset',
        'changeset:status': 'changeset status',
        'changeset:version': 'changeset version && bun install --lockfile-only',
      }
    : {}),
  'update:all': 'nlx taze major -r -I',
  'update:nix-flake': 'nix flake update',
});

// Generators' files merge before renderers', so the skeleton is a generator
// contribution: its key order wins over fragments other generators add
// (infra scripts), and the renderer only fills in the catalog.
export const rootPackageJson: Generator = (ctx) => ({
  files: [
    {
      path: 'package.json',
      strategy: 'json-merge',
      content: json({
        name: ctx.config.name,
        private: true,
        ...(ctx.config.description === ''
          ? {}
          : { description: ctx.config.description }),
        type: 'module',
        workspaces: { packages: ['apps/*', 'packages/*'] },
        scripts: scripts(ctx.config),
        devDependencies: catalogDeps(rootDevDependencies(ctx.config)),
        // Transitive @effect/* caret ranges drift ahead of the exact effect
        // pin, which effect-versions:check rejects.
        overrides: Rec.fromEntries(
          Arr.map(
            Arr.sort(effectFamily, Str.Order),
            (name) => [name, ctx.version('effect')] as const,
          ),
        ),
        engines: { node: '^22.18.0 || ^24.0.0 || >=26.0.0' },
        // Turbo reads `devEngines` and will drop the top-level field in a
        // future major; tools that only know `packageManager` still read it.
        devEngines: {
          packageManager: { name: 'bun', version: BUN_VERSION },
        },
        packageManager: PACKAGE_MANAGER,
      }),
    },
  ],
});

export const rootCatalog: Renderer = (ctx, aggregate) => [
  {
    path: 'package.json',
    strategy: 'json-merge',
    content: json({
      workspaces: {
        catalog: Rec.fromEntries(
          Arr.map(
            aggregate.catalog,
            (name) => [name, ctx.version(name)] as const,
          ),
        ),
      },
    }),
  },
];
