import { Action, type Input } from 'alchemy';
import type { Output } from 'alchemy/Output';
import { Effect, type Layer } from 'effect';
import type { SqlClient } from 'effect/sql';

import {
  migrationNames,
  runMigrations,
  type ProductMigrations,
} from '../product/migrations.ts';
import { normalizeEmails, promoteAdmins } from '../sql/promote-admins.ts';

// The host's database as the deploy reaches it.
//
// On Cloudflare D1:
//
//   {
//     identity: db.databaseId,
//     client: Effect.map(Cloudflare.D1.QueryDatabase(db), SQL.D1Layer).pipe(
//       Effect.provide(Cloudflare.D1.QueryDatabaseLocal),
//     ),
//   }
export interface DeployDatabase<E, RIn, R> {
  // Not secret: it is kept in the deploy's state. A new one runs every
  // migration again, and every grant.
  readonly identity: Input<string>;
  // Runs while the stack is read. The layer it returns is built when the Action
  // runs.
  readonly client: Effect.Effect<
    Layer.Layer<SqlClient.SqlClient, E, RIn>,
    never,
    R
  >;
  // What must be deployed first. It is waited for without being part of the
  // input that decides whether to run.
  readonly after?: ReadonlyArray<Output<unknown, never>>;
}

// Yielded in an Action's init, an output becomes a dependency of the Action.
const connect = <E, RIn, R>(database: DeployDatabase<E, RIn, R>) =>
  Effect.gen(function* () {
    for (const output of database.after ?? []) {
      // oxlint-disable-next-line effecttsgo/floating-effect -- yielding captures it; its value is not used
      yield* output;
    }
    return yield* database.client;
  });

// Registers an Action under `id` that applies the product's migrations, and
// returns the names it applied. Make what serves the product depend on that
// output, so no request arrives before its tables.
//
// Runs when the list of migrations or the database changes, or after a failure.
export const migrate = <E, RIn, R>(
  id: string,
  product: ProductMigrations,
  database: DeployDatabase<E, RIn, R>,
) =>
  // Defined here and not once for the module: an Action's captures belong to
  // its definition, and they name this database.
  Action(
    'Shoemaker.Migrate',
    Effect.map(
      connect(database),
      (client) =>
        (_input: {
          readonly product: string;
          readonly migrations: ReadonlyArray<string>;
          readonly database: string;
        }) =>
          runMigrations(product).pipe(
            Effect.map((applied) => ({ applied })),
            // oxlint-disable-next-line effecttsgo/strict-effect-provide -- an Action's body is the entry point of its deploy step
            Effect.provide(client),
            Effect.scoped,
          ),
    ),
  )(id, {
    product: product.product,
    migrations: migrationNames(product),
    database: database.identity,
  });

// Registers an Action under `id` that gives `admin` to every listed account.
//
// Runs when the list or the database changes, or after a failure, so a
// demotion made in the admin stands until then. It needs Better Auth's tables,
// so `after` names an output that comes after them, such as the server's URL.
export const grantAdmins = <E, RIn, R>(
  id: string,
  emails: ReadonlyArray<string>,
  database: DeployDatabase<E, RIn, R>,
) =>
  Action(
    'Shoemaker.GrantAdmins',
    Effect.map(
      connect(database),
      (client) =>
        (input: {
          readonly emails: ReadonlyArray<string>;
          readonly database: string;
        }) =>
          promoteAdmins(input.emails).pipe(
            Effect.map((granted) => ({ granted })),
            // oxlint-disable-next-line effecttsgo/strict-effect-provide -- an Action's body is the entry point of its deploy step
            Effect.provide(client),
            Effect.scoped,
          ),
    ),
  )(id, { emails: normalizeEmails(emails), database: database.identity });
