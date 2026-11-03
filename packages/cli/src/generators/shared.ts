import {
  Array as Arr,
  pipe,
  Record as Rec,
  type Schema,
  String as Str,
} from 'effect';

import type { ShoemakerConfig } from '../config/schema.ts';
import { type GenContext, GeneratedFile } from '../engine/types.ts';
import type { Jsonc } from './task-runner/jsonc.ts';
import { type PackageCommand, packageCommands } from './task-runner/tasks.ts';

// Helpers shared by every generator area. Keep these small and boring: each
// generator should read like the file it produces.

export const owned = (path: string, content: string) =>
  GeneratedFile.Text({ path, strategy: 'owned', content });

export const seed = (path: string, content: string) =>
  GeneratedFile.Text({ path, strategy: 'seed', content });

export const managed = (path: string, content: string) =>
  GeneratedFile.Text({ path, strategy: 'managed', content });

export const ownedJson = (path: string, json: Schema.JsonObject) =>
  GeneratedFile.Json({ path, strategy: 'owned', json });

export const seedJson = (path: string, json: Schema.JsonObject) =>
  GeneratedFile.Json({ path, strategy: 'seed', json });

// turbo.jsonc takes trailing commas; `.json` files (nx, .vscode) do not.
export const ownedJsonc = (path: string, jsonc: Jsonc) =>
  GeneratedFile.Jsonc({
    path,
    strategy: 'owned',
    jsonc,
    trailingCommas: !Str.endsWith('.json')(path),
  });

// Keys shoemaker owns in a JSON file the user also edits (package.json).
export const jsonMerge = (path: string, json: Schema.JsonObject) =>
  GeneratedFile.Merge({ path, strategy: 'json-merge', json });

// A managed region. `comment` is the line-comment token of the file type
// (`//`, `#`, or `<!--` for markdown, which closes with `-->`).
export const region = (id: string, body: string, comment = '//') => {
  const close = comment === '<!--' ? ' -->' : '';
  return Arr.join(
    [
      `${comment} shoemaker:begin ${id}${close}`,
      Str.replace(/\n$/u, '')(body),
      `${comment} shoemaker:end ${id}${close}`,
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
  config: ShoemakerConfig,
  extra: Readonly<Record<string, string>> = {},
  optOut: ReadonlyArray<PackageCommand> = [],
) => ({
  ...(config.taskRunner === 'nx'
    ? pipe(
        packageCommands,
        Rec.filter((_, name) => !optOut.includes(name)),
        Rec.map((argv) => Arr.join(argv, ' ')),
      )
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
  // Shared commands this package does not run (see `optOutTasks`).
  readonly optOut?: ReadonlyArray<PackageCommand>;
  // Expo apps are not ESM packages.
  readonly module?: boolean;
  // False when the package's tsconfig extends something other than
  // shoemaker-typescript-config (Expo extends expo/tsconfig.base).
  readonly sharedTsconfig?: boolean;
  readonly extra?: Readonly<Record<string, Schema.Json>>;
}

// package.json for a workspace package, as a json-merge file so later syncs
// update scripts and deps without touching keys the user added.
export const workspacePackageJson = (
  ctx: GenContext,
  pkg: WorkspacePackage,
) => {
  const scripts: Readonly<Record<string, string>> = packageScripts(
    ctx.config,
    pkg.scripts,
    pkg.optOut,
  );
  return jsonMerge(`${pkg.dir}/package.json`, {
    name: ctx.pkg(pkg.name),
    version: '0.0.0',
    private: true,
    ...(pkg.module === false ? {} : { type: 'module' }),
    ...(pkg.description === undefined ? {} : { description: pkg.description }),
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
      ...(pkg.sharedTsconfig === false ? [] : ['shoemaker-typescript-config']),
      ...(pkg.devDependencies ?? []),
    ]),
    ...pkg.extra,
  });
};

// Per-package tsconfig extending the shared base.
export const packageTsconfig = (
  dir: string,
  options: {
    readonly react?: boolean;
    readonly compilerOptions?: Schema.JsonObject;
    readonly include?: ReadonlyArray<string>;
  } = {},
) =>
  ownedJson(`${dir}/tsconfig.json`, {
    extends: `shoemaker-typescript-config/${
      options.react === true ? 'tsconfig.react.json' : 'tsconfig.base.json'
    }`,
    ...(options.compilerOptions === undefined
      ? {}
      : { compilerOptions: options.compilerOptions }),
    include: options.include ?? ['src/**/*', 'test/**/*', '*.ts'],
  });

// Wrap a command so it runs with the repo's env/secrets loaded.
export const withSecrets = (
  config: ShoemakerConfig,
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
  config: ShoemakerConfig,
  kind: ShoemakerConfig['apps'][number]['kind'],
) => Arr.some(config.apps, (app) => app.kind === kind);
