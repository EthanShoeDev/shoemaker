import {
  Array as Arr,
  Effect,
  pipe,
  Record as Rec,
  String as Str,
} from 'effect';

import type { Repo } from '../engine/repo.ts';
import type { RepoCheck } from './types.ts';
import {
  allManifests,
  hasDep,
  readWorkspace,
  type Manifest,
} from './workspace.ts';

// Apps are leaves of the package graph. `build`, `lint` and `typecheck` carry
// `dependsOn: ["^build"]`, so one app-to-app entry in a package.json makes
// every lint run build that app (listening-astro's browser extension built the
// whole web app inside `turbo run lint` this way). Express runtime
// relationships with turbo `dependsOn` and `--affected` instead.
//
// The one exception is a TanStack Start site that mounts an API app at /api
// (an `src/routes/api.$.ts` splat route): it imports that API's handlers and
// deploys them, so the dependency is the point. A separately hosted API
// (listening-astro's, on k8s) is still a leaf.
//
// listening-astro's rule 2 (browser bundle must not reach the server tier)
// needs a per-repo list of browser-bundled packages, so it is not ported until
// shoemaker.config.ts can declare one.

const FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

// A TanStack Start site with an /api splat route serves an API in-process.
const mountsApi = (repo: Repo, manifest: Manifest) =>
  hasDep(manifest.pkg, '@tanstack/react-start')
    ? repo.exists(`${manifest.dir}/src/routes/api.$.ts`)
    : Effect.succeed(false);

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
  const mounting = new Set<Manifest>();
  for (const manifest of manifests) {
    if (yield* mountsApi(repo, manifest)) mounting.add(manifest);
  }
  const edges = Arr.flatMap(manifests, (manifest) =>
    Arr.flatMap(FIELDS, (field) =>
      pipe(
        Rec.keys(manifest.pkg[field] ?? {}),
        Arr.filter((dep) => apps.has(dep)),
        Arr.map((dep) => ({ manifest, field, dep })),
      ),
    ),
  );
  const mounted = Arr.filter(edges, ({ manifest }) => mounting.has(manifest));
  const violations = Arr.filter(
    edges,
    ({ manifest }) => !mounting.has(manifest),
  );
  const notes = [
    ...Arr.map(
      mounted,
      ({ manifest, dep }) =>
        `Allowed: ${manifest.dir} mounts ${dep} (${apps.get(dep) ?? ''}) at /api.`,
    ),
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
        ...Arr.map(
          violations,
          ({ manifest, field, dep }) =>
            `  ERROR ${manifest.path} -> ${field}."${dep}" (${apps.get(dep) ?? ''}): apps are leaves of the package graph`,
        ),
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
  description:
    'Nothing (no app, package or the root) depends on an app, except a site on the API it mounts at /api',
  run: runPackageBoundaries,
} satisfies RepoCheck;
