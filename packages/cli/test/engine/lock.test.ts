import { assert, describe, it } from '@effect/vitest';
import { Effect, Exit, Option, String as Str } from 'effect';

import {
  type Lock,
  parseLock,
  readLock,
  renderLock,
} from '../../src/engine/lock.ts';
import { makeMemoryRepo } from '../../src/engine/repo-memory.ts';

describe('lock', () => {
  const lock: Lock = {
    cliVersion: '0.1.0',
    migrations: ['2026-10-28-a'],
    files: {
      'b.json': { sha256: 'bb', strategy: 'json-merge', owned: ['/name'] },
      'a.ts': { sha256: 'aa', strategy: 'owned' },
    },
  };

  it.effect('round-trips through render and parse', () =>
    Effect.gen(function* () {
      const text = renderLock(lock);
      assert.deepStrictEqual(yield* parseLock(text), lock);
      // Paths are sorted so the lock diffs cleanly.
      assert.isBelow(
        Option.getOrElse(Str.indexOf('a.ts')(text), () => -1),
        Option.getOrElse(Str.indexOf('b.json')(text), () => -1),
      );
    }),
  );

  it.effect('accepts JSONC comments and trailing commas', () =>
    Effect.gen(function* () {
      const parsed = yield* parseLock(
        '// header\n{ "cliVersion": "1", "migrations": [], "files": {}, }',
      );
      assert.strictEqual(parsed.cliVersion, '1');
    }),
  );

  it.effect('fails on an invalid lock', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(parseLock('{ "cliVersion": 1 }'));
      assert.isTrue(Exit.isFailure(exit));
    }),
  );

  it.effect('reads a missing lock as undefined', () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* readLock(makeMemoryRepo({})), undefined);
    }),
  );
});
