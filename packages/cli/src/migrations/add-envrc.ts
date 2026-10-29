import { Effect } from 'effect';

import { MigrationId } from './ids.ts';
import type { Migration } from './types.ts';

const USE_FLAKE = /^\s*use flake\b/mu;

export const addEnvrc: Migration = {
  id: MigrationId.addEnvrc,
  description: 'Add `use flake` to .envrc so direnv loads the flake dev shell',
  applies: Effect.fnUntraced(function* (repo) {
    if (!(yield* repo.exists('flake.nix'))) return false;
    const envrc = yield* repo.read('.envrc');
    return envrc === undefined || !USE_FLAKE.test(envrc);
  }),
  run: Effect.fnUntraced(function* (repo) {
    const envrc = yield* repo.read('.envrc');
    return [
      {
        path: '.envrc',
        content: envrc === undefined ? 'use flake\n' : `use flake\n${envrc}`,
      },
    ];
  }),
};
