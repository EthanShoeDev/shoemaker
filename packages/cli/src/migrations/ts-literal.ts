import {
  Array as Arr,
  pipe,
  Predicate,
  Record as Rec,
  String as Str,
} from 'effect';
import * as Jsonc from 'jsonc-parser';

// JSON(C) -> TypeScript object literal, carrying each entry's comments along.
// Comments are keyed by JSON path (`rules\0eqeqeq`, `ignorePatterns\03`).

export type Comments = ReadonlyMap<string, ReadonlyArray<string>>;
type Path = ReadonlyArray<string | number>;

export const pathKey = (path: Path) => Arr.join(Arr.map(path, String), '\0');

export const collectComments = (text: string): Comments => {
  const comments: Array<{ start: number; end: number; text: string }> = [];
  Jsonc.visit(text, {
    onComment: (offset, length) => {
      comments.push({
        start: offset,
        end: offset + length,
        text: Str.slice(offset, offset + length)(text),
      });
    },
  });
  const result = new Map<string, Array<string>>();
  const add = (path: Path, comment: string) => {
    const key = pathKey(path);
    result.set(key, [...(result.get(key) ?? []), comment]);
  };
  const walk = (node: Jsonc.Node, path: Path) => {
    if (node.type !== 'object' && node.type !== 'array') return;
    let cursor = node.offset + 1;
    let previous: Path | undefined;
    Arr.forEach(node.children ?? [], (child, index) => {
      const raw: unknown =
        node.type === 'object' ? child.children?.[0]?.value : index;
      if (!Predicate.isString(raw) && !Predicate.isNumber(raw)) return;
      const key = raw;
      const childPath = [...path, key];
      for (const comment of comments) {
        if (comment.start < cursor || comment.end > child.offset) continue;
        // A comment on the previous entry's line trails that entry.
        const trailing =
          previous !== undefined &&
          !pipe(text, Str.slice(cursor, comment.start), Str.includes('\n'));
        add(
          trailing && previous !== undefined ? previous : childPath,
          comment.text,
        );
      }
      const value = node.type === 'object' ? child.children?.[1] : child;
      if (value !== undefined) walk(value, childPath);
      cursor = child.offset + child.length;
      previous = childPath;
    });
  };
  const tree = Jsonc.parseTree(text);
  if (tree !== undefined) walk(tree, []);
  return result;
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

export const quote = (value: string) =>
  `'${pipe(
    value,
    Str.replaceAll('\\', '\\\\'),
    Str.replaceAll("'", String.raw`\'`),
    Str.replaceAll('\n', String.raw`\n`),
  )}'`;

const keyOf = (key: string) => (IDENTIFIER.test(key) ? key : quote(key));

export const toTs = (
  value: unknown,
  comments: Comments = new Map(),
  path: Path = [],
  depth = 1,
): string => {
  const pad = Str.repeat(depth)('  ');
  const close = Str.repeat(depth - 1)('  ');
  const lead = (childPath: Path) =>
    Arr.join(
      Arr.map(
        comments.get(pathKey(childPath)) ?? [],
        (comment) => `${pad}${comment}\n`,
      ),
      '',
    );
  if (Predicate.isString(value)) return quote(value);
  if (Predicate.isNumber(value) || Predicate.isBoolean(value) || value === null)
    return String(value);
  if (Arr.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = Arr.map(value, (item: unknown, index) => {
      const childPath = [...path, index];
      return `${lead(childPath)}${pad}${toTs(item, comments, childPath, depth + 1)},\n`;
    });
    return `[\n${Arr.join(items, '')}${close}]`;
  }
  if (Predicate.isObject(value)) {
    const entries = Rec.toEntries(value);
    if (entries.length === 0) return '{}';
    const items = Arr.map(entries, ([key, item]) => {
      const childPath = [...path, key];
      return `${lead(childPath)}${pad}${keyOf(key)}: ${toTs(item, comments, childPath, depth + 1)},\n`;
    });
    return `{\n${Arr.join(items, '')}${close}}`;
  }
  return 'undefined';
};

// Renders `{ key: value, ... }` from already-rendered entries (in order).
export const objectLiteral = (
  entries: ReadonlyArray<readonly [string, string, ReadonlyArray<string>?]>,
  depth = 1,
) => {
  const pad = Str.repeat(depth)('  ');
  const lines = Arr.map(
    entries,
    ([key, rendered, notes = []]) =>
      `${Arr.join(
        Arr.map(notes, (note) => `${pad}${note}\n`),
        '',
      )}${pad}${keyOf(key)}: ${rendered},\n`,
  );
  return `{\n${Arr.join(lines, '')}${Str.repeat(depth - 1)('  ')}}`;
};
