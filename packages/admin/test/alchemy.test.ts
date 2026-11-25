import { assert, describe, it } from '@effect/vitest';
import { type ActionLike, isAction } from 'alchemy/Action';
import { makeResolveContext } from 'alchemy/ActionRuntimeContext';
import * as Output from 'alchemy/Output';
import * as Plan from 'alchemy/Plan';
import { RuntimeContext } from 'alchemy/RuntimeContext';
import { Stack, type StackSpec } from 'alchemy/Stack';
import { type ActionState, InMemoryService, State } from 'alchemy/State';
import { hashInput } from 'alchemy/Util/sha256';
import { Array as Arr, Context, Effect, Layer, Record as Rec } from 'effect';
import { SqlClient } from 'effect/sql';
import { equals } from 'shoemaker-utils/testing/assertions';
import { deployD1, sqlite } from 'shoemaker-utils/testing/databases';

import { grantAdmins, migrate } from '../src/alchemy.ts';
import { adminMigrations } from '../src/sql.ts';

const STACK = 'test';
const STAGE = 'test';

const at = (identity: string) => ({ identity, client: Effect.succeed(sqlite) });

// Registers an Action on a stack of its own and returns the one node there.
// Nothing is planned and no provider is involved.
const register = <E>(action: Effect.Effect<unknown, E, Stack>) =>
  Effect.gen(function* () {
    const stack: Omit<StackSpec, 'output'> = {
      name: STACK,
      stage: STAGE,
      resources: {},
      bindings: {},
      actions: {},
    };
    yield* action.pipe(Effect.provideService(Stack, stack));
    const node = yield* Arr.findFirst(Rec.values(stack.actions), isAction).pipe(
      Effect.fromOption,
      Effect.orDie,
    );
    return { node, stack };
  });

const input = (node: ActionLike) =>
  Output.evaluate(node.Input, {}).pipe(
    Effect.provideService(State, InMemoryService()),
  );

const hash = <E>(action: Effect.Effect<unknown, E, Stack>) =>
  register(action).pipe(
    Effect.flatMap(({ node }) => input(node)),
    Effect.flatMap(hashInput),
  );

const run = (node: ActionLike, captures: Record<string, unknown> = {}) =>
  Effect.gen(function* () {
    const value: unknown = yield* input(node);
    return yield* node
      .Run(value)
      .pipe(
        Effect.provideService(RuntimeContext, makeResolveContext(captures)),
      ) as Effect.Effect<unknown, unknown>;
  });

// Whether a deploy would run the Action again, given how it ended last time.
// The state is in memory, so this reads no state store.
const planned = <E>(
  action: Effect.Effect<unknown, E, Stack>,
  last: { readonly status: ActionState['status']; readonly inputHash: string },
) =>
  Effect.gen(function* () {
    const { node, stack } = yield* register(action);
    const state: ActionState = {
      kind: 'action',
      actionType: node.Type,
      namespace: undefined,
      fqn: node.FQN,
      logicalId: node.LogicalId,
      downstream: [],
      inputHash: last.inputHash,
      input: {},
      ...(last.status === 'ran'
        ? { status: last.status, output: {} }
        : { status: last.status }),
    };
    const memory = InMemoryService();
    const store = yield* memory;
    yield* store.set({
      stack: STACK,
      stage: STAGE,
      fqn: node.FQN,
      value: state,
    });
    const plan = yield* Plan.make({ ...stack, output: undefined }).pipe(
      Effect.provideService(State, memory),
    );
    return plan.actions[node.FQN]?.action;
  });

describe('migrate', () => {
  const names = Arr.map(adminMigrations.migrations, ({ name }) => name);

  it.effect('holds the migration names and the database in its input', () =>
    Effect.gen(function* () {
      const { node } = yield* register(
        migrate('AdminMigrate', adminMigrations, at('db-1')),
      );
      yield* equals(input(node), {
        product: 'admin',
        migrations: names,
        database: 'db-1',
      });
    }),
  );

  it.effect('changes its input with the migrations and the database', () =>
    Effect.gen(function* () {
      const more = {
        ...adminMigrations,
        migrations: [
          ...adminMigrations.migrations,
          { name: 'next', statements: [] },
        ],
      };
      const hashes = [
        yield* hash(migrate('M', adminMigrations, at('db-1'))),
        yield* hash(migrate('M', adminMigrations, at('db-2'))),
        yield* hash(migrate('M', more, at('db-1'))),
      ];
      assert.strictEqual(Arr.dedupe(hashes).length, hashes.length);
      yield* equals(hash(migrate('M', adminMigrations, at('db-1'))), hashes[0]);
    }),
  );

  it.effect('runs the migrations through the deploy-time D1 client', () =>
    Effect.gen(function* () {
      const { node } = yield* register(
        migrate('M', adminMigrations, {
          identity: 'db-1',
          client: Effect.succeed(deployD1),
        }),
      );
      yield* equals(run(node), { applied: names });
    }),
  );

  it.effect('waits for what the client yields, without hashing it', () =>
    Effect.gen(function* () {
      const url = Output.literal('https://api.example.com');
      const action = migrate('M', adminMigrations, {
        identity: 'db-1',
        client: Effect.gen(function* () {
          const read = yield* url;
          return Layer.unwrap(Effect.as(read, sqlite));
        }),
      });
      const { node } = yield* register(action);
      assert.strictEqual(Rec.size(node.Captures), 1);
      const plain = yield* hash(migrate('M', adminMigrations, at('db-1')));
      yield* equals(hash(action), plain);
    }),
  );
});

describe('grantAdmins', () => {
  const list = ['Ada@example.com', 'bob@example.com'];
  const same = ['bob@example.com', ' ada@example.com', 'BOB@example.com'];

  it.effect('changes its input with the people and the database only', () =>
    Effect.gen(function* () {
      const first = yield* hash(grantAdmins('G', list, at('db-1')));
      yield* equals(hash(grantAdmins('G', same, at('db-1'))), first);
      const others = [
        first,
        yield* hash(grantAdmins('G', ['bob@example.com'], at('db-1'))),
        yield* hash(grantAdmins('G', [], at('db-1'))),
        yield* hash(grantAdmins('G', list, at('db-2'))),
      ];
      assert.strictEqual(Arr.dedupe(others).length, others.length);
    }),
  );

  it.effect('runs again after a failure, and not with the same list', () =>
    Effect.gen(function* () {
      const action = grantAdmins('G', list, at('db-1'));
      const inputHash = yield* hash(action);
      yield* equals(planned(action, { status: 'running', inputHash }), 'run');
      // So a role taken away in the admin is not given back.
      yield* equals(planned(action, { status: 'ran', inputHash }), 'noop');
      yield* equals(
        planned(grantAdmins('G', ['cyd@example.com'], at('db-1')), {
          status: 'ran',
          inputHash,
        }),
        'run',
      );
    }),
  );

  it.effect('fails for an email without an account, then grants it', () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(sqlite);
      const { node } = yield* register(
        grantAdmins('G', list, {
          identity: 'db-1',
          client: context.pipe(Layer.succeedContext, Effect.succeed),
        }),
      );
      const sql = context.pipe(Context.get(SqlClient.SqlClient));
      yield* sql`CREATE TABLE ${sql('user')} (email TEXT, role TEXT)`;
      yield* sql`INSERT INTO ${sql('user')} VALUES ('ada@example.com', 'host')`;
      const error = yield* Effect.flip(run(node));
      assert.include(String(error), 'bob@example.com');
      yield* sql`INSERT INTO ${sql('user')} VALUES ('bob@example.com', 'user')`;
      yield* equals(run(node), {
        granted: ['ada@example.com', 'bob@example.com'],
      });
      yield* equals(sql`SELECT role FROM ${sql('user')} ORDER BY email`, [
        { role: 'host,admin' },
        { role: 'user,admin' },
      ]);
    }),
  );

  it.effect('does nothing for an empty list', () =>
    Effect.gen(function* () {
      const { node } = yield* register(grantAdmins('G', [], at('db-1')));
      yield* equals(run(node), { granted: [] });
    }),
  );
});
