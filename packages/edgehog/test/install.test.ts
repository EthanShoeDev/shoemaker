import { NodeServices } from '@effect/platform-node';
import { assert, it } from '@effect/vitest';
import { Array as Arr, Effect } from 'effect';
import { INSTALL_TIMEOUT, installed } from 'shoemaker-utils/testing/install';

const MANIFESTS = [
  `${import.meta.dirname}/../package.json`,
  `${import.meta.dirname}/../../admin/package.json`,
] as const;

const UNWANTED =
  /^(?:react|react-dom|foldkit|wrangler|miniflare|workerd|@cloudflare\/.*|@alchemy\.run\/cloudflare|@effect\/sql-d1)$/u;

it.layer(NodeServices.layer)('installing the package', (it) => {
  it.effect(
    'for flags on Bun and Postgres needs no UI framework and no Cloudflare',
    () =>
      Effect.gen(function* () {
        const names = yield* installed({
          manifests: MANIFESTS,
          beside: {
            effect: '4.1.5',
            '@effect/platform-bun': '4.1.5',
            '@effect/sql-pg': '4.1.5',
            '@openfeature/server-sdk': '1.23.0',
          },
        });
        assert.includeMembers(names, [
          'shoemaker-edgehog',
          'shoemaker-admin',
          '@openfeature/server-sdk',
        ]);
        assert.deepStrictEqual(
          Arr.filter(names, (name) => UNWANTED.test(name)),
          [],
        );
      }),
    INSTALL_TIMEOUT,
  );

  it.effect(
    'without flags needs no OpenFeature',
    () =>
      Effect.gen(function* () {
        const names = yield* installed({
          manifests: MANIFESTS,
          beside: { effect: '4.1.5' },
        });
        assert.include(names, 'shoemaker-edgehog');
        assert.deepStrictEqual(
          Arr.filter(names, (name) => /^(?:@openfeature|alchemy)/u.test(name)),
          [],
        );
      }),
    INSTALL_TIMEOUT,
  );
});
