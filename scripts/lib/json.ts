import {
  Array as Arr,
  Effect,
  FileSystem,
  Predicate,
  Record as Rec,
  Schema,
} from 'effect';

import { renderJson } from '../../packages/cli/src/engine/json.ts';

const JsonObject = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Unknown),
);

// package.json and friends as plain objects: unknown keys are kept, so a
// read-modify-write round trip never drops fields.
export const readJsonObject = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(file);
  return { ...(yield* Schema.decodeEffect(JsonObject)(raw)) };
});

export const stringRecord = (value: unknown): Record<string, string> =>
  Predicate.isObject(value)
    ? Rec.fromEntries(
        Arr.filter(Rec.toEntries(value), (entry): entry is [string, string] =>
          Predicate.isString(entry[1]),
        ),
      )
    : {};

export const writeJson = Effect.fnUntraced(function* (
  file: string,
  value: unknown,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(file, renderJson(value));
});
