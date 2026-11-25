import { assert, describe, it } from '@effect/vitest';

import {
  admits,
  editJson,
  isNewerVersion,
  kebab,
  majorOf,
} from '../../src/checks/workspace.ts';

describe('versions in specs', () => {
  it('compares across operators, partial versions and prereleases', () => {
    assert.isTrue(isNewerVersion('^1.2.4', '~1.2.3'));
    assert.isTrue(isNewerVersion('2', '1.9.9'));
    assert.isFalse(isNewerVersion('1.2.3', '^1.2.3'));
    assert.isTrue(isNewerVersion('4.0.0-beta.10', '4.0.0-beta.9'));
    assert.isTrue(isNewerVersion('4.0.0', '4.0.0-beta.9'));
    assert.isFalse(isNewerVersion('latest', '1.0.0'));
  });

  it('checks ranges, and lets specs that are not ranges through', () => {
    assert.isTrue(admits('^0.2.0', '0.2.9'));
    assert.isFalse(admits('^0.1.0', '0.2.9'));
    assert.isFalse(admits('^4.0.0', '4.1.0-beta.2'));
    assert.isTrue(admits('latest', '0.2.9'));
  });

  it('reads a major', () => {
    assert.strictEqual(majorOf('^7'), 7);
    assert.strictEqual(majorOf('>=3.1'), 3);
    assert.strictEqual(majorOf('latest'), undefined);
  });
});

describe('kebab', () => {
  it('splits words but not digits, and drops what names cannot have', () => {
    assert.strictEqual(kebab('fooBar baz'), 'foo-bar-baz');
    assert.strictEqual(kebab('web2'), 'web2');
    assert.strictEqual(kebab('9lives'), 'x-9lives');
    assert.strictEqual(kebab('café_app'), 'caf-app');
  });
});

describe('editJson', () => {
  it('keeps key order, line endings and the missing final newline', () => {
    const text = '{\r\n  "b": { "x": 1 },\r\n  "a": "1"\r\n}';
    assert.strictEqual(
      editJson(text, ['a'], '2'),
      '{\r\n  "b": {\r\n    "x": 1\r\n  },\r\n  "a": "2"\r\n}',
    );
  });

  it('adds missing parents and sorts into a sorted map', () => {
    assert.strictEqual(
      editJson('{\n  "name": "x"\n}\n', ['workspaces', 'catalog', 'a'], '1'),
      '{\n  "name": "x",\n  "workspaces": {\n    "catalog": {\n      "a": "1"\n    }\n  }\n}\n',
    );
    assert.strictEqual(
      editJson(
        '{\n  "catalog": {\n    "a": "1",\n    "c": "1"\n  }\n}\n',
        ['catalog', 'b'],
        '1',
      ),
      '{\n  "catalog": {\n    "a": "1",\n    "b": "1",\n    "c": "1"\n  }\n}\n',
    );
  });

  it('leaves text that is not a JSON object alone', () => {
    assert.strictEqual(editJson('{ nope', ['a'], '1'), '{ nope');
  });
});
