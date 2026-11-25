import * as Cloudflare from '@alchemy.run/cloudflare';
import { Credentials } from '@alchemy.run/cloudflare/Credentials';
import * as SQL from '@alchemy.run/cloudflare/D1/SQL';
import { afterEach, assert, describe, it, vi } from '@effect/vitest';
import * as Output from 'alchemy/Output';
import { type CompiledStack, make as makeStack, Stack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import { inMemoryState } from 'alchemy/State';
import { Effect, Layer, Record as Rec, Schema } from 'effect';
import { FetchHttpClient, HttpServerResponse } from 'effect/http';

import { grantAdmins, migrate, migrateHost } from '../src/alchemy.ts';
import { adminMigrations } from '../src/sql.ts';

const AppDb = Cloudflare.D1.Database('AppDb');

const deployDatabase = Effect.map(AppDb, (db) => ({
  identity: db.databaseId,
  client: Effect.map(Cloudflare.D1.QueryDatabase(db), SQL.D1Layer).pipe(
    Effect.provide(Cloudflare.D1.QueryDatabaseLocal),
  ),
}));

// The README's three wirings. That they compile is part of the test.
class Api extends Cloudflare.Worker<Api>()(
  'Api',
  { main: import.meta.url },
  Effect.gen(function* () {
    yield* Cloudflare.D1.QueryDatabase(AppDb);
    if (globalThis.__ALCHEMY_RUNTIME__ !== true) {
      yield* migrateHost('AdminMigrate', adminMigrations, deployDatabase);
    }
    return { fetch: Effect.succeed(HttpServerResponse.empty()) };
  }).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseBinding)),
) {}

const program = Effect.gen(function* () {
  const database = yield* deployDatabase;
  const migrated = yield* migrate('PlainMigrate', adminMigrations, database);
  yield* Cloudflare.Worker('Plain', {
    main: './plain.ts',
    env: { ADMIN_MIGRATIONS: Output.map(migrated.applied, String) },
  });

  const api = yield* Api;
  yield* grantAdmins('Admins', ['ada@example.com'], {
    ...database,
    after: [api.url],
  });
});

type CloudflareServices = Exclude<Effect.Services<typeof program>, Stack>;

// Reads the stack without planning or deploying it. Anything that asks for the
// account or its credentials dies.
const noAccount = Layer.mergeAll(
  Layer.succeed(
    Cloudflare.CloudflareEnvironment,
    Effect.die(new Error('A test asked for the Cloudflare account.')),
  ),
  Layer.succeed(
    Credentials,
    Effect.die(new Error('A test asked for Cloudflare credentials.')),
  ),
  FetchHttpClient.layer,
);

const read = makeStack<CloudflareServices>({
  name: 'test',
  // The providers themselves are for planning, so none is here.
  providers: noAccount as Layer.Layer<CloudflareServices>,
  state: inMemoryState(),
})(program).pipe(
  Effect.provideService(Stage, 'test'),
  Effect.provide(noAccount),
  (effect) =>
    // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- services that only planning or deploying would use
    effect as Effect.Effect<CompiledStack>,
);

const decodeProps = Schema.decodeUnknownEffect(
  Schema.Struct({ env: Schema.Unknown }),
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a Worker in a stack', () => {
  it.effect('is deployed after the migrations, and the grant after it', () =>
    Effect.gen(function* () {
      const { actions, resources } = yield* read;
      const env = (id: string) =>
        Effect.map(decodeProps(resources[id]?.Props), (props) =>
          Output.upstreamAny(props.env),
        );
      const apiEnv = yield* env('Api');
      const plainEnv = yield* env('Plain');
      assert.sameMembers(Rec.keys(actions), [
        'AdminMigrate',
        'PlainMigrate',
        'Admins',
      ]);
      assert.hasAllKeys(apiEnv, ['AdminMigrate']);
      assert.hasAllKeys(plainEnv, ['PlainMigrate']);
      assert.hasAllKeys(Output.upstreamAny(actions.AdminMigrate?.Input), [
        'AppDb',
      ]);
      assert.hasAllKeys(Output.upstreamAny(actions.Admins?.Captures), [
        'Api',
        'AppDb',
      ]);
      // The server's URL orders the grant without deciding whether it runs.
      assert.hasAllKeys(Output.upstreamAny(actions.Admins?.Input), ['AppDb']);
    }),
  );
});

describe('migrateHost', () => {
  const unused = Effect.die(new Error('The database was asked for.'));

  it.effect('does nothing in the deployed host', () => {
    vi.stubGlobal('__ALCHEMY_RUNTIME__', true);
    const stack = {
      name: 't',
      stage: 't',
      resources: {},
      bindings: {},
      actions: {},
    };
    return migrateHost('M', adminMigrations, unused).pipe(
      Effect.provideService(Stack, stack),
      Effect.andThen(
        Effect.sync(() => {
          assert.isEmpty(stack.actions);
        }),
      ),
    );
  });

  it.effect('does nothing outside a stack', () =>
    migrateHost('M', adminMigrations, unused),
  );

  it.effect(
    'dies in a stack but outside a host, where it could order nothing',
    () =>
      Effect.gen(function* () {
        const stack = {
          name: 't',
          stage: 't',
          resources: {},
          bindings: {},
          actions: {},
        };
        const exit = yield* migrateHost('M', adminMigrations, unused).pipe(
          Effect.provideService(Stack, stack),
          Effect.exit,
        );
        assert.include(String(exit), 'outside a host');
      }),
  );
});
