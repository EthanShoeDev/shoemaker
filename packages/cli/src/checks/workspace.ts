import {
  Array as Arr,
  Effect,
  Option,
  Order,
  pipe,
  Predicate,
  Record as Rec,
  Schema,
  String as Str,
} from 'effect';
import * as Jsonc from 'jsonc-parser';

import type { Repo } from '../engine/repo.ts';

// Shared readers for doctor checks, repo checks and adopt: they all
// walk the same package.json files and edit them without reformatting.

export const parseJsonc = (text: string): unknown => {
  const errors: Array<Jsonc.ParseError> = [];
  const value: unknown = Jsonc.parse(text, errors, {
    allowTrailingComma: true,
  });
  return errors.length === 0 ? value : undefined;
};

// Non-null, non-array object (a parsed JSON object).
export const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> => Predicate.isObject(value);

export const decodeJsonc = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  text: string | undefined,
) =>
  text === undefined
    ? Option.none<S['Type']>()
    : Schema.decodeUnknownOption(schema)(parseJsonc(text));

const StringRecord = Schema.Record(Schema.String, Schema.String);

const Workspaces = Schema.Union([
  Schema.Array(Schema.String),
  Schema.Struct({
    packages: Schema.optional(Schema.Array(Schema.String)),
    catalog: Schema.optional(StringRecord),
  }),
]);

export const PackageJson = Schema.Struct({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  packageManager: Schema.optional(Schema.String),
  devEngines: Schema.optional(Schema.Unknown),
  bin: Schema.optional(Schema.Union([Schema.String, StringRecord])),
  exports: Schema.optional(Schema.Unknown),
  main: Schema.optional(Schema.String),
  scripts: Schema.optional(StringRecord),
  dependencies: Schema.optional(StringRecord),
  devDependencies: Schema.optional(StringRecord),
  peerDependencies: Schema.optional(StringRecord),
  optionalDependencies: Schema.optional(StringRecord),
  workspaces: Schema.optional(Workspaces),
  catalog: Schema.optional(StringRecord),
  catalogSkip: Schema.optional(Schema.Array(Schema.String)),
  patchedDependencies: Schema.optional(StringRecord),
});
export type PackageJson = typeof PackageJson.Type;

export const DEP_TYPES = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
] as const;
export type DepType = (typeof DEP_TYPES)[number];

export interface Manifest {
  // Repo-relative path of the package.json.
  readonly path: string;
  // Repo-relative package directory ('' for the root).
  readonly dir: string;
  readonly text: string;
  readonly pkg: PackageJson;
}

export const dirOf = (file: string) =>
  Option.match(Str.lastIndexOf('/')(file), {
    onNone: () => '',
    onSome: (slash) => Str.slice(0, slash)(file),
  });

export const readManifest = Effect.fnUntraced(function* (
  repo: Repo,
  path: string,
) {
  const text = yield* repo.read(path);
  const pkg = decodeJsonc(PackageJson, text);
  if (text === undefined || Option.isNone(pkg)) return undefined;
  const manifest: Manifest = { path, dir: dirOf(path), text, pkg: pkg.value };
  return manifest;
});

type Workspaces = NonNullable<PackageJson['workspaces']>;
const isList = (workspaces: Workspaces): workspaces is ReadonlyArray<string> =>
  Arr.isArray(workspaces);

export const workspacePatterns = (pkg: PackageJson) => {
  const { workspaces } = pkg;
  if (workspaces === undefined) return [];
  return isList(workspaces) ? workspaces : (workspaces.packages ?? []);
};

const nestedCatalog = (pkg: PackageJson) =>
  pkg.workspaces === undefined || isList(pkg.workspaces)
    ? undefined
    : pkg.workspaces.catalog;

export const catalogOf = (pkg: PackageJson) =>
  nestedCatalog(pkg) ?? pkg.catalog ?? {};

// Where `--fix` writes catalog entries: bun reads `workspaces.catalog` or a
// top-level `catalog` (the only option when `workspaces` is an array).
export const catalogPath = (pkg: PackageJson): Jsonc.JSONPath =>
  pkg.workspaces !== undefined &&
  !isList(pkg.workspaces) &&
  (nestedCatalog(pkg) !== undefined || pkg.catalog === undefined)
    ? ['workspaces', 'catalog']
    : ['catalog'];

export interface Workspace {
  readonly root: Manifest;
  // Workspace packages, excluding the root.
  readonly packages: ReadonlyArray<Manifest>;
  readonly catalog: Readonly<Record<string, string>>;
}

export const readWorkspace = Effect.fnUntraced(function* (repo: Repo) {
  const root = yield* readManifest(repo, 'package.json');
  if (root === undefined) return undefined;
  const patterns = workspacePatterns(root.pkg);
  const excluded = new Set<string>();
  const included = new Set<string>();
  for (const pattern of patterns) {
    const negated = Str.startsWith('!')(pattern);
    const base = Str.replace(
      /\/$/u,
      '',
    )(negated ? Str.slice(1)(pattern) : pattern);
    const matches = yield* repo.glob(`${base}/package.json`);
    for (const match of matches) (negated ? excluded : included).add(match);
  }
  const paths = Arr.sort(
    Arr.filter(included, (path) => !excluded.has(path)),
    Order.String,
  );
  const packages: Array<Manifest> = [];
  for (const path of paths) {
    const manifest = yield* readManifest(repo, path);
    if (manifest !== undefined) packages.push(manifest);
  }
  const workspace: Workspace = { root, packages, catalog: catalogOf(root.pkg) };
  return workspace;
});

export const allManifests = (workspace: Workspace) => [
  workspace.root,
  ...workspace.packages,
];

export const allDeps = (pkg: PackageJson) => ({
  ...pkg.peerDependencies,
  ...pkg.optionalDependencies,
  ...pkg.devDependencies,
  ...pkg.dependencies,
});

export const hasDep = (pkg: PackageJson, name: string) =>
  Rec.has(allDeps(pkg), name);

// `@scope/name` -> `scope`.
export const scopeOf = (name: string | undefined) =>
  name !== undefined && Str.startsWith('@')(name)
    ? Option.getOrUndefined(
        Option.map(Str.indexOf('/')(name), (slash) =>
          Str.slice(1, slash)(name),
        ),
      )
    : undefined;

export const kebab = (value: string) => {
  const slug = pipe(
    value,
    Str.replaceAll(/([a-z0-9])([A-Z])/gu, '$1-$2'),
    Str.toLowerCase,
    Str.replaceAll(/[^a-z0-9]+/gu, '-'),
    Str.replaceAll(/^-+|-+$/gu, ''),
  );
  return /^[a-z]/u.test(slug) ? slug : `x-${slug}`;
};

// Minimal semver-ish ordering: compares the first `x.y.z` in each string and
// ignores prerelease tags, enough to decide whether a pin is newer.
const numbers = (version: string) =>
  Option.getOrUndefined(
    Option.map(
      Option.fromNullOr(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(version)),
      (match) => Arr.map(match.slice(1), (part) => Number(part ?? 0)),
    ),
  );

export const isNewerVersion = (a: string, b: string) => {
  const left = numbers(a);
  const right = numbers(b);
  if (left === undefined || right === undefined) return false;
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
};

export const majorOf = (version: string) => numbers(version)?.[0];

const indentOf = (text: string) => {
  const match = /\n([ \t]+)"/u.exec(text);
  const indent = match?.[1] ?? '  ';
  return Str.startsWith('\t')(indent)
    ? { insertSpaces: false, tabSize: 1 }
    : { insertSpaces: true, tabSize: indent.length };
};

// Sets (or, with `undefined`, removes) the value at `path`, keeping the rest of
// the file byte-for-byte. New keys are inserted in alphabetical position when
// `sorted` is set (catalogs, dependency maps).
export const editJson = (
  text: string,
  path: Jsonc.JSONPath,
  value: unknown,
  sorted = false,
) => {
  const key = path.at(-1);
  const edits = Jsonc.modify(text, path, value, {
    formattingOptions: { ...indentOf(text), eol: '\n' },
    ...(sorted && Predicate.isString(key)
      ? {
          getInsertionIndex: (properties: Array<string>) =>
            Option.getOrElse(
              Arr.findFirstIndex(properties, (property) => property > key),
              () => properties.length,
            ),
        }
      : {}),
  });
  return Jsonc.applyEdits(text, edits);
};

// Accumulates edits to many files so several fixes can touch one file.
// `undefined` content means deleted. Files first seen through `set` have an
// unknown original, so they are always reported.
const UNREAD = Symbol('unread');

export const makeEditor = (
  initial: Iterable<{ readonly path: string; readonly text: string }>,
) => {
  const original = new Map<string, string | typeof UNREAD>();
  const current = new Map<string, string | undefined>();
  for (const file of initial) {
    original.set(file.path, file.text);
    current.set(file.path, file.text);
  }
  return {
    get: (path: string) => current.get(path),
    set: (path: string, text: string | undefined) => {
      if (!original.has(path)) original.set(path, UNREAD);
      current.set(path, text);
    },
    update: (path: string, f: (text: string) => string) => {
      const text = current.get(path);
      if (text !== undefined) current.set(path, f(text));
    },
    changes: () =>
      pipe(
        [...current],
        Arr.filter(([path, text]) => original.get(path) !== text),
        Arr.map(([path, content]) => ({ path, content })),
      ),
  };
};

const COMMAND_START = String.raw`(^|[\s;&|(]|&&|\|\|)`;

// Matches `tool` as a command word inside a script (not `effect-tsgo`, not
// `oxlint-tsgolint`).
export const commandWord = (tool: string) =>
  new RegExp(
    String.raw`${COMMAND_START}${Str.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)(tool)}(?=\s|$)`,
    'u',
  );

export const invokes = (script: string, tool: string) =>
  commandWord(tool).test(script);

// Strips line and block comments from TS source well enough for the regex
// checks doctor runs on config files (keeps `https://` inside strings).
export const stripComments = (source: string) =>
  pipe(
    source,
    Str.replaceAll(/\/\*[\s\S]*?\*\//gu, ''),
    Str.replaceAll(/(^|[^:'"`\\])\/\/.*$/gmu, '$1'),
  );

// The workspace scope (most common `@x/` among packages), never `repo`.
export const scopeFor = (workspace: Workspace) => {
  const counts = new Map<string, number>();
  for (const manifest of workspace.packages) {
    const scope = scopeOf(manifest.pkg.name);
    if (scope !== undefined && scope !== 'repo')
      counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  const [best] = Arr.sort(
    counts,
    Order.flip(
      Order.mapInput(
        Order.Number,
        (entry: readonly [string, number]) => entry[1],
      ),
    ),
  );
  const rootName = workspace.root.pkg.name ?? 'project';
  return kebab(
    best?.[0] ?? scopeOf(rootName) ?? Str.replace(/^@[^/]+\//u, '')(rootName),
  );
};
