import { Context, DateTime, type Effect, type Option } from 'effect';
import type { Cookies, Headers } from 'effect/http';

import type {
  EmailTaken,
  Forbidden,
  LinkNotSent,
  UserNotFound,
} from './errors.ts';
import type { AdminUser, AdminUserPage } from './users.ts';

export interface Ban {
  readonly reason: string | null;
  // Null is a ban without an end.
  readonly expiresAt: DateTime.Utc | null;
}

// A ban that has ended is no ban.
export const isBanActive = (ban: Ban | null, now: DateTime.Utc) =>
  ban !== null &&
  (ban.expiresAt === null || DateTime.isGreaterThan(ban.expiresAt, now));

export interface AdminSession {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly roles: ReadonlyArray<string>;
    // As stored, even when it has expired: the core decides.
    readonly ban: Ban | null;
  };
  // The admin's user id, when the session was started by impersonation.
  readonly impersonatedBy: string | null;
}

// Who a request's headers belong to. Reads the session, the roles and the ban
// from the database, never from a cache. A source that cannot answer dies, so
// an outage is not mistaken for a visitor.
export class AdminSessions extends Context.Service<
  AdminSessions,
  {
    readonly find: (
      headers: Headers.Headers,
    ) => Effect.Effect<Option.Option<AdminSession>>;
  }
>()('shoemaker-admin/core/ports/AdminSessions') {}

export interface Impersonation {
  // For the caller's browser.
  readonly cookies: Cookies.Cookies;
  // Ends the session again, when it should not have been started after all.
  readonly undo: Effect.Effect<void>;
}

// The project's accounts. It enforces no permission of its own: the core has
// already decided. `ban` ends every session the user holds, and those started
// by impersonation as them or by them.
export class UserDirectory extends Context.Service<
  UserDirectory,
  {
    readonly list: (options: {
      // Matched anywhere in the email, without regard to letter case.
      readonly search?: string | undefined;
      readonly limit: number;
      readonly offset: number;
    }) => Effect.Effect<typeof AdminUserPage.Type>;
    readonly get: (
      id: string,
    ) => Effect.Effect<typeof AdminUser.Type, UserNotFound>;
    readonly ban: (
      id: string,
      reason: string | null,
    ) => Effect.Effect<void, UserNotFound>;
    readonly unban: (id: string) => Effect.Effect<void, UserNotFound>;
    // Replaces every role the user holds, and ends impersonations as them, which
    // now would hold the new ones, and by them, who may no longer be allowed to.
    readonly setRoles: (
      id: string,
      roles: ReadonlyArray<string>,
    ) => Effect.Effect<void, UserNotFound>;
    // An account without a password, whose email counts as verified: only a
    // link sent there can give it one. The email is in lower case.
    readonly create: (account: {
      readonly email: string;
      readonly name: string;
      readonly roles: ReadonlyArray<string>;
    }) => Effect.Effect<typeof AdminUser.Type, EmailTaken | Forbidden>;
    // Also ends the sessions `ban` would.
    readonly delete: (id: string) => Effect.Effect<void, UserNotFound>;
    // Signs the caller's browser in as the user for at most an hour.
    readonly impersonate: (options: {
      readonly id: string;
      readonly headers: Headers.Headers;
    }) => Effect.Effect<Impersonation, UserNotFound | Forbidden>;
  }
>()('shoemaker-admin/core/ports/UserDirectory') {}

// Emails a user a link to choose a password, for a project that signs people in
// with one. The link goes nowhere else: not into a response, a log or a span.
export class PasswordLinks extends Context.Service<
  PasswordLinks,
  {
    // Dies when no link to the page could work, before anything is done for one.
    readonly ready: (landing: string) => Effect.Effect<void>;
    readonly send: (options: {
      readonly userId: string;
      // The project's page the link ends on.
      readonly landing: string;
    }) => Effect.Effect<void, UserNotFound | Forbidden | LinkNotSent>;
  }
>()('shoemaker-admin/core/ports/PasswordLinks') {}
