import { Array as Arr, Effect, Layer, Option } from 'effect';
import { Cookies, Headers } from 'effect/http';

import {
  AdminSessions,
  type NewAuditEntry,
  UserDirectory,
} from '../../src/index.ts';
import { Accounts } from '../support/accounts.ts';
import {
  backend,
  cookieHeader,
  makeAuth,
  type TestAuth,
  type TestDb,
} from './auth.ts';
import { failing, recording, send } from './send.ts';

export const HOUR = 3_600_000;

export const withCookie = (cookie: string) => Headers.fromInput({ cookie });

// An admin, a customer and everything needed to act as them.
export const worldOf = Effect.fnUntraced(function* (auth: TestAuth) {
  const services = yield* Layer.build(backend(auth));
  const entries: Array<NewAuditEntry> = [];
  const provide = Effect.provide(
    Layer.merge(Layer.succeedContext(services), recording(entries)),
  );
  const accounts = yield* Accounts.pipe(provide);
  const directory = yield* UserDirectory.pipe(provide);
  const sessions = yield* AdminSessions.pipe(provide);
  const ada = yield* accounts.create({
    email: 'ada@example.com',
    roles: 'admin',
  });
  const bob = yield* accounts.create({ email: 'bob@example.com' });
  const adaCookie = yield* accounts.signIn(ada.id);
  const impersonate = directory
    .impersonate({ id: bob.id, headers: withCookie(adaCookie) })
    .pipe(
      Effect.map(({ cookies }) =>
        cookies.pipe(Cookies.toSetCookieHeaders, cookieHeader),
      ),
    );
  return {
    auth,
    accounts,
    directory,
    sessions,
    ada,
    bob,
    adaCookie,
    impersonate,
    entries,
    send: (sent: Parameters<typeof send>[1]) => send(auth, sent).pipe(provide),
    sendUnaudited: (sent: Parameters<typeof send>[1]) =>
      Effect.provide(send(auth, sent), failing),
  };
});

// The same over an in-memory database to look in.
export const world = Effect.fnUntraced(function* (
  extra: Parameters<typeof makeAuth>[1] = {},
  beside: Parameters<typeof makeAuth>[2] = {},
) {
  const db: TestDb = { user: [], session: [], account: [] };
  const auth = yield* makeAuth(db, extra, beside);
  return { db, ...(yield* worldOf(auth)) };
});

export const sessionsOf = (db: TestDb, userId: string) =>
  Arr.filter(db.session, (row) => row.userId === userId);

export const userRow = (db: TestDb, id: string) =>
  Arr.findFirst(db.user, (row) => row.id === id).pipe(Option.getOrThrow);
