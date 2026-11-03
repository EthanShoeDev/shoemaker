import {
  Array as Arr,
  Effect,
  Predicate,
  Record as Rec,
  Result,
  type Schema,
  String as Str,
} from 'effect';

import { encodeJson } from '../../engine/json.ts';

// A tiny JSONC printer that writes the layout oxfmt would: objects always
// expanded, arrays inline when they fit in 80 columns, trailing commas, and
// `//` comments above keys. turbo.jsonc, nx.json and .vscode/*.json use it.

export type Jsonc =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<Jsonc>
  | Commented
  | { readonly [key: string]: Jsonc | undefined };

export class Commented {
  constructor(
    readonly comment: string,
    readonly value: Jsonc,
  ) {}
}

// Renders `comment` (may span lines) as `//` lines above the key holding it.
export const commented = (comment: string, value: Jsonc) =>
  new Commented(comment, value);

const WIDTH = 80;

export const isScalar = (
  value: Jsonc,
): value is string | number | boolean | null =>
  Predicate.isString(value) ||
  Predicate.isNumber(value) ||
  Predicate.isBoolean(value) ||
  Predicate.isNull(value);

export const isList = (value: Jsonc): value is ReadonlyArray<Jsonc> =>
  Arr.isArray(value);

const inline = Effect.fnUntraced(function* (
  value: Jsonc,
): Effect.fn.Return<string | undefined, Schema.SchemaError> {
  if (isScalar(value)) return yield* encodeJson(value);
  if (value instanceof Commented) return undefined;
  if (isList(value)) {
    const items = yield* Effect.forEach(value, inline);
    return Arr.every(items, Predicate.isNotUndefined)
      ? `[${Arr.join(items, ', ')}]`
      : undefined;
  }
  return Arr.every(Rec.values(value), (entry) => entry === undefined)
    ? '{}'
    : undefined;
});

const print = Effect.fnUntraced(function* (
  value: Jsonc,
  indent: string,
  prefixWidth: number,
  comma: string,
): Effect.fn.Return<string, Schema.SchemaError> {
  const flat = yield* inline(value);
  if (flat !== undefined && prefixWidth + flat.length + 1 <= WIDTH) return flat;
  const inner = `${indent}  `;
  const items = (lines: ReadonlyArray<string>) =>
    Arr.map(lines, (line, i) =>
      i === lines.length - 1 ? `${line}${comma}` : `${line},`,
    );
  if (isList(value)) {
    const lines = yield* Effect.forEach(value, (item) =>
      Effect.map(
        print(item, inner, inner.length, comma),
        (printed) => `${inner}${printed}`,
      ),
    );
    return `[\n${Arr.join(items(lines), '\n')}\n${indent}]`;
  }
  if (isScalar(value) || value instanceof Commented) return flat ?? '';
  // Each entry is its comment lines plus one value line; only value lines
  // take commas.
  const entries = yield* Effect.forEach(
    Arr.filterMap(Rec.toEntries(value), ([key, raw]) =>
      raw === undefined ? Result.failVoid : Result.succeed([key, raw] as const),
    ),
    Effect.fnUntraced(function* ([key, raw]: readonly [string, Jsonc]) {
      const entry = raw instanceof Commented ? raw.value : raw;
      const comments =
        raw instanceof Commented
          ? Arr.map(Str.split(raw.comment, '\n'), (line) =>
              line === '' ? `${inner}//` : `${inner}// ${line}`,
            )
          : [];
      const quoted = yield* encodeJson(key);
      const head = `${inner}${quoted}: `;
      const printed = yield* print(entry, inner, head.length, comma);
      return { comments, line: `${head}${printed}` };
    }),
  );
  const lines = items(Arr.map(entries, (e) => e.line));
  const body = Arr.flatMap(entries, (e, i) => [...e.comments, lines[i] ?? '']);
  return `{\n${Arr.join(body, '\n')}\n${indent}}`;
});

// `.jsonc` files (turbo) take trailing commas; oxfmt prints `.json` files
// (tsconfig, .vscode, nx) without them, comments or not.
export const printJsonc = (value: Jsonc, trailingCommas: boolean) =>
  Effect.map(
    print(value, '', 0, trailingCommas ? ',' : ''),
    (text) => `${text}\n`,
  );
