import {
  Array as Arr,
  Effect,
  Option,
  pipe,
  Record as Rec,
  String as Str,
} from 'effect';

import type { Repo } from '../engine/repo.ts';
import { readLockResolutions } from './lockfile.ts';
import type { RepoCheck } from './types.ts';
import { readManifest } from './workspace.ts';

// Bun keys each patch to an exact `name@version`. When `bun install`
// re-resolves a range the key stops matching and bun silently skips the
// patch (exit 0, no warning), so drift has to be caught mechanically.

// Short added lines (`}`, `];`) appear everywhere and would match by
// coincidence, passing a patch that never applied.
const MIN_SIGNIFICANT_LINE_LENGTH = 8;
const URL_VERSION = /^https?:\/\//u;

interface PatchTarget {
  readonly file: string;
  readonly addedLines: Array<string>;
}

// Only enough unified-diff structure to ask "did this text reach node_modules?".
export const parsePatch = (contents: string) => {
  const targets: Array<PatchTarget> = [];
  let current: PatchTarget | undefined;
  for (const line of Str.split(contents, '\n')) {
    const header = /^diff --git a\/.+ b\/(.+)$/u.exec(line);
    if (header?.[1] !== undefined) {
      current = { file: header[1], addedLines: [] };
      targets.push(current);
    } else if (
      current !== undefined &&
      Str.startsWith('+')(line) &&
      !Str.startsWith('+++')(line)
    ) {
      const added = pipe(line, Str.slice(1), Str.trim);
      if (added.length >= MIN_SIGNIFICANT_LINE_LENGTH)
        current.addedLines.push(added);
    }
  }
  return targets;
};

type Problem = { readonly level: 'error' | 'warn'; readonly message: string };

const checkPatch = Effect.fnUntraced(function* (
  repo: Repo,
  key: string,
  patchPath: string,
  resolutions: ReadonlyMap<string, string>,
) {
  // `pkg@1.2.3`, `@scope/pkg@1.2.3` or `pkg@https://host/pkg/<sha>`: the name
  // ends at the first `@` past the scope marker.
  const at = pipe(
    key,
    Str.slice(1),
    Str.indexOf('@'),
    Option.map((index) => index + 1),
    Option.getOrElse(() => -1),
  );
  const pkgName = Str.slice(0, at)(key);
  const keyedVersion = Str.slice(at + 1)(key);
  const error = (message: string): Array<Problem> => [
    { level: 'error', message },
  ];

  if (at <= 0 || keyedVersion === '') {
    return error(
      `patchedDependencies key "${key}" is not in \`name@version\` form.`,
    );
  }
  const patch = yield* repo.read(patchPath);
  if (patch === undefined)
    return error(`${key}: patch file "${patchPath}" does not exist.`);

  const pkgDir = `node_modules/${pkgName}`;
  const installed = yield* readManifest(repo, `${pkgDir}/package.json`);
  if (installed === undefined) {
    return error(
      `${key}: not installed at ${pkgDir}. Either the dependency was removed (delete the patch and its patchedDependencies entry) or it is nested rather than hoisted, in which case the patch may not be applying. (Run \`bun install\` first if node_modules is missing.)`,
    );
  }
  const rekey = `Re-key it: \`bun patch ${pkgName}\`, re-apply and re-validate the changes, \`bun patch --commit 'node_modules/${pkgName}'\`, then pin the dep to an exact version.`;
  if (URL_VERSION.test(keyedVersion)) {
    const resolved = resolutions.get(pkgName);
    if (resolved !== `${pkgName}@${keyedVersion}`) {
      return error(
        `${key}: bun.lock resolves ${pkgName} to ${resolved ?? 'nothing'}, so bun is SILENTLY SKIPPING this patch. ${rekey}`,
      );
    }
  } else if (installed.pkg.version !== keyedVersion) {
    return error(
      `${key}: installed version is ${installed.pkg.version ?? 'unknown'}, so bun is SILENTLY SKIPPING this patch. ${rekey}`,
    );
  }

  const targets = parsePatch(patch);
  if (targets.length === 0) {
    return [
      {
        level: 'warn' as const,
        message: `${key}: no diff hunks found in "${patchPath}". Is the patch file empty?`,
      },
    ];
  }
  const problems: Array<Problem> = [];
  for (const target of targets) {
    const contents = yield* repo.read(`${pkgDir}/${target.file}`);
    if (contents === undefined) {
      problems.push({
        level: 'error',
        message: `${key}: patched file "${target.file}" is missing from ${pkgDir}.`,
      });
    } else if (target.addedLines.length === 0) {
      // Deletion-only hunks leave nothing to search for; say so rather than
      // reporting "applied".
      problems.push({
        level: 'warn',
        message: `${key}: "${target.file}" has no distinctive added lines to verify, so only the version key was checked for it.`,
      });
    } else {
      const missing = Arr.filter(
        target.addedLines,
        (line) => !Str.includes(line)(contents),
      );
      if (missing.length > 0) {
        problems.push({
          level: 'error',
          message: Arr.join(
            [
              `${key}: "${target.file}" in node_modules does not contain ${missing.length} of the ${target.addedLines.length} line(s) this patch adds: the patch is NOT applied.`,
              ...Arr.map(missing.slice(0, 3), (line) => `      + ${line}`),
              '      Try `bun install` first; if that does not fix it, regenerate the patch.',
            ],
            '\n',
          ),
        });
      }
    }
  }
  return problems;
});

const runPatches = Effect.fnUntraced(function* (repo: Repo) {
  const root = yield* readManifest(repo, 'package.json');
  const patched = root?.pkg.patchedDependencies ?? {};
  const entries = Rec.toEntries(patched);
  const patchFiles = yield* repo.glob('patches/*.patch');

  const resolutions =
    (yield* readLockResolutions(repo)) ?? new Map<string, string>();
  const problems: Array<Problem> = [];
  for (const [key, patchPath] of entries) {
    problems.push(...(yield* checkPatch(repo, key, patchPath, resolutions)));
  }
  // Orphans: bun ignores patch files not wired into patchedDependencies.
  const referenced = new Set(
    Arr.map(Rec.values(patched), (path) => Str.replace(/^\.\//u, '')(path)),
  );
  for (const file of patchFiles) {
    if (!referenced.has(file)) {
      problems.push({
        level: 'warn',
        message: `${file} is not referenced by patchedDependencies, so bun never applies it. Wire it up or delete it.`,
      });
    }
  }

  if (entries.length === 0 && problems.length === 0) {
    return {
      ok: true,
      report: 'No patchedDependencies declared: nothing to verify.',
      fixes: [],
    };
  }
  const errors = Arr.filter(problems, (p) => p.level === 'error');
  const warnings = Arr.filter(problems, (p) => p.level === 'warn');
  const summary =
    errors.length > 0
      ? `${errors.length} patch(es) are not taking effect.`
      : `All ${entries.length} patches are applied.${warnings.length > 0 ? ` ${warnings.length} warning(s) above.` : ''}`;
  return {
    ok: errors.length === 0,
    report: Arr.join(
      [
        `Verifying ${entries.length} patched dependencies...`,
        '',
        ...Arr.map(warnings, (w) => `  WARN  ${w.message}`),
        ...Arr.map(errors, (e) => `  ERROR ${e.message}`),
        '',
        summary,
      ],
      '\n',
    ),
    fixes: [],
  };
});

export const patchesCheck = {
  name: 'patches',
  description:
    'Every bun patch (patchedDependencies) still matches the installed name@version and is applied',
  run: runPatches,
} satisfies RepoCheck;
