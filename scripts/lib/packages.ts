import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Predicate,
  String as Str,
} from 'effect';
import { HttpClient } from 'effect/http';

import { readJsonObject } from './json.ts';

export const repoRoot = Effect.gen(function* () {
  const path = yield* Path.Path;
  return path.resolve(import.meta.dirname, '../..');
});

// Workspace packages that go to npm (every one not marked private). Publish
// order is turbo's job (`^build`, `^release:publish`), so none is kept here.
export const publishablePackages = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* repoRoot;
  const dirs = yield* fs.readDirectory(path.join(root, 'packages'));
  const found = yield* Effect.forEach(Arr.sort(dirs, Str.Order), (dir) =>
    Effect.gen(function* () {
      const cwd = path.join(root, 'packages', dir);
      const manifestPath = path.join(cwd, 'package.json');
      if (!(yield* fs.exists(manifestPath))) return undefined;
      const manifest = yield* readJsonObject(manifestPath);
      if (manifest.private === true) return undefined;
      return {
        cwd,
        name: String(manifest.name),
        version: String(manifest.version),
      };
    }),
  );
  return Arr.filter(found, Predicate.isNotUndefined);
});

// The registry answers 404 for a version it has never seen.
export const isOnNpm = Effect.fnUntraced(function* (pkg: {
  readonly name: string;
  readonly version: string;
}) {
  const response = yield* HttpClient.get(
    `https://registry.npmjs.org/${pkg.name}/${pkg.version}`,
  );
  return response.status === 200;
});
