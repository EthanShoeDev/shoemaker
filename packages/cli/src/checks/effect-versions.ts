import { Array as Arr, Effect, Order, pipe, String as Str } from 'effect';

import type { Repo } from '../engine/repo.ts';
import { readLockResolutions, splitResolved } from './lockfile.ts';
import type { RepoCheck } from './types.ts';
import { majorOf } from './workspace.ts';

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

const runEffectVersions = Effect.fnUntraced(function* (repo: Repo) {
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

export const effectVersionsCheck: RepoCheck = {
  name: 'effect-versions',
  description:
    'Every effect / @effect/* package in bun.lock resolves to the same version as effect',
  run: runEffectVersions,
};
