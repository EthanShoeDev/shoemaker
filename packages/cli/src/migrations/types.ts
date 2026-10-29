import type { Effect } from 'effect';
import type { PlatformError } from 'effect/PlatformError';

import type { FileChange, Repo } from '../engine/repo.ts';

// A one-shot structural change (e.g. `.oxlintrc.json` -> `oxlint.config.ts`).
// Applied migration ids are recorded in shoebox.lock.jsonc so each runs once.
export interface Migration {
  // Stable kebab id, prefixed with an ordering date: `2026-10-28-oxlintrc-to-ts`.
  readonly id: string;
  readonly description: string;
  readonly applies: (repo: Repo) => Effect.Effect<boolean, PlatformError>;
  readonly run: (
    repo: Repo,
  ) => Effect.Effect<ReadonlyArray<FileChange>, PlatformError>;
}
