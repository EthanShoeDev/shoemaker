import {
  Array as Arr,
  Effect,
  Option,
  Order,
  pipe,
  Record as Rec,
  RegExp as Regex,
  Result,
  Schema,
  SemVer,
  SemVerRange,
  String as Str,
} from 'effect';

import { mergeJson, parseJsonc, parseJsonObject } from '../engine/json.ts';
import type { Repo } from '../engine/repo.ts';

// Shared readers for doctor checks, repo checks and adopt: they all
// walk the same package.json files and edit them without reformatting.

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
    packages: Schema.String.pipe(Schema.Array, Schema.optional),
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
  catalogSkip: Schema.String.pipe(Schema.Array, Schema.optional),
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
export const catalogPath = (pkg: PackageJson): ReadonlyArray<string> =>
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
  // Not Str.kebabCase: that splits digits off too (`web2` -> `web-2`), and
  // keeps letters package names cannot have.
  const slug = Str.noCase(value, {
    delimiter: '-',
    splitRegExp: /([a-z0-9])([A-Z])/gu,
    stripRegExp: /[^A-Za-z0-9]+/gu,
  });
  return /^[a-z]/u.test(slug) ? slug : `x-${slug}`;
};

// The version a spec names (`^7`, `~1.2`, `>=1.2.3-rc.1`), missing parts as 0.
// SemVer.parse takes exact versions only and SemVerRange has no lower bound.
const SPEC = /(\d+)(?:\.(\d+))?(?:\.(\d+)(-[0-9A-Za-z.-]+)?)?/u;

const versionOf = (spec: string) =>
  Option.fromNullOr(SPEC.exec(spec)).pipe(
    Option.flatMap(([, major = '0', minor = '0', patch = '0', pre = '']) =>
      Result.getSuccess(SemVer.parse(`${major}.${minor}.${patch}${pre}`)),
    ),
  );

export const isNewerVersion = (a: string, b: string) =>
  Option.getOrElse(
    Option.zipWith(versionOf(a), versionOf(b), SemVer.isGreaterThan),
    () => false,
  );

// Whether a range admits a version. A spec that is not a range (`latest`, a
// URL) makes no claim, so it admits anything.
export const admits = (range: string, version: string) =>
  Result.match(Result.all([SemVerRange.parse(range), SemVer.parse(version)]), {
    onFailure: () => true,
    onSuccess: ([parsedRange, parsed]) =>
      SemVerRange.matches(parsedRange, parsed),
  });

export const majorOf = (version: string) =>
  Option.getOrUndefined(
    Option.map(versionOf(version), (parsed) => parsed.major),
  );

const indentOf = (text: string) => /\n([ \t]+)"/u.exec(text)?.[1] ?? '  ';

// Sets the value at `path` in a package.json, keeping its key order, indent,
// line endings and final newline. A new key goes in sorted position when the
// map around it is sorted (catalogs).
export const editJson = (
  text: string,
  path: ReadonlyArray<string>,
  value: string,
) => {
  const existing = parseJsonObject(text);
  if (existing === undefined) return text;
  const [first = '', ...rest] = path;
  const owned = {
    [first]: Arr.reduceRight(rest, value as unknown, (inner, key) => ({
      [key]: inner,
    })),
  };
  const JsonText = Schema.fromJsonString(Schema.Json, {
    space: indentOf(text),
  });
  return Option.match(
    Schema.encodeUnknownOption(JsonText)(mergeJson(existing, owned)),
    {
      onNone: () => text,
      onSome: (json) => {
        const edited = Str.endsWith('\n')(text) ? `${json}\n` : json;
        return Str.includes('\r\n')(text)
          ? Str.replaceAll('\n', '\r\n')(edited)
          : edited;
      },
    },
  );
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
  new RegExp(String.raw`${COMMAND_START}${Regex.escape(tool)}(?=\s|$)`, 'u');

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

// Each distinct string with how often it occurs, most frequent first.
export const countsOf = (values: ReadonlyArray<string>) =>
  Arr.sort(
    Arr.map(
      Rec.toEntries(Arr.groupBy(values, (value) => value)),
      ([value, group]) => [value, group.length] as const,
    ),
    Order.flip(
      Order.mapInput(
        Order.Number,
        (entry: readonly [string, number]) => entry[1],
      ),
    ),
  );

// The workspace scope (most common `@x/` among packages), never `repo`.
export const scopeFor = (workspace: Workspace) => {
  const scopes = Arr.flatMap(workspace.packages, (manifest) => {
    const scope = scopeOf(manifest.pkg.name);
    return scope === undefined || scope === 'repo' ? [] : [scope];
  });
  const [best] = countsOf(scopes);
  const rootName = workspace.root.pkg.name ?? 'project';
  return kebab(
    best?.[0] ?? scopeOf(rootName) ?? Str.replace(/^@[^/]+\//u, '')(rootName),
  );
};
