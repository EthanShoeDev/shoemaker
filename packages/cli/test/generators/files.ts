import { assert } from '@effect/vitest';
import {
  Array as Arr,
  Effect,
  Predicate,
  Record as Rec,
  Result,
  Schema,
} from 'effect';

import { renderFile } from '../../src/engine/format.ts';
import { renderJson } from '../../src/engine/json.ts';
import { GeneratedFile } from '../../src/engine/types.ts';
import {
  Commented,
  isList,
  isScalar,
  type Jsonc,
} from '../../src/generators/task-runner/jsonc.ts';

// Accessors for what generators emit, so tests read values instead of
// parsing text the engine has not rendered yet.

export const textOf = (file: GeneratedFile) => {
  assert.isTrue(GeneratedFile.$is('Text')(file), `${file.path} is a text file`);
  return GeneratedFile.$is('Text')(file) ? file.content : '';
};

// A JSONC tree as the JSON it prints, comments dropped.
const plainJsonc = (value: Jsonc): Schema.Json => {
  if (value instanceof Commented) return plainJsonc(value.value);
  if (isScalar(value)) return value;
  if (isList(value)) return Arr.map(value, plainJsonc);
  return Rec.filterMap(value, (entry) =>
    entry === undefined ? Result.failVoid : Result.succeed(plainJsonc(entry)),
  );
};

export const jsonOf = GeneratedFile.$match({
  Text: (file): Schema.Json => assert.fail(`${file.path} is not JSON`),
  Json: (file) => file.json,
  Merge: (file) => file.json,
  Jsonc: (file) => plainJsonc(file.jsonc),
});

const isJsonObject = Schema.is(Schema.JsonObject);

// A JSON object, or `{}` when the value is absent or not an object.
export const record = (
  value: Schema.Json | undefined,
): Readonly<Record<string, Schema.Json>> => (isJsonObject(value) ? value : {});

// A JSON string field; the assertion fails for anything else.
export const stringOf = (value: Schema.Json | undefined) => {
  assert.isString(value);
  return Predicate.isString(value) ? value : '';
};

// Generated files by path, read as text or as a JSON object.
export const lookup = (files: ReadonlyArray<GeneratedFile>) => {
  const byPath = new Map(Arr.map(files, (file) => [file.path, file] as const));
  const file = (path: string) => {
    const found = byPath.get(path);
    if (found === undefined) throw new Error(`${path} was not generated`);
    return found;
  };
  return {
    byPath,
    file,
    text: (path: string) => textOf(file(path)),
    json: (path: string) => record(jsonOf(file(path))),
  };
};

// The text sync renders for `file`, before formatting.
export const printed = Effect.fnUntraced(function* (file: GeneratedFile) {
  const rendered = yield* renderFile(file);
  return GeneratedFile.$is('Text')(rendered)
    ? rendered.content
    : yield* renderJson(rendered.json);
});
