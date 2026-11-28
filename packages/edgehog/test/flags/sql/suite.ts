import { assert, describe, type Vitest } from '@effect/vitest';
import {
  Array as Arr,
  Effect,
  Layer,
  Schema,
  type Scope,
  String as Str,
} from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { TestClock } from 'effect/testing';
import { runMigrations } from 'shoemaker-admin/sql';
import { equals } from 'shoemaker-utils/testing/assertions';

import { evaluateFlag } from '../../../src/flags.ts';
import {
  FlagDefinitions,
  FlagStore,
  MAX_FLAG_BYTES,
  MAX_FLAGS,
} from '../../../src/index.ts';
import { flagMigrations, flagStoreLayer } from '../../../src/sql.ts';
import { boolean, text } from '../../support/definitions.ts';

const TIMED_OUT = 60_000;

const Json = Schema.fromJsonString(Schema.Unknown);
const encodeJson = Schema.encodeEffect(Json);

const tagOf = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.match(effect, {
    onFailure: (error) => error._tag,
    onSuccess: () => 'done',
  });

export const migrated = <E, R>(
  database: Layer.Layer<SqlClient.SqlClient, E, R>,
) =>
  flagStoreLayer.pipe(
    Layer.provideMerge(runMigrations(flagMigrations).pipe(Layer.effectDiscard)),
    Layer.provideMerge(database),
  );

export const flagSuite = <E, R>(
  name: string,
  database: Effect.Effect<Layer.Layer<SqlClient.SqlClient, E>, never, R>,
  it: Pick<Vitest.MethodsNonLive<R>, 'effect'>,
) => {
  const test = <A, E2>(
    title: string,
    body: Effect.Effect<
      A,
      E2,
      FlagDefinitions | FlagStore | SqlClient.SqlClient | Scope.Scope
    >,
  ) => {
    it.effect(
      title,
      () =>
        Effect.flatMap(database, (layer) =>
          Effect.provide(body, migrated(layer).pipe(Layer.orDie)),
        ),
      TIMED_OUT,
    );
  };

  describe(`flags on ${name}`, () => {
    test(
      'are created, read, changed and deleted',
      Effect.gen(function* () {
        const store = yield* FlagStore;
        const { load } = yield* FlagDefinitions;
        const config = text('hello ünïcødé 😀');
        const made = yield* store.create(1, { key: 'greeting', config });
        assert.deepInclude(made, { key: 'greeting', config, version: 1 });
        yield* equals(store.get(1, made.id), made);
        yield* TestClock.adjust('1 hour');
        const next = text('bye');
        const changed = yield* store.update(1, made.id, {
          version: 1,
          config: next,
        });
        assert.deepInclude(changed, { config: next, version: 2 });
        assert.deepStrictEqual(changed.createdAt, made.createdAt);
        assert.notDeepEqual(changed.updatedAt, made.updatedAt);
        yield* equals(
          load(1),
          new Map([
            [
              'greeting',
              { id: made.id, key: 'greeting', config: next, version: 2 },
            ],
          ]),
        );
        yield* equals(tagOf(store.remove(1, made.id, 1)), 'FlagChanged');
        yield* equals(store.remove(1, made.id, 2), changed);
        yield* equals(load(1), new Map());
        yield* equals(tagOf(store.get(1, made.id)), 'FlagNotFound');
        yield* equals(tagOf(store.remove(1, made.id, 2)), 'FlagNotFound');
      }),
    );

    test(
      'of two projects may share a key, and are kept apart',
      Effect.gen(function* () {
        const store = yield* FlagStore;
        const { load } = yield* FlagDefinitions;
        const one = yield* store.create(1, {
          key: 'same',
          config: boolean([{ conditions: [], variant: 'on' }]),
        });
        yield* store.create(2, { key: 'same', config: boolean() });
        yield* equals(
          tagOf(store.create(1, { key: 'same', config: boolean() })),
          'FlagKeyTaken',
        );
        const answers = yield* Effect.forEach(
          [1, 2, 3],
          (project) =>
            Effect.map(load(project), (held) =>
              Arr.map([...held.values()], (flag) => {
                const found = evaluateFlag(flag, {});
                return found.kind === 'value' && found.value;
              }),
            ),
          { concurrency: 1 },
        );
        assert.deepStrictEqual(answers, [[true], [false], []]);
        // Another project's flag is not there to read, change or delete.
        yield* equals(tagOf(store.get(2, one.id)), 'FlagNotFound');
        yield* equals(
          tagOf(store.update(2, one.id, { version: 1, config: boolean() })),
          'FlagNotFound',
        );
        yield* equals(tagOf(store.remove(2, one.id, 1)), 'FlagNotFound');
      }),
    );

    test(
      'are listed by key',
      Effect.gen(function* () {
        const store = yield* FlagStore;
        for (const key of ['b', 'a', 'C']) {
          yield* store.create(1, { key, config: boolean() });
        }
        const listed = yield* store.list(1);
        assert.deepStrictEqual(
          Arr.map(listed, (flag) => flag.key),
          ['C', 'a', 'b'],
        );
      }),
    );

    test(
      'keep the change of the admin who read the newest',
      Effect.gen(function* () {
        const store = yield* FlagStore;
        const { id } = yield* store.create(1, { key: 'f', config: text('0') });
        const save = (version: number, value: string) =>
          store.update(1, id, { version, config: text(value) });
        yield* save(1, 'first');
        yield* equals(tagOf(save(1, 'second')), 'FlagChanged');
        const held = yield* store.get(1, id);
        assert.deepStrictEqual(held.config, text('first'));
      }),
    );

    test(
      'keep their type',
      Effect.gen(function* () {
        const store = yield* FlagStore;
        const { id } = yield* store.create(1, { key: 'f', config: boolean() });
        yield* equals(
          tagOf(store.update(1, id, { version: 1, config: text('x') })),
          'FlagTypeFixed',
        );
      }),
    );

    test(
      'that cannot be read spoil no other, and can be deleted',
      Effect.gen(function* () {
        const store = yield* FlagStore;
        const { load } = yield* FlagDefinitions;
        const sql = yield* SqlClient.SqlClient;
        yield* store.create(1, { key: 'good', config: boolean() });
        const bad = yield* store.create(1, { key: 'bad', config: boolean() });
        for (const stored of [
          '{"type":"boolean"',
          '{"type":"boolean","enabled":true,"variants":{"on":true},"defaultVariant":"on","rules":[],"until":1}',
        ]) {
          yield* sql`UPDATE edgehog_flag SET definition = ${stored}
            WHERE id = ${bad.id}`;
          const held = yield* load(1);
          assert.isNull(held.get('bad')?.config);
          assert.isNotNull(held.get('good')?.config);
        }
        // Nested past what a decoder can follow.
        const deep = `{"type":"object","variants":{"a":${Str.repeat(20_000)('{"a":')}0${Str.repeat(20_000)('}')}}}`;
        yield* sql`UPDATE edgehog_flag SET definition = ${deep}
          WHERE id = ${bad.id}`;
        const held = yield* load(1);
        assert.isNull(held.get('bad')?.config);
        assert.isNotNull(held.get('good')?.config);
        // Nor is it overwritten by one that cannot tell what it held.
        yield* equals(
          tagOf(store.update(1, bad.id, { version: 1, config: boolean() })),
          'FlagUnreadable',
        );
        const listed = yield* store.list(1);
        assert.deepStrictEqual(
          Arr.map(listed, (flag) => flag.config === null),
          [true, false],
        );
        yield* equals(tagOf(store.remove(1, bad.id, 1)), 'done');
      }),
    );

    test(
      'stop at the number a project may hold',
      Effect.gen(function* () {
        const store = yield* FlagStore;
        const { load } = yield* FlagDefinitions;
        const config = boolean();
        for (const at of Arr.range(1, MAX_FLAGS)) {
          yield* store.create(1, { key: `f${at}`, config });
        }
        const error = yield* Effect.flip(
          store.create(1, { key: 'one-more', config }),
        );
        assert.deepInclude(error, {
          _tag: 'FlagLimitReached',
          limit: 'flags',
          maximum: MAX_FLAGS,
        });
        yield* equals(
          tagOf(store.create(1, { key: 'f1', config })),
          'FlagKeyTaken',
        );
        const held = yield* load(1);
        assert.strictEqual(held.size, MAX_FLAGS);
        yield* equals(tagOf(store.create(2, { key: 'f1', config })), 'done');
      }),
    );

    test(
      'stop at the size a project may hold, when created and when changed',
      Effect.gen(function* () {
        const store = yield* FlagStore;
        // Two bytes each in UTF-8.
        const big = text(Str.repeat(MAX_FLAG_BYTES / 4)('é'));
        const first = yield* store.create(1, { key: 'a', config: big });
        const error = yield* Effect.flip(
          store.create(1, { key: 'b', config: big }),
        );
        assert.deepInclude(error, {
          _tag: 'FlagLimitReached',
          limit: 'bytes',
          maximum: MAX_FLAG_BYTES,
        });
        const second = yield* store.create(1, { key: 'b', config: text('') });
        yield* equals(
          tagOf(store.update(1, second.id, { version: 1, config: big })),
          'FlagLimitReached',
        );
        // Another project's flags are not counted.
        yield* equals(
          tagOf(store.create(2, { key: 'a', config: big })),
          'done',
        );
        // Its own size is not counted against itself.
        yield* equals(
          tagOf(store.update(1, first.id, { version: 1, config: big })),
          'done',
        );
        yield* equals(
          tagOf(store.update(1, first.id, { version: 2, config: text('') })),
          'done',
        );
        yield* equals(
          tagOf(store.update(1, second.id, { version: 1, config: big })),
          'done',
        );
      }),
    );

    test(
      'count the bytes of the key and of what is stored',
      Effect.gen(function* () {
        const store = yield* FlagStore;
        const sql = yield* SqlClient.SqlClient;
        const key = Str.repeat(100)('k');
        yield* store.create(1, { key, config: text('é') });
        const row = yield* SqlSchema.findOne({
          Request: Schema.Void,
          Result: Schema.Struct({
            size: Schema.Finite,
            definition: Schema.String,
          }),
          execute: () => sql`SELECT size, definition FROM edgehog_flag`,
        })(undefined);
        assert.strictEqual(
          row.size,
          100 + new TextEncoder().encode(row.definition).length,
        );
      }),
    );

    test(
      'are unavailable, not missing, when storage fails',
      Effect.gen(function* () {
        const { load } = yield* FlagDefinitions;
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DROP TABLE edgehog_flag`;
        yield* equals(tagOf(load(1)), 'FlagsUnavailable');
      }),
    );

    test(
      'are read by an index',
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const plan = yield* sql.onDialectOrElse({
          orElse: () =>
            sql.unsafe(
              'EXPLAIN QUERY PLAN SELECT id FROM edgehog_flag WHERE project_id = 1',
            ),
          pg: () =>
            Effect.andThen(
              sql.unsafe('SET enable_seqscan = off'),
              sql.unsafe(
                'EXPLAIN SELECT id FROM edgehog_flag WHERE project_id = 1',
              ),
            ),
        });
        const text = yield* encodeJson(plan);
        assert.include(text, 'edgehog_flag_key');
      }),
    );
  });
};
