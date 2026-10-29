import {
  Array as Arr,
  Effect,
  FileSystem,
  Path,
  Schema,
  String as Str,
} from 'effect';

import { LOCK_PATH, type Lock, renderLock } from './lock.ts';
import { isWrite, type Plan } from './plan.ts';
import { runCapture } from './process.ts';

export class DirtyTreeError extends Schema.TaggedError<
  DirtyTreeError,
  { readonly brand: unique symbol }
>()('DirtyTreeError', { message: Schema.String }) {}

const firstLine = (text: string) =>
  Arr.headNonEmpty(Str.split(Str.trim(text), '\n'));

// Git is the undo button, so writes need a clean tree. A directory outside
// any git repo (or without git installed) has nothing to protect. Any other
// git failure (dubious ownership, a broken index) fails closed: without a
// status there is no telling what a write would clobber.
export const ensureCleanTree = Effect.fnUntraced(function* (root: string) {
  const refuse = (why: string) =>
    DirtyTreeError.make({
      message: `Could not check ${root} for uncommitted changes (${why}). Fix git, or pass --allow-dirty to write anyway.`,
    });
  const inside = yield* runCapture(
    'git',
    ['rev-parse', '--is-inside-work-tree'],
    root,
  );
  if (inside.code === -1) return;
  if (inside.code !== 0) {
    if (/not a git repository/iu.test(inside.stderr)) return;
    return yield* refuse(firstLine(inside.stderr) || `exit ${inside.code}`);
  }
  if (Str.trim(inside.stdout) !== 'true') {
    return yield* refuse('not inside a git work tree');
  }
  const status = yield* runCapture(
    'git',
    ['status', '--porcelain', '--untracked-files=normal', '--', '.'],
    root,
  );
  if (status.code !== 0) {
    return yield* refuse(
      firstLine(status.stderr) || `git status exited ${status.code}`,
    );
  }
  if (Str.trim(status.stdout) !== '') {
    return yield* DirtyTreeError.make({
      message: `${root} has uncommitted changes. Commit them first, or pass --allow-dirty.\n${Str.trimEnd(status.stdout)}`,
    });
  }
});

export const writeFile = Effect.fnUntraced(function* (
  root: string,
  file: string,
  content: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = path.join(root, file);
  yield* fs.makeDirectory(path.dirname(target), { recursive: true });
  yield* fs.writeFileString(target, content);
});

export const removeFile = Effect.fnUntraced(function* (
  root: string,
  file: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = path.join(root, file);
  const exists = yield* fs.exists(target);
  if (exists) yield* fs.remove(target);
});

export const writeLock = (root: string, lock: Lock) =>
  writeFile(root, LOCK_PATH, renderLock(lock));

// Writes every create/update in the plan. The caller writes the lock.
export const applyPlan = Effect.fnUntraced(function* (
  root: string,
  plan: Plan,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const file of Arr.filter(plan.files, isWrite)) {
    yield* writeFile(root, file.path, file.after);
    if (file.executable) yield* fs.chmod(path.join(root, file.path), 0o755);
  }
});
