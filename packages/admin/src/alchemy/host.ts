import type { Output } from 'alchemy/Output';
import { CurrentRuntimeContext, sanitizeKey } from 'alchemy/RuntimeContext';
import { Stack } from 'alchemy/Stack';
import { Effect, Option } from 'effect';

import type { ProductMigrations } from '../product/migrations.ts';
import type { DeployDatabase } from './actions.ts';

// `migrate` for a Worker or Function that is a class, whose props can't depend
// on an Action: they are evaluated in the deployed bundle too. Called from the
// host's init, it registers the Action and puts its output in the host's
// environment, so the host is deployed after its tables exist.
//
// Does nothing in the deployed host, and outside a stack. Put it behind
// `if (globalThis.__ALCHEMY_RUNTIME__ !== true)`, which Alchemy's bundler removes, and
// what `database` imports stays out of the bundle as well.
export const migrateHost = <E, RIn, R, R2>(
  id: string,
  product: ProductMigrations,
  database: Effect.Effect<DeployDatabase<E, RIn, R>, never, R2>,
): Effect.Effect<void> => {
  if (globalThis.__ALCHEMY_RUNTIME__ === true) return Effect.void;
  const bind = Effect.gen(function* () {
    const stack = yield* Effect.serviceOption(Stack);
    if (Option.isNone(stack)) return;
    const host = yield* CurrentRuntimeContext;
    if (host === undefined) {
      return yield* Effect.die(
        new Error(`migrateHost('${id}') was called outside a host's init.`),
      );
    }
    // dynamic-import -- deployed bundles drop the branch, and this with it
    const { migrate } = yield* Effect.promise(() => import('./actions.ts'));
    const target = yield* database;
    const migrated = yield* migrate(id, product, target);
    yield* host.set(sanitizeKey(id), migrated as Output);
  });
  // oxlint-disable-next-line effecttsgo/unsafe-effect-type-assertion -- the database's and Action's services are there whenever a stack is read, but a host's init type admits only runtime ones; a missing one fails the plan
  return bind as Effect.Effect<void>;
};
