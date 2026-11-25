import { DatabaseSync } from 'node:sqlite';

import { Database } from '@alchemy.run/better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { Effect, Layer, Schema, String as Str } from 'effect';

import { adminPlugin } from '../../src/better-auth.ts';
import { access } from '../support/access.ts';
import { options } from './auth.ts';

const D1_PARAMETERS = 100;

class TooManyParameters extends Schema.TaggedError<
  TooManyParameters,
  { readonly brand: unique symbol }
>()('TooManyParameters', { sql: Schema.String }) {}

// SQLite with D1's limit.
class LimitedDatabase extends DatabaseSync {
  override prepare(sql: string) {
    if (Str.split(sql, '?').length - 1 > D1_PARAMETERS) {
      throw TooManyParameters.make({ sql });
    }
    return super.prepare(sql);
  }
}

// Better Auth's own SQL adapter over an empty database with its tables.
export const openSqlite = Effect.acquireRelease(
  Effect.promise(() => {
    const db = new LimitedDatabase(':memory:');
    return getMigrations({
      ...options,
      database: db,
      plugins: [adminPlugin(access)],
    })
      .then(({ runMigrations }) => runMigrations())
      .then(() => db);
  }),
  (db) => Effect.sync(() => db.close()),
);

export const sqliteDatabase = (db: DatabaseSync) =>
  Layer.succeed(Database, {
    provider: 'sqlite',
    runtime: Effect.succeed(db),
  });
