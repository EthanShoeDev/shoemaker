import {
  Array as Arr,
  Effect,
  Order,
  pipe,
  Record as Rec,
  String as Str,
} from 'effect';

import type { Repo } from '../engine/repo.ts';
import {
  readLockPackages,
  readLockResolutions,
  splitResolved,
} from './lockfile.ts';
import type { RepoCheck } from './types.ts';
import {
  catalogPath,
  editJson,
  majorOf,
  makeEditor,
  readWorkspace,
} from './workspace.ts';

// effect v4 publishes `effect` and every `@effect/*` package in lockstep and
// the packages call each other's internals, so one transitive package resolved
// to a newer prerelease breaks at runtime (listening-astro lost runner-to-runner
// RPC for four days to exactly this). The lockfile is the source of truth: the
// drift lives in transitive resolutions nobody declares.

// Not on the lockstep release train (matched by prefix: tsgo ships one
// platform binary package per target).
const NOT_LOCKSTEP = ['@effect/tsgo', '@effect/language-service'];

const isLockstep = (name: string) =>
  (name === 'effect' || Str.startsWith('@effect/')(name)) &&
  !Arr.some(
    NOT_LOCKSTEP,
    (prefix) => name === prefix || Str.startsWith(`${prefix}-`)(name),
  );

const effectFamily = Effect.fnUntraced(function* (repo: Repo) {
  const resolutions = yield* readLockResolutions(repo);
  if (resolutions === undefined) {
    return { ok: true, report: 'No bun.lock: nothing to verify.', fixes: [] };
  }
  const resolved = new Map<string, Set<string>>();
  for (const entry of resolutions.values()) {
    const parsed = splitResolved(entry);
    if (parsed === undefined || !isLockstep(parsed.name)) continue;
    const versions = resolved.get(parsed.name) ?? new Set<string>();
    versions.add(parsed.version);
    resolved.set(parsed.name, versions);
  }

  // The hoisted `effect` is the repo's line. A package kept on another major
  // on purpose (e.g. a package mid-port from Effect 3) is its own
  // island: its @effect/* packages version independently, so it is only noted.
  const hoisted = resolutions.get('effect');
  const effectVersions = [...(resolved.get('effect') ?? [])];
  const expected =
    (hoisted === undefined ? undefined : splitResolved(hoisted)?.version) ??
    (effectVersions.length === 1 ? effectVersions[0] : undefined);
  if (expected === undefined) {
    return effectVersions.length === 0
      ? {
          ok: true,
          report: 'effect is not in bun.lock: nothing to verify.',
          fixes: [],
        }
      : {
          ok: false,
          report: `No hoisted \`effect\` in bun.lock and several versions resolved: ${Arr.join(effectVersions, ', ')}. Pin it in root \`overrides\` and run bun install.`,
          fixes: [],
        };
  }
  const line = majorOf(expected);
  const otherMajor = Arr.flatMap([...resolved], ([name, versions]) =>
    pipe(
      [...versions],
      Arr.filter((v) => majorOf(v) !== line),
      Arr.map((v) => `${name}@${v}`),
    ),
  );
  for (const versions of resolved.values()) {
    for (const version of versions)
      if (majorOf(version) !== line) versions.delete(version);
  }
  for (const [name, versions] of resolved)
    if (versions.size === 0) resolved.delete(name);
  const notes =
    otherMajor.length === 0
      ? []
      : [
          `Not on effect ${line ?? '?'}.x, so not compared: ${Arr.join(Arr.sort(otherMajor, Order.String), ', ')}`,
        ];

  const byName: Order.Order<readonly [string, Set<string>]> = ([a], [b]) =>
    Str.localeCompare(b)(a);
  const problems = Arr.flatMap(
    Arr.sort([...resolved], byName),
    ([name, versions]: readonly [string, Set<string>]) =>
      pipe(
        [...versions],
        Arr.filter((version) => version !== expected),
        Arr.map(
          (version) =>
            `  ERROR ${name}@${version} (effect is ${expected}): add "${name}": "${expected}" to root package.json overrides and run bun install`,
        ),
      ),
  );

  return problems.length === 0
    ? {
        ok: true,
        report: Arr.join(
          [
            `All ${resolved.size} effect packages resolve to ${expected}.`,
            ...notes,
          ],
          '\n',
        ),
        fixes: [],
      }
    : {
        ok: false,
        report: Arr.join(
          [
            ...problems,
            '',
            `${problems.length} effect package(s) drifted from effect@${expected}. Mixed versions break cross-package internals at runtime.`,
            ...notes,
          ],
          '\n',
        ),
        fixes: [],
      };
});

// alchemy publishes `alchemy` and its `@alchemy.run/*` packages in lockstep
// (each peers on that exact `alchemy`) and pins its other dependencies,
// `@distilled.cloud/*` among them, exactly. A package the repo adds itself
// (@alchemy.run/stripe, @distilled.cloud/stripe) keeps its old pin when sync
// moves the ones it manages, and then resolves twice.

// The version a package must resolve to, or undefined for no claim.
type Pins = (name: string) => string | undefined;

const isAlchemyScoped = Str.startsWith('@alchemy.run/');
const isDistilled = Str.startsWith('@distilled.cloud/');
const EXACT = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/u;

type LockPackage = NonNullable<
  Effect.Success<ReturnType<typeof readLockPackages>>
>[number];

const alchemyPins = Effect.fnUntraced(function* (repo: Repo) {
  const packages = (yield* readLockPackages(repo)) ?? [];
  const hoisted = (yield* readLockResolutions(repo))?.get('alchemy');
  const alchemy =
    hoisted === undefined ? undefined : splitResolved(hoisted)?.version;
  if (alchemy === undefined)
    return { packages, alchemy, pins: () => undefined };
  const onTrain = (pkg: LockPackage) =>
    pkg.name === 'alchemy' ||
    (isAlchemyScoped(pkg.name) && pkg.dependencies.alchemy !== undefined);
  // Exact versions the train at alchemy's version asks for, by name; a name
  // asked for at two versions gets no claim.
  const asked = new Map<string, Set<string>>();
  for (const pkg of packages) {
    if (!onTrain(pkg) || pkg.version !== alchemy) continue;
    for (const [name, spec] of Rec.toEntries(pkg.dependencies)) {
      if (!EXACT.test(spec)) continue;
      asked.set(name, (asked.get(name) ?? new Set()).add(spec));
    }
  }
  const only = (specs: Set<string> | undefined) =>
    specs?.size === 1 ? [...specs][0] : undefined;
  const distilled = only(
    new Set(
      Arr.flatMap([...asked], ([name, specs]) =>
        isDistilled(name) ? [...specs] : [],
      ),
    ),
  );
  const train = new Set(
    Arr.map(Arr.filter(packages, onTrain), (pkg) => pkg.name),
  );
  const pins: Pins = (name) =>
    only(asked.get(name)) ??
    (train.has(name) ? alchemy : isDistilled(name) ? distilled : undefined);
  return { packages, alchemy, pins };
});

const pinProblems = (packages: ReadonlyArray<LockPackage>, pins: Pins) => {
  const problems = Arr.flatMap(packages, (pkg) => {
    const claimed =
      isAlchemyScoped(pkg.name) ||
      isDistilled(pkg.name) ||
      pkg.name === 'alchemy';
    const expected = claimed ? pins(pkg.name) : undefined;
    return expected === undefined || pkg.version === expected
      ? []
      : [`  ERROR ${pkg.name}@${pkg.version} (alchemy pins ${expected})`];
  });
  return Arr.sort(Arr.dedupe(problems), Order.String);
};

// A pin on another major is a package kept there on purpose (an Effect 3
// island), and a range that already admits the version needs no edit.
const isBehind = (pinned: string, expected: string) =>
  majorOf(pinned) === majorOf(expected) &&
  (EXACT.test(pinned)
    ? pinned !== expected
    : !Bun.semver.satisfies(expected, pinned));

// Root catalog pins that disagree with their family's version: the fix
// moves them, and the next `bun install` resolves the family once.
const catalogFixes = Effect.fnUntraced(function* (repo: Repo, pins: Pins) {
  const workspace = yield* readWorkspace(repo);
  if (workspace === undefined) return { fixes: [], log: [] };
  const editor = makeEditor([workspace.root]);
  const at = catalogPath(workspace.root.pkg);
  const log: Array<string> = [];
  for (const [name, pinned] of Arr.sort(
    Rec.toEntries(workspace.catalog),
    Order.mapInput(Order.String, ([name]: readonly [string, string]) => name),
  )) {
    const expected = pins(name);
    if (expected === undefined || !isBehind(pinned, expected)) continue;
    editor.update(workspace.root.path, (text) =>
      editJson(text, [...at, name], expected),
    );
    log.push(`  catalog "${name}": "${pinned}" -> "${expected}"`);
  }
  return { fixes: editor.changes(), log };
});

const runEffectVersions = Effect.fnUntraced(function* (repo: Repo) {
  const effect = yield* effectFamily(repo);
  const { packages, alchemy, pins } = yield* alchemyPins(repo);
  const problems = pinProblems(packages, pins);
  const hoistedEffect = (yield* readLockResolutions(repo))?.get('effect');
  const effectVersion =
    hoistedEffect === undefined
      ? undefined
      : splitResolved(hoistedEffect)?.version;
  const { fixes, log } = yield* catalogFixes(repo, (name) =>
    isLockstep(name) ? effectVersion : pins(name),
  );
  const alchemyReport =
    alchemy === undefined
      ? []
      : problems.length === 0
        ? [`Every alchemy package resolves to what alchemy@${alchemy} pins.`]
        : [
            '',
            ...problems,
            '',
            `${problems.length} package(s) drifted from what alchemy@${alchemy} pins. Mixed versions duplicate its providers and SDKs.`,
          ];
  const catalogReport =
    log.length === 0
      ? []
      : [
          '',
          'Catalog pins behind their family (--fix moves them, then run bun install):',
          ...log,
        ];
  return {
    ok: effect.ok && problems.length === 0 && fixes.length === 0,
    report: Arr.join([effect.report, ...alchemyReport, ...catalogReport], '\n'),
    fixes,
  };
});

export const effectVersionsCheck = {
  name: 'effect-versions',
  description:
    'Every effect / @effect/* package resolves to the same version as effect, and every @alchemy.run/* and @distilled.cloud/* to what alchemy pins',
  run: runEffectVersions,
} satisfies RepoCheck;
