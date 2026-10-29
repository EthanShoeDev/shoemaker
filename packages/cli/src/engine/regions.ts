// `shoebox:begin <id>` / `shoebox:end <id>` regions inside managed files. The
// markers sit in `//`, `#` or `<!-- -->` comments (see `region()` in
// generators/shared.ts). A region body is the lines between its markers.
// Text is expected with LF line endings (plan.ts normalises CRLF first).

import { Array as Arr, Option, pipe, String as Str } from 'effect';

const MARKER =
  /^\s*(?:\/\/|#|<!--)\s*shoebox:(?<kind>begin|end)\s+(?<id>[^\s>]+?)\s*(?:-->)?\s*$/u;

const FENCE = /^ {0,3}(?<fence>`{3,}|~{3,})/u;

export interface Region {
  readonly id: string;
  readonly body: string;
  // Line indexes of the begin and end markers.
  readonly begin: number;
  readonly end: number;
}

export interface RegionOptions {
  // Markdown: markers inside ``` / ~~~ fences are examples, not regions.
  readonly fences?: boolean;
}

export const isMarkdown = (path: string) => /\.mdx?$/iu.test(path);

const closesFence = (line: string, fence: string) =>
  new RegExp(
    String.raw`^ {0,3}${Str.startsWith('`')(fence) ? '`' : '~'}{${fence.length},}\s*$`,
    'u',
  ).test(line);

// Regions with a matching begin/end pair. Unbalanced or nested markers are
// ignored, so they surface as missing regions (a conflict) rather than as a
// guess about what the user meant.
export const parseRegions = (
  text: string,
  options: RegionOptions = {},
): ReadonlyArray<Region> => {
  const lines = Str.split(text, '\n');
  const regions: Array<Region> = [];
  let open: { readonly id: string; readonly begin: number } | undefined;
  let fence: string | undefined;
  Arr.forEach(lines, (line, index) => {
    if (options.fences === true) {
      if (fence !== undefined) {
        if (closesFence(line, fence)) fence = undefined;
        return;
      }
      const opened = FENCE.exec(line)?.groups?.fence;
      if (opened !== undefined) {
        fence = opened;
        return;
      }
    }
    const match = MARKER.exec(line);
    const id = match?.groups?.id;
    if (id === undefined) return;
    if (match?.groups?.kind === 'begin') {
      open = { id, begin: index };
    } else if (open !== undefined && open.id === id) {
      regions.push({
        id,
        begin: open.begin,
        end: index,
        body: Arr.join(lines.slice(open.begin + 1, index), '\n'),
      });
      open = undefined;
    }
  });
  return regions;
};

// First occurrence wins; duplicated ids are reported by `replaceRegions`.
export const regionBodies = (text: string, options: RegionOptions = {}) => {
  const bodies = new Map<string, string>();
  for (const r of parseRegions(text, options)) {
    if (!bodies.has(r.id)) bodies.set(r.id, r.body);
  }
  return bodies;
};

export const regionIds = (text: string, options: RegionOptions = {}) => [
  ...regionBodies(text, options).keys(),
];

export interface RegionReplacement {
  readonly content: string;
  // Region ids the generated file has but the file on disk lacks.
  readonly missing: ReadonlyArray<string>;
  // Generated region ids that occur more than once on disk.
  readonly duplicates: ReadonlyArray<string>;
}

// The generated lines of each region, markers excluded. Lines, not the joined
// body, so an empty body (one blank line) and no body stay distinct and a
// freshly written file is a fixed point.
const regionLines = (text: string, options: RegionOptions) => {
  const lines = Str.split(text, '\n');
  const out = new Map<string, ReadonlyArray<string>>();
  for (const r of parseRegions(text, options)) {
    if (!out.has(r.id)) out.set(r.id, lines.slice(r.begin + 1, r.end));
  }
  return out;
};

// Rewrites the bodies of `existing`'s regions with `generated`'s. Text outside
// regions, and regions shoebox no longer generates, are left alone.
export const replaceRegions = (
  existing: string,
  generated: string,
  options: RegionOptions = {},
): RegionReplacement => {
  const wanted = regionLines(generated, options);
  const found = parseRegions(existing, options);
  const lines = Str.split(existing, '\n');
  const out: Array<string> = [];
  let cursor = 0;
  for (const region of found) {
    const body = wanted.get(region.id);
    if (body === undefined) continue;
    out.push(...lines.slice(cursor, region.begin + 1), ...body);
    cursor = region.end;
  }
  out.push(...lines.slice(cursor));
  const counts = new Map<string, number>();
  for (const r of found) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
  return {
    content: Arr.join(out, '\n'),
    missing: Arr.filter([...wanted.keys()], (id) => !counts.has(id)),
    duplicates: Arr.filter(
      [...wanted.keys()],
      (id) => (counts.get(id) ?? 0) > 1,
    ),
  };
};

// Adds generated regions `ids` that `existing` lacks, each after the region
// that precedes it in the generated file (else at the end). Nothing already in
// `existing` is moved or dropped.
export const insertRegions = (
  existing: string,
  generated: string,
  ids: ReadonlyArray<string>,
  options: RegionOptions = {},
) => {
  const source = Str.split(generated, '\n');
  const order = parseRegions(generated, options);
  let content = existing;
  for (const id of ids) {
    const found = Arr.findFirstIndex(order, (r) => r.id === id);
    if (Option.isNone(found)) continue;
    const index = found.value;
    const region = order[index];
    if (region === undefined) continue;
    const block = source.slice(region.begin, region.end + 1);
    const spaced = Option.exists(
      Arr.get(source, region.begin - 1),
      (line) => Str.trim(line) === '',
    )
      ? ['', ...block]
      : block;
    const present = parseRegions(content, options);
    const anchor = pipe(
      Arr.reverse(order.slice(0, index)),
      Arr.findFirst((before) =>
        Arr.findFirst(present, (r) => r.id === before.id),
      ),
    );
    const lines = Str.split(content, '\n');
    if (Option.isNone(anchor)) {
      // Before the trailing newline, so the file still ends with one.
      const end = lines.at(-1) === '' ? lines.length - 1 : lines.length;
      const blank =
        end === 0 ||
        Option.exists(Arr.get(lines, end - 1), (line) => Str.trim(line) === '');
      lines.splice(end, 0, ...(blank ? block : spaced));
    } else {
      lines.splice(anchor.value.end + 1, 0, ...spaced);
    }
    content = Arr.join(lines, '\n');
  }
  return content;
};
