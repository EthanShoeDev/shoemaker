import { Effect, Layer } from 'effect';

import { backend, makeAuth, makeAuthOver } from './better-auth-support/auth.ts';
import { openSqlite, sqliteDatabase } from './better-auth-support/sqlite.ts';
import { operationsSuite } from './support/operations-suite.ts';
import { usersSuite } from './support/users-suite.ts';

const memory = Layer.unwrap(
  Effect.suspend(() => makeAuth({ user: [], session: [], account: [] })).pipe(
    Effect.map(backend),
  ),
);

const sqlite = Layer.unwrap(
  openSqlite.pipe(
    Effect.flatMap((db) => makeAuthOver(sqliteDatabase(db))),
    Effect.map(backend),
  ),
);

for (const suite of [usersSuite, operationsSuite]) {
  suite('Better Auth', memory);
  suite('Better Auth on SQLite', sqlite);
}
