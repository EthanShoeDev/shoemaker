import { assert } from '@effect/vitest';
import {
  Array as Arr,
  Effect,
  Record as Rec,
  Schema,
  String as Str,
} from 'effect';
import { format } from 'oxfmt';

import {
  defaultConfig,
  type ShoemakerConfig,
} from '../../../src/config/schema.ts';
import { makeContext } from '../../../src/engine/generate.ts';
import type {
  Contribution,
  FileStrategy,
  GeneratedFile,
  Generator,
} from '../../../src/engine/types.ts';
import { versionOf } from '../../../src/versions.ts';

export const sampleConfig = (
  overrides: Partial<ShoemakerConfig> = {},
): ShoemakerConfig => ({
  ...defaultConfig('sample'),
  ...overrides,
});

export const contribute = (generator: Generator, config: ShoemakerConfig) => {
  const contribution = generator(makeContext(config));
  const files = contribution.files ?? [];
  const byPath = new Map(Arr.map(files, (file) => [file.path, file] as const));
  const file = (path: string): GeneratedFile => {
    const found = byPath.get(path);
    if (found === undefined) throw new Error(`${path} was not generated`);
    return found;
  };
  return { contribution, files, byPath, file };
};

export const assertStrategies = (
  byPath: ReadonlyMap<string, GeneratedFile>,
  expected: ReadonlyArray<readonly [string, FileStrategy]>,
) => {
  for (const [path, strategy] of expected) {
    assert.strictEqual(byPath.get(path)?.strategy, strategy, path);
  }
};

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

// A JSON object field, or `{}` when it is absent or not an object.
export const record = (value: unknown): Readonly<Record<string, unknown>> =>
  Schema.is(JsonObject)(value) ? value : {};

// Every `catalog:` dependency in an emitted package.json is listed in the
// contribution's catalog, and every catalog name has a pinned version.
export const assertCatalogComplete = (contribution: Contribution) => {
  const catalog = new Set(contribution.catalog);
  for (const file of contribution.files ?? []) {
    if (!Str.endsWith('package.json')(file.path)) continue;
    const manifest = record(JSON.parse(file.content));
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name, spec] of Rec.toEntries(record(manifest[field]))) {
        if (spec !== 'catalog:') continue;
        assert.isTrue(
          catalog.has(name),
          `${file.path}: ${name} not in catalog`,
        );
      }
    }
  }
  for (const name of catalog) assert.isString(versionOf(name));
};

const isSource = (path: string) => /\.(?:ts|tsx)$/u.test(path);

// oxfmt parses before it formats, so a syntax error in a template surfaces as
// a format error.
export const assertSourcesParse = (files: ReadonlyArray<GeneratedFile>) =>
  Effect.forEach(
    Arr.filter(files, (file) => isSource(file.path)),
    (file) =>
      Effect.promise(() => format(file.path, file.content, {})).pipe(
        Effect.tap((result) =>
          Effect.sync(() =>
            assert.deepStrictEqual(
              Arr.map(result.errors, (error) => error.message),
              [],
              file.path,
            ),
          ),
        ),
      ),
    { discard: true },
  );

export const parseJson = (file: GeneratedFile) =>
  record(JSON.parse(file.content));
