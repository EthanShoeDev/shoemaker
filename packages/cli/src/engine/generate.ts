import { Array as Arr, Record as Rec, Schema, String as Str } from 'effect';

import type { ShoemakerConfig } from '../config/schema.ts';
import { generators, renderers } from '../generators/index.ts';
import { versionOf } from '../versions.ts';
import { matchesAny } from './glob.ts';
import {
  type Aggregate,
  type Contribution,
  type GenContext,
  GeneratedFile,
} from './types.ts';

export interface GenerateOptions {
  // Replace pinned versions, e.g. point `shoemaker-*` at local tarballs
  // (`file:/tmp/packs/oxlint-config.tgz`) for end-to-end tests before publish.
  readonly versionOverrides?: Readonly<Record<string, string>>;
}

export const makeContext = (
  config: ShoemakerConfig,
  options: GenerateOptions = {},
): GenContext => ({
  config,
  pkg: (name) => `@${config.scope}/${name}`,
  version: (name) => options.versionOverrides?.[name] ?? versionOf(name),
});

const isJsonObject = Schema.is(Schema.JsonObject);

// Objects merge key by key; anything else (arrays included) is replaced.
export const deepMerge = (
  base: Schema.JsonObject,
  patch: Schema.JsonObject,
): Schema.JsonObject =>
  Rec.union(base, patch, (existing, value) =>
    isJsonObject(existing) && isJsonObject(value)
      ? deepMerge(existing, value)
      : value,
  );

const uniq = (values: ReadonlyArray<string>) => [...new Set(values)];

const aggregate = (contributions: ReadonlyArray<Contribution>): Aggregate => ({
  tasks: Arr.flatMap(contributions, (c) => c.tasks ?? []),
  env: [
    ...new Map(
      Arr.map(
        Arr.flatMap(contributions, (c) => c.env ?? []),
        (v) => [v.key, v] as const,
      ),
    ).values(),
  ],
  catalog: Arr.sort(
    uniq(Arr.flatMap(contributions, (c) => c.catalog ?? [])),
    Str.Order,
  ),
  nixPackages: uniq(Arr.flatMap(contributions, (c) => c.nixPackages ?? [])),
  gitignore: uniq(Arr.flatMap(contributions, (c) => c.gitignore ?? [])),
  ignore: uniq(Arr.flatMap(contributions, (c) => c.ignore ?? [])),
});

const mergeFiles = (
  files: ReadonlyArray<GeneratedFile>,
): ReadonlyArray<GeneratedFile> => {
  const byPath = new Map<string, GeneratedFile>();
  for (const file of files) {
    const existing = byPath.get(file.path);
    if (existing === undefined) {
      byPath.set(file.path, file);
    } else if (
      GeneratedFile.$is('Merge')(existing) &&
      GeneratedFile.$is('Merge')(file)
    ) {
      byPath.set(file.path, {
        ...existing,
        json: deepMerge(existing.json, file.json),
      });
    } else {
      throw new Error(`Two generators emitted ${file.path}`);
    }
  }
  return Arr.sort([...byPath.values()], (a: GeneratedFile, b: GeneratedFile) =>
    Str.localeCompare(b.path)(a.path),
  );
};

// Renders the full file tree for a config. Pure: no filesystem access.
export const generate = (
  config: ShoemakerConfig,
  options: GenerateOptions = {},
): {
  readonly files: ReadonlyArray<GeneratedFile>;
  readonly aggregate: Aggregate;
} => {
  const ctx = makeContext(config, options);
  const contributions = Arr.map(generators, (g) => g(ctx));
  const agg = aggregate(contributions);
  const files = Arr.map(
    Arr.filter(
      mergeFiles([
        ...Arr.flatMap(contributions, (c) => c.files ?? []),
        ...Arr.flatMap(renderers, (r) => r(ctx, agg)),
      ]),
      (file) => !config.unmanaged.includes(file.path),
    ),
    // The repo's formatter skips these, so sync writes them as rendered.
    (file) =>
      matchesAny(file.path, agg.ignore) ? { ...file, verbatim: true } : file,
  );
  return { files, aggregate: agg };
};
