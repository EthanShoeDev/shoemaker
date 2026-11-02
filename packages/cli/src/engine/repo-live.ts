import { Array as Arr, Effect, FileSystem, Path, String as Str } from 'effect';

import { runCapture } from './process.ts';
import type { Repo } from './repo.ts';

// Never read, and all a repo outside git skips. FileSystem.glob prunes them
// instead of walking node_modules and filtering afterwards.
const EXCLUDED = Arr.map(
  ['node_modules', '.git', 'dist', '.turbo', '.external', '.direnv'],
  (dir) => `**/${dir}`,
);

export const makeRepo = Effect.fnUntraced(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.resolve(root);
  const at = (file: string) => path.join(absolute, file);
  // In a git repo, the files git would commit: tracked ones plus untracked
  // ones no .gitignore (nested, negated or global) excludes, so checks never
  // read cloned reference repos or build output. Undefined outside git.
  const listed = yield* runCapture(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    absolute,
  );
  const inGit =
    listed.code === 0
      ? new Set(Arr.filter(Str.split(listed.stdout, '\0'), Str.isNonEmpty))
      : undefined;

  const repo: Repo = {
    root: absolute,
    name: path.basename(absolute),
    read: (file) =>
      fs
        .exists(at(file))
        .pipe(
          Effect.flatMap((exists) =>
            exists ? fs.readFileString(at(file)) : Effect.undefined,
          ),
        ),
    exists: (file) => fs.exists(at(file)),
    glob: Effect.fnUntraced(function* (pattern) {
      const found = yield* fs.glob(pattern, {
        root: absolute,
        dot: true,
        exclude: EXCLUDED,
      });
      // git lists files only; outside git, directories that match are dropped.
      const files =
        inGit === undefined
          ? yield* Effect.filter(found, (file) =>
              fs
                .stat(at(file))
                .pipe(Effect.map((info) => info.type === 'File')),
            )
          : Arr.filter(found, (file) => inGit.has(file));
      return Arr.sort(files, Str.Order);
    }),
  };
  return repo;
});
