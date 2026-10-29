// oxlint-disable-next-line effecttsgo/node-builtin-import -- effect's Path has no glob matcher, and Bun.Glob is missing under node vitest.
import { matchesGlob } from 'node:path';

import { Array as Arr, Effect, Record as Rec, String as Str } from 'effect';

import type { Repo } from './repo.ts';

// In-memory Repo for tests: path -> contents.
export const makeMemoryRepo = (
  files: Readonly<Record<string, string>>,
  root = '/repo',
): Repo => ({
  root,
  read: (file) => Effect.succeed(files[file]),
  exists: (file) =>
    Effect.succeed(
      Rec.has(files, file) ||
        Arr.some(Rec.keys(files), Str.startsWith(`${file}/`)),
    ),
  glob: (pattern) =>
    Effect.succeed(
      Arr.sort(
        Arr.filter(Rec.keys(files), (f) => matchesGlob(f, pattern)),
        Str.Order,
      ),
    ),
});
