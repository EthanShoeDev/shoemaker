import { Array as Arr, Effect, Record as Rec, String as Str } from 'effect';

import { matchesAny } from './glob.ts';
import type { Repo } from './repo.ts';

// In-memory Repo for tests: path -> contents.
export const makeMemoryRepo = (
  files: Readonly<Record<string, string>>,
  root = '/repo',
): Repo => ({
  root,
  name: Arr.lastNonEmpty(Str.split(root, '/')),
  read: (file) => Effect.succeed(files[file]),
  exists: (file) =>
    Effect.succeed(
      Rec.has(files, file) ||
        Arr.some(Rec.keys(files), Str.startsWith(`${file}/`)),
    ),
  glob: (pattern) =>
    Effect.succeed(
      Arr.sort(
        Arr.filter(Rec.keys(files), (f) => matchesAny(f, [pattern])),
        Str.Order,
      ),
    ),
});
