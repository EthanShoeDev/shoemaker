import { Array as Arr, pipe, String as Str } from 'effect';

import type { App, Package } from '../../config/schema.ts';
import type {
  Contribution,
  GenContext,
  Generator,
} from '../../engine/types.ts';
import { owned } from '../shared.ts';
import type { TaskDef } from '../task-runner/model.ts';

// Building blocks the app and library generators share. Each kind module
// exports a `(ctx, unit) => Contribution` builder; `forApps` / `forPackages`
// turn it into a `Generator` over every app (or package) of that kind.

export type Unit = App | Package;

export const appDir = (app: Unit) => `apps/${app.name}`;
export const packageDir = (pkg: Unit) => `packages/${pkg.name}`;

// Every workspace package typechecks with TS 7 `tsc` and tests with vitest.
// Under bun's isolated linker a package only sees what it declares, so the
// toolchain is listed per package rather than relied on from the root.
export const toolchainDevDependencies = [
  '@types/node',
  'typescript',
  'vitest',
] as const;

export const effectTestDevDependencies = [
  ...toolchainDevDependencies,
  '@effect/vitest',
  'bun-types',
] as const;

// Catalog names for a package: its own deps plus the tsconfig base that
// `workspacePackageJson` always adds.
export const catalogOf = (...groups: ReadonlyArray<ReadonlyArray<string>>) => [
  ...new Set([...groups.flat(), 'shoemaker-typescript-config']),
];

export const mergeContributions = (
  contributions: ReadonlyArray<Contribution>,
): Contribution => ({
  files: Arr.flatMap(contributions, (c) => c.files ?? []),
  tasks: Arr.flatMap(contributions, (c) => c.tasks ?? []),
  env: Arr.flatMap(contributions, (c) => c.env ?? []),
  catalog: [...new Set(Arr.flatMap(contributions, (c) => c.catalog ?? []))],
  nixPackages: Arr.flatMap(contributions, (c) => c.nixPackages ?? []),
  gitignore: Arr.flatMap(contributions, (c) => c.gitignore ?? []),
  ignore: Arr.flatMap(contributions, (c) => c.ignore ?? []),
});

export const forApps =
  (
    kind: App['kind'],
    build: (ctx: GenContext, app: App) => Contribution,
  ): Generator =>
  (ctx) =>
    mergeContributions(
      pipe(
        ctx.config.apps,
        Arr.filter((app) => app.kind === kind),
        Arr.map((app) => build(ctx, app)),
      ),
    );

export const forPackages =
  (
    kind: Package['kind'],
    build: (ctx: GenContext, pkg: Package) => Contribution,
  ): Generator =>
  (ctx) =>
    mergeContributions(
      pipe(
        ctx.config.packages,
        Arr.filter((pkg) => pkg.kind === kind),
        Arr.map((pkg) => build(ctx, pkg)),
      ),
    );

export interface VitestOptions {
  readonly include?: ReadonlyArray<string>;
  // Extra `test` entries, pre-rendered as `key: value` TypeScript.
  readonly extra?: ReadonlyArray<string>;
  // `mts` in packages that are not `"type": "module"` (Expo), so Vite loads
  // the config as ESM.
  readonly extension?: 'ts' | 'mts';
}

const list = (items: ReadonlyArray<string>) =>
  `[${pipe(
    items,
    Arr.map((item) => `'${item}'`),
    Arr.join(', '),
  )}]`;

// Unique project name so the root vitest `projects` list can hold every app.
export const vitestConfig = (
  dir: string,
  name: string,
  options: VitestOptions = {},
) =>
  owned(
    `${dir}/vitest.config.${options.extension ?? 'ts'}`,
    `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
${pipe(
  [
    `name: '${name}-unit'`,
    `include: ${list(options.include ?? ['test/**/*.test.{ts,tsx}'])}`,
    ...(options.extra ?? []),
  ],
  Arr.map((entry) => `    ${entry},`),
  Arr.join('\n'),
)}
  },
});
`,
  );

// Long-running dev servers are never cached and never finish.
export const devTask = (ctx: GenContext, unit: Unit): TaskDef => ({
  name: 'dev',
  package: ctx.pkg(unit.name),
  persistent: true,
  cache: false,
  comment: 'Dev server: long-running, never cached.',
});

export const buildTask = (
  ctx: GenContext,
  unit: Unit,
  outputs: ReadonlyArray<string>,
): TaskDef => ({
  name: 'build',
  package: ctx.pkg(unit.name),
  dependsOn: ['^build'],
  outputs,
});

export const pascalCase = (name: string) =>
  pipe(name, Str.split('-'), Arr.map(Str.capitalize), Arr.join(''));
