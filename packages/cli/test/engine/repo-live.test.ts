import { BunServices } from '@effect/platform-bun';
import { assert, describe, it } from '@effect/vitest';
import { Effect, FileSystem, Path, Record as Rec } from 'effect';

import { runCapture } from '../../src/engine/process.ts';
import { makeRepo } from '../../src/engine/repo-live.ts';

const files = {
  '.gitignore': 'docs/cloned-repos-as-docs/\n*.log\n!keep.log\n',
  'README.md': '# repo\n',
  'docs/guide.md': '# guide\n',
  'docs/cloned-repos-as-docs/effect/README.md': '# cloned\n',
  'debug.log': 'noise\n',
  'keep.log': 'kept\n',
  'packages/a/.gitignore': 'generated/\n',
  'packages/a/generated/out.md': '# generated\n',
  'node_modules/dep/README.md': '# dep\n',
  'turbo.json': '{}\n',
  'apps/web/turbo.jsonc': '{}\n',
  '.husky/_/husky.sh': '',
  '.husky/pre-commit': '',
};

const write = Effect.fnUntraced(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const [file, content] of Rec.toEntries(files)) {
    yield* fs.makeDirectory(path.dirname(path.join(dir, file)), {
      recursive: true,
    });
    yield* fs.writeFileString(path.join(dir, file), content);
  }
});

describe('makeRepo glob', () => {
  it.effect('skips what .gitignore excludes in a git repo', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      yield* write(dir);
      yield* runCapture('git', ['init', '-q'], dir);
      const repo = yield* makeRepo(dir);
      assert.deepStrictEqual(yield* repo.glob('**/*.md'), [
        'README.md',
        'docs/guide.md',
      ]);
      assert.deepStrictEqual(yield* repo.glob('*.log'), ['keep.log']);
      assert.deepStrictEqual(yield* repo.glob('**/turbo.json{,c}'), [
        'apps/web/turbo.jsonc',
        'turbo.json',
      ]);
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );

  it.effect('sees every file outside git', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      yield* write(dir);
      const repo = yield* makeRepo(dir);
      const markdown = yield* repo.glob('**/*.md');
      assert.include(markdown, 'docs/cloned-repos-as-docs/effect/README.md');
      assert.notInclude(markdown, 'node_modules/dep/README.md');
      // Files only: the `_` directory is not a match.
      assert.deepStrictEqual(yield* repo.glob('.husky/*'), [
        '.husky/pre-commit',
      ]);
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );
});
