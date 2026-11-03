import { Data, type Schema } from 'effect';

import type { ShoemakerConfig } from '../config/schema.ts';
import type { EnvVar } from '../generators/secrets/model.ts';
import type { Jsonc } from '../generators/task-runner/jsonc.ts';
import type { TaskDef } from '../generators/task-runner/model.ts';

// How `shoemaker sync` treats a generated file once it exists on disk.
//
// - `owned`: shoemaker renders the whole file. Re-rendered on every sync. A file
//   whose on-disk hash no longer matches the lockfile baseline was hand-edited
//   and is reported as a conflict instead of being overwritten.
// - `seed`: written once when missing (app source, README). Never updated.
// - `managed`: the file contains `shoemaker:begin <id>` / `shoemaker:end <id>`
//   regions. Sync rewrites region bodies only; text outside them is the
//   user's. A missing file is written in full.
// - `json-merge`: a JSON object of keys shoemaker owns. Sync deep merges them
//   into the existing JSON file (objects merge, everything else is replaced)
//   and leaves unowned keys alone. Used for package.json.
export type FileStrategy = 'owned' | 'seed' | 'managed' | 'json-merge';

interface FileFields {
  // Repo-relative POSIX path.
  readonly path: string;
  // Written as rendered, unformatted: the repo's oxfmt ignores it.
  readonly verbatim?: boolean;
}

// What a generator emits. JSON stays a value until the engine writes it, so
// generators never serialize and json-merge never reparses.
export type GeneratedFile = Data.TaggedEnum<{
  Text: FileFields & {
    readonly strategy: 'owned' | 'seed' | 'managed';
    readonly content: string;
    // Mark executable (scripts/*.sh).
    readonly executable?: boolean;
  };
  Json: FileFields & {
    readonly strategy: 'owned' | 'seed';
    readonly json: Schema.JsonObject;
  };
  // Printed in oxfmt's layout, with comments; `.json` files take no trailing
  // commas.
  Jsonc: FileFields & {
    readonly strategy: 'owned' | 'seed';
    readonly jsonc: Jsonc;
    readonly trailingCommas: boolean;
  };
  Merge: FileFields & {
    readonly strategy: 'json-merge';
    readonly json: Schema.JsonObject;
  };
}>;

export const GeneratedFile = Data.taggedEnum<GeneratedFile>();

// A generated file after the engine rendered it: whole files are text, and a
// json-merge fragment stays a value to merge with the file on disk.
export type RenderedFile =
  | Data.TaggedEnum.Value<GeneratedFile, 'Text'>
  | Data.TaggedEnum.Value<GeneratedFile, 'Merge'>;

// Facts generators share. Generators are pure: config in, files out.
export interface GenContext {
  readonly config: ShoemakerConfig;
  // `@scope/name` for a workspace package.
  readonly pkg: (name: string) => string;
  // Pinned version spec for a dependency, from versions.ts. Throws on unknown
  // names so a missing pin fails generation instead of emitting `latest`.
  readonly version: (dependency: string) => string;
}

// What one generator contributes. Files are merged by path (a later generator
// emitting the same `json-merge` path deep-merges; any other duplicate is a
// bug and throws). Tasks feed the task-runner renderer; env vars feed the
// secrets renderer; catalog entries feed the root package.json catalog.
export interface Contribution {
  readonly files?: ReadonlyArray<GeneratedFile>;
  readonly tasks?: ReadonlyArray<TaskDef>;
  readonly env?: ReadonlyArray<EnvVar>;
  // Dependency names to add to the root bun catalog (version from versions.ts).
  readonly catalog?: ReadonlyArray<string>;
  // nixpkgs attributes for the dev shell.
  readonly nixPackages?: ReadonlyArray<string>;
  // Lines for .gitignore.
  readonly gitignore?: ReadonlyArray<string>;
  // Glob patterns oxlint/oxfmt/jscpd/knip should ignore (generated code).
  readonly ignore?: ReadonlyArray<string>;
}

export type Generator = (ctx: GenContext) => Contribution;

// Everything every generator contributed, merged. Renderers for files that
// depend on the whole repo (root package.json catalog, turbo.jsonc / nx.json,
// .env.schema / secretspec.toml, flake.nix, .gitignore) read this.
export interface Aggregate {
  readonly tasks: ReadonlyArray<TaskDef>;
  readonly env: ReadonlyArray<EnvVar>;
  readonly catalog: ReadonlyArray<string>;
  readonly nixPackages: ReadonlyArray<string>;
  readonly gitignore: ReadonlyArray<string>;
  readonly ignore: ReadonlyArray<string>;
}

export type Renderer = (
  ctx: GenContext,
  aggregate: Aggregate,
) => ReadonlyArray<GeneratedFile>;
