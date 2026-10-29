import {
  Array as Arr,
  Effect,
  Order,
  Record as Rec,
  String as Str,
} from 'effect';

import type { Repo } from '../engine/repo.ts';
import type { RepoCheck } from './types.ts';
import {
  DEP_TYPES,
  allManifests,
  catalogPath,
  editJson,
  isNewerVersion,
  makeEditor,
  readWorkspace,
  scopeOf,
  type DepType,
  type Manifest,
} from './workspace.ts';

// Only for tools that read package.json themselves and reject `catalog:`:
// electron-builder validates electron-updater/electron-log versions.
const GLOBAL_SKIP = new Set(['electron-updater', 'electron-log']);

// Local protocols have no catalog equivalent.
const LOCAL = /^(?:workspace|link|file|portal):/u;

export interface Violation {
  readonly manifest: Manifest;
  readonly depType: DepType;
  readonly depName: string;
  readonly current: string;
  readonly expected: 'catalog:' | 'workspace:*';
}

export interface MissingFromCatalog {
  readonly depName: string;
  readonly version: string;
  readonly usedIn: ReadonlyArray<{
    readonly manifest: Manifest;
    readonly depType: DepType;
  }>;
}

const label = (manifest: Manifest) => manifest.pkg.name ?? manifest.path;

export const analyzeCatalog = Effect.fnUntraced(function* (repo: Repo) {
  const workspace = yield* readWorkspace(repo);
  if (workspace === undefined) return undefined;
  const { catalog } = workspace;
  const manifests = allManifests(workspace);
  const workspaceNames = new Set(
    Arr.flatMap(workspace.packages, (m) =>
      m.pkg.name === undefined ? [] : [m.pkg.name],
    ),
  );
  const internalScopes = new Set(
    Arr.flatMap([...workspaceNames], (name) =>
      Arr.fromNullishOr(scopeOf(name)),
    ),
  );

  const violations: Array<Violation> = [];
  const missing = new Map<
    string,
    { version: string; usedIn: Array<{ manifest: Manifest; depType: DepType }> }
  >();

  for (const manifest of manifests) {
    const skip = new Set(manifest.pkg.catalogSkip);
    for (const depType of DEP_TYPES) {
      for (const [depName, version] of Rec.toEntries(
        manifest.pkg[depType] ?? {},
      )) {
        if (GLOBAL_SKIP.has(depName) || skip.has(depName)) continue;
        const base = { manifest, depType, depName, current: version } as const;
        if (workspaceNames.has(depName)) {
          if (!Str.startsWith('workspace:')(version)) {
            violations.push({ ...base, expected: 'workspace:*' });
          }
        } else if (Rec.has(catalog, depName)) {
          if (!Str.startsWith('catalog:')(version)) {
            violations.push({ ...base, expected: 'catalog:' });
          }
        } else if (
          !Str.startsWith('catalog:')(version) &&
          !LOCAL.test(version) &&
          !internalScopes.has(scopeOf(depName) ?? '')
        ) {
          const entry = missing.get(depName) ?? { version, usedIn: [] };
          if (isNewerVersion(version, entry.version)) entry.version = version;
          entry.usedIn.push({ manifest, depType });
          missing.set(depName, entry);
        }
      }
    }
  }

  const notInCatalog: Array<MissingFromCatalog> = Arr.sort(
    Arr.map([...missing], ([depName, entry]) => ({ depName, ...entry })),
    Order.combine(
      Order.flip(
        Order.mapInput(
          Order.Number,
          (dep: MissingFromCatalog) => dep.usedIn.length,
        ),
      ),
      (a: MissingFromCatalog, b: MissingFromCatalog) =>
        Str.localeCompare(b.depName)(a.depName),
    ),
  );

  return { workspace, catalog, manifests, violations, notInCatalog };
});

type Analysis = NonNullable<Effect.Success<ReturnType<typeof analyzeCatalog>>>;

const computeFixes = ({
  workspace,
  catalog,
  manifests,
  violations,
  notInCatalog,
}: Analysis) => {
  const editor = makeEditor(manifests);
  const root = workspace.root.path;
  const catalogAt = catalogPath(workspace.root.pkg);
  const log: Array<string> = [];

  for (const v of violations) {
    const pinned = catalog[v.depName];
    if (
      v.expected === 'catalog:' &&
      pinned !== undefined &&
      isNewerVersion(v.current, pinned)
    ) {
      editor.update(root, (text) =>
        editJson(text, [...catalogAt, v.depName], v.current, true),
      );
      log.push(
        `Updated catalog "${v.depName}": "${pinned}" -> "${v.current}" (newer)`,
      );
    }
    editor.update(v.manifest.path, (text) =>
      editJson(text, [v.depType, v.depName], v.expected),
    );
    log.push(
      `Fixed ${label(v.manifest)} (${v.depType}): "${v.depName}" -> "${v.expected}"`,
    );
  }

  for (const dep of notInCatalog) {
    editor.update(root, (text) =>
      editJson(text, [...catalogAt, dep.depName], dep.version, true),
    );
    log.push(`Added "${dep.depName}": "${dep.version}" to catalog`);
    for (const use of dep.usedIn) {
      editor.update(use.manifest.path, (text) =>
        editJson(text, [use.depType, dep.depName], 'catalog:'),
      );
    }
  }

  return { fixes: editor.changes(), log };
};

const runCatalog = Effect.fnUntraced(function* (repo: Repo) {
  const analysis = yield* analyzeCatalog(repo);
  if (analysis === undefined) {
    return {
      ok: false,
      report: 'No package.json at the repo root.',
      fixes: [],
    };
  }
  const { catalog, manifests, violations, notInCatalog } = analysis;
  const lines = [
    `Found ${Rec.keys(catalog).length} dependencies in catalog`,
    `Checking ${manifests.length} packages (including root)...`,
  ];
  if (violations.length > 0) {
    lines.push('', `Found ${violations.length} violation(s):`, '');
    for (const v of violations) {
      lines.push(
        `  ${label(v.manifest)} (${v.depType}): "${v.depName}" is "${v.current}" but should be "${v.expected}"`,
      );
    }
  }
  if (notInCatalog.length > 0) {
    lines.push('', 'Dependencies not in catalog:', '');
    for (const dep of notInCatalog) {
      const users = Arr.join(
        Arr.map(dep.usedIn, (u) => label(u.manifest)),
        ', ',
      );
      lines.push(
        `  "${dep.depName}": "${dep.version}" (used in ${dep.usedIn.length} packages: ${users})`,
      );
    }
  }
  const ok = violations.length === 0 && notInCatalog.length === 0;
  const { fixes, log } = computeFixes(analysis);
  if (ok) {
    lines.push(
      'All packages correctly use catalog: and workspace:* references',
    );
  } else {
    lines.push(
      '',
      'Summary:',
      `  - Violations: ${violations.length}`,
      `  - Deps not in catalog: ${notInCatalog.length}`,
      '',
      'With --fix:',
      ...Arr.map(log, (entry) => `  ${entry}`),
      '  Then run `bun install` to update the lockfile.',
    );
  }
  return { ok, report: Arr.join(lines, '\n'), fixes };
});

export const catalogCheck = {
  name: 'catalog',
  description:
    'Every workspace dependency uses `catalog:` (or `workspace:*`); --fix rewrites them and adds missing catalog entries',
  run: runCatalog,
} satisfies RepoCheck;
