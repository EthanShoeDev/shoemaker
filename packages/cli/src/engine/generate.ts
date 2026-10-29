import {
  Array as Arr,
  Predicate,
  Record as Rec,
  Schema,
  String as Str,
} from 'effect';

import type { ShoeboxConfig } from '../config/schema.ts';
import { generators, renderers } from '../generators/index.ts';
import { versionOf } from '../versions.ts';
import type {
  Aggregate,
  Contribution,
  GenContext,
  GeneratedFile,
} from './types.ts';

export interface GenerateOptions {
  // Replace pinned versions, e.g. point `@shoe-box-tools/*` at local tarballs
  // (`file:/tmp/packs/oxlint-config.tgz`) for end-to-end tests before publish.
  readonly versionOverrides?: Readonly<Record<string, string>>;
}

export const makeContext = (
  config: ShoeboxConfig,
  options: GenerateOptions = {},
): GenContext => ({
  config,
  pkg: (name) => `@${config.scope}/${name}`,
  version: (name) => options.versionOverrides?.[name] ?? versionOf(name),
});

const isPlainObject = Predicate.isObject;

// oxlint-disable-next-line effecttsgo/schema-sync -- generate() is pure and synchronous; it only parses JSON its own generators emitted, so a failure is a generator bug.
const decodeJsonObject = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

// Objects merge key by key; anything else (arrays included) is replaced.
export const deepMerge = (
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Rec.toEntries(patch)) {
    const existing = out[key];
    out[key] =
      isPlainObject(existing) && isPlainObject(value)
        ? deepMerge(existing, value)
        : value;
  }
  return out;
};

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
      existing.strategy === 'json-merge' &&
      file.strategy === 'json-merge'
    ) {
      byPath.set(file.path, {
        ...existing,
        content: `${JSON.stringify(
          deepMerge(
            decodeJsonObject(existing.content),
            decodeJsonObject(file.content),
          ),
          null,
          2,
        )}\n`,
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
  config: ShoeboxConfig,
  options: GenerateOptions = {},
): {
  readonly files: ReadonlyArray<GeneratedFile>;
  readonly aggregate: Aggregate;
} => {
  const ctx = makeContext(config, options);
  const contributions = Arr.map(generators, (g) => g(ctx));
  const agg = aggregate(contributions);
  const files = Arr.filter(
    mergeFiles([
      ...Arr.flatMap(contributions, (c) => c.files ?? []),
      ...Arr.flatMap(renderers, (r) => r(ctx, agg)),
    ]),
    (file) => !config.unmanaged.includes(file.path),
  );
  return { files, aggregate: agg };
};
