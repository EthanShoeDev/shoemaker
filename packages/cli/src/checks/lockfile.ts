import {
  Array as Arr,
  Effect,
  Option,
  pipe,
  Record as Rec,
  Schema,
  String as Str,
} from 'effect';

import type { Repo } from '../engine/repo.ts';
import { decodeJsonc } from './workspace.ts';

// bun.lock is JSONC. Its `packages` map is keyed by install path (nested
// duplicates as "parent/name") and each entry's first element is the resolved
// `name@version` (or `name@<url>` for a tarball dependency).
const Lockfile = Schema.Struct({
  packages: Schema.Record(
    Schema.String,
    Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Unknown]),
  ),
});

export const readLockResolutions = Effect.fnUntraced(function* (repo: Repo) {
  const text = yield* repo.read('bun.lock');
  if (text === undefined) return undefined;
  const lock = decodeJsonc(Lockfile, text);
  return Option.isNone(lock)
    ? new Map<string, string>()
    : new Map(
        Arr.map(
          Rec.toEntries(lock.value.packages),
          ([installPath, [resolved]]) => [installPath, resolved] as const,
        ),
      );
});

// `@scope/name@1.2.3` -> name + version; the version follows the LAST `@`.
export const splitResolved = (resolved: string) =>
  pipe(
    Str.lastIndexOf('@')(resolved),
    Option.filter((at) => at > 0),
    Option.map((at) => ({
      name: Str.slice(0, at)(resolved),
      version: Str.slice(at + 1)(resolved),
    })),
    Option.getOrUndefined,
  );

const LockDependencies = Schema.Struct({
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  peerDependencies: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String),
  ),
});
const decodeLockDependencies = Schema.decodeUnknownOption(LockDependencies);

// Each resolved package with the dependency specs its own manifest declares
// (bun.lock keeps them in the entry's third element).
export const readLockPackages = Effect.fnUntraced(function* (repo: Repo) {
  const text = yield* repo.read('bun.lock');
  if (text === undefined) return undefined;
  const lock = decodeJsonc(Lockfile, text);
  if (Option.isNone(lock)) return [];
  return Arr.flatMap(Rec.values(lock.value.packages), (entry) => {
    const parsed = splitResolved(entry[0]);
    if (parsed === undefined) return [];
    const meta = Option.getOrUndefined(decodeLockDependencies(entry[2]));
    return [
      {
        ...parsed,
        dependencies: { ...meta?.peerDependencies, ...meta?.dependencies },
      },
    ];
  });
});
