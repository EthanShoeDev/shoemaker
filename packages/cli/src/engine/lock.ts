import {
  Array as Arr,
  Effect,
  Order,
  Record as Rec,
  Result,
  Schema,
  String as Str,
} from 'effect';
import { Json5 } from 'effect/encoding';

import type { Repo } from './repo.ts';

export const LOCK_PATH = 'shoemaker.lock.jsonc';

const Strategy = Schema.Literals(['owned', 'seed', 'managed', 'json-merge']);

export const LockEntry = Schema.Struct({
  // Fingerprint of what shoemaker last wrote (see plan.ts `fingerprint`).
  sha256: Schema.String,
  strategy: Strategy,
  // What the fingerprint covered when it was taken: region ids (managed) or
  // owned key pointers (json-merge). Locks written before this was recorded
  // lack it; their fingerprints cover the current generator's set instead.
  owned: Schema.String.pipe(Schema.Array, Schema.optional),
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
  // Json5 for its trailing commas; Effect's Jsonc rejects them.
  const parsed = Json5.parse(text);
  if (Result.isFailure(parsed)) {
    return yield* LockParseError.make({
      message: `${LOCK_PATH} is not valid JSONC`,
    });
  }
  return yield* decodeLock(parsed.success).pipe(
    Effect.mapError((issue) =>
      LockParseError.make({ message: `${LOCK_PATH}: ${issue.message}` }),
    ),
  );
});

const byPath = Order.mapInput(
  (a: string, b: string) => Str.localeCompare(b)(a),
  ([path]: readonly [string, LockEntry]) => path,
);

const LockText = Schema.fromJsonString(Lock, { space: 2 });

// Files sorted by path so the lock diffs cleanly.
export const renderLock = (lock: Lock) =>
  Effect.map(
    Schema.encodeEffect(LockText)({
      ...lock,
      files: Rec.fromEntries(Arr.sort(Rec.toEntries(lock.files), byPath)),
    }),
    (text) => `${text}\n`,
  );

export const readLock = Effect.fnUntraced(function* (repo: Repo) {
  const text = yield* repo.read(LOCK_PATH);
  return text === undefined ? undefined : yield* parseLock(text);
});
