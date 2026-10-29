import type { Effect } from 'effect';
import type { PlatformError } from 'effect/PlatformError';

import type { Repo } from '../engine/repo.ts';

export interface Finding {
  readonly ok: boolean;
  // One line: what is wrong (or what passed).
  readonly message: string;
  // How to fix it by hand.
  readonly fix?: string;
  readonly path?: string;
}

// A doctor check audits any repo (shoebox-managed or not) against the current
// preferences.
export interface DoctorCheck {
  readonly id: string;
  readonly description: string;
  readonly run: (
    repo: Repo,
  ) => Effect.Effect<ReadonlyArray<Finding>, PlatformError>;
}
