import { Array as Arr, Effect, Record as Rec } from 'effect';

import { allManifests, readWorkspace } from '../checks/workspace.ts';
import { MigrationId } from './ids.ts';
import { renameScript } from './script-names.ts';
import { renameScriptsEverywhere, workspaceEditor } from './shared.ts';
import type { Migration } from './types.ts';

export const lintScriptNames: Migration = {
  id: MigrationId.lintScriptNames,
  description:
    'Rename lint:<tool> / fmt:* scripts to <tool>:check / <tool>:fix and update turbo tasks, CI and docs that run them',
  applies: Effect.fnUntraced(function* (repo) {
    const workspace = yield* readWorkspace(repo);
    return (
      workspace !== undefined &&
      Arr.some(allManifests(workspace), (m) =>
        Arr.some(
          Rec.toEntries(m.pkg.scripts ?? {}),
          ([name, command]) => renameScript(name, command) !== undefined,
        ),
      )
    );
  }),
  run: Effect.fnUntraced(function* (repo) {
    const context = yield* workspaceEditor(repo);
    if (context === undefined) return [];
    yield* renameScriptsEverywhere(
      repo,
      context.workspace,
      context.editor,
      renameScript,
    );
    return context.editor.changes();
  }),
};
