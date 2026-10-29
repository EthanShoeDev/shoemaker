import { Array as Arr, Effect, FileSystem, Path, String as Str } from 'effect';
import { badArgument } from 'effect/PlatformError';

import type { Repo } from './repo.ts';

const EXCLUDED =
  /(?:^|\/)(?:node_modules|\.git|dist|\.turbo|\.external|\.direnv)\//u;

export const makeRepo = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.resolve(root);
  const at = (file: string) => path.join(absolute, file);

  const repo: Repo = {
    root: absolute,
    read: (file) =>
      fs
        .exists(at(file))
        .pipe(
          Effect.flatMap((exists) =>
            exists ? fs.readFileString(at(file)) : Effect.undefined,
          ),
        ),
    exists: (file) => fs.exists(at(file)),
    glob: (pattern) =>
      Effect.tryPromise({
        try: () =>
          Array.fromAsync(
            new Bun.Glob(pattern).scan({
              cwd: absolute,
              dot: true,
              onlyFiles: true,
            }),
          ),
        catch: (cause) =>
          badArgument({
            module: 'FileSystem',
            method: 'glob',
            description: `glob ${pattern}`,
            cause,
          }),
      }).pipe(
        Effect.map((files) =>
          Arr.sort(
            Arr.filter(files, (file) => !EXCLUDED.test(file)),
            Str.Order,
          ),
        ),
      ),
  };
  return repo;
});
