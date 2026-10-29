import {
  Array as Arr,
  Effect,
  Option,
  Record as Rec,
  String as Str,
} from 'effect';

import { formatContent, formatFiles } from './format.ts';
import { matchesAny } from './glob.ts';
import { sha256 } from './hash.ts';
import {
  canonicalJson,
  mergeJson,
  ownedPointers,
  ownedProjection,
  parseJsonObject,
  renderJson,
  shapeOf,
} from './json.ts';
import { LOCK_PATH, type Lock, type LockEntry } from './lock.ts';
import {
  insertRegions,
  isMarkdown,
  regionBodies,
  regionIds,
  replaceRegions,
} from './regions.ts';
import type { Repo } from './repo.ts';
import type { FileStrategy, GeneratedFile } from './types.ts';

// - create: missing on disk.
// - update: differs, and disk still matches the lock baseline (safe).
// - unchanged: disk already holds the generated result.
// - conflict: differs and was hand-edited since the baseline (or a managed
//   file lost or duplicated a region / a json-merge file is not JSON).
// - untracked: differs and has no baseline (a repo being adopted).
// - skip: a seed file that already exists, or that shoebox wrote and the
//   user deleted.
export type Action =
  | 'create'
  | 'update'
  | 'unchanged'
  | 'conflict'
  | 'untracked'
  | 'skip';

export interface PlannedFile {
  readonly path: string;
  readonly strategy: FileStrategy;
  readonly action: Action;
  readonly before: string | undefined;
  // What shoebox writes (for conflict/untracked: what it would write).
  readonly after: string;
  readonly executable: boolean;
  readonly generated: GeneratedFile;
  readonly reason?: string;
  // A conflict/untracked file `--force` turned into an update.
  readonly forced?: boolean;
}

export interface Plan {
  readonly files: ReadonlyArray<PlannedFile>;
  // In the lock but no longer generated. Left on disk, dropped from the lock.
  readonly orphans: ReadonlyArray<string>;
}

export interface PlanOptions {
  // Globs whose conflicts/untracked files take the generated version.
  readonly force?: ReadonlyArray<string>;
}

const toLf = Str.replaceAll('\r\n', '\n');

// A CRLF checkout (core.autocrlf) is hashed as LF, and an edit shoebox makes
// to it keeps CRLF, so line endings alone are never drift.
const usesCrlf = (text: string) =>
  Option.exists(
    Str.indexOf('\n')(text),
    (eol) => eol > 0 && text[eol - 1] === '\r',
  );

const withEol = (text: string, crlf: boolean) =>
  crlf ? Str.replaceAll('\n', '\r\n')(toLf(text)) : text;

const regionOptions = (path: string) => ({ fences: isMarkdown(path) });

// What a fingerprint covers besides whole files: the region ids (managed) or
// owned key pointers (json-merge) of `file`. The lock records it, so a later
// generator that owns more (or fewer) keys or regions does not make the file
// look hand-edited.
export const ownedSet = (file: GeneratedFile) => {
  switch (file.strategy) {
    case 'owned':
    case 'seed': {
      return undefined;
    }
    case 'managed': {
      return regionIds(toLf(file.content), regionOptions(file.path));
    }
    case 'json-merge': {
      return ownedPointers(parseJsonObject(file.content) ?? {});
    }
  }
};

// The recorded set, or for locks written before sets were recorded, the
// generated file the set is derived from.
export type Scope =
  | { readonly owned: ReadonlyArray<string> }
  | { readonly generated: string };

// What the lock records per strategy, so hand edits can be told apart from
// shoebox's own writes: the whole file for owned/seed, only the region bodies
// for managed, only the owned keys for json-merge.
export const fingerprint = (
  strategy: FileStrategy,
  path: string,
  content: string,
  scope: Scope,
) => {
  const text = toLf(content);
  switch (strategy) {
    case 'owned':
    case 'seed': {
      return sha256(text);
    }
    case 'managed': {
      const options = regionOptions(path);
      const ids =
        'owned' in scope
          ? scope.owned
          : regionIds(toLf(scope.generated), options);
      const bodies = regionBodies(text, options);
      return sha256(
        canonicalJson(Arr.map(ids, (id) => [id, bodies.get(id) ?? null])),
      );
    }
    case 'json-merge': {
      const existing = parseJsonObject(text);
      const shape =
        'owned' in scope
          ? shapeOf(scope.owned)
          : (parseJsonObject(scope.generated) ?? {});
      return sha256(
        existing === undefined
          ? text
          : canonicalJson(ownedProjection(existing, shape)),
      );
    }
  }
};

const scopeOf = (file: GeneratedFile, baseline: LockEntry | undefined) =>
  baseline?.owned !== undefined && baseline.strategy === file.strategy
    ? { owned: baseline.owned }
    : { generated: file.content };

// The baseline for `written`, as shoebox wrote it from `file`.
export const lockEntry = (file: GeneratedFile, written: string): LockEntry => {
  const owned = ownedSet(file);
  return {
    strategy: file.strategy,
    sha256: fingerprint(file.strategy, file.path, written, {
      owned: owned ?? [],
    }),
    ...(owned === undefined ? {} : { owned }),
  };
};

// After shoebox itself edits a tracked file (a migration), the result becomes
// its baseline, but only when the file still matched the old baseline: a hand
// edit stays a conflict. `generated` stands in for a lock without a recorded
// set; without either, the baseline is left alone.
export const rebaseline = (
  entry: LockEntry,
  path: string,
  before: string,
  after: string,
  generated: string | undefined,
) => {
  const needsSet =
    entry.strategy === 'managed' || entry.strategy === 'json-merge';
  const owned =
    entry.owned ??
    (needsSet && generated !== undefined
      ? ownedSet({ path, strategy: entry.strategy, content: generated })
      : undefined);
  if (needsSet && owned === undefined) return undefined;
  const scope: Scope =
    entry.owned === undefined && generated !== undefined
      ? { generated }
      : { owned: owned ?? [] };
  if (fingerprint(entry.strategy, path, before, scope) !== entry.sha256) {
    return undefined;
  }
  return {
    strategy: entry.strategy,
    sha256: fingerprint(entry.strategy, path, after, { owned: owned ?? [] }),
    ...(owned === undefined ? {} : { owned }),
  } satisfies LockEntry;
};

interface Desired {
  readonly after: string;
  // Set when the file cannot be merged: always a conflict.
  readonly problem?: string;
}

const desired = Effect.fnUntraced(function* (
  file: GeneratedFile,
  disk: string | undefined,
  baseline: LockEntry | undefined,
) {
  if (disk === undefined) {
    return {
      after:
        file.strategy === 'json-merge'
          ? yield* formatContent(
              file.path,
              renderJson(parseJsonObject(file.content) ?? {}),
            )
          : file.content,
    } satisfies Desired;
  }
  const crlf = usesCrlf(disk);
  switch (file.strategy) {
    case 'owned':
    case 'seed': {
      return { after: withEol(file.content, crlf) } satisfies Desired;
    }
    case 'managed': {
      const options = regionOptions(file.path);
      const { content, missing, duplicates } = replaceRegions(
        toLf(disk),
        file.content,
        options,
      );
      // Text outside regions is the user's, so even --force only adds the
      // missing regions. A region the baseline had was removed by hand (a
      // conflict); one it lacked is new in this version and simply added.
      const after = withEol(
        insertRegions(content, file.content, missing, options),
        crlf,
      );
      const known =
        baseline?.strategy === 'managed' ? baseline.owned : undefined;
      const lost = Arr.filter(
        missing,
        (id) => known === undefined || known.includes(id),
      );
      if (duplicates.length > 0) {
        return {
          after,
          problem: `shoebox region(s) appear more than once: ${Arr.join(duplicates, ', ')}; keep one copy of each`,
        } satisfies Desired;
      }
      return lost.length === 0
        ? ({ after } satisfies Desired)
        : ({
            after,
            problem: `missing shoebox region(s): ${Arr.join(lost, ', ')}`,
          } satisfies Desired);
    }
    case 'json-merge': {
      const owned = parseJsonObject(file.content) ?? {};
      const existing = parseJsonObject(disk);
      if (existing === undefined) {
        return {
          after: yield* formatContent(file.path, renderJson(owned)),
          problem: 'not a JSON object',
        } satisfies Desired;
      }
      return {
        after: withEol(
          yield* formatContent(
            file.path,
            renderJson(mergeJson(existing, owned)),
          ),
          crlf,
        ),
      } satisfies Desired;
    }
  }
});

// Why a file that differs from the generated result cannot simply be updated.
const blocker = (
  problem: string | undefined,
  baseline: LockEntry | undefined,
  current: string,
) => {
  if (problem !== undefined) {
    return { action: 'conflict', reason: problem } as const;
  }
  if (baseline === undefined) {
    return {
      action: 'untracked',
      reason: 'exists but shoebox has no baseline for it',
    } as const;
  }
  if (baseline.sha256 !== current) {
    return {
      action: 'conflict',
      reason: 'edited since the last sync',
    } as const;
  }
  return undefined;
};

const classify = Effect.fnUntraced(function* (
  file: GeneratedFile,
  repo: Repo,
  lock: Lock | undefined,
  options: PlanOptions,
) {
  const disk = yield* repo.read(file.path);
  const baseline = lock?.files[file.path];
  const base = {
    path: file.path,
    strategy: file.strategy,
    before: disk,
    executable: file.executable === true,
    generated: file,
  };
  const { after, problem } = yield* desired(file, disk, baseline);
  if (disk === undefined) {
    // shoebox wrote this seed before, so its absence is the user's choice.
    if (file.strategy === 'seed' && baseline?.strategy === 'seed') {
      return {
        ...base,
        after: '',
        action: 'skip',
        reason: 'deleted by user',
      } satisfies PlannedFile;
    }
    return { ...base, after, action: 'create' } satisfies PlannedFile;
  }
  if (file.strategy === 'seed') {
    return { ...base, after: disk, action: 'skip' } satisfies PlannedFile;
  }
  if (problem === undefined && after === disk) {
    return { ...base, after, action: 'unchanged' } satisfies PlannedFile;
  }
  const blocked = blocker(
    problem,
    baseline,
    fingerprint(file.strategy, file.path, disk, scopeOf(file, baseline)),
  );
  if (blocked === undefined) {
    return { ...base, after, action: 'update' } satisfies PlannedFile;
  }
  const forced = matchesAny(file.path, options.force ?? []);
  return {
    ...base,
    after,
    action: forced ? 'update' : blocked.action,
    reason: blocked.reason,
    ...(forced ? { forced } : {}),
  } satisfies PlannedFile;
});

export const makePlan = Effect.fnUntraced(function* (
  repo: Repo,
  generated: ReadonlyArray<GeneratedFile>,
  lock: Lock | undefined,
  options: PlanOptions = {},
) {
  const formatted = yield* formatFiles(generated);
  const files: ReadonlyArray<PlannedFile> = yield* Effect.forEach(
    formatted,
    (file) => classify(file, repo, lock, options),
    { concurrency: 16 },
  );
  const paths = new Set(Arr.map(files, (f) => f.path));
  const orphans = Arr.filter(
    Rec.keys(lock?.files ?? {}),
    (path) => !paths.has(path) && path !== LOCK_PATH,
  );
  return { files, orphans } satisfies Plan;
});

export const isWrite = (file: PlannedFile) =>
  file.action === 'create' || file.action === 'update';

export const isBlocked = (file: PlannedFile) =>
  file.action === 'conflict' || file.action === 'untracked';

// The lock after applying `plan`: written and unchanged files get a fresh
// baseline; blocked files keep whatever baseline they had. A skipped seed
// keeps the baseline of what shoebox wrote and gets none otherwise: content
// the user wrote is never recorded as shoebox's.
export const nextLock = (
  previous: Lock | undefined,
  plan: Plan,
  cliVersion: string,
): Lock => {
  const files: Record<string, LockEntry> = {};
  for (const file of plan.files) {
    const old = previous?.files[file.path];
    if (file.action === 'skip') {
      if (old !== undefined) {
        files[file.path] = { sha256: old.sha256, strategy: 'seed' };
      }
      continue;
    }
    if (isBlocked(file)) {
      if (old !== undefined) files[file.path] = old;
      continue;
    }
    files[file.path] = lockEntry(file.generated, file.after);
  }
  return {
    cliVersion,
    migrations: previous?.migrations ?? [],
    files,
  };
};
