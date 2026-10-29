import {
  Array as Arr,
  Effect,
  pipe,
  Record as Rec,
  String as Str,
} from 'effect';

import type { Repo } from '../engine/repo.ts';
import type { RepoCheck } from './types.ts';
import { allManifests, readWorkspace } from './workspace.ts';

// Apps are leaves of the package graph. `build`, `lint` and `typecheck` carry
// `dependsOn: ["^build"]`, so one app-to-app entry in a package.json makes
// every lint run build that app (listening-astro's browser extension built the
// whole web app inside `turbo run lint` this way). Express runtime
// relationships with turbo `dependsOn` and `--affected` instead.
//
// listening-astro's rule 2 (browser bundle must not reach the server tier)
// needs a per-repo list of browser-bundled packages, so it is not ported until
// shoebox.config.ts can declare one.

const FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

const runPackageBoundaries = Effect.fnUntraced(function* (repo: Repo) {
  const workspace = yield* readWorkspace(repo);
  if (workspace === undefined) {
    return { ok: true, report: 'No package.json at the repo root.', fixes: [] };
  }
  const manifests = allManifests(workspace);
  const apps = new Map(
    pipe(
      workspace.packages,
      Arr.filter(
        (m) =>
          Arr.headNonEmpty(Str.split(m.dir, '/')) === 'apps' &&
          m.pkg.name !== undefined,
      ),
      Arr.map((m) => [m.pkg.name ?? '', m.dir] as const),
    ),
  );
  const violations = Arr.flatMap(manifests, (manifest) =>
    Arr.flatMap(FIELDS, (field) =>
      pipe(
        Rec.keys(manifest.pkg[field] ?? {}),
        Arr.filter((dep) => apps.has(dep)),
        Arr.map(
          (dep) =>
            `  ERROR ${manifest.path} -> ${field}."${dep}" (${apps.get(dep) ?? ''}): apps are leaves of the package graph`,
        ),
      ),
    ),
  );
  const notes = [
    'Rule 2 (browser bundle vs server tier) is not configured; skipped.',
  ];
  if (violations.length === 0) {
    return {
      ok: true,
      report: Arr.join(
        [
          `Package boundaries hold (${manifests.length} packages, ${apps.size} apps).`,
          ...notes,
        ],
        '\n',
      ),
      fixes: [],
    };
  }
  return {
    ok: false,
    report: Arr.join(
      [
        ...violations,
        '',
        `${violations.length} boundary violation(s). A dependency on an app makes every \`dependsOn: ["^build"]\` task build that app: put build ordering in turbo.jsonc and let turbo \`--affected\` pick CI coverage.`,
        ...notes,
      ],
      '\n',
    ),
    fixes: [],
  };
});

export const packageBoundariesCheck = {
  name: 'package-boundaries',
  description: 'Nothing (no app, package or the root) depends on an app',
  run: runPackageBoundaries,
} satisfies RepoCheck;
