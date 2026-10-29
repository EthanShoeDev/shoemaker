import { assert, describe, it } from '@effect/vitest';
import { Array as Arr } from 'effect';

import {
  insertRegions,
  parseRegions,
  replaceRegions,
} from '../../src/engine/regions.ts';
import { region } from '../../src/generators/shared.ts';

describe('regions', () => {
  it('parses //, # and <!-- --> markers', () => {
    const text = Arr.join(
      [
        region('a', 'one', '//'),
        'user text',
        region('b', 'two\nlines', '#'),
        region('c', 'three', '<!--'),
      ],
      '\n',
    );
    const regions = parseRegions(text);
    assert.deepStrictEqual(
      Arr.map(regions, (r) => [r.id, r.body]),
      [
        ['a', 'one'],
        ['b', 'two\nlines'],
        ['c', 'three'],
      ],
    );
  });

  it('ignores unbalanced markers', () => {
    assert.deepStrictEqual(parseRegions('// shoemaker:begin a\nbody\n'), []);
  });

  it('replaces region bodies and keeps text outside them', () => {
    const existing = `# mine\n${region('rules', 'old', '<!--')}\n\n## also mine\n`;
    const generated = `# generated\n${region('rules', 'new\nrules', '<!--')}\n`;
    const result = replaceRegions(existing, generated);
    assert.deepStrictEqual(result.missing, []);
    assert.strictEqual(
      result.content,
      `# mine\n${region('rules', 'new\nrules', '<!--')}\n\n## also mine\n`,
    );
  });

  it('reports generated regions missing on disk instead of appending them', () => {
    const existing = `${region('a', 'x')}\n`;
    const generated = `${region('a', 'y')}\n${region('b', 'z')}\n`;
    const result = replaceRegions(existing, generated);
    assert.deepStrictEqual(result.missing, ['b']);
    assert.strictEqual(result.content, `${region('a', 'y')}\n`);
  });

  it('handles empty bodies', () => {
    const result = replaceRegions(
      '// shoemaker:begin a\n// shoemaker:end a\n',
      '// shoemaker:begin a\nfilled\n// shoemaker:end a\n',
    );
    assert.strictEqual(
      result.content,
      '// shoemaker:begin a\nfilled\n// shoemaker:end a\n',
    );
    assert.strictEqual(
      replaceRegions(
        result.content,
        '// shoemaker:begin a\n// shoemaker:end a\n',
      ).content,
      '// shoemaker:begin a\n// shoemaker:end a\n',
    );
  });

  it('keeps a blank-line body distinct from no body', () => {
    const generated = `${region('a', '', '#')}\n`;
    assert.strictEqual(generated, '# shoemaker:begin a\n\n# shoemaker:end a\n');
    assert.strictEqual(replaceRegions(generated, generated).content, generated);
  });

  it('reports generated ids that occur more than once', () => {
    const existing = `${region('a', 'x')}\n${region('a', 'y')}\n${region('old', 'z')}\n${region('old', 'z')}\n`;
    const result = replaceRegions(existing, `${region('a', 'new')}\n`);
    assert.deepStrictEqual(result.duplicates, ['a']);
  });

  it('ignores markers inside markdown fences only when asked', () => {
    const text = `\`\`\`\n${region('a', 'example', '<!--')}\n\`\`\`\n~~~~\n${region('b', 'x', '<!--')}\n~~~~\n${region('c', 'real', '<!--')}\n`;
    assert.deepStrictEqual(
      Arr.map(parseRegions(text, { fences: true }), (r) => r.id),
      ['c'],
    );
    assert.deepStrictEqual(
      Arr.map(parseRegions(text), (r) => r.id),
      ['a', 'b', 'c'],
    );
  });

  it('inserts missing regions after their generated predecessor, else at the end', () => {
    const generated = `${region('a', '1')}\n${region('b', '2')}\n\n${region('c', '3')}\n`;
    assert.strictEqual(
      insertRegions(`// mine\n${region('a', '1')}\n// also mine\n`, generated, [
        'b',
        'c',
      ]),
      `// mine\n${region('a', '1')}\n${region('b', '2')}\n\n${region('c', '3')}\n// also mine\n`,
    );
    assert.strictEqual(
      insertRegions('// only mine\n', generated, ['a']),
      `// only mine\n${region('a', '1')}\n`,
    );
  });
});
