import { Array as Arr, Record as Rec, String as Str } from 'effect';

import type { ShoeboxConfig } from '../config/schema.ts';
import type { GenContext, GeneratedFile } from '../engine/types.ts';
import { packageCommands } from './task-runner/tasks.ts';

// Helpers shared by every generator area. Keep these small and boring: each
// generator should read like the file it produces.

export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export const owned = (path: string, content: string): GeneratedFile => ({
  path,
  content,
  strategy: 'owned',
});

export const seed = (path: string, content: string): GeneratedFile => ({
  path,
  content,
  strategy: 'seed',
});

export const managed = (path: string, content: string): GeneratedFile => ({
  path,
  content,
  strategy: 'managed',
});

// A managed region. `comment` is the line-comment token of the file type
// (`//`, `#`, or `<!--` for markdown, which closes with `-->`).
export const region = (id: string, body: string, comment = '//') => {
  const close = comment === '<!--' ? ' -->' : '';
  return Arr.join(
    [
      `${comment} shoebox:begin ${id}${close}`,
      Str.replace(/\n$/u, '')(body),
      `${comment} shoebox:end ${id}${close}`,
    ],
    '\n',
  );
};

// `{ react: 'catalog:' }` for each dependency name. Generators also list the
// names in `Contribution.catalog` so the root catalog pins them.
export const catalogDeps = (names: ReadonlyArray<string>) =>
  Rec.fromEntries(
    Arr.map(Arr.sort(names, Str.Order), (name) => [name, 'catalog:'] as const),
  );

// A workspace package's scripts. Turbo runs the shared leaf commands from
// turbo.jsonc, so packages only carry their own; nx runs package scripts, so
// there every package gets a copy. Aggregates (`lint`, `lint:check`) are
// task-runner tasks with no script.
export const packageScripts = (
  config: ShoeboxConfig,
  extra: Readonly<Record<string, string>> = {},
) => ({
  ...(config.taskRunner === 'nx'
    ? Rec.map(packageCommands, (argv) => Arr.join(argv, ' '))
    : {}),
  ...extra,
});

export interface WorkspacePackage {
  // Directory relative to the repo root (`apps/web`, `packages/core`).
  readonly dir: string;
  // Unscoped name; the scope comes from the config.
  readonly name: string;
  readonly description?: string;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: ReadonlyArray<string>;
  readonly devDependencies?: ReadonlyArray<string>;
  // Other workspace packages (unscoped names) this package depends on.
  readonly workspaceDependencies?: ReadonlyArray<string>;
  readonly exports?: Readonly<Record<string, string>>;
  // Expo apps are not ESM packages.
  readonly module?: boolean;
  // False when the package's tsconfig extends something other than
  // shoe-box-typescript-config (Expo extends expo/tsconfig.base).
  readonly sharedTsconfig?: boolean;
  readonly extra?: Readonly<Record<string, unknown>>;
}

// package.json for a workspace package, as a json-merge file so later syncs
// update scripts and deps without touching keys the user added.
export const workspacePackageJson = (
  ctx: GenContext,
  pkg: WorkspacePackage,
): GeneratedFile => {
  const scripts: Readonly<Record<string, string>> = packageScripts(
    ctx.config,
    pkg.scripts,
  );
  return {
    path: `${pkg.dir}/package.json`,
    strategy: 'json-merge',
    content: json({
      name: ctx.pkg(pkg.name),
      version: '0.0.0',
      private: true,
      ...(pkg.module === false ? {} : { type: 'module' }),
      ...(pkg.description === undefined
        ? {}
        : { description: pkg.description }),
      ...(pkg.exports === undefined
        ? {}
        : { exports: { ...pkg.exports, './package.json': './package.json' } }),
      ...(Rec.isEmptyRecord(scripts) ? {} : { scripts }),
      dependencies: {
        ...Rec.fromEntries(
          Arr.map(
            Arr.sort(pkg.workspaceDependencies ?? [], Str.Order),
            (name) => [ctx.pkg(name), 'workspace:*'] as const,
          ),
        ),
        ...catalogDeps(pkg.dependencies ?? []),
      },
      devDependencies: catalogDeps([
        ...(pkg.sharedTsconfig === false ? [] : ['shoe-box-typescript-config']),
        ...(pkg.devDependencies ?? []),
      ]),
      ...pkg.extra,
    }),
  };
};

// Per-package tsconfig extending the shared base.
export const packageTsconfig = (
  dir: string,
  options: {
    readonly react?: boolean;
    readonly compilerOptions?: Readonly<Record<string, unknown>>;
    readonly include?: ReadonlyArray<string>;
  } = {},
): GeneratedFile =>
  owned(
    `${dir}/tsconfig.json`,
    json({
      extends: `shoe-box-typescript-config/${
        options.react === true ? 'tsconfig.react.json' : 'tsconfig.base.json'
      }`,
      ...(options.compilerOptions === undefined
        ? {}
        : { compilerOptions: options.compilerOptions }),
      include: options.include ?? ['src/**/*', 'test/**/*', '*.ts'],
    }),
  );

// Wrap a command so it runs with the repo's env/secrets loaded.
export const withSecrets = (
  config: ShoeboxConfig,
  command: string,
  profile = 'development',
) => {
  switch (config.secrets) {
    case 'varlock': {
      return `varlock run -- ${command}`;
    }
    case 'secretspec': {
      return `secretspec run --profile ${profile} -- ${command}`;
    }
    case 'none': {
      return command;
    }
  }
};

export const hasApp = (
  config: ShoeboxConfig,
  kind: ShoeboxConfig['apps'][number]['kind'],
) => Arr.some(config.apps, (app) => app.kind === kind);
