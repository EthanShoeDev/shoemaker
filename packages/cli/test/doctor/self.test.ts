import { BunServices } from '@effect/platform-bun';
import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Path } from 'effect';

import { doctorChecks } from '../../src/doctor/index.ts';
import { makeRepo } from '../../src/engine/repo-live.ts';

// Shoemaker reads env (publish and release scripts) without a secrets manager,
// by choice.
const ACCEPTED = 'secrets-manager';

describe('doctor on shoemaker itself', () => {
  it.effect(
    'finds no drift from the preferences shoemaker enforces',
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const repo = yield* makeRepo(
          path.resolve(import.meta.dirname, '../../../..'),
        );
        const checks = Arr.filter(doctorChecks, (c) => c.id !== ACCEPTED);
        const found = yield* Effect.forEach(checks, (check) =>
          Effect.map(check.run(repo), (findings) =>
            Arr.map(
              Arr.filter(findings, (f) => !f.ok),
              (f) => `${check.id}: ${f.message}`,
            ),
          ),
        );
        assert.deepStrictEqual(Arr.flatten(found), []);
      }).pipe(Effect.provide(BunServices.layer)),
    30_000,
  );
});
