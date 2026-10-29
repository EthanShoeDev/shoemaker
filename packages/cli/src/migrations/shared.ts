// oxlint-disable-next-line effecttsgo/node-builtin-import -- Effect's Path has no glob matcher; matchesGlob is pure
import { matchesGlob } from 'node:path';

import {
  Array as Arr,
  Effect,
  Option,
  Order,
  Record as Rec,
  String as Str,
} from 'effect';

import {
  PackageJson,
  allManifests,
  catalogPath,
  decodeJsonc,
  editJson,
  makeEditor,
  readWorkspace,
  renameJsonKey,
  type Manifest,
  type Workspace,
} from '../checks/workspace.ts';
import type { FileChange, Repo } from '../engine/repo.ts';
import type { Migration } from './types.ts';

export type Editor = ReturnType<typeof makeEditor>;

// A Repo view with planned changes applied on top, so migrations can be
// chained (and dry-run) without writing to disk.
export const withChanges = (
  repo: Repo,
  changes: ReadonlyArray<FileChange>,
): Repo => {
  const overlay = new Map(
    Arr.map(changes, (change) => [change.path, change.content] as const),
  );
  return {
    root: repo.root,
    read: (path) =>
      overlay.has(path) ? Effect.succeed(overlay.get(path)) : repo.read(path),
    exists: (path) =>
      overlay.has(path)
        ? Effect.succeed(overlay.get(path) !== undefined)
        : repo
            .exists(path)
            .pipe(
              Effect.map(
                (exists) =>
                  exists ||
                  Arr.some(
                    [...overlay],
                    ([file, content]) =>
                      content !== undefined && Str.startsWith(`${path}/`)(file),
                  ),
              ),
            ),
    glob: (pattern) =>
      repo.glob(pattern).pipe(
        Effect.map((files) => {
          const all = new Set(files);
          for (const [file, content] of overlay) {
            if (content === undefined) all.delete(file);
            else if (matchesGlob(file, pattern)) all.add(file);
          }
          return Arr.sort(all, Order.String);
        }),
      ),
  };
};

// Runs migrations in order, each seeing the previous ones' changes, and
// returns the merged change set (last write per path wins).
export const planAll = Effect.fnUntraced(function* (
  repo: Repo,
  migrations: ReadonlyArray<Migration>,
) {
  let changes: ReadonlyArray<FileChange> = [];
  const applied: Array<string> = [];
  for (const migration of migrations) {
    const view = withChanges(repo, changes);
    if (!(yield* migration.applies(view))) continue;
    const next = yield* migration.run(view);
    if (next.length === 0) continue;
    applied.push(migration.id);
    const merged = new Map(
      Arr.map(changes, (change) => [change.path, change] as const),
    );
    for (const change of next) merged.set(change.path, change);
    changes = [...merged.values()];
  }
  return { applied, changes };
});

export const workspaceEditor = Effect.fnUntraced(function* (repo: Repo) {
  const workspace = yield* readWorkspace(repo);
  if (workspace === undefined) return undefined;
  return { workspace, editor: makeEditor(allManifests(workspace)) };
});

// Uses the repo's catalog when it has one; otherwise pins the version.
export const addRootDevDep = (
  editor: Editor,
  workspace: Workspace,
  name: string,
  version: string,
) => {
  const root = workspace.root.path;
  const usesCatalog = Rec.keys(workspace.catalog).length > 0;
  if (usesCatalog && workspace.catalog[name] === undefined) {
    editor.update(root, (text) =>
      editJson(text, [...catalogPath(workspace.root.pkg), name], version, true),
    );
  }
  if (
    workspace.root.pkg.devDependencies?.[name] === undefined &&
    workspace.root.pkg.dependencies?.[name] === undefined
  ) {
    editor.update(root, (text) =>
      editJson(
        text,
        ['devDependencies', name],
        usesCatalog ? 'catalog:' : version,
        true,
      ),
    );
  }
};

const escape = (value: string) =>
  Str.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)(value);

// Task references in turbo/nx configs: "name", "^name", "//#name", "pkg#name".
export const renameTaskRefs = (
  text: string,
  renames: ReadonlyMap<string, string>,
) => {
  let result = text;
  for (const [from, to] of renames) {
    result = Str.replaceAll(
      new RegExp(String.raw`"((?:[^"#\s]*#)?\^?)${escape(from)}"`, 'gu'),
      `"$1${to}"`,
    )(result);
  }
  return result;
};

// `bun run name`, `turbo run name`, `turbo name` inside scripts, CI and docs.
export const renameRunRefs = (
  text: string,
  renames: ReadonlyMap<string, string>,
) => {
  let result = text;
  for (const [from, to] of renames) {
    result = Str.replaceAll(
      new RegExp(
        String.raw`(\b(?:run|turbo)\s+(?:--?[\w-]+(?:=\S+)?\s+)*)${escape(from)}(?=[\s"'\x60]|$)`,
        'gmu',
      ),
      `$1${to}`,
    )(result);
  }
  return result;
};

export const TASK_FILES = [
  '**/turbo.json',
  '**/turbo.jsonc',
  'nx.json',
  '**/project.json',
];
export const RUN_REF_FILES = [
  '.github/**/*.{yml,yaml}',
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'justfile',
  'Justfile',
];

const scriptsIn = (text: string): Readonly<Record<string, string>> =>
  Option.getOrUndefined(decodeJsonc(PackageJson, text))?.scripts ?? {};

// Rewrites every script command with `f`, reading the editor's current text so
// earlier edits (renames) in the same migration are respected.
export const rewriteScripts = (
  editor: Editor,
  workspace: Workspace,
  f: (command: string, name: string, manifest: Manifest) => string,
) => {
  for (const manifest of allManifests(workspace)) {
    editor.update(manifest.path, (text) => {
      let result = text;
      for (const [name, command] of Rec.toEntries(scriptsIn(text))) {
        const updated = f(command, name, manifest);
        if (updated !== command)
          result = editJson(result, ['scripts', name], updated);
      }
      return result;
    });
  }
};

const rewriteFiles = Effect.fnUntraced(function* (
  repo: Repo,
  editor: Editor,
  patterns: ReadonlyArray<string>,
  f: (text: string) => string,
) {
  for (const pattern of patterns) {
    for (const path of yield* repo.glob(pattern)) {
      const text = editor.get(path) ?? (yield* repo.read(path));
      if (text === undefined) continue;
      const updated = f(text);
      if (updated !== text) editor.set(path, updated);
    }
  }
});

// Renames scripts (key in place) and every reference to them: other scripts,
// task-runner configs, CI workflows and agent docs.
export const renameScriptsEverywhere = Effect.fnUntraced(function* (
  repo: Repo,
  workspace: Workspace,
  editor: Editor,
  decide: (
    name: string,
    command: string,
    manifest: Manifest,
  ) => string | undefined,
) {
  const votes = new Map<string, Map<string, number>>();
  for (const manifest of allManifests(workspace)) {
    editor.update(manifest.path, (text) => {
      const scripts = scriptsIn(text);
      let result = text;
      for (const [name, command] of Rec.toEntries(scripts)) {
        const to = decide(name, command, manifest);
        if (to === undefined || to === name) continue;
        const existing = scripts[to];
        if (existing === undefined)
          result = renameJsonKey(result, ['scripts', name], to);
        else if (existing === command)
          result = editJson(result, ['scripts', name], undefined);
        else continue;
        const counts = votes.get(name) ?? new Map<string, number>();
        counts.set(to, (counts.get(to) ?? 0) + 1);
        votes.set(name, counts);
      }
      return result;
    });
  }
  // A task name is global to the task runner: when packages disagree on the
  // new name, the most common one wins for references.
  const renames = new Map(
    Arr.flatMap([...votes], ([from, counts]) => {
      const [best] = Arr.sort(
        [...counts],
        Order.flip(
          Order.mapInput(
            Order.Number,
            (entry: readonly [string, number]) => entry[1],
          ),
        ),
      );
      return best === undefined ? [] : [[from, best[0]] as const];
    }),
  );
  if (renames.size === 0) return renames;
  rewriteScripts(editor, workspace, (command) =>
    renameRunRefs(command, renames),
  );
  yield* rewriteFiles(repo, editor, TASK_FILES, (text) =>
    renameTaskRefs(text, renames),
  );
  yield* rewriteFiles(repo, editor, RUN_REF_FILES, (text) =>
    renameRunRefs(text, renames),
  );
  return renames;
});
