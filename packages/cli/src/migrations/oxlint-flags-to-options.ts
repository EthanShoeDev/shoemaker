import { Array as Arr, Effect, Record as Rec, String as Str } from 'effect';

import { allManifests, invokes, readWorkspace } from '../checks/workspace.ts';
import type { Repo } from '../engine/repo.ts';
import { MigrationId } from './ids.ts';
import { dropTypeAwareFlags } from './oxlint-scripts.ts';
import { rewriteScripts, workspaceEditor } from './shared.ts';
import type { Migration } from './types.ts';

const CONFIG = 'oxlint.config.ts';
const OPTIONS = [
  ['typeAware', 'true'],
  ['typeCheck', 'true'],
  ['reportUnusedDisableDirectives', "'error'"],
] as const;

const hasFlags = Effect.fnUntraced(function* (repo: Repo) {
  const workspace = yield* readWorkspace(repo);
  return (
    workspace !== undefined &&
    Arr.some(allManifests(workspace), (m) =>
      Arr.some(
        Rec.values(m.pkg.scripts ?? {}),
        (command) =>
          invokes(command, 'oxlint') && dropTypeAwareFlags(command) !== command,
      ),
    )
  );
});

// Adds the missing type-aware options to a hand-rolled config. Configs built
// with defineShoeboxConfig already set them.
export const addOptions = (source: string) => {
  if (Str.includes('shoe-box-oxlint-config')(source)) return source;
  const missing = Arr.filter(
    OPTIONS,
    ([key]) => !new RegExp(String.raw`\b${key}\s*:`, 'u').test(source),
  );
  if (missing.length === 0) return source;
  const lines = Arr.map(missing, ([key, value]) => `${key}: ${value},`);
  const options = /\boptions\s*:\s*\{/u.exec(source);
  if (options !== null) {
    const at = options.index + options[0].length;
    return `${Str.slice(0, at)(source)}\n    ${Arr.join(lines, '\n    ')}${Str.slice(at)(source)}`;
  }
  const config = /\b(?:defineConfig\(\s*|export default\s+)\{/u.exec(source);
  if (config === null) return source;
  const at = config.index + config[0].length;
  return `${Str.slice(0, at)(source)}\n  options: {\n    ${Arr.join(lines, '\n    ')}\n  },${Str.slice(at)(source)}`;
};

export const oxlintFlagsToOptions: Migration = {
  id: MigrationId.oxlintFlagsToOptions,
  description:
    'Move --type-aware/--type-check/--report-unused-disable-directives from oxlint scripts into oxlint.config.ts options',
  applies: Effect.fnUntraced(function* (repo) {
    const source = yield* repo.read(CONFIG);
    if (source === undefined) return false;
    return (yield* hasFlags(repo)) || addOptions(source) !== source;
  }),
  run: Effect.fnUntraced(function* (repo) {
    const source = yield* repo.read(CONFIG);
    const context = yield* workspaceEditor(repo);
    if (source === undefined || context === undefined) return [];
    const { workspace, editor } = context;
    editor.set(CONFIG, source);
    editor.update(CONFIG, addOptions);
    rewriteScripts(editor, workspace, (command) =>
      invokes(command, 'oxlint') ? dropTypeAwareFlags(command) : command,
    );
    return editor.changes();
  }),
};
