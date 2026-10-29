import {
  Array as Arr,
  Config,
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

// The registry answers 404 for a name or version it has never seen.
export const onNpm = Effect.fnUntraced(function* (path: string) {
  const response = yield* HttpClient.get(`https://registry.npmjs.org/${path}`);
  return response.status === 200;
});

// CI publishes through npm trusted publishing (OIDC), which can only publish
// to a package that already exists and names this repo as a trusted
// publisher. A name npm has never seen is `unclaimed` there: its first
// version goes out by hand (scripts/release.ts).
export const publishStatus = Effect.fnUntraced(function* (pkg: {
  readonly name: string;
  readonly version: string;
}) {
  if (yield* onNpm(`${pkg.name}/${pkg.version}`)) return 'published' as const;
  const ci = yield* Config.Boolean('CI').pipe(Config.withDefault(false));
  if (ci && !(yield* onNpm(pkg.name))) return 'unclaimed' as const;
  return 'pending' as const;
});
