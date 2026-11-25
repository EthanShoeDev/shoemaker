import { Array as Arr, DateTime, Effect, Predicate, Schema } from 'effect';
import { SqlClient } from 'effect/sql';

import { AtomicWrites } from './atomic.ts';

// One statement, with no parameters: the same on every database, or by dialect.
export type MigrationStatement =
  | string
  | { readonly sqlite: string; readonly pg: string };

export interface Migration {
  // Recorded once it is applied, so it never changes.
  readonly name: string;
  readonly statements: ReadonlyArray<MigrationStatement>;
}

export interface ProductMigrations {
  // Prefixes the product's tables, and names its history: `<product>_migrations`.
  readonly product: string;
  // In the order they apply.
  readonly migrations: ReadonlyArray<Migration>;
}

export class MigrationFailed extends Schema.TaggedError<
  MigrationFailed,
  { readonly brand: unique symbol }
>()('MigrationFailed', {
  product: Schema.String,
  migration: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Migration ${this.migration} of ${this.product} failed and was not recorded.`;
  }
}

const MAX_PRODUCT_LENGTH = 40;

// The product becomes part of a table name, which no driver can parameterize.
const ProductName = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_]*$/u),
  Schema.isMaxLength(MAX_PRODUCT_LENGTH),
);

const decodeProduct = Schema.decodeUnknownEffect(ProductName);

const decodeNames = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ name: Schema.String })),
);

export const migrationNames = (product: ProductMigrations) =>
  Arr.map(product.migrations, (migration) => migration.name);

const checkNames = (product: ProductMigrations) => {
  const names = migrationNames(product);
  return Arr.dedupe(names).length === names.length
    ? Effect.void
    : Effect.die(
        new Error(`Two migrations of ${product.product} share one name.`),
      );
};

// Applies what is not yet recorded, each migration together with its record, so
// none is ever half applied or half recorded. Returns the names it applied. Of
// two deploys at once, one applies a migration and the other finds it recorded.
export const runMigrations = Effect.fn('runMigrations')(function* (
  product: ProductMigrations,
) {
  const sql = yield* SqlClient.SqlClient;
  const atomic = yield* AtomicWrites.make;
  const name = yield* Effect.orDie(decodeProduct(product.product));
  yield* checkNames(product);
  const history = sql(`${name}_migrations`);

  const failed = (migration: string) => (cause: unknown) =>
    MigrationFailed.make({ product: name, migration, cause });

  const recorded = Effect.gen(function* () {
    const rows = yield* sql`SELECT name FROM ${history}`;
    const decoded = yield* Effect.orDie(decodeNames(rows));
    return new Set(Arr.map(decoded, (row) => row.name));
  });

  // Postgres may refuse the second of two IF NOT EXISTS at once; by then the
  // first has made the table, which the next read proves.
  const create = sql`CREATE TABLE IF NOT EXISTS ${history} (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`.pipe(
    Effect.catch((error) =>
      recorded.pipe(
        Effect.mapError(() => error),
        Effect.asVoid,
      ),
    ),
    Effect.mapError(failed(`${name}_migrations`)),
  );

  // Deploys take turns on Postgres, so the later one fails on what the earlier
  // one committed instead of deadlocking with it. SQLite has one writer anyway.
  const takeTurns = sql.onDialectOrElse({
    orElse: () => [],
    pg: () => [sql`LOCK TABLE ${history} IN EXCLUSIVE MODE`],
  });

  const render = (statement: MigrationStatement) =>
    sql.unsafe(
      Predicate.isString(statement)
        ? statement
        : sql.onDialectOrElse({
            orElse: () => statement.sqlite,
            pg: () => statement.pg,
          }),
    );

  const apply = Effect.fnUntraced(function* (migration: Migration) {
    const now = yield* DateTime.now;
    return yield* atomic
      .run([
        ...takeTurns,
        ...Arr.map(migration.statements, render),
        sql`INSERT INTO ${history} (name, applied_at)
          VALUES (${migration.name}, ${DateTime.formatIso(now)})`,
      ])
      .pipe(
        Effect.as(true),
        // Another deploy may have applied it first, or the reply to ours may
        // have been lost. Drivers classify both too differently to tell apart
        // by the error, so the record decides.
        Effect.catch((error) =>
          recorded.pipe(
            Effect.mapError(() => error),
            Effect.flatMap((names) =>
              names.has(migration.name)
                ? Effect.succeed(false)
                : Effect.fail(error),
            ),
          ),
        ),
        Effect.mapError(failed(migration.name)),
      );
  });

  yield* sql.onDialectOrElse({
    orElse: () =>
      Effect.die(
        new Error(
          `${name} supports SQLite, D1 and Postgres, not this database.`,
        ),
      ),
    sqlite: () => Effect.void,
    pg: () => Effect.void,
  });
  yield* create;
  const done = yield* Effect.mapError(recorded, failed(`${name}_migrations`));
  const pending = Arr.filter(
    product.migrations,
    (migration) => !done.has(migration.name),
  );
  const applied = yield* Effect.filter(pending, apply, { concurrency: 1 });
  const names = Arr.map(applied, (migration) => migration.name);
  if (Arr.isReadonlyArrayNonEmpty(names)) {
    yield* Effect.logInfo(
      `Applied ${name} migrations: ${Arr.join(names, ', ')}`,
    );
  }
  return names;
});
