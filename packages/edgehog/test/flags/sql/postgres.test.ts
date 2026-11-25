import { NodeServices } from '@effect/platform-node';
import { assert, describe, it, layer } from '@effect/vitest';
import { Array as Arr, Config, Effect, Layer, String as Str } from 'effect';
import {
  findPostgres,
  Postgres,
  postgresLayer,
} from 'shoemaker-utils/testing/postgres';

import { FlagStore, MAX_FLAG_BYTES, MAX_FLAGS } from '../../../src/index.ts';
import { flagStoreLayer } from '../../../src/sql.ts';
import { boolean, text } from '../../support/definitions.ts';
import { flagSuite, migrated } from './suite.ts';

const TIMED_OUT = 60_000;
const ADMINS = 8;

const { ci, source } = await Effect.runPromise(
  Effect.gen(function* () {
    return {
      ci: yield* Config.Boolean('CI').pipe(Config.withDefault(false)),
      source: yield* findPostgres,
    };
  }).pipe(Effect.provide(NodeServices.layer)),
);

const available = source.kind !== 'none';

it.skipIf(available || !ci)('CI runs the Postgres tests', () => {
  assert.fail(
    'There is no Postgres: set TEST_POSTGRES_URL, or put initdb and postgres on the PATH (nix develop).',
  );
});

describe.skipIf(!available)(
  'with TEST_POSTGRES_URL, or Postgres on the PATH',
  () => {
    layer(postgresLayer(source), { timeout: TIMED_OUT })((it) => {
      flagSuite(
        'Postgres',
        Effect.flatMap(Postgres, (postgres) => postgres.database),
        it,
      );

      // Each on its own connections, all at once.
      const together = Effect.fnUntraced(function* <A>(
        prepare: Effect.Effect<void, unknown, FlagStore>,
        act: (
          store: FlagStore['Service'],
          admin: number,
        ) => Effect.Effect<A, { readonly _tag: string }>,
      ) {
        const postgres = yield* Postgres;
        const database = yield* postgres.database;
        const left = yield* Effect.gen(function* () {
          yield* Effect.orDie(prepare);
          const outcomes = yield* Effect.all(
            Arr.makeBy(ADMINS, (admin) =>
              Effect.gen(function* () {
                const store = yield* FlagStore;
                return yield* act(store, admin).pipe(
                  Effect.match({
                    onSuccess: () => 'done',
                    onFailure: (error) => error._tag,
                  }),
                );
              }).pipe(
                Effect.provide(flagStoreLayer.pipe(Layer.provide(database))),
              ),
            ),
            { concurrency: 'unbounded' },
          );
          const store = yield* FlagStore;
          return { outcomes, flags: yield* store.list(1) };
        }).pipe(Effect.provide(migrated(database)));
        return {
          flags: left.flags,
          done: Arr.filter(left.outcomes, (outcome) => outcome === 'done'),
          outcomes: left.outcomes,
        };
      });

      it.effect(
        'admins creating at once never pass the number of flags',
        () =>
          Effect.gen(function* () {
            const { done, flags } = yield* together(
              Effect.gen(function* () {
                const store = yield* FlagStore;
                for (const at of Arr.range(1, MAX_FLAGS - 1)) {
                  yield* store.create(1, { key: `f${at}`, config: boolean() });
                }
              }),
              (store, admin) =>
                store.create(1, { key: `new-${admin}`, config: boolean() }),
            );
            assert.lengthOf(done, 1);
            assert.lengthOf(flags, MAX_FLAGS);
          }),
        TIMED_OUT,
      );

      it.effect(
        'admins growing flags at once never pass the size',
        () =>
          Effect.gen(function* () {
            const { done, outcomes } = yield* together(
              Effect.gen(function* () {
                const store = yield* FlagStore;
                for (const at of Arr.range(0, ADMINS - 1)) {
                  yield* store.create(1, { key: `f${at}`, config: text('') });
                }
              }),
              (store, admin) =>
                Effect.gen(function* () {
                  const flags = yield* store.list(1);
                  return yield* store.update(1, flags[admin]?.id ?? '', {
                    version: 1,
                    config: text(Str.repeat(MAX_FLAG_BYTES * 0.6)('x')),
                  });
                }),
            );
            assert.lengthOf(done, 1);
            assert.lengthOf(
              Arr.filter(outcomes, (tag) => tag === 'FlagLimitReached'),
              ADMINS - 1,
            );
          }),
        TIMED_OUT,
      );

      it.effect(
        'of admins changing one flag at once, one succeeds',
        () =>
          Effect.gen(function* () {
            const { done, flags } = yield* together(
              Effect.gen(function* () {
                const store = yield* FlagStore;
                yield* store.create(1, { key: 'f', config: text('') });
              }),
              (store, admin) =>
                Effect.gen(function* () {
                  const [flag] = yield* store.list(1);
                  return yield* store.update(1, flag?.id ?? '', {
                    version: 1,
                    config: text(`by ${admin}`),
                  });
                }),
            );
            assert.lengthOf(done, 1);
            assert.strictEqual(flags[0]?.version, 2);
          }),
        TIMED_OUT,
      );
    });
  },
);
