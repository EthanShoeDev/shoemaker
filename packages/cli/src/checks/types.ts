import type { Effect } from 'effect';
import type { PlatformError } from 'effect/PlatformError';

import type { FileChange, Repo } from '../engine/repo.ts';

export interface CheckResult {
  readonly ok: boolean;
  // Human-readable report printed by `shoebox check <name>`.
  readonly report: string;
  // Writes `--fix` should apply (empty when the check has no fixer).
  readonly fixes: ReadonlyArray<FileChange>;
}

// Repo checkers wired into package scripts (`catalog:check` ->
// `shoebox check catalog`), replacing the copy-pasted scripts/lint/*.ts.
export interface RepoCheck {
  readonly name: string;
  readonly description: string;
  readonly run: (repo: Repo) => Effect.Effect<CheckResult, PlatformError>;
}
