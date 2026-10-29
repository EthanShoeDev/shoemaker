import { Array as Arr, Option, String as Str } from 'effect';

import { renderEntry, renderInlineEntry } from './render.ts';

// Effect's indexOf/lastIndexOf take no start position, so these search a slice
// and map the result back to an index into `source`.
const indexFrom = (source: string, search: string, from: number) =>
  Option.map(Str.indexOf(search)(Str.slice(from)(source)), (at) => at + from);

// Index of the first character of the line that holds `at`.
const lineStart = (source: string, at: number) =>
  Option.match(Str.lastIndexOf('\n')(Str.slice(0, at + 1)(source)), {
    onNone: () => 0,
    onSome: (newline) => newline + 1,
  });

// The source with comment and string contents blanked (same length), so
// brackets and keys are only found in code.
const maskCode = (source: string) => {
  // Code units, so indexes line up with the source string's.
  const out = Str.split(source, '');
  let index = 0;
  const blank = (from: number, to: number) => {
    for (let at = from; at < to; at += 1) {
      if (out[at] !== '\n') out[at] = ' ';
    }
  };
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      const stop = Option.getOrElse(
        indexFrom(source, '\n', index),
        () => source.length,
      );
      blank(index, stop);
      index = stop;
    } else if (char === '/' && next === '*') {
      const stop = Option.match(indexFrom(source, '*/', index + 2), {
        onNone: () => source.length,
        onSome: (end) => end + 2,
      });
      blank(index, stop);
      index = stop;
    } else if (char === "'" || char === '"' || char === '`') {
      let at = index + 1;
      while (at < source.length && source[at] !== char) {
        at += source[at] === '\\' ? 2 : 1;
      }
      // Keep the quotes so a string still counts as a value.
      blank(index + 1, at);
      index = at + 1;
    } else {
      index += 1;
    }
  }
  return Arr.join(out, '');
};

const closingBracket = (code: string, open: number) => {
  let depth = 0;
  for (let at = open; at < code.length; at += 1) {
    const char = code[at];
    if (char === '[' || char === '{' || char === '(') depth += 1;
    if (char === ']' || char === '}' || char === ')') {
      depth -= 1;
      if (depth === 0) return char === ']' ? at : undefined;
    }
  }
  return undefined;
};

const lastCodeChar = (code: string, before: number) => {
  for (let at = before - 1; at >= 0; at -= 1) {
    const char = code[at];
    if (char === undefined || Str.trim(char) !== '') return at;
  }
  return -1;
};

// Appends `entry` to the one `key: [...]` array literal in a
// shoebox.config.ts source, leaving every other byte alone. Undefined when
// that literal is not there exactly once (a const, a spread, a computed
// value): the caller then asks the user to make the edit.
export const insertListEntry = (
  source: string,
  key: 'apps' | 'packages',
  entry: { readonly name: string; readonly kind: string },
) => {
  const code = maskCode(source);
  const matches = [
    ...Str.matchAll(new RegExp(String.raw`(?<![\w$.])${key}\s*:\s*\[`, 'gu'))(
      code,
    ),
  ];
  const [match] = matches;
  // matchAll always sets `index`; Effect types matches as RegExpMatchArray.
  if (match?.index === undefined || matches.length !== 1) return undefined;
  const open = match.index + match[0].length - 1;
  const close = closingBracket(code, open);
  if (close === undefined) return undefined;
  const indent =
    /^[ \t]*/u.exec(Str.slice(lineStart(source, match.index))(source))?.[0] ??
    '';
  const last = lastCodeChar(code, close);
  if (last === open) {
    // Only comments inside: there is no telling where the entry belongs.
    if (Str.trim(Str.slice(open + 1, close)(source)) !== '') return undefined;
    return `${Str.slice(0, open)(source)}[\n${renderEntry(entry, `${indent}  `)}\n${indent}]${Str.slice(close + 1)(source)}`;
  }
  const comma = code[last] === ',' ? '' : ',';
  const closeLine = lineStart(source, close);
  if (closeLine > last && Str.trim(Str.slice(closeLine, close)(code)) === '') {
    // Match the existing items' indent (the line of the last one).
    const lastLine = Str.slice(lineStart(source, last))(source);
    const itemIndent = /^[ \t]*/u.exec(lastLine)?.[0] ?? '';
    const at = itemIndent.length > indent.length ? itemIndent : `${indent}  `;
    return `${Str.slice(0, last + 1)(source)}${comma}${Str.slice(last + 1, closeLine)(source)}${renderEntry(entry, at)}\n${Str.slice(closeLine)(source)}`;
  }
  const inline = renderInlineEntry(entry);
  return `${Str.slice(0, last + 1)(source)}${comma === '' ? ` ${inline},` : `, ${inline}`}${Str.slice(last + 1)(source)}`;
};
