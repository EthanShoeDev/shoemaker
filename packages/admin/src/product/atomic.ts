import { Context, Effect, Layer, Predicate } from 'effect';
import { SqlClient, type SqlError, type Statement } from 'effect/sql';

// Any statement: what it returns is not this service's business.
// oxlint-disable-next-line typescript/no-explicit-any -- Statement is invariant in its row type
export type AnyStatement = Statement.Statement<any>;

interface Batching {
  readonly batch: (
    statements: ReadonlyArray<AnyStatement>,
  ) => Effect.Effect<unknown, SqlError.SqlError>;
}

// `@effect/sql-d1` marks its clients with this, and so does Alchemy's
// deploy-time one. Spelled out so that the package needs neither.
const D1_CLIENT = '~@effect/sql-d1/D1Client';

const isBatching = (
  sql: SqlClient.SqlClient,
): sql is Batching & SqlClient.SqlClient =>
  Predicate.hasProperty(sql, D1_CLIENT) &&
  Predicate.hasProperty(sql, 'batch') &&
  Predicate.isFunction(sql.batch);

// Statements that happen together or not at all. D1 has no transactions but
// runs a batch as one, and the others are the reverse.
export class AtomicWrites extends Context.Service<
  AtomicWrites,
  {
    readonly run: (
      statements: ReadonlyArray<AnyStatement>,
    ) => Effect.Effect<void, SqlError.SqlError>;
  }
>()('shoemaker-admin/product/atomic/AtomicWrites') {
  static readonly make = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const run = isBatching(sql)
      ? (statements: ReadonlyArray<AnyStatement>) =>
          Effect.asVoid(sql.batch(statements))
      : (statements: ReadonlyArray<AnyStatement>) =>
          sql.withTransaction(
            Effect.forEach(statements, (statement) => statement, {
              concurrency: 1,
              discard: true,
            }),
          );
    return AtomicWrites.of({ run });
  });

  static readonly layer = Layer.effect(AtomicWrites, AtomicWrites.make);
}
