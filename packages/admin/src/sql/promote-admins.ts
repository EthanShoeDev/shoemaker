import { Array as Arr, Effect, Schema, String as Str } from 'effect';
import { SqlClient } from 'effect/sql';

import { parseRoles } from '../core/roles.ts';

const ADMIN = 'admin';

// D1 takes at most 100 parameters.
const EMAILS_PER_QUERY = 50;

// A role read and written back, against another write in between.
const MAX_ATTEMPTS = 5;

export class AdminNotSignedUp extends Schema.TaggedError<
  AdminNotSignedUp,
  { readonly brand: unique symbol }
>()('AdminNotSignedUp', { emails: Schema.Array(Schema.String) }) {
  override get message() {
    return `No account for ${Arr.join(this.emails, ', ')}: sign up once, then deploy again.`;
  }
}

export class AdminRoleContended extends Schema.TaggedError<
  AdminRoleContended,
  { readonly brand: unique symbol }
>()('AdminRoleContended', { email: Schema.String }) {
  override get message() {
    return `The roles of ${this.email} kept changing while admin was being granted: deploy again.`;
  }
}

const decodeAccounts = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      email: Schema.String,
      role: Schema.NullOr(Schema.String),
    }),
  ),
);

// `ADMIN_EMAILS`, separated by commas or whitespace. Sorted and without
// repeats, so the same people always give the same list.
export const parseAdminEmails = (value: string) =>
  normalizeEmails(Str.split(value, /[\s,]+/u));

export const normalizeEmails = (emails: ReadonlyArray<string>) =>
  Arr.sort(
    Arr.dedupe(
      Arr.filter(
        Arr.map(emails, (email) => Str.toLowerCase(Str.trim(email))),
        Str.isNonEmpty,
      ),
    ),
    Str.Order,
  );

// Gives the admin role to every listed account, beside its other roles, then
// fails if a listed email has none. Returns the emails that hold it now.
export const promoteAdmins = Effect.fn('promoteAdmins')(function* (
  emails: ReadonlyArray<string>,
) {
  const wanted = normalizeEmails(emails);
  if (!Arr.isReadonlyArrayNonEmpty(wanted)) return [];
  const sql = yield* SqlClient.SqlClient;

  const find = (list: ReadonlyArray<string>) =>
    sql`SELECT email, role FROM ${sql('user')}
      WHERE LOWER(email) IN ${sql.in(list)}`.pipe(
      Effect.flatMap((rows) => Effect.orDie(decodeAccounts(rows))),
    );

  const grant = Effect.fnUntraced(function* (account: {
    readonly email: string;
    readonly role: string | null;
  }) {
    const roles = parseRoles(account.role);
    if (Arr.contains(roles, ADMIN)) return true;
    const unchanged =
      account.role === null ? sql`role IS NULL` : sql`role = ${account.role}`;
    const updated = yield* sql`UPDATE ${sql('user')}
      SET role = ${Arr.join(Arr.append(roles, ADMIN), ',')}
      WHERE email = ${account.email} AND ${unchanged}
      RETURNING email`;
    return updated.length > 0;
  });

  const attempt = Effect.fnUntraced(function* (email: string) {
    const accounts = yield* find([email]);
    const granted = yield* Effect.forEach(accounts, grant, { concurrency: 1 });
    return Arr.every(granted, (done) => done);
  });

  const retry = Effect.fnUntraced(function* (email: string) {
    for (let tries = 1; tries < MAX_ATTEMPTS; tries++) {
      if (yield* attempt(email)) return;
    }
    return yield* AdminRoleContended.make({ email });
  });

  const pages = yield* Effect.forEach(
    Arr.chunksOf(wanted, EMAILS_PER_QUERY),
    find,
    { concurrency: 1 },
  );
  const accounts = Arr.flatten(pages);
  const contended = yield* Effect.filter(
    accounts,
    (account) => Effect.map(grant(account), (done) => !done),
    { concurrency: 1 },
  );
  yield* Effect.forEach(
    contended,
    (account) => retry(Str.toLowerCase(account.email)),
    { concurrency: 1, discard: true },
  );

  const found = Arr.dedupe(
    Arr.map(accounts, (account) => Str.toLowerCase(account.email)),
  );
  const missing = Arr.difference(wanted, found);
  if (Arr.isReadonlyArrayNonEmpty(missing)) {
    return yield* AdminNotSignedUp.make({ emails: missing });
  }
  return found;
});
