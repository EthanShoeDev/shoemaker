import type { ShoeboxConfig } from '../config/schema.ts';
import type { EnvVar } from '../generators/secrets/model.ts';
import type { TaskDef } from '../generators/task-runner/model.ts';

// How `shoebox sync` treats a generated file once it exists on disk.
//
// - `owned`: shoebox renders the whole file. Re-rendered on every sync. A file
//   whose on-disk hash no longer matches the lockfile baseline was hand-edited
//   and is reported as a conflict instead of being overwritten.
// - `seed`: written once when missing (app source, README). Never updated.
// - `managed`: the file contains `shoebox:begin <id>` / `shoebox:end <id>`
//   regions. Sync rewrites region bodies only; text outside them is the
//   user's. A missing file is written in full.
// - `json-merge`: `content` is a JSON object of keys shoebox owns. Sync deep
//   merges them into the existing JSON file (objects merge, everything else is
//   replaced) and leaves unowned keys alone. Used for package.json.
export type FileStrategy = 'owned' | 'seed' | 'managed' | 'json-merge';

export interface GeneratedFile {
  // Repo-relative POSIX path.
  readonly path: string;
  readonly content: string;
  readonly strategy: FileStrategy;
  // Mark executable (scripts/*.sh).
  readonly executable?: boolean;
}

// Facts generators share. Generators are pure: config in, files out.
export interface GenContext {
  readonly config: ShoeboxConfig;
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
