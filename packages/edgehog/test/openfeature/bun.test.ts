import { NodeServices } from '@effect/platform-node';
import { assert, it } from '@effect/vitest';
import { Effect, Stream } from 'effect';
import { ChildProcess } from 'effect/process';

const SMOKE = `${import.meta.dirname}/../support/bun-smoke.ts`;

it.layer(NodeServices.layer)('Bun and Postgres', (it) => {
  it.effect(
    'define and evaluate a flag',
    () =>
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make('bun', [SMOKE]);
        const [output, code] = yield* Effect.all(
          [
            handle.all.pipe(Stream.decodeText, Stream.mkString),
            handle.exitCode,
          ],
          { concurrency: 2 },
        );
        assert.strictEqual(Number(code), 0, output);
        assert.include(output, 'bun true true');
      }),
    60_000,
  );
});
