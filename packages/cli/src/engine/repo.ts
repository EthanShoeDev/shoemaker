import type { Effect } from 'effect';
import type { PlatformError } from 'effect/PlatformError';

// Read-only view of a repo on disk, shared by doctor checks, adopt inference
// and repo checks. `makeRepo` (engine/repo-live.ts) implements it over
// FileSystem; tests use `makeMemoryRepo` (engine/repo-memory.ts).
export interface Repo {
  // Absolute root path.
  readonly root: string;
  // Repo-relative POSIX path -> contents, or undefined when missing.
  readonly read: (
    path: string,
  ) => Effect.Effect<string | undefined, PlatformError>;
  readonly exists: (path: string) => Effect.Effect<boolean, PlatformError>;
  // Repo-relative matches, excluding node_modules, .git, dist, .turbo and .external.
  readonly glob: (
    pattern: string,
  ) => Effect.Effect<ReadonlyArray<string>, PlatformError>;
}

// A write planned by a `--fix` repo check. `content: undefined`
// deletes the file.
export interface FileChange {
  readonly path: string;
  readonly content: string | undefined;
}
