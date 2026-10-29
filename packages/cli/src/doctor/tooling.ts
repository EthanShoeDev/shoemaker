import {
  Array as Arr,
  Effect,
  Option,
  pipe,
  Record as Rec,
  Schema,
  String as Str,
} from 'effect';

import { analyzeCatalog } from '../checks/catalog.ts';
import {
  catalogOf,
  decodeJsonc,
  hasDep,
  invokes,
  kebab,
  majorOf,
  readWorkspace,
  scopeOf,
  allDeps,
} from '../checks/workspace.ts';
import { MigrationId } from '../migrations/ids.ts';
import { renameScript } from '../migrations/script-names.ts';
import { fail, listSome, manifestsOf, pass, scriptsOf } from './shared.ts';
import type { DoctorCheck, Finding } from './types.ts';

// Keep in step with `bun-types` in versions.ts and the generated flake.
export const CURRENT_BUN = '1.4.4';

export const turboJsonc: DoctorCheck = {
  id: 'turbo-jsonc',
  description:
    'turbo is configured with turbo.jsonc (root and packages), not turbo.json',
  run: Effect.fnUntraced(function* (repo) {
    const json = yield* repo.glob('**/turbo.json');
    if (json.length > 0) {
      return Arr.map(json, (path) =>
        fail(`${path} should be turbo.jsonc`, {
          path,
          migration: MigrationId.turboJsonToJsonc,
        }),
      );
    }
    if (yield* repo.exists('turbo.jsonc')) return [pass('turbo.jsonc')];
    if (yield* repo.exists('nx.json'))
      return [pass('nx.json (task runner: nx)')];
    return [
      fail('no task runner config (turbo.jsonc or nx.json)', {
        fix: 'shoe-box adopt, then shoe-box sync renders turbo.jsonc',
      }),
    ];
  }),
};

export const scriptNames: DoctorCheck = {
  id: 'script-names',
  description:
    'Scripts are named <tool>:check / <tool>:fix (not lint:<tool>, fmt:*)',
  run: Effect.fnUntraced(function* (repo) {
    const drifted = Arr.flatMap(scriptsOf(yield* manifestsOf(repo)), (s) => {
      const to = renameScript(s.name, s.command);
      return to === undefined
        ? []
        : [
            `${s.name} -> ${to}${s.manifest.dir === '' ? '' : ` (${s.manifest.dir})`}`,
          ];
    });
    return drifted.length === 0
      ? [pass('script names follow <tool>:check / <tool>:fix')]
      : [
          fail(
            `${drifted.length} script(s) to rename: ${listSome(drifted, 6)}`,
            { migration: MigrationId.lintScriptNames },
          ),
        ];
  }),
};

export const bunTest: DoctorCheck = {
  id: 'no-bun-test',
  description: 'Tests run through vitest (`bun run test`), never `bun test`',
  run: Effect.fnUntraced(function* (repo) {
    const flagged = Arr.filter(scriptsOf(yield* manifestsOf(repo)), (s) =>
      /\bbun test\b/u.test(s.command),
    );
    return flagged.length === 0
      ? [pass('no `bun test` scripts')]
      : [
          fail(
            `\`bun test\` in ${listSome(Arr.map(flagged, (s) => `${s.manifest.path}#${s.name}`))}`,
            {
              fix: 'use vitest with @effect/vitest (`vitest run`)',
            },
          ),
        ];
  }),
};

export const effectTsgo: DoctorCheck = {
  id: 'effect-tsgo-prepare',
  description:
    'Effect diagnostics come from @effect/tsgo, wired with "prepare": "effect-tsgo patch --oxlint"',
  run: Effect.fnUntraced(function* (repo) {
    const manifests = yield* manifestsOf(repo);
    const [root] = manifests;
    if (root === undefined) return [];
    const usesEffect = Arr.some(manifests, (m) => hasDep(m.pkg, 'effect'));
    const tsgo = Arr.some(manifests, (m) => hasDep(m.pkg, '@effect/tsgo'));
    const prepare = root.pkg.scripts?.prepare;
    const findings: Array<Finding> = [];
    if (
      !tsgo &&
      Arr.some(manifests, (m) => hasDep(m.pkg, '@effect/language-service'))
    ) {
      findings.push(
        fail('uses @effect/language-service without @effect/tsgo', {
          fix: 'add @effect/tsgo (catalog:) and "prepare": "effect-tsgo patch --oxlint"; keep the language service plugin with diagnostics: false',
        }),
      );
    }
    if (
      tsgo &&
      (prepare === undefined ||
        !Str.includes('effect-tsgo patch --oxlint')(prepare))
    ) {
      findings.push(
        fail(
          `prepare is ${prepare === undefined ? 'missing' : `"${prepare}"`}`,
          {
            path: 'package.json',
            fix: 'set "prepare": "effect-tsgo patch --oxlint"',
          },
        ),
      );
    }
    if (!tsgo && usesEffect && findings.length === 0) {
      findings.push(
        fail('uses effect without @effect/tsgo', {
          fix: 'add @effect/tsgo and "prepare": "effect-tsgo patch --oxlint"',
        }),
      );
    }
    if (findings.length === 0)
      findings.push(
        pass(tsgo ? 'effect-tsgo patch --oxlint' : 'no Effect dependency'),
      );
    return findings;
  }),
};

export const typescript7: DoctorCheck = {
  id: 'typescript-7',
  description:
    'Typecheck uses TS 7 `tsc`, not `tsgo` / @typescript/native-preview',
  run: Effect.fnUntraced(function* (repo) {
    const workspace = yield* readWorkspace(repo);
    if (workspace === undefined) return [];
    const manifests = [workspace.root, ...workspace.packages];
    const findings: Array<Finding> = [];
    const tsgoScripts = Arr.filter(scriptsOf(manifests), (s) =>
      invokes(s.command, 'tsgo'),
    );
    if (tsgoScripts.length > 0) {
      findings.push(
        fail(
          `tsgo in ${listSome(Arr.map(tsgoScripts, (s) => `${s.manifest.path}#${s.name}`))}`,
          { migration: MigrationId.tsgoToTsc },
        ),
      );
    }
    const preview = Arr.filter(manifests, (m) =>
      hasDep(m.pkg, '@typescript/native-preview'),
    );
    if (preview.length > 0) {
      findings.push(
        fail(
          `@typescript/native-preview in ${listSome(Arr.map(preview, (m) => m.path))}`,
          { migration: MigrationId.tsgoToTsc },
        ),
      );
    }
    const versions = Arr.flatMap(manifests, (m) => {
      const version = allDeps(m.pkg).typescript;
      if (version === undefined) return [];
      return [
        Str.startsWith('catalog:')(version)
          ? (workspace.catalog.typescript ?? version)
          : version,
      ];
    });
    const old = Arr.filter(versions, (v) => (majorOf(v) ?? 7) < 7);
    if (old.length > 0) {
      findings.push(
        fail(`typescript ${listSome([...new Set(old)])} (want ^7)`, {
          migration: MigrationId.tsgoToTsc,
        }),
      );
    } else if (versions.length === 0) {
      findings.push(
        fail('typescript is not a dependency', {
          migration: MigrationId.tsgoToTsc,
        }),
      );
    }
    return findings.length > 0
      ? findings
      : [pass(`typescript ${versions[0] ?? ''} with tsc`)];
  }),
};

const pinnedBun = (flake: string) =>
  /bun-v(\d+\.\d+\.\d+)/u.exec(flake)?.[1] ??
  /bun[\s\S]{0,400}?version\s*=\s*"(\d+\.\d+\.\d+)"/u.exec(flake)?.[1];

export const bunVersion: DoctorCheck = {
  id: 'bun-version',
  description: `packageManager is bun@${CURRENT_BUN} and matches the flake (and Dockerfiles)`,
  run: Effect.fnUntraced(function* (repo) {
    const [root] = yield* manifestsOf(repo);
    if (root === undefined) return [fail('no root package.json')];
    const findings: Array<Finding> = [];
    const manager = root.pkg.packageManager;
    const version =
      manager !== undefined && Str.startsWith('bun@')(manager)
        ? Str.slice(4)(manager)
        : undefined;
    if (version !== CURRENT_BUN) {
      findings.push(
        fail(
          `packageManager is ${manager ?? 'missing'} (want bun@${CURRENT_BUN})`,
          {
            path: 'package.json',
            fix: `set "packageManager": "bun@${CURRENT_BUN}" and repin bun in flake.nix to match`,
          },
        ),
      );
    }
    if (root.pkg.type !== 'module') {
      findings.push(
        fail('root package.json is not "type": "module"', {
          path: 'package.json',
          fix: 'add "type": "module"',
        }),
      );
    }
    const flake = yield* repo.read('flake.nix');
    const flakeBun = flake === undefined ? undefined : pinnedBun(flake);
    if (flakeBun !== undefined && flakeBun !== version) {
      findings.push(
        fail(
          `flake.nix pins bun ${flakeBun} but packageManager is ${manager ?? 'missing'}`,
          {
            path: 'flake.nix',
            fix: 'pin the same bun version in flake.nix and packageManager',
          },
        ),
      );
    }
    for (const path of yield* repo.glob('**/Dockerfile*')) {
      const image = /oven\/bun:(\d+\.\d+\.\d+)/u.exec(
        (yield* repo.read(path)) ?? '',
      )?.[1];
      if (image !== undefined && image !== version) {
        findings.push(
          fail(
            `${path} uses oven/bun:${image} but packageManager is ${manager ?? 'missing'}`,
            { path, fix: 'use the same bun version' },
          ),
        );
      }
    }
    return findings.length > 0
      ? findings
      : [
          pass(
            `bun@${CURRENT_BUN}${flakeBun === undefined ? '' : ', flake matches'}`,
          ),
        ];
  }),
};

// Three or more Capitalized Words in a row read as a project name, e.g. a
// flake description copied from another repo.
const properName = (description: string) =>
  /(?:[A-Z][a-z]+\s+){2,}[A-Z][a-z]+/u.exec(description)?.[0];

export const nixDevShell: DoctorCheck = {
  id: 'nix-dev-shell',
  description:
    'flake.nix + flake.lock + .envrc (`use flake`) provide the dev shell',
  run: Effect.fnUntraced(function* (repo) {
    const findings: Array<Finding> = [];
    const flake = yield* repo.read('flake.nix');
    if (flake === undefined) {
      return [
        fail('no flake.nix', {
          fix: 'shoe-box sync renders flake.nix (nixpkgs-unstable, alejandra, bun pinned to packageManager)',
        }),
      ];
    }
    if (!(yield* repo.exists('flake.lock'))) {
      findings.push(
        fail('no flake.lock', {
          fix: 'run `nix flake lock` and commit flake.lock',
        }),
      );
    }
    const envrc = yield* repo.read('.envrc');
    if (envrc === undefined || !/^\s*use flake\b/mu.test(envrc)) {
      findings.push(
        fail(
          envrc === undefined ? 'no .envrc' : '.envrc does not `use flake`',
          { migration: MigrationId.addEnvrc },
        ),
      );
    }
    const description = /description\s*=\s*"([^"]*)"/u.exec(flake)?.[1] ?? '';
    const name = properName(description);
    const [root] = yield* manifestsOf(repo);
    const known = pipe(
      [root?.pkg.name ?? '', Arr.lastNonEmpty(Str.split(repo.root, '/'))],
      Arr.map((value) => kebab(value)),
      Arr.join(' '),
    );
    if (name !== undefined && !Str.includes(kebab(name))(known)) {
      findings.push(
        fail(
          `flake description "${description}" names "${name}", which is not this repo`,
          {
            path: 'flake.nix',
            fix: 'update the flake description',
          },
        ),
      );
    }
    return findings.length > 0
      ? findings
      : [pass('flake.nix, flake.lock, .envrc use flake')];
  }),
};

const Jscpd = Schema.Struct({
  threshold: Schema.optional(Schema.Finite),
  minTokens: Schema.optional(Schema.Finite),
  minLines: Schema.optional(Schema.Finite),
});
const JSCPD = { threshold: 0, minTokens: 50, minLines: 33 } as const;
const JSCPD_KEYS = ['threshold', 'minTokens', 'minLines'] as const;

export const jscpd: DoctorCheck = {
  id: 'jscpd',
  description:
    'jscpd configured (.jscpd.json: threshold 0, minTokens 50, minLines 33) with a jscpd:check script',
  run: Effect.fnUntraced(function* (repo) {
    const config = decodeJsonc(Jscpd, yield* repo.read('.jscpd.json'));
    if (Option.isNone(config)) {
      return [
        fail('no .jscpd.json', {
          fix: 'add .jscpd.json with threshold 0, minTokens 50, minLines 33',
        }),
      ];
    }
    const findings: Array<Finding> = [];
    const off = pipe(
      JSCPD_KEYS,
      Arr.filter((key) => config.value[key] !== JSCPD[key]),
      Arr.map((key) => [key, JSCPD[key], config.value[key]] as const),
    );
    if (off.length > 0) {
      findings.push(
        fail(
          `.jscpd.json differs: ${Arr.join(
            Arr.map(
              off,
              ([key, want, got]) => `${key} ${String(got)} (want ${want})`,
            ),
            ', ',
          )}`,
          {
            path: '.jscpd.json',
            fix: `set ${Arr.join(
              Arr.map(off, ([key, want]) => `"${key}": ${want}`),
              ', ',
            )}`,
          },
        ),
      );
    }
    const [root] = yield* manifestsOf(repo);
    if (root?.pkg.scripts?.['jscpd:check'] === undefined) {
      findings.push(
        fail('no jscpd:check script', {
          path: 'package.json',
          fix: '"jscpd:check": "jscpd --config .jscpd.json"',
        }),
      );
    }
    return findings.length > 0 ? findings : [pass('jscpd configured')];
  }),
};

export const knip: DoctorCheck = {
  id: 'knip',
  description:
    'knip configured with knip.ts and `knip --no-config-hints --cache`',
  run: Effect.fnUntraced(function* (repo) {
    const findings: Array<Finding> = [];
    const json = yield* repo.glob('{knip,.knip}.json{,c}');
    const ts =
      (yield* repo.exists('knip.ts')) || (yield* repo.exists('knip.config.ts'));
    if (json.length > 0) {
      findings.push(
        fail(`${Arr.join(json, ', ')} should be knip.ts`, {
          path: json[0] ?? '',
          fix: 'convert to knip.ts with defineKnipConfig from shoe-box-knip-config',
        }),
      );
    } else if (!ts) {
      findings.push(
        fail('knip is not configured', {
          fix: 'add knip.ts with defineKnipConfig from shoe-box-knip-config',
        }),
      );
    }
    const [root] = yield* manifestsOf(repo);
    const script = root?.pkg.scripts?.['knip:check'];
    if (script === undefined) {
      findings.push(
        fail('no knip:check script', {
          path: 'package.json',
          fix: '"knip:check": "knip --no-config-hints --cache"',
        }),
      );
    } else if (
      !Str.includes('--no-config-hints')(script) ||
      !Str.includes('--cache')(script)
    ) {
      findings.push(
        fail(`knip:check is "${script}"`, {
          path: 'package.json',
          fix: '"knip:check": "knip --no-config-hints --cache"',
        }),
      );
    }
    return findings.length > 0 ? findings : [pass('knip.ts with knip:check')];
  }),
};

export const catalog: DoctorCheck = {
  id: 'catalog',
  description:
    'Every dependency uses catalog: (summary of `shoe-box check catalog`)',
  run: Effect.fnUntraced(function* (repo) {
    const analysis = yield* analyzeCatalog(repo);
    if (analysis === undefined) return [fail('no root package.json')];
    const { violations, notInCatalog, workspace } = analysis;
    if (violations.length === 0 && notInCatalog.length === 0) {
      return [
        pass(
          `all dependencies use catalog: (${Rec.keys(catalogOf(workspace.root.pkg)).length} entries)`,
        ),
      ];
    }
    return [
      fail(
        `${violations.length} pinned dep(s) that should be catalog:/workspace:*, ${notInCatalog.length} dep(s) missing from the catalog`,
        {
          fix: 'shoe-box check catalog --fix, then bun install',
        },
      ),
    ];
  }),
};

const COPIED = [
  'catalog-check',
  'effect-versions-check',
  'patches-check',
  'package-boundaries-check',
  'scrutinize-lint-ignores',
] as const;

export const copiedScripts: DoctorCheck = {
  id: 'copied-scripts',
  description:
    'No copy-pasted check scripts (scripts/**/catalog-check.ts etc.): use `shoe-box check <name>`',
  run: Effect.fnUntraced(function* (repo) {
    const findings: Array<Finding> = [];
    for (const script of COPIED) {
      const check = pipe(
        script,
        Str.replace(/-check$/u, ''),
        Str.replace('scrutinize-', ''),
      );
      for (const path of yield* repo.glob(`scripts/**/${script}.ts`)) {
        findings.push(
          fail(`${path} is a copy of \`shoe-box check ${check}\``, {
            path,
            ...(script === 'catalog-check'
              ? { migration: MigrationId.catalogCheckToShoebox }
              : {
                  fix: `point its script at \`shoe-box check ${check}\` and delete the copy (keep it if it has repo-specific rules)`,
                }),
          }),
        );
      }
    }
    return findings.length > 0 ? findings : [pass('no copied check scripts')];
  }),
};

// The root depends on no internal package except config/tooling, and
// workspace packages use a real scope.
const TOOLING = /(?:^|-)(?:config|plugins?|tooling|tsconfig)$/u;

export const monorepoLayout: DoctorCheck = {
  id: 'monorepo-layout',
  description:
    'A bun workspace monorepo scoped @<project>/*; the root depends only on config/tooling packages',
  run: Effect.fnUntraced(function* (repo) {
    const workspace = yield* readWorkspace(repo);
    if (workspace === undefined) return [fail('no root package.json')];
    if (workspace.packages.length === 0) {
      return [
        fail('not a monorepo (no workspace packages)', {
          fix: 'move the app into apps/<name> and add "workspaces": { "packages": ["apps/*", "packages/*"] }',
        }),
      ];
    }
    const findings: Array<Finding> = [];
    const scopes = new Set(
      Arr.flatMap(workspace.packages, (m) =>
        Arr.fromNullishOr(scopeOf(m.pkg.name)),
      ),
    );
    if (scopes.has('repo'))
      findings.push(
        fail('packages use the @repo/* scope', {
          fix: 'rename to @<project>/*',
        }),
      );
    const internal = new Map(
      Arr.map(workspace.packages, (m) => [m.pkg.name ?? '', m.dir] as const),
    );
    const rootInternal = Arr.filter(
      Rec.keys(allDeps(workspace.root.pkg)),
      (dep) => {
        const dir = internal.get(dep);
        return (
          dir !== undefined &&
          !Str.startsWith('packages/config/')(dir) &&
          !TOOLING.test(Arr.lastNonEmpty(Str.split(dep, '/')))
        );
      },
    );
    if (rootInternal.length > 0) {
      findings.push(
        fail(`root depends on internal packages: ${listSome(rootInternal)}`, {
          path: 'package.json',
          fix: 'drop them from the root; only config/tooling packages belong there',
        }),
      );
    }
    return findings.length > 0
      ? findings
      : [
          pass(
            `${workspace.packages.length} workspace packages (${Arr.join(
              Arr.map([...scopes], (s) => `@${s}`),
              ', ',
            )})`,
          ),
        ];
  }),
};

export const gitHooks: DoctorCheck = {
  id: 'no-git-hooks',
  description:
    'No git hooks (husky, lefthook, simple-git-hooks): CI and agent instructions are the gates',
  run: Effect.fnUntraced(function* (repo) {
    const manifests = yield* manifestsOf(repo);
    const hooks = [
      ...Arr.map((yield* repo.glob('.husky/*')).slice(0, 1), () => '.husky/'),
      ...(yield* repo.glob('{lefthook,.lefthook}.{yml,yaml,json}')),
      ...Arr.filter(
        ['husky', 'lefthook', 'simple-git-hooks', 'lint-staged'],
        (dep) => Arr.some(manifests, (m) => hasDep(m.pkg, dep)),
      ),
    ];
    return hooks.length === 0
      ? [pass('no git hooks')]
      : [
          fail(`git hooks configured: ${Arr.join(hooks, ', ')}`, {
            fix: 'remove them; run checks in CI',
          }),
        ];
  }),
};

export const vscode: DoctorCheck = {
  id: 'vscode',
  description: '.vscode uses oxc as the default formatter with fixAll on save',
  run: Effect.fnUntraced(function* (repo) {
    const settings = yield* repo.read('.vscode/settings.json');
    if (settings === undefined)
      return [
        fail('no .vscode/settings.json', {
          fix: 'shoe-box sync renders .vscode (vscode feature)',
        }),
      ];
    return Str.includes('oxc.oxc-vscode')(settings)
      ? [pass('.vscode uses oxc')]
      : [
          fail('.vscode/settings.json does not use oxc as the formatter', {
            path: '.vscode/settings.json',
            fix: '"editor.defaultFormatter": "oxc.oxc-vscode"',
          }),
        ];
  }),
};

export const toolingChecks = [
  monorepoLayout,
  turboJsonc,
  scriptNames,
  bunTest,
  effectTsgo,
  typescript7,
  bunVersion,
  nixDevShell,
  jscpd,
  knip,
  catalog,
  copiedScripts,
  gitHooks,
  vscode,
];
