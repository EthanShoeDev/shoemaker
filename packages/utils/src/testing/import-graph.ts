import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Path,
  Record as Rec,
  String as Str,
} from 'effect';

// What one entry's files are and what they may import (design.md, decision 7).
export interface Entry {
  // Files of this entry: paths under `src`, or folders ending in `/`.
  readonly owns: ReadonlyArray<string>;
  readonly entries: ReadonlyArray<string>;
  // Packages, each with its subpaths where none is named.
  readonly packages: ReadonlyArray<string>;
}

export type Rules = Readonly<Record<string, Entry>>;

interface Import {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

// The formatter leaves one form of each. `import { type A }` is no type-only
// import: under `verbatimModuleSyntax` the module is still loaded.
const STATIC =
  /^(?:import|export)\s+(type\s+)?(?:[\w*{][^'"]*?\sfrom\s+)?'([^']+)'/gmu;
const DYNAMIC = /\bimport\(\s*'([^']+)'/gu;

export const importsIn = (source: string): ReadonlyArray<Import> => [
  ...Arr.map([...Str.matchAll(STATIC)(source)], (match) => ({
    specifier: match[2] ?? '',
    typeOnly: match[1] !== undefined,
  })),
  ...Arr.map([...Str.matchAll(DYNAMIC)(source)], (match) => ({
    specifier: match[1] ?? '',
    typeOnly: false,
  })),
];

const ownerOf = (rules: Rules, file: string) =>
  Arr.findFirst(Rec.toEntries(rules), ([, entry]) =>
    Arr.some(entry.owns, (owned) =>
      Str.endsWith('/')(owned) ? Str.startsWith(owned)(file) : file === owned,
    ),
  ).pipe(Option.map(([name]) => name));

const isPackage = (specifier: string, name: string) =>
  specifier === name || Str.startsWith(`${name}/`)(specifier);

// Every import an entry's files may not make, types included: a declaration
// file asks for them all the same. Follows relative imports from each entry.
export const violations = Effect.fnUntraced(function* (
  rules: Rules,
  root: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const found: Array<string> = [];
  for (const [name, entry] of Rec.toEntries(rules)) {
    const pending = [`${name}.ts`];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const file = pending.pop() ?? '';
      if (seen.has(file)) continue;
      seen.add(file);
      const owner = ownerOf(rules, file);
      if (Option.isNone(owner)) {
        found.push(`${file} belongs to no entry`);
        continue;
      }
      if (owner.value !== name && !entry.entries.includes(owner.value)) {
        found.push(`${name} reaches ${file} of ${owner.value}`);
        continue;
      }
      const source = yield* fs.readFileString(path.join(root, file));
      for (const { specifier } of importsIn(source)) {
        if (Str.startsWith('.')(specifier)) {
          pending.push(
            path.relative(
              root,
              path.resolve(root, path.dirname(file), specifier),
            ),
          );
        } else if (
          !Arr.some(entry.packages, (allowed) => isPackage(specifier, allowed))
        ) {
          found.push(`${name} reaches '${specifier}' in ${file}`);
        }
      }
    }
  }
  return Arr.dedupe(found);
});
