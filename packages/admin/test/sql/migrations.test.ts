import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Ref, String as Str } from 'effect';
import { SqlClient, Statement } from 'effect/sql';
import { equals } from 'shoemaker-utils/testing/assertions';
import { d1, sqlite } from 'shoemaker-utils/testing/databases';

import { runMigrations } from '../../src/product/migrations.ts';
import { adminMigrations } from '../../src/sql/admin-migrations.ts';
import {
  parseAdminEmails,
  promoteAdmins,
} from '../../src/sql/promote-admins.ts';

describe('a lost reply', () => {
  it.effect('is not a failed migration when its record is there', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations(adminMigrations);
      const rows = yield* sql`SELECT name FROM admin_migrations`;
      assert.strictEqual(rows.length, adminMigrations.migrations.length);
      yield* equals(sql`SELECT target_kind FROM admin_audit_log`, []);
      yield* equals(runMigrations(adminMigrations), []);
    }).pipe(Effect.provide(d1({ loseReplies: true }))),
  );
});

describe('a new, empty database', () => {
  it.effect('gets every migration again', () =>
    Effect.gen(function* () {
      const names = Arr.map(adminMigrations.migrations, ({ name }) => name);
      const migrated = runMigrations(adminMigrations);
      yield* equals(Effect.provide(migrated, sqlite), names);
      yield* equals(Effect.provide(migrated, sqlite), names);
    }),
  );
});

describe('ADMIN_EMAILS', () => {
  it('is a list without order, case or repeats', () => {
    assert.deepStrictEqual(
      parseAdminEmails(' b@x.com, A@x.com\n a@x.com ,, c@x.com '),
      ['a@x.com', 'b@x.com', 'c@x.com'],
    );
    assert.deepStrictEqual(parseAdminEmails(''), []);
    assert.deepStrictEqual(parseAdminEmails(' , '), []);
  });
});

describe('a role that changes while admin is granted', () => {
  // Runs `between` before each UPDATE of the grant, as another write would.
  const granting = <E>(between: (grant: number) => Effect.Effect<unknown, E>) =>
    Effect.gen(function* () {
      const grants = yield* Ref.make(0);
      return yield* promoteAdmins(['ada@example.com']).pipe(
        Effect.provideService(Statement.CurrentTransformer, (statement) =>
          Effect.gen(function* () {
            const [text] = statement.compile();
            if (Str.startsWith('UPDATE')(text)) {
              const grant = yield* Ref.updateAndGet(grants, (n) => n + 1);
              yield* Effect.orDie(between(grant));
            }
            return statement;
          }).pipe(
            Effect.provideService(Statement.CurrentTransformer, undefined),
          ),
        ),
      );
    });

  const setup = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE ${sql('user')} (email TEXT, role TEXT)`;
    yield* sql`INSERT INTO ${sql('user')} VALUES ('ada@example.com', 'user')`;
    return sql;
  });

  it.effect('keeps the new role too', () =>
    Effect.gen(function* () {
      const sql = yield* setup;
      yield* granting((grant) =>
        grant === 1
          ? sql`UPDATE ${sql('user')} SET role = 'host'`
          : Effect.void,
      );
      yield* equals(sql`SELECT role FROM ${sql('user')}`, [
        { role: 'host,admin' },
      ]);
    }).pipe(Effect.provide(sqlite)),
  );

  it.effect('gives up after a few tries', () =>
    Effect.gen(function* () {
      const sql = yield* setup;
      const error = yield* Effect.flip(
        granting(
          (grant) => sql`UPDATE ${sql('user')} SET role = ${`role-${grant}`}`,
        ),
      );
      assert.strictEqual(error._tag, 'AdminRoleContended');
    }).pipe(Effect.provide(sqlite)),
  );
});
