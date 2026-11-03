import { assert } from '@effect/vitest';
import { Array as Arr, Effect, Record as Rec, String as Str } from 'effect';
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
import { jsonOf, lookup, record, textOf } from '../files.ts';

export const sampleConfig = (
  overrides: Partial<ShoemakerConfig> = {},
): ShoemakerConfig => ({
  ...defaultConfig('sample'),
  ...overrides,
});

export const contribute = (generator: Generator, config: ShoemakerConfig) => {
  const contribution = generator(makeContext(config));
  const files = contribution.files ?? [];
  return { contribution, files, ...lookup(files) };
};

export const assertStrategies = (
  byPath: ReadonlyMap<string, GeneratedFile>,
  expected: ReadonlyArray<readonly [string, FileStrategy]>,
) => {
  for (const [path, strategy] of expected) {
    assert.strictEqual(byPath.get(path)?.strategy, strategy, path);
  }
};

// Every `catalog:` dependency in an emitted package.json is listed in the
// contribution's catalog, and every catalog name has a pinned version.
export const assertCatalogComplete = (contribution: Contribution) => {
  const catalog = new Set(contribution.catalog);
  for (const file of contribution.files ?? []) {
    if (!Str.endsWith('package.json')(file.path)) continue;
    const manifest = record(jsonOf(file));
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
      Effect.promise(() => format(file.path, textOf(file), {})).pipe(
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
