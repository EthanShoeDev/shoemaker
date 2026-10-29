import {
  Array as Arr,
  Effect,
  Option,
  Record as Rec,
  String as Str,
} from 'effect';
import type { PlatformError } from 'effect/PlatformError';

import {
  allDeps,
  hasDep,
  kebab,
  readWorkspace,
  scopeFor,
  type Manifest,
} from '../checks/workspace.ts';
import {
  defaultConfig,
  type App,
  type DeployTarget,
  type StateStore,
  type Package,
  type ShoeboxConfig,
} from '../config/schema.ts';
import { SECRETS_FILES } from '../doctor/security.ts';
import { globAll } from '../doctor/shared.ts';
import type { Repo } from '../engine/repo.ts';

// Reads an existing repo and guesses the shoebox.config.ts that describes it,
// so `shoe-box adopt` can start from the repo's real shape.

const MAX_SOURCE_FILES = 200;

const sourcesOf = Effect.fnUntraced(function* (repo: Repo, dir: string) {
  const files = yield* repo.glob(`${dir}/src/**/*.{ts,tsx}`);
  const contents: Array<string> = [];
  for (const file of files.slice(0, MAX_SOURCE_FILES)) {
    contents.push((yield* repo.read(file)) ?? '');
  }
  return contents;
});

// Server-side markers only: HttpApi/HttpApiClient also appear in clients.
const HTTP_SERVER =
  /\bHttpApiBuilder\b|\b(?:Bun|Node)HttpServer\b|\bHttp(?:Layer)?Router\.serve\b|\bHttpServer\.serve\b/u;
const EFFECT_CLI = /from ['"](?:effect\/cli|@effect\/cli)(?:\/[\w]+)?['"]/u;

export const appKindOf = Effect.fnUntraced(function* (
  repo: Repo,
  manifest: Manifest,
) {
  const { pkg } = manifest;
  if (hasDep(pkg, '@tanstack/react-start')) return 'tanstack-start' as const;
  if (hasDep(pkg, 'foldkit')) return 'foldkit' as const;
  if (hasDep(pkg, 'expo')) return 'expo' as const;
  if (!hasDep(pkg, 'effect')) return undefined;
  const platform =
    hasDep(pkg, '@effect/platform-bun') || hasDep(pkg, '@effect/platform-node');
  const sources = yield* sourcesOf(repo, manifest.dir);
  if (platform && Arr.some(sources, (source) => HTTP_SERVER.test(source)))
    return 'effect-api' as const;
  if (
    pkg.bin !== undefined &&
    (hasDep(pkg, '@effect/cli') ||
      Arr.some(sources, (source) => EFFECT_CLI.test(source)))
  ) {
    return 'effect-cli' as const;
  }
  return undefined;
});

// A package under packages/ that ships a binary or a framework app is not a
// library even if it exports code (HttpApi contracts are libraries).
const isAppShaped = (manifest: Manifest) =>
  manifest.pkg.bin !== undefined ||
  Arr.some(['@tanstack/react-start', 'foldkit', 'expo'], (dep) =>
    hasDep(manifest.pkg, dep),
  );

// Config and tooling packages are rendered by shoebox itself (or replaced by
// shoe-box-*), and env/infra come from the secrets/infra generators.
const NOT_LIBRARY =
  /^(?:env|infra|assets|scripts|tooling|.*-config|.*-plugins?|config|tsconfig|eslint-.*)$/u;

const looksLikeLibrary = Effect.fnUntraced(function* (
  repo: Repo,
  manifest: Manifest,
) {
  const base = Arr.lastNonEmpty(Str.split(manifest.dir, '/'));
  if (
    Str.startsWith('packages/config/')(manifest.dir) ||
    Str.startsWith('packages/vendor/')(manifest.dir)
  )
    return false;
  if (NOT_LIBRARY.test(base)) return false;
  if (manifest.pkg.exports === undefined && manifest.pkg.main === undefined)
    return false;
  return (yield* repo.glob(`${manifest.dir}/src/**/*.{ts,tsx}`)).length > 0;
});

const uniqueBy = <A extends { readonly name: string }>(
  items: ReadonlyArray<A>,
) => [
  ...new Map(Arr.map(items, (item) => [item.name, item] as const)).values(),
];

const PROVIDERS: ReadonlyArray<readonly ['cloudflare' | 'aws', RegExp]> = [
  [
    'cloudflare',
    /from ['"](?:alchemy(?:-effect)?\/[Cc]loudflare|@alchemy\.run\/cloudflare)[\w/'"-]*/u,
  ],
  [
    'aws',
    /from ['"](?:alchemy(?:-effect)?\/(?:AWS|aws)|@alchemy\.run\/aws)[\w/'"-]*/u,
  ],
];

const STATE_STORES: ReadonlyArray<readonly [StateStore, RegExp]> = [
  ['cloudflare', /\bCloudflare\.state\(/u],
  ['aws', /\bAWS\.state\(/u],
];

const inferInfra = Effect.fnUntraced(function* (repo: Repo) {
  const entrypoints = yield* globAll(repo, [
    'alchemy.run.ts',
    'apps/*/alchemy.run.ts',
    'packages/*/alchemy.run.ts',
  ]);
  if (entrypoints.length === 0) return { kind: 'none' as const };
  const files = [
    ...entrypoints,
    ...(yield* globAll(repo, [
      'infra/**/*.ts',
      'packages/infra/**/*.ts',
      'apps/*/infra/**/*.ts',
    ])),
  ].slice(0, MAX_SOURCE_FILES);
  const sources = yield* Effect.forEach(files, (file) =>
    Effect.map(repo.read(file), (source) => source ?? ''),
  );
  const first = <A>(table: ReadonlyArray<readonly [A, RegExp]>) =>
    Arr.findFirst(table, ([, pattern]) =>
      Arr.some(sources, (source) => pattern.test(source)),
    ).pipe(Option.map(([value]) => value));
  return {
    kind: 'alchemy' as const,
    // Cloudflare hosts every app kind shoebox scaffolds, so it wins a tie.
    deploy: Option.getOrElse(first(PROVIDERS), (): DeployTarget => 'none'),
    state: Option.getOrElse(first(STATE_STORES), (): StateStore => 'local'),
  };
});

const repoName = (repo: Repo, manifest: Manifest | undefined) => {
  const raw = manifest?.pkg.name;
  if (raw === undefined)
    return kebab(Arr.lastNonEmpty(Str.split(repo.root, '/')));
  // `@wisely/monorepo` names the scope, not the project.
  const bare = Str.replace(/^@[^/]+\//u, '')(raw);
  const scope = /^@([^/]+)\//u.exec(raw)?.[1];
  return kebab(
    scope !== undefined && /^(?:monorepo|root|workspace|repo)$/u.test(bare)
      ? scope
      : bare,
  );
};

export const inferConfig = (
  repo: Repo,
): Effect.Effect<ShoeboxConfig, PlatformError> =>
  Effect.gen(function* () {
    const workspace = yield* readWorkspace(repo);
    const name = repoName(repo, workspace?.root);
    const base = defaultConfig(name);
    if (workspace === undefined) return base;

    const apps: Array<App> = [];
    const packages: Array<Package> = [];
    for (const manifest of workspace.packages) {
      const dirName = kebab(Arr.lastNonEmpty(Str.split(manifest.dir, '/')));
      if (Str.startsWith('apps/')(manifest.dir)) {
        const kind = yield* appKindOf(repo, manifest);
        if (kind !== undefined) apps.push({ name: dirName, kind });
      } else if (
        Str.startsWith('packages/')(manifest.dir) &&
        !isAppShaped(manifest) &&
        (yield* looksLikeLibrary(repo, manifest))
      ) {
        packages.push({ name: dirName, kind: 'library' });
      }
    }

    const taskRunner =
      (yield* repo.exists('nx.json')) &&
      !(yield* repo.exists('turbo.jsonc')) &&
      !(yield* repo.exists('turbo.json'))
        ? ('nx' as const)
        : ('turbo' as const);
    const secretsFiles = yield* globAll(repo, SECRETS_FILES);
    const secrets = Arr.some(secretsFiles, Str.endsWith('.env.schema'))
      ? ('varlock' as const)
      : secretsFiles.length > 0
        ? ('secretspec' as const)
        : ('none' as const);
    const workflows = yield* repo.glob('.github/workflows/*.{yml,yaml}');

    const config: ShoeboxConfig = {
      ...base,
      scope: workspace.packages.length > 0 ? scopeFor(workspace) : name,
      description: workspace.root.pkg.description ?? '',
      apps: uniqueBy(apps),
      packages: uniqueBy(packages),
      taskRunner,
      secrets,
      infra: yield* inferInfra(repo),
      ci: workflows.length > 0 ? 'github' : 'none',
      features: {
        changesets:
          (yield* repo.exists('.changeset')) ||
          Rec.has(allDeps(workspace.root.pkg), '@changesets/cli'),
        agents: yield* repo.exists('AGENTS.md'),
        vscode: yield* repo.exists('.vscode'),
      },
      nixPackages: [],
      unmanaged: [],
    };
    return config;
  });
