import { Array as Arr, Predicate, Record as Rec, String as Str } from 'effect';

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

const isScalar = (value: Jsonc): value is string | number | boolean | null =>
  Predicate.isString(value) ||
  Predicate.isNumber(value) ||
  Predicate.isBoolean(value) ||
  Predicate.isNull(value);

const isList = (value: Jsonc): value is ReadonlyArray<Jsonc> =>
  Arr.isArray(value);

const inline = (value: Jsonc): string | undefined => {
  if (isScalar(value)) return JSON.stringify(value);
  if (value instanceof Commented) return undefined;
  if (isList(value)) {
    const items = Arr.map(value, inline);
    return Arr.every(items, Predicate.isNotUndefined)
      ? `[${Arr.join(items, ', ')}]`
      : undefined;
  }
  return Arr.every(Rec.values(value), (entry) => entry === undefined)
    ? '{}'
    : undefined;
};

const print = (
  value: Jsonc,
  indent: string,
  prefixWidth: number,
  comma: string,
): string => {
  const flat = inline(value);
  if (flat !== undefined && prefixWidth + flat.length + 1 <= WIDTH) return flat;
  const inner = `${indent}  `;
  const items = (lines: ReadonlyArray<string>) =>
    Arr.map(lines, (line, i) =>
      i === lines.length - 1 ? `${line}${comma}` : `${line},`,
    );
  if (isList(value)) {
    const lines = Arr.map(
      value,
      (item) => `${inner}${print(item, inner, inner.length, comma)}`,
    );
    return `[\n${Arr.join(items(lines), '\n')}\n${indent}]`;
  }
  if (isScalar(value) || value instanceof Commented) return flat ?? '';
  // Each entry is its comment lines plus one value line; only value lines
  // take commas.
  const entries = Arr.flatMap(Rec.toEntries(value), ([key, raw]) => {
    if (raw === undefined) return [];
    const entry = raw instanceof Commented ? raw.value : raw;
    const comments =
      raw instanceof Commented
        ? Arr.map(Str.split(raw.comment, '\n'), (line) =>
            line === '' ? `${inner}//` : `${inner}// ${line}`,
          )
        : [];
    const head = `${inner}${JSON.stringify(key)}: `;
    return [
      { comments, line: `${head}${print(entry, inner, head.length, comma)}` },
    ];
  });
  const lines = items(Arr.map(entries, (e) => e.line));
  const body = Arr.flatMap(entries, (e, i) => [...e.comments, lines[i] ?? '']);
  return `{\n${Arr.join(body, '\n')}\n${indent}}`;
};

// `.jsonc` files (turbo) take trailing commas; oxfmt prints `.json` files
// (tsconfig, .vscode, nx) without them, comments or not.
export const jsonc = (
  value: Jsonc,
  options: { readonly json?: boolean } = {},
) => `${print(value, '', 0, options.json === true ? '' : ',')}\n`;
