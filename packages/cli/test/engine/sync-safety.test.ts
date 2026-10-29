import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Option, String as Str } from 'effect';

import { sha256 } from '../../src/engine/hash.ts';
import { canonicalJson, ownedProjection } from '../../src/engine/json.ts';
import { type Lock, parseLock, renderLock } from '../../src/engine/lock.ts';
import { makePlan, nextLock, type Plan } from '../../src/engine/plan.ts';
import { makeMemoryRepo } from '../../src/engine/repo-memory.ts';
import type { FileStrategy, GeneratedFile } from '../../src/engine/types.ts';
import { json, region } from '../../src/generators/shared.ts';

// Regression tests for ways a sync could overwrite or lose a user's work, or
// report shoemaker's own output as a hand edit.

const file = (
  path: string,
  content: string,
  strategy: FileStrategy = 'owned',
): GeneratedFile => ({ path, content, strategy });

const planned = (plan: Plan, path: string) => {
  const found = Option.getOrUndefined(
    Arr.findFirst(plan.files, (f) => f.path === path),
  );
  assert.isDefined(found, `${path} is in the plan`);
  return {
    action: found?.action,
    reason: found?.reason,
    after: found?.after ?? '',
  };
};

// One sync of `generated` over `disk`: the plan, disk afterwards, next lock.
// The lock goes through render/parse, as it does on disk.
const sync = (
  disk: Readonly<Record<string, string>>,
  generated: ReadonlyArray<GeneratedFile>,
  lock: Lock | undefined,
  force: ReadonlyArray<string> = [],
) =>
  Effect.gen(function* () {
    const plan = yield* makePlan(makeMemoryRepo(disk), generated, lock, {
      force,
    });
    const after: Record<string, string> = { ...disk };
    for (const p of plan.files) {
      if (p.action === 'create' || p.action === 'update')
        after[p.path] = p.after;
    }
    const next = yield* parseLock(renderLock(nextLock(lock, plan, '0.0.0')));
    return { plan, disk: after, lock: next };
  });

const read = (disk: Readonly<Record<string, string>>, path: string) =>
  disk[path] ?? '';

describe('dependency versions are a floor', () => {
  const generated = (script: string, version: string) =>
    file(
      'package.json',
      json({
        scripts: { test: script },
        workspaces: { catalog: { 'shoemaker-oxlint-config': version } },
      }),
      'json-merge',
    );

  it.effect('a raised version survives a sync that changes the file', () =>
    Effect.gen(function* () {
      const first = yield* sync({}, [generated('vitest', '^0.1.0')], undefined);
      const raised = {
        'package.json': Str.replace(
          '^0.1.0',
          '^0.2.1',
        )(read(first.disk, 'package.json')),
      };
      const unchanged = yield* sync(
        raised,
        [generated('vitest', '^0.1.0')],
        first.lock,
      );
      assert.strictEqual(
        planned(unchanged.plan, 'package.json').action,
        'unchanged',
      );
      const next = yield* sync(
        raised,
        [generated('vitest run', '^0.1.0')],
        first.lock,
      );
      const { action, after } = planned(next.plan, 'package.json');
      assert.strictEqual(action, 'update');
      assert.include(after, '"test": "vitest run"');
      assert.include(after, '"shoemaker-oxlint-config": "^0.2.1"');
    }),
  );

  it.effect('a newer generated version replaces an older one', () =>
    Effect.gen(function* () {
      const first = yield* sync({}, [generated('vitest', '^0.2.1')], undefined);
      const next = yield* sync(
        first.disk,
        [generated('vitest', '^0.3.0')],
        first.lock,
      );
      const { action, after } = planned(next.plan, 'package.json');
      assert.strictEqual(action, 'update');
      assert.include(after, '"shoemaker-oxlint-config": "^0.3.0"');
    }),
  );

  it.effect('turning a version into another kind of spec is a hand edit', () =>
    Effect.gen(function* () {
      const first = yield* sync({}, [generated('vitest', '^0.1.0')], undefined);
      const edited = {
        'package.json': Str.replace(
          '^0.1.0',
          'file:../oxlint-config',
        )(read(first.disk, 'package.json')),
      };
      const next = yield* sync(
        edited,
        [generated('vitest run', '^0.1.0')],
        first.lock,
      );
      assert.strictEqual(planned(next.plan, 'package.json').action, 'conflict');
    }),
  );
});

describe('owned key / region set changes between versions', () => {
  it.effect('json-merge: a newly owned key is an update, not a conflict', () =>
    Effect.gen(function* () {
      const v1 = [
        file('package.json', json({ scripts: { a: 'x' } }), 'json-merge'),
      ];
      const first = yield* sync({}, v1, undefined);
      const v2 = [
        file(
          'package.json',
          json({ scripts: { a: 'x', b: 'y' } }),
          'json-merge',
        ),
      ];
      const second = yield* sync(first.disk, v2, first.lock);
      assert.strictEqual(planned(second.plan, 'package.json').action, 'update');
      assert.include(read(second.disk, 'package.json'), '"b": "y"');
    }),
  );

  it.effect(
    'json-merge: a hand edit of a key owned at baseline still conflicts',
    () =>
      Effect.gen(function* () {
        const v1 = [
          file('package.json', json({ scripts: { a: 'x' } }), 'json-merge'),
        ];
        const first = yield* sync({}, v1, undefined);
        const edited = {
          'package.json': Str.replace(
            '"x"',
            '"mine"',
          )(read(first.disk, 'package.json')),
        };
        const v2 = [
          file(
            'package.json',
            json({ scripts: { a: 'x', b: 'y' } }),
            'json-merge',
          ),
        ];
        const second = yield* sync(edited, v2, first.lock);
        assert.strictEqual(
          planned(second.plan, 'package.json').action,
          'conflict',
        );
      }),
  );

  it.effect(
    'managed: a region dropped by the generator is not a conflict',
    () =>
      Effect.gen(function* () {
        const v1 = [
          file(
            'a.ts',
            `${region('one', 'const a = 1;')}\n${region('two', 'const b = 1;')}\n`,
            'managed',
          ),
        ];
        const first = yield* sync({}, v1, undefined);
        const v2 = [
          file('a.ts', `${region('one', 'const a = 2;')}\n`, 'managed'),
        ];
        const second = yield* sync(first.disk, v2, first.lock);
        assert.strictEqual(planned(second.plan, 'a.ts').action, 'update');
        assert.include(read(second.disk, 'a.ts'), 'const a = 2;');
      }),
  );

  it.effect(
    'managed: a new region is appended and keeps text outside regions',
    () =>
      Effect.gen(function* () {
        const v1 = [
          file(
            'AGENTS.md',
            `# A\n\n${region('one', 'gen', '<!--')}\n`,
            'managed',
          ),
        ];
        const first = yield* sync({}, v1, undefined);
        const mine = `${read(first.disk, 'AGENTS.md')}\n## My notes\nkeep me\n`;
        const v2 = [
          file(
            'AGENTS.md',
            `# A\n\n${region('one', 'gen', '<!--')}\n\n${region('two', 'new', '<!--')}\n`,
            'managed',
          ),
        ];
        const second = yield* sync({ 'AGENTS.md': mine }, v2, first.lock);
        const agents = planned(second.plan, 'AGENTS.md');
        assert.strictEqual(agents.action, 'update');
        assert.strictEqual(
          agents.after,
          `# A\n\n${region('one', 'gen', '<!--')}\n\n${region('two', 'new', '<!--')}\n\n## My notes\nkeep me\n`,
        );
        const third = yield* sync(second.disk, v2, second.lock);
        assert.strictEqual(
          planned(third.plan, 'AGENTS.md').action,
          'unchanged',
        );
      }),
  );

  it.effect(
    'a lock without recorded sets falls back to the generated set',
    () =>
      Effect.gen(function* () {
        const generated = file(
          'package.json',
          json({ scripts: { a: 'x' } }),
          'json-merge',
        );
        const disk = {
          'package.json': '{\n  "scripts": {\n    "a": "x"\n  }\n}\n',
        };
        // What a lock written before owned sets were recorded holds.
        const legacy: Lock = {
          cliVersion: '0.0.0',
          files: {
            'package.json': {
              strategy: 'json-merge',
              sha256: sha256(
                canonicalJson(
                  ownedProjection(
                    { scripts: { a: 'x' } },
                    { scripts: { a: 'x' } },
                  ),
                ),
              ),
            },
          },
        };
        const same = yield* sync(disk, [generated], legacy);
        assert.strictEqual(
          planned(same.plan, 'package.json').action,
          'unchanged',
        );
        assert.isDefined(same.lock.files['package.json']?.owned);
        const changed = file(
          'package.json',
          json({ scripts: { a: 'z' } }),
          'json-merge',
        );
        const updated = yield* sync(disk, [changed], legacy);
        assert.strictEqual(
          planned(updated.plan, 'package.json').action,
          'update',
        );
      }),
  );
});

describe('managed regions', () => {
  it.effect(
    'a duplicated region id is a conflict, not a silent overwrite',
    () =>
      Effect.gen(function* () {
        const generated = [
          file(
            'AGENTS.md',
            `# A\n${region('rules', 'generated v1', '<!--')}\n`,
            'managed',
          ),
        ];
        const first = yield* sync({}, generated, undefined);
        const duplicated = `${read(first.disk, 'AGENTS.md')}\n${region('rules', 'generated v1', '<!--')}\n`;
        const edited = Str.replace('generated v1', 'MY HAND EDIT')(duplicated);
        const second = yield* sync(
          { 'AGENTS.md': edited },
          generated,
          first.lock,
        );
        const agents = planned(second.plan, 'AGENTS.md');
        assert.strictEqual(agents.action, 'conflict');
        assert.include(agents.reason ?? '', 'more than once: rules');
        assert.include(read(second.disk, 'AGENTS.md'), 'MY HAND EDIT');
      }),
  );

  it.effect('markers inside markdown code fences are not regions', () =>
    Effect.gen(function* () {
      const generated = [
        file('AGENTS.md', `# A\n${region('rules', 'v2', '<!--')}\n`, 'managed'),
      ];
      const example = `\`\`\`md\n${region('rules', 'an example', '<!--')}\n\`\`\``;
      const disk = {
        'AGENTS.md': `# A\n${example}\n${region('rules', 'v1', '<!--')}\n`,
      };
      const first = yield* sync(disk, generated, undefined, ['AGENTS.md']);
      assert.strictEqual(
        read(first.disk, 'AGENTS.md'),
        `# A\n${example}\n${region('rules', 'v2', '<!--')}\n`,
      );
    }),
  );

  it.effect('--force on a removed region appends it and keeps user text', () =>
    Effect.gen(function* () {
      const generated = [
        file(
          'AGENTS.md',
          `# A\n\n${region('one', 'gen one', '<!--')}\n\n${region('two', 'gen two', '<!--')}\n`,
          'managed',
        ),
      ];
      const first = yield* sync({}, generated, undefined);
      // The user deleted region `two` and wrote their own notes.
      const mine = `# A\n\n${region('one', 'gen one', '<!--')}\n\n## My notes\nkeep me\n`;
      const blocked = yield* sync({ 'AGENTS.md': mine }, generated, first.lock);
      const agents = planned(blocked.plan, 'AGENTS.md');
      assert.strictEqual(agents.action, 'conflict');
      assert.include(agents.reason ?? '', 'missing shoemaker region(s): two');
      const forced = yield* sync({ 'AGENTS.md': mine }, generated, first.lock, [
        'AGENTS.md',
      ]);
      assert.strictEqual(
        read(forced.disk, 'AGENTS.md'),
        `# A\n\n${region('one', 'gen one', '<!--')}\n\n${region('two', 'gen two', '<!--')}\n\n## My notes\nkeep me\n`,
      );
    }),
  );

  it.effect('an empty region body is stable right after creation', () =>
    Effect.gen(function* () {
      const generated = [file('x.sh', `${region('r', '', '#')}\n`, 'managed')];
      const first = yield* sync({}, generated, undefined);
      const second = yield* sync(first.disk, generated, first.lock);
      assert.strictEqual(planned(second.plan, 'x.sh').action, 'unchanged');
    }),
  );
});

describe('seeds', () => {
  it.effect('a skipped seed never records the user content as a baseline', () =>
    Effect.gen(function* () {
      const v1 = [file('README.md', '# seed\n', 'seed')];
      const first = yield* sync({}, v1, undefined);
      const edited = { 'README.md': '# seed\nMY HAND EDIT\n' };
      const second = yield* sync(edited, v1, first.lock);
      assert.strictEqual(planned(second.plan, 'README.md').action, 'skip');
      assert.deepStrictEqual(
        second.lock.files['README.md'],
        first.lock.files['README.md'],
      );
      // A later version owning the file must not take the hand edit for its own.
      const v2 = [file('README.md', '# owned now\n', 'owned')];
      const third = yield* sync(edited, v2, second.lock);
      assert.strictEqual(planned(third.plan, 'README.md').action, 'conflict');
      assert.strictEqual(
        read(third.disk, 'README.md'),
        '# seed\nMY HAND EDIT\n',
      );
    }),
  );

  it.effect('a seed the user did not get from shoemaker gets no baseline', () =>
    Effect.gen(function* () {
      const v1 = [file('README.md', '# seed\n', 'seed')];
      const adopted = yield* sync({ 'README.md': '# theirs\n' }, v1, undefined);
      assert.isUndefined(adopted.lock.files['README.md']);
    }),
  );

  it.effect('a seed the user deleted is not re-created', () =>
    Effect.gen(function* () {
      const v1 = [file('src/example.ts', 'export {};\n', 'seed')];
      const first = yield* sync({}, v1, undefined);
      const second = yield* sync({}, v1, first.lock);
      const example = planned(second.plan, 'src/example.ts');
      assert.strictEqual(example.action, 'skip');
      assert.strictEqual(example.reason, 'deleted by user');
      assert.isUndefined(second.disk['src/example.ts']);
      // And it stays deleted.
      const third = yield* sync({}, v1, second.lock);
      assert.strictEqual(planned(third.plan, 'src/example.ts').action, 'skip');
    }),
  );
});

describe('line endings', () => {
  it.effect('a CRLF checkout of an untouched owned file is unchanged', () =>
    Effect.gen(function* () {
      const generated = [file('tsconfig.json', '{\n  "a": 1\n}\n')];
      const first = yield* sync({}, generated, undefined);
      const crlf = { 'tsconfig.json': '{\r\n  "a": 1\r\n}\r\n' };
      const second = yield* sync(crlf, generated, first.lock);
      assert.strictEqual(
        planned(second.plan, 'tsconfig.json').action,
        'unchanged',
      );
      const v2 = [file('tsconfig.json', '{\n  "a": 2\n}\n')];
      const third = yield* sync(crlf, v2, first.lock);
      assert.strictEqual(planned(third.plan, 'tsconfig.json').action, 'update');
      assert.strictEqual(
        read(third.disk, 'tsconfig.json'),
        '{\r\n  "a": 2\r\n}\r\n',
      );
    }),
  );

  it.effect('a managed update into a CRLF file keeps CRLF throughout', () =>
    Effect.gen(function* () {
      const generated = [
        file(
          '.gitignore',
          `${region('shoemaker', 'node_modules\ndist', '#')}\n\nmine\n`,
          'managed',
        ),
      ];
      const disk = {
        '.gitignore':
          '# shoemaker:begin shoemaker\r\nnode_modules\r\n# shoemaker:end shoemaker\r\n\r\nmine\r\n',
      };
      const first = yield* sync(disk, generated, undefined, ['**']);
      assert.strictEqual(
        read(first.disk, '.gitignore'),
        '# shoemaker:begin shoemaker\r\nnode_modules\r\ndist\r\n# shoemaker:end shoemaker\r\n\r\nmine\r\n',
      );
      const second = yield* sync(first.disk, generated, first.lock);
      assert.strictEqual(
        planned(second.plan, '.gitignore').action,
        'unchanged',
      );
    }),
  );

  it.effect('a CRLF json-merge file is updated without a false conflict', () =>
    Effect.gen(function* () {
      const v1 = [file('package.json', json({ name: 'x' }), 'json-merge')];
      const first = yield* sync({}, v1, undefined);
      const crlf = {
        'package.json': Str.replaceAll(
          '\n',
          '\r\n',
        )(read(first.disk, 'package.json')),
      };
      const v2 = [
        file('package.json', json({ name: 'x', type: 'module' }), 'json-merge'),
      ];
      const second = yield* sync(crlf, v2, first.lock);
      assert.strictEqual(planned(second.plan, 'package.json').action, 'update');
      assert.strictEqual(
        read(second.disk, 'package.json'),
        '{\r\n  "name": "x",\r\n  "type": "module"\r\n}\r\n',
      );
    }),
  );
});
