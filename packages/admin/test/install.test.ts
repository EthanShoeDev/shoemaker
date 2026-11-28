import { NodeServices } from '@effect/platform-node';
import { assert, it } from '@effect/vitest';
import { Array as Arr, Effect } from 'effect';
import { INSTALL_TIMEOUT, installed } from 'shoemaker-utils/testing/install';

const MANIFEST = `${import.meta.dirname}/../package.json`;

const install = (beside: ReadonlyArray<string>) =>
  installed({ manifests: [MANIFEST], beside });

const UNWANTED =
  /^(?:react|react-dom|foldkit|wrangler|miniflare|workerd|@cloudflare\/.*|@alchemy\.run\/cloudflare|@effect\/sql-d1)$/u;

it.layer(NodeServices.layer)('installing the package', (it) => {
  it.effect(
    'beside effect pulls only effect',
    () =>
      Effect.gen(function* () {
        const names = yield* install(['effect']);
        assert.include(names, 'shoemaker-admin');
        assert.include(names, 'effect');
        for (const optional of ['alchemy', 'better-auth']) {
          assert.notInclude(names, optional);
        }
        assert.deepStrictEqual(
          Arr.filter(names, (name) => UNWANTED.test(name)),
          [],
        );
      }),
    INSTALL_TIMEOUT,
  );

  it.effect(
    'on Bun and Postgres needs neither React nor Cloudflare',
    () =>
      Effect.gen(function* () {
        const names = yield* install([
          'effect',
          '@effect/platform-bun',
          '@effect/sql-pg',
          'better-auth',
        ]);
        assert.include(names, 'better-auth');
        assert.deepStrictEqual(
          Arr.filter(names, (name) => UNWANTED.test(name)),
          [],
        );
      }),
    INSTALL_TIMEOUT,
  );

  it.effect(
    'with Alchemy adds nothing of its own',
    () =>
      Effect.gen(function* () {
        const names = yield* install([
          'effect',
          'alchemy',
          '@alchemy.run/better-auth',
          'better-auth',
        ]);
        assert.include(names, '@alchemy.run/better-auth');
        assert.deepStrictEqual(
          Arr.filter(names, (name) => UNWANTED.test(name)),
          [],
        );
      }),
    INSTALL_TIMEOUT,
  );
});
