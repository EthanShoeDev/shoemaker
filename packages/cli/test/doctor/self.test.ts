import { BunServices } from '@effect/platform-bun';
import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Path } from 'effect';

import { doctorChecks } from '../../src/doctor/index.ts';
import { makeRepo } from '../../src/engine/repo-live.ts';

const ACCEPTED = [
  // Shoemaker reads env (publish and release scripts) without a secrets
  // manager, by choice.
  'secrets-manager',
  // It deploys no Worker: packages/admin only tests against Cloudflare's client.
  'cloudflare-observability-mcp',
];

describe('doctor on shoemaker itself', () => {
  it.effect(
    'finds no drift from the preferences shoemaker enforces',
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const repo = yield* makeRepo(
          path.resolve(import.meta.dirname, '../../../..'),
        );
        const checks = Arr.filter(
          doctorChecks,
          (c) => !Arr.contains(ACCEPTED, c.id),
        );
        const found = yield* Effect.forEach(
          checks,
          (check) =>
            Effect.map(check.run(repo), (findings) =>
              Arr.map(
                Arr.filter(findings, (f) => !f.ok),
                (f) => `${check.id}: ${f.message}`,
              ),
            ),
          { concurrency: 1 },
        );
        assert.deepStrictEqual(Arr.flatten(found), []);
      }).pipe(Effect.provide(BunServices.layer)),
    30_000,
  );
});
