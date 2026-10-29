import { Array as Arr, Effect, String as Str } from 'effect';

import { editJson } from '../checks/workspace.ts';
import { versions } from '../versions.ts';
import { MigrationId } from './ids.ts';
import { addRootDevDep, rewriteScripts, workspaceEditor } from './shared.ts';
import type { Migration } from './types.ts';

const COPIES = 'scripts/**/catalog-check.ts';
const CLI = '@shoe-box-tools/cli';

// `bun scripts/lint/catalog-check.ts --fix` -> `shoebox check catalog --fix`.
const SCRIPT_CALL =
  /\b(?:bun(?:\s+run)?|bunx|tsx|node)\s+(?:\.\/)?scripts\/(?:[\w-]+\/)*catalog-check\.ts/gu;

export const catalogCheckToShoebox: Migration = {
  id: MigrationId.catalogCheckToShoebox,
  description:
    'Replace copy-pasted scripts/**/catalog-check.ts with `shoebox check catalog` from @shoe-box-tools/cli',
  applies: (repo) =>
    repo.glob(COPIES).pipe(Effect.map((files) => files.length > 0)),
  run: Effect.fnUntraced(function* (repo) {
    const context = yield* workspaceEditor(repo);
    const copies = yield* repo.glob(COPIES);
    if (context === undefined)
      return Arr.map(copies, (path) => ({ path, content: undefined }));
    const { workspace, editor } = context;
    for (const path of copies) editor.set(path, undefined);
    rewriteScripts(editor, workspace, (command) =>
      Str.replaceAll(SCRIPT_CALL, 'shoebox check catalog')(command),
    );
    const scripts = workspace.root.pkg.scripts ?? {};
    for (const [name, command] of [
      ['catalog:check', 'shoebox check catalog'],
      ['catalog:fix', 'shoebox check catalog --fix'],
    ] as const) {
      if (scripts[name] === undefined) {
        editor.update(workspace.root.path, (text) =>
          editJson(text, ['scripts', name], command),
        );
      }
    }
    addRootDevDep(editor, workspace, CLI, versions[CLI]);
    return editor.changes();
  }),
};
