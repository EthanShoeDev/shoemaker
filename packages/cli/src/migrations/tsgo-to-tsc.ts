import { Array as Arr, Effect, Record as Rec, String as Str } from 'effect';

import {
  allDeps,
  allManifests,
  catalogPath,
  editJson,
  invokes,
  majorOf,
  readWorkspace,
  replaceCommand,
  DEP_TYPES,
  type Workspace,
} from '../checks/workspace.ts';
import { versions } from '../versions.ts';
import { MigrationId } from './ids.ts';
import {
  addRootDevDep,
  renameScriptsEverywhere,
  rewriteScripts,
  workspaceEditor,
} from './shared.ts';
import type { Migration } from './types.ts';

const PREVIEW = '@typescript/native-preview';

const resolvedTs = (workspace: Workspace, version: string) =>
  Str.startsWith('catalog:')(version)
    ? (workspace.catalog.typescript ?? version)
    : version;

const isOld = (version: string) => (majorOf(version) ?? 7) < 7;

export const tsgoToTsc: Migration = {
  id: MigrationId.tsgoToTsc,
  description:
    'Typecheck with TS 7 `tsc`: scripts tsgo -> tsc, drop @typescript/native-preview, typescript ^7',
  applies: Effect.fnUntraced(function* (repo) {
    const workspace = yield* readWorkspace(repo);
    if (workspace === undefined) return false;
    const manifests = allManifests(workspace);
    return (
      Arr.some(manifests, (m) => {
        const deps = allDeps(m.pkg);
        const ts = deps.typescript;
        return (
          Rec.has(deps, PREVIEW) ||
          (ts !== undefined && isOld(resolvedTs(workspace, ts))) ||
          Arr.some(Rec.values(m.pkg.scripts ?? {}), (command) =>
            invokes(command, 'tsgo'),
          )
        );
      }) || Arr.every(manifests, (m) => allDeps(m.pkg).typescript === undefined)
    );
  }),
  run: Effect.fnUntraced(function* (repo) {
    const context = yield* workspaceEditor(repo);
    if (context === undefined) return [];
    const { workspace, editor } = context;
    const want = versions.typescript;

    yield* renameScriptsEverywhere(repo, workspace, editor, (name, command) =>
      (name === 'tsgo:check' || name === 'tsgo') && invokes(command, 'tsgo')
        ? 'typecheck'
        : undefined,
    );
    rewriteScripts(editor, workspace, (command) =>
      replaceCommand(command, 'tsgo', 'tsc'),
    );

    const catalogAt = catalogPath(workspace.root.pkg);
    if (workspace.catalog[PREVIEW] !== undefined) {
      editor.update(workspace.root.path, (text) =>
        editJson(text, [...catalogAt, PREVIEW], undefined),
      );
    }
    const catalogTs = workspace.catalog.typescript;
    if (catalogTs !== undefined && isOld(catalogTs)) {
      editor.update(workspace.root.path, (text) =>
        editJson(text, [...catalogAt, 'typescript'], want),
      );
    }
    let declared = false;
    for (const manifest of allManifests(workspace)) {
      for (const depType of DEP_TYPES) {
        const deps = manifest.pkg[depType] ?? {};
        if (deps[PREVIEW] !== undefined) {
          editor.update(manifest.path, (text) =>
            editJson(text, [depType, PREVIEW], undefined),
          );
        }
        const ts = deps.typescript;
        if (ts === undefined) continue;
        declared = true;
        if (!Str.startsWith('catalog:')(ts) && isOld(ts)) {
          const usesCatalog =
            catalogTs !== undefined || Rec.keys(workspace.catalog).length > 0;
          editor.update(manifest.path, (text) =>
            editJson(
              text,
              [depType, 'typescript'],
              usesCatalog ? 'catalog:' : want,
            ),
          );
          if (usesCatalog && catalogTs === undefined) {
            editor.update(workspace.root.path, (text) =>
              editJson(text, [...catalogAt, 'typescript'], want, true),
            );
          }
        }
      }
    }
    if (!declared) addRootDevDep(editor, workspace, 'typescript', want);
    return editor.changes();
  }),
};
