import {
  Array as Arr,
  Option,
  Predicate,
  Record as Rec,
  String as Str,
} from 'effect';
import { type ParseError, parse } from 'jsonc-parser';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Predicate.isObject(value);

// Parses a JSON(C) object, or undefined when the text is not one.
export const parseJsonObject = (text: string) => {
  const errors: Array<ParseError> = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  return errors.length === 0 && isPlainObject(value) ? value : undefined;
};

const isSorted = (keys: ReadonlyArray<string>) =>
  Arr.every(
    keys,
    (key, index) => index === 0 || (keys[index - 1] ?? '') <= key,
  );

// Where a key shoebox adds goes, so an upgraded file reads like a fresh one:
// in sorted position when both sides are sorted (the catalog), else right
// after the owned key that precedes it in the generated object.
const insertionIndex = (
  keys: ReadonlyArray<string>,
  key: string,
  ownedKeys: ReadonlyArray<string>,
  sorted: boolean,
) => {
  if (sorted) {
    return Option.getOrElse(
      Arr.findFirstIndex(keys, (existing) => existing > key),
      () => keys.length,
    );
  }
  const before = Arr.reverse(ownedKeys.slice(0, ownedKeys.indexOf(key)));
  const anchor = Arr.findFirst(before, (owned) => keys.includes(owned));
  if (Option.isSome(anchor)) return keys.indexOf(anchor.value) + 1;
  const after = ownedKeys.slice(ownedKeys.indexOf(key) + 1);
  return Option.match(
    Arr.findFirst(after, (owned) => keys.includes(owned)),
    {
      onNone: () => keys.length,
      onSome: (successor) => keys.indexOf(successor),
    },
  );
};

// Existing keys keep their order and unowned keys survive. Objects merge key
// by key; anything else (arrays included) is replaced.
export const mergeJson = (
  existing: Record<string, unknown>,
  owned: Record<string, unknown>,
): Record<string, unknown> => {
  const ownedKeys = Rec.keys(owned);
  const sorted = isSorted(Rec.keys(existing)) && isSorted(ownedKeys);
  const keys = Rec.keys(existing);
  for (const key of ownedKeys) {
    if (!Rec.has(existing, key)) {
      keys.splice(insertionIndex(keys, key, ownedKeys, sorted), 0, key);
    }
  }
  return Rec.fromEntries(
    Arr.map(keys, (key) => {
      const current = existing[key];
      if (!Rec.has(owned, key)) return [key, current] as const;
      const value = owned[key];
      return [
        key,
        isPlainObject(current) && isPlainObject(value)
          ? mergeJson(current, value)
          : value,
      ] as const;
    }),
  );
};

// RFC 6901 pointers to every owned leaf: what the lock records as the key
// paths shoebox owned when it wrote the file.
const escapeKey = (key: string) =>
  Str.replaceAll('/', '~1')(Str.replaceAll('~', '~0')(key));
const unescapeKey = (key: string) =>
  Str.replaceAll('~0', '~')(Str.replaceAll('~1', '/')(key));

export const ownedPointers = (
  owned: Record<string, unknown>,
  prefix = '',
): ReadonlyArray<string> =>
  Arr.flatMap(Rec.toEntries(owned), ([key, value]) => {
    const pointer = `${prefix}/${escapeKey(key)}`;
    return isPlainObject(value) ? ownedPointers(value, pointer) : [pointer];
  });

// The owned-key tree back from pointers, in the shape `ownedProjection` reads.
export const shapeOf = (pointers: ReadonlyArray<string>) => {
  const root: Record<string, unknown> = {};
  for (const pointer of pointers) {
    const keys = Arr.map(Str.split(pointer, '/').slice(1), unescapeKey);
    let node = root;
    Arr.forEach(keys, (key, index) => {
      if (index === keys.length - 1) {
        if (!isPlainObject(node[key])) node[key] = true;
        return;
      }
      const child = node[key];
      const next = isPlainObject(child) ? child : {};
      node[key] = next;
      node = next;
    });
  }
  return root;
};

// The slice of `existing` at the key paths shoebox owns. Hashing this tells a
// hand edit of an owned value apart from keys the user added alongside.
export const ownedProjection = (
  existing: Record<string, unknown>,
  owned: Record<string, unknown>,
): Record<string, unknown> =>
  Rec.fromEntries(
    Arr.map(Rec.toEntries(owned), ([key, value]) => {
      const current = existing[key];
      return [
        key,
        isPlainObject(value) && isPlainObject(current)
          ? ownedProjection(current, value)
          : (current ?? null),
      ] as const;
    }),
  );

// Stable serialization (sorted keys) for hashing.
export const canonicalJson = (value: unknown): string => {
  if (Arr.isArray(value)) {
    return `[${Arr.join(Arr.map(value, canonicalJson), ',')}]`;
  }
  if (isPlainObject(value)) {
    const members = Arr.map(
      Arr.sort(Rec.keys(value), Str.Order),
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    );
    return `{${Arr.join(members, ',')}}`;
  }
  return JSON.stringify(value);
};

export const renderJson = (value: unknown) =>
  `${JSON.stringify(value, null, 2)}\n`;
