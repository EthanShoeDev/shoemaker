#!/usr/bin/env bun
// Prints every package.json script in the workspace, grouped by package.
import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  Record as Rec,
  Schema,
  String as Str,
} from 'effect';
import { Command } from 'effect/cli';

const PackageJson = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.optional(Schema.String),
    scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    workspaces: Schema.optional(
      Schema.Union([
        Schema.Array(Schema.String),
        Schema.Struct({
          packages: Schema.optional(Schema.Array(Schema.String)),
        }),
      ]),
    ),
  }),
);
type PackageJson = typeof PackageJson.Type;
const decodePackageJson = Schema.decodeOption(PackageJson);

const readPackageJson = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(file))) return Option.none<PackageJson>();
  return decodePackageJson(yield* fs.readFileString(file));
});

type Workspaces = NonNullable<PackageJson['workspaces']>;
const isList = (workspaces: Workspaces): workspaces is ReadonlyArray<string> =>
  Arr.isArray(workspaces);

const workspacePatterns = (pkg: PackageJson) => {
  const { workspaces } = pkg;
  if (workspaces === undefined) return [];
  return isList(workspaces) ? workspaces : (workspaces.packages ?? []);
};

const manifestPaths = Effect.fnUntraced(function* (
  rootDir: string,
  patterns: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const paths: Array<string> = [];
  for (const pattern of patterns) {
    if (!Str.endsWith('/*')(pattern)) {
      paths.push(path.join(rootDir, pattern, 'package.json'));
      continue;
    }
    const base = path.join(rootDir, Str.slice(0, -2)(pattern));
    const entries = yield* fs
      .readDirectory(base)
      .pipe(Effect.orElseSucceed(() => []));
    for (const entry of entries)
      paths.push(path.join(base, entry, 'package.json'));
  }
  return paths;
});

const printScripts = (label: string, pkg: PackageJson) =>
  Effect.gen(function* () {
    const scripts = Rec.toEntries(pkg.scripts ?? {});
    yield* Console.log(`\n┌─ ${label}`);
    if (scripts.length === 0) yield* Console.log('│  (no scripts)');
    const width = Math.max(0, ...Arr.map(scripts, ([name]) => name.length));
    for (const [name, command] of scripts) {
      const shown =
        command.length > 60 ? `${Str.slice(0, 57)(command)}...` : command;
      yield* Console.log(`│  ${Str.padEnd(width)(name)}  →  ${shown}`);
    }
    yield* Console.log(`└─ ${scripts.length} script(s)`);
  });

const main = Effect.gen(function* () {
  const path = yield* Path.Path;
  const rootDir = path.resolve('.');
  const root = yield* readPackageJson(path.join(rootDir, 'package.json'));
  if (Option.isNone(root)) {
    yield* Console.log('No package.json in the current directory.');
    return;
  }
  yield* printScripts(`${root.value.name ?? 'root'} (root)`, root.value);

  const packages: Array<PackageJson> = [];
  for (const file of yield* manifestPaths(
    rootDir,
    workspacePatterns(root.value),
  )) {
    const pkg = yield* readPackageJson(file);
    if (Option.isSome(pkg)) packages.push(pkg.value);
  }
  const sorted = Arr.sort(packages, (a: PackageJson, b: PackageJson) =>
    Str.localeCompare(b.name ?? '')(a.name ?? ''),
  );
  for (const pkg of sorted) yield* printScripts(pkg.name ?? 'unknown', pkg);

  const total = Arr.reduce(
    [root.value, ...sorted],
    0,
    (sum, pkg) => sum + Rec.keys(pkg.scripts ?? {}).length,
  );
  yield* Console.log(
    `\n${sorted.length + 1} packages | ${total} total scripts`,
  );
});

const command = Command.make('pkg-scripts', {}, () => main);

Command.run(command, { version: '0.0.1' }).pipe(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- this is the entry point
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
