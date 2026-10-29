import type { Effect } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import type { ChildProcessSpawner } from 'effect/process';

import type { FileChange, Repo } from '../engine/repo.ts';

export interface CheckResult {
  readonly ok: boolean;
  // Human-readable report printed by `shoemaker check <name>`.
  readonly report: string;
  // Writes `--fix` should apply (empty when the check has no fixer).
  readonly fixes: ReadonlyArray<FileChange>;
}

// Repo checkers wired into package scripts (`catalog:check` ->
// `shoemaker check catalog`), replacing the copy-pasted scripts/lint/*.ts.
export interface RepoCheck {
  readonly name: string;
  readonly description: string;
  // `fix` is for checks that delegate to a tool which rewrites files itself
  // (nix fmt); file-based checks return `fixes` and ignore it.
  readonly run: (
    repo: Repo,
    options: { readonly fix: boolean },
  ) => Effect.Effect<
    CheckResult,
    PlatformError,
    ChildProcessSpawner.ChildProcessSpawner
  >;
}
