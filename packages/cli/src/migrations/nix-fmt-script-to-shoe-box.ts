import { Effect, pipe, String as Str } from 'effect';

import { versions } from '../versions.ts';
import { MigrationId } from './ids.ts';
import { addRootDevDep, rewriteScripts, workspaceEditor } from './shared.ts';
import type { Migration } from './types.ts';

const SCRIPT = 'scripts/lint/nix-fmt.sh';
const CLI = 'shoe-box';

// `./scripts/lint/nix-fmt.sh flake.nix -- -c` -> `shoe-box check nix-fmt`.
// A call runs up to the next `&&`, `||`, `;` or `|`; `trail` keeps the space
// before it. Check calls (`-c`) are rewritten first, the rest become --fix.
const CALL = String.raw`(?:\b(?:bash|sh)\s+)?(?:\./)?scripts/lint/nix-fmt\.sh\b`;
const END = String.raw`[^&|;]*?(?<trail>\s*)(?=$|[&|;])`;
const CHECK_CALL = new RegExp(
  String.raw`${CALL}(?=[^&|;]*\s(?:-c|--check)\b)${END}`,
  'gu',
);
const FIX_CALL = new RegExp(`${CALL}${END}`, 'gu');

export const nixFmtScriptToShoebox: Migration = {
  id: MigrationId.nixFmtScriptToShoebox,
  description:
    'Replace scripts/lint/nix-fmt.sh (bash, not cross-platform) with `shoe-box check nix-fmt`',
  applies: (repo) => repo.exists(SCRIPT),
  run: Effect.fnUntraced(function* (repo) {
    const context = yield* workspaceEditor(repo);
    if (context === undefined) return [{ path: SCRIPT, content: undefined }];
    const { workspace, editor } = context;
    editor.set(SCRIPT, undefined);
    rewriteScripts(editor, workspace, (command) =>
      pipe(
        command,
        Str.replaceAll(CHECK_CALL, 'shoe-box check nix-fmt$<trail>'),
        Str.replaceAll(FIX_CALL, 'shoe-box check nix-fmt --fix$<trail>'),
      ),
    );
    addRootDevDep(editor, workspace, CLI, versions[CLI]);
    return editor.changes();
  }),
};
