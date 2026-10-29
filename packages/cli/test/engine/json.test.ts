import { assert, describe, it } from '@effect/vitest';
import { Record as Rec } from 'effect';

import {
  canonicalJson,
  mergeJson,
  ownedPointers,
  keepRaisedVersions,
  maskVersions,
  ownedProjection,
  parseJsonObject,
  shapeOf,
} from '../../src/engine/json.ts';

describe('json-merge', () => {
  const existing = {
    name: '@x/web',
    private: true,
    scripts: { dev: 'vite', custom: 'echo hi' },
    dependencies: { react: 'catalog:', mine: '1.0.0' },
    files: ['a'],
  };
  const owned = {
    name: '@x/web',
    scripts: { dev: 'vite dev', typecheck: 'tsc --noEmit' },
    dependencies: { react: 'catalog:' },
    files: ['dist'],
    type: 'module',
  };

  it('preserves existing key order and unowned keys', () => {
    const merged = mergeJson(existing, owned);
    assert.deepStrictEqual(Rec.keys(merged), [
      'name',
      'private',
      'scripts',
      'dependencies',
      'files',
      'type',
    ]);
    assert.deepStrictEqual(merged.scripts, {
      dev: 'vite dev',
      custom: 'echo hi',
      typecheck: 'tsc --noEmit',
    });
    assert.deepStrictEqual(merged.dependencies, {
      react: 'catalog:',
      mine: '1.0.0',
    });
    // Arrays are replaced, not concatenated.
    assert.deepStrictEqual(merged.files, ['dist']);
  });

  it('projects only owned key paths', () => {
    assert.deepStrictEqual(ownedProjection(existing, owned), {
      name: '@x/web',
      scripts: { dev: 'vite', typecheck: null },
      dependencies: { react: 'catalog:' },
      files: ['a'],
      type: null,
    });
  });

  it('keeps dependency versions a repo has raised', () => {
    const owned = {
      version: '0.0.0',
      dependencies: { a: '^1.2.0', b: '^1.2.0', c: 'catalog:', d: '1.0.0' },
      workspaces: { catalog: { e: '2.0.0-beta.84' } },
    };
    const existing = {
      version: '9.9.9',
      dependencies: { a: '^1.3.0', b: '^1.1.0', c: '^5.0.0', d: '~1.0.1' },
      workspaces: { catalog: { e: '2.0.0-beta.100' } },
    };
    assert.deepStrictEqual(keepRaisedVersions(owned, existing), {
      // Outside a dependency map a version is an ordinary value.
      version: '0.0.0',
      // Raised specs stay; lower ones and non-version specs take shoemaker's.
      dependencies: { a: '^1.3.0', b: '^1.2.0', c: 'catalog:', d: '~1.0.1' },
      workspaces: { catalog: { e: '2.0.0-beta.100' } },
    });
  });

  it('masks only version specs inside dependency maps', () => {
    assert.deepStrictEqual(
      maskVersions({
        version: '1.0.0',
        devDependencies: { a: '^1.0.0', b: 'catalog:' },
        catalogs: { react: { react: '19.3.0' } },
      }),
      {
        version: '1.0.0',
        devDependencies: { a: '<version>', b: 'catalog:' },
        catalogs: { react: { react: '<version>' } },
      },
    );
  });

  it('canonical JSON ignores key order', () => {
    assert.strictEqual(
      canonicalJson({ b: 1, a: { d: 2, c: [3] } }),
      canonicalJson({ a: { c: [3], d: 2 }, b: 1 }),
    );
  });

  it('parses JSONC objects only', () => {
    assert.deepStrictEqual(parseJsonObject('{ "a": 1, // c\n }'), { a: 1 });
    assert.strictEqual(parseJsonObject('[1]'), undefined);
    assert.strictEqual(parseJsonObject('{ nope'), undefined);
  });

  it('inserts new keys where a fresh render would put them', () => {
    // Sorted on both sides (the catalog): sorted position, around user keys.
    const catalog = mergeJson(
      { a: '1', c: 'mine', d: '1' },
      { a: '1', b: '2', d: '1', e: '2' },
    );
    assert.deepStrictEqual(Rec.keys(catalog), ['a', 'b', 'c', 'd', 'e']);
    // Otherwise right after the owned key that precedes it.
    const scripts = mergeJson(
      { build: 'x', mine: 'y', test: 'z' },
      { build: 'x', typecheck: 'tsc', test: 'z' },
    );
    assert.deepStrictEqual(Rec.keys(scripts), [
      'build',
      'typecheck',
      'mine',
      'test',
    ]);
  });

  it('records owned key paths as pointers and reads them back', () => {
    const pointers = ownedPointers({
      name: 'x',
      workspaces: { catalog: { '@effect/vitest': '1', 'a~b': '2' } },
    });
    assert.deepStrictEqual(pointers, [
      '/name',
      '/workspaces/catalog/@effect~1vitest',
      '/workspaces/catalog/a~0b',
    ]);
    assert.deepStrictEqual(shapeOf(pointers), {
      name: true,
      workspaces: { catalog: { '@effect/vitest': true, 'a~b': true } },
    });
  });
});
