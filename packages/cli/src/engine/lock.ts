import {
  Array as Arr,
  Effect,
  Order,
  Record as Rec,
  Schema,
  String as Str,
} from 'effect';
import { type ParseError, parse } from 'jsonc-parser';

import type { Repo } from './repo.ts';

export const LOCK_PATH = 'shoebox.lock.jsonc';

const Strategy = Schema.Literals(['owned', 'seed', 'managed', 'json-merge']);

export const LockEntry = Schema.Struct({
  // Fingerprint of what shoebox last wrote (see plan.ts `fingerprint`).
  sha256: Schema.String,
  strategy: Strategy,
  // What the fingerprint covered when it was taken: region ids (managed) or
  // owned key pointers (json-merge). Locks written before this was recorded
  // lack it; their fingerprints cover the current generator's set instead.
  owned: Schema.optional(Schema.Array(Schema.String)),
});
export type LockEntry = typeof LockEntry.Type;

export const Lock = Schema.Struct({
  cliVersion: Schema.String,
  files: Schema.Record(Schema.String, LockEntry),
});
export type Lock = typeof Lock.Type;

export class LockParseError extends Schema.TaggedError<
  LockParseError,
  { readonly brand: unique symbol }
>()('LockParseError', { message: Schema.String }) {}

const decodeLock = Schema.decodeUnknownEffect(Lock);

export const parseLock = Effect.fnUntraced(function* (text: string) {
  const errors: Array<ParseError> = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    return yield* LockParseError.make({
      message: `${LOCK_PATH} is not valid JSONC`,
    });
  }
  return yield* decodeLock(value).pipe(
    Effect.mapError((issue) =>
      LockParseError.make({ message: `${LOCK_PATH}: ${issue.message}` }),
    ),
  );
});

const byPath = Order.mapInput(
  (a: string, b: string) => Str.localeCompare(b)(a),
  ([path]: readonly [string, LockEntry]) => path,
);

// Sorted keys so the lock diffs cleanly.
export const renderLock = (lock: Lock) =>
  `${JSON.stringify(
    {
      cliVersion: lock.cliVersion,
      files: Rec.fromEntries(
        Arr.map(
          Arr.sort(Rec.toEntries(lock.files), byPath),
          ([path, entry]) =>
            [
              path,
              {
                sha256: entry.sha256,
                strategy: entry.strategy,
                ...(entry.owned === undefined ? {} : { owned: entry.owned }),
              },
            ] as const,
        ),
      ),
    },
    null,
    2,
  )}\n`;

export const readLock = Effect.fnUntraced(function* (repo: Repo) {
  const text = yield* repo.read(LOCK_PATH);
  return text === undefined ? undefined : yield* parseLock(text);
});
