import { NodeServices } from '@effect/platform-node';
import { assert, it } from '@effect/vitest';
import { Array as Arr, Effect } from 'effect';
import { INSTALL_TIMEOUT, installed } from 'shoemaker-utils/testing/install';

const MANIFEST = `${import.meta.dirname}/../package.json`;

const install = (beside: Readonly<Record<string, string>>) =>
  installed({ manifests: [MANIFEST], beside });

const UNWANTED =
  /^(?:react|react-dom|foldkit|wrangler|miniflare|workerd|@cloudflare\/.*|@alchemy\.run\/cloudflare|@effect\/sql-d1)$/u;

it.layer(NodeServices.layer)('installing the package', (it) => {
  it.effect(
    'beside effect pulls only effect',
    () =>
      Effect.gen(function* () {
        const names = yield* install({ effect: '4.1.5' });
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
        const names = yield* install({
          effect: '4.1.5',
          '@effect/platform-bun': '4.1.5',
          '@effect/sql-pg': '4.1.5',
          'better-auth': '1.7.15',
        });
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
        const chosen = {
          effect: '4.1.5',
          alchemy: '2.0.0-beta.87',
          '@alchemy.run/better-auth': '2.0.0-beta.87',
          'better-auth': '1.7.15',
        };
        const names = yield* install(chosen);
        assert.include(names, '@alchemy.run/better-auth');
        assert.deepStrictEqual(
          Arr.filter(names, (name) => UNWANTED.test(name)),
          [],
        );
      }),
    INSTALL_TIMEOUT,
  );
});
