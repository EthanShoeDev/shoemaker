import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import {
  type D1QueryTransport,
  makeD1DatabaseFromTransport,
  makeQueryDatabaseClientFrom,
} from '@alchemy.run/cloudflare/D1/QueryDatabaseHttpClient';
import * as DeployD1 from '@alchemy.run/cloudflare/D1/SQL';
import { D1Client } from '@effect/sql-d1';
import { PgliteClient } from '@effect/sql-pglite';
import { SqliteClient } from '@effect/sql-sqlite-node';
import { Array as Arr, Effect, Layer, Predicate, String as Str } from 'effect';

interface Query {
  readonly sql: string;
  readonly params?: ReadonlyArray<unknown>;
}

// One D1 database, on SQLite: a batch is one unit.
export const makeD1Server = () => {
  const database = new DatabaseSync(':memory:');
  const stats = { refused: 0 };
  let lostAt: string | undefined;
  const run = ({ sql, params = [] }: Query) => {
    if (lostAt !== undefined && Str.includes(lostAt)(sql)) {
      lostAt = undefined;
      throw new Error('The request was lost.');
    }
    return {
      results: database
        .prepare(sql)
        .all(...Arr.map(params, (param) => param as SQLInputValue)),
      success: true,
    };
  };
  const batch = (queries: ReadonlyArray<Query>) => {
    database.exec('BEGIN');
    try {
      const result = Arr.map(queries, run);
      database.exec('COMMIT');
      return result;
    } catch (error) {
      stats.refused += 1;
      database.exec('ROLLBACK');
      throw error;
    }
  };
  return {
    run,
    batch,
    stats,
    // Gives up, once, on reaching the first statement that has the text.
    abandon: (text: string) => {
      lostAt = text;
    },
  };
};

interface D1Options {
  readonly server?: ReturnType<typeof makeD1Server>;
  // Applies a batch and then fails, as a connection dropped meanwhile does.
  readonly loseReplies?: boolean;
}

const makeD1 = (options: D1Options = {}) => {
  const { loseReplies = false, server = makeD1Server() } = options;
  const answer = (body: Parameters<D1QueryTransport>[0]) => {
    if (!Predicate.hasProperty(body, 'batch')) {
      return { result: [server.run(body)] };
    }
    const result = server.batch(body.batch);
    if (loseReplies) throw new Error('The reply was lost.');
    return { result };
  };
  const transport: D1QueryTransport = (body) =>
    Effect.runPromise(Effect.sync(() => answer(body)));
  return makeD1DatabaseFromTransport(transport);
};

export const sqlite = SqliteClient.layer({ filename: ':memory:' });

export const d1 = (options?: D1Options) =>
  Layer.suspend(() => D1Client.layer({ db: makeD1(options) }));

// The client an Alchemy Action gets for a database that is already deployed.
export const deployD1 = Layer.suspend(() => {
  const client = Effect.succeed(makeD1()).pipe(makeQueryDatabaseClientFrom);
  return DeployD1.D1Layer(client);
});

export const pglite = PgliteClient.layer({});
