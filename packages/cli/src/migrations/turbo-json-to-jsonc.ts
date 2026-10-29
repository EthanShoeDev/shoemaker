import { Effect } from 'effect';

import type { Repo } from '../engine/repo.ts';
import { MigrationId } from './ids.ts';
import type { Migration } from './types.ts';

const turboJsonFiles = (repo: Repo) => repo.glob('**/turbo.json');

export const turboJsonToJsonc: Migration = {
  id: MigrationId.turboJsonToJsonc,
  description:
    'Rename every turbo.json to turbo.jsonc (turbo reads jsonc; comments explain task wiring)',
  applies: (repo) =>
    turboJsonFiles(repo).pipe(Effect.map((files) => files.length > 0)),
  run: Effect.fnUntraced(function* (repo) {
    const changes = [];
    for (const path of yield* turboJsonFiles(repo)) {
      const target = `${path}c`;
      // Both present: turbo would read either; merging is a judgement call.
      if (yield* repo.exists(target)) continue;
      const content = yield* repo.read(path);
      changes.push({ path: target, content }, { path, content: undefined });
    }
    return changes;
  }),
};
