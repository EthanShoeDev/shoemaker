import {
  Array as Arr,
  Effect,
  Layer,
  Number as Num,
  Option,
  String as Str,
} from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';

import { UsersApi } from '../contract/users.ts';
import { AccessRules } from '../core/access-rules.ts';
import { AuditTrail } from '../core/audit.ts';
import { CurrentAdmin } from '../core/caller.ts';
import {
  Forbidden,
  type LinkNotSent,
  OperationUnsupported,
  UnknownRole,
  type UserNotFound,
} from '../core/errors.ts';
import { PasswordLinks, UserDirectory } from '../core/ports.ts';
import { usersProduct } from '../core/products.ts';
import { DEFAULT_ROLE } from '../core/roles.ts';
import { adminApi } from './admin-api.ts';
import { pageSize } from './page-size.ts';

const USERS = { initial: 25, maximum: 100 };

// Emails users a link to choose a password.
export interface LinkSender {
  // Dies when no link could work.
  readonly ready: Effect.Effect<void>;
  readonly send: (
    userId: string,
  ) => Effect.Effect<void, UserNotFound | Forbidden | LinkNotSent>;
}

// A link that ends on one of the project's pages: an address, or a path of the
// site Better Auth is on.
export const linkTo = (landing: string) =>
  Effect.map(PasswordLinks, (links): LinkSender => ({
    ready: links.ready(landing),
    send: (userId) => links.send({ userId, landing }),
  })).pipe(Effect.withSpan('linkTo'));

// What a project supports beyond what every one does. The rest is refused, and
// reported as unsupported.
interface Operations<Invite, PasswordLink> {
  readonly invite?: Effect.Effect<LinkSender, never, Invite>;
  readonly passwordLink?: Effect.Effect<LinkSender, never, PasswordLink>;
  readonly delete?: boolean;
}

const normalize = (roles: ReadonlyArray<string>) =>
  Arr.isReadonlyArrayNonEmpty(roles) ? Arr.dedupe(roles) : [DEFAULT_ROLE];

const unsupported = (operation: string) =>
  OperationUnsupported.make({ operation });

interface Supported {
  readonly invite: Option.Option<LinkSender>;
  readonly passwordLink: Option.Option<LinkSender>;
  readonly delete: boolean;
}

const usersHandlers = (supported: Supported) =>
  HttpApiBuilder.group(UsersApi, 'users', (handlers) =>
    Effect.gen(function* () {
      const directory = yield* UserDirectory;
      const rules = yield* AccessRules;

      const list = Effect.fn('UsersApi.list')(function* ({
        query,
      }: {
        readonly query: {
          readonly search?: string | undefined;
          readonly limit?: number | undefined;
          readonly offset?: number | undefined;
        };
      }) {
        const search = Str.trim(query.search ?? '');
        return yield* directory.list({
          search: Str.isEmpty(search) ? undefined : search,
          limit: pageSize(query.limit, USERS),
          offset: Num.clamp(Math.floor(query.offset ?? 0), {
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
          }),
        });
      });

      // The account, under its own id: a database may find it by another
      // spelling, which neither a rule nor the audit log may go by.
      const findTarget = Effect.fnUntraced(function* (asked: string) {
        const user = yield* directory.get(asked);
        const trail = yield* AuditTrail;
        yield* trail.target({ kind: 'user', id: user.id });
        return user;
      });

      const ban = Effect.fn('UsersApi.ban')(function* (
        asked: string,
        reason: string | null,
      ) {
        const caller = yield* CurrentAdmin;
        const { id } = yield* findTarget(asked);
        if (caller.id === id) {
          return yield* Forbidden.make({ message: 'You can’t ban yourself.' });
        }
        // Recorded even for a user already banned: it may replace a ban that
        // would have ended.
        yield* directory.ban(id, reason);
        if (reason !== null) yield* (yield* AuditTrail).detail(reason);
      });

      const unban = Effect.fn('UsersApi.unban')(function* (asked: string) {
        const user = yield* findTarget(asked);
        yield* directory.unban(user.id);
        if (!user.banned) yield* (yield* AuditTrail).nothingChanged;
      });

      // Not whether the two may be impersonated or banned at all: only who the
      // extra permission is needed for. One role grants both, as for any
      // endpoint.
      const mayBecome = (
        actor: { readonly roles: ReadonlyArray<string> },
        target: { readonly roles: ReadonlyArray<string> },
      ) =>
        !rules.isAdmin(target.roles) ||
        rules.can(actor.roles, { user: ['impersonate', 'impersonate-admins'] });

      const stillAllowed = (actorId: string, targetId: string) =>
        Effect.all([directory.get(actorId), directory.get(targetId)], {
          concurrency: 1,
        }).pipe(
          Effect.map(
            ([actor, target]) =>
              !actor.banned &&
              !target.banned &&
              rules.can(actor.roles, { user: ['impersonate'] }) &&
              mayBecome(actor, target),
          ),
          Effect.orElseSucceed(() => false),
        );

      const impersonate = Effect.fn('UsersApi.impersonate')(function* (
        asked: string,
      ) {
        const caller = yield* CurrentAdmin;
        const { headers } = yield* HttpServerRequest.HttpServerRequest;
        const target = yield* findTarget(asked);
        if (caller.id === target.id) {
          return yield* Forbidden.make({
            message: 'You can’t impersonate yourself.',
          });
        }
        if (target.banned) {
          return yield* Forbidden.make({ message: 'This user is banned.' });
        }
        if (!mayBecome(caller, target)) {
          return yield* Forbidden.make({
            message: 'Your account can’t impersonate an admin.',
          });
        }

        const { cookies, undo } = yield* directory.impersonate({
          id: target.id,
          headers,
        });
        // A ban, a deletion or a change of roles meanwhile ends what it finds, and
        // may have looked before this session was there.
        if (!(yield* stillAllowed(caller.id, target.id))) {
          yield* undo;
          return yield* Forbidden.make({
            message: 'One of the two accounts has just changed.',
          });
        }
        // On this response only: one that fails, say for want of an audit entry,
        // must not sign the browser in.
        return HttpServerResponse.empty({ status: 204, cookies });
      });

      const checkRoles = Effect.fnUntraced(function* (
        roles: ReadonlyArray<string>,
      ) {
        const unknown = Arr.findFirst(roles, (role) => !rules.isRole(role));
        if (Option.isSome(unknown)) {
          return yield* UnknownRole.make({ role: unknown.value });
        }
      });

      const setRoles = Effect.fn('UsersApi.setRoles')(function* (
        asked: string,
        wanted: ReadonlyArray<string>,
      ) {
        const caller = yield* CurrentAdmin;
        const trail = yield* AuditTrail;
        const user = yield* findTarget(asked);
        if (caller.id === user.id) {
          return yield* Forbidden.make({
            message: 'You can’t change your own roles.',
          });
        }
        const roles = normalize(wanted);
        yield* checkRoles(roles);
        const held = Arr.dedupe(user.roles);
        if (
          held.length === roles.length &&
          Arr.every(roles, (role) => Arr.contains(held, role))
        ) {
          return yield* trail.nothingChanged;
        }
        yield* directory.setRoles(user.id, roles);
        yield* trail.detail(Arr.join(roles, ', '));
      });

      const invite = Effect.fn('UsersApi.invite')(function* (account: {
        readonly email: string;
        readonly name: string;
        readonly roles?: ReadonlyArray<string> | undefined;
      }) {
        if (Option.isNone(supported.invite))
          return yield* unsupported('invite');
        const caller = yield* CurrentAdmin;
        const trail = yield* AuditTrail;
        const roles = normalize(account.roles ?? []);
        yield* checkRoles(roles);
        if (
          Arr.some(roles, (role) => role !== DEFAULT_ROLE) &&
          !rules.can(caller.roles, { user: ['create', 'set-role'] })
        ) {
          return yield* Forbidden.make({
            message: 'Your account can’t give a role to who it invites.',
          });
        }
        // Before there is an account nobody could be sent a link to.
        yield* supported.invite.value.ready;
        const user = yield* directory.create({
          email: Str.toLowerCase(account.email),
          name: account.name,
          roles,
        });
        yield* trail.target({ kind: 'user', id: user.id });
        yield* trail.detail(Arr.join(roles, ', '));
        // The account exists by now, so a link that was not sent is part of the
        // answer and not a failure, which would leave the account unrecorded.
        const linkSent = yield* supported.invite.value.send(user.id).pipe(
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.logError('An invited user was sent no link.', cause).pipe(
              Effect.annotateLogs({ userId: user.id }),
              Effect.as(false),
            ),
          ),
        );
        return { user, linkSent };
      });

      const passwordLink = Effect.fn('UsersApi.passwordLink')(function* (
        asked: string,
      ) {
        if (Option.isNone(supported.passwordLink)) {
          return yield* unsupported('passwordLink');
        }
        const trail = yield* AuditTrail;
        const user = yield* findTarget(asked);
        // A mailer may fail after it delivered, by timing out. The link works then,
        // so this must not pass for nothing: no entry says it was sent, and the
        // log says who asked for it and that it may have been.
        yield* supported.passwordLink.value
          .send(user.id)
          .pipe(Effect.tapErrorTag('LinkNotSent', () => trail.mayHaveActed));
      });

      const remove = Effect.fn('UsersApi.delete')(function* (asked: string) {
        if (!supported.delete) return yield* unsupported('delete');
        const caller = yield* CurrentAdmin;
        const user = yield* findTarget(asked);
        if (caller.id === user.id) {
          return yield* Forbidden.make({
            message: 'You can’t delete yourself.',
          });
        }
        yield* directory.delete(user.id);
      });

      return handlers
        .handle('list', list)
        .handle('get', ({ params }) => directory.get(params.id))
        .handle('ban', ({ params, payload }) =>
          ban(params.id, payload.reason ?? null),
        )
        .handle('unban', ({ params }) => unban(params.id))
        .handle('impersonate', ({ params }) => impersonate(params.id))
        .handle('setRoles', ({ params, payload }) =>
          setRoles(params.id, payload.roles),
        )
        .handle('operations', () =>
          Effect.succeed({
            invite: Option.isSome(supported.invite),
            passwordLink: Option.isSome(supported.passwordLink),
            delete: supported.delete,
          }),
        )
        .handle('invite', ({ payload }) => invite(payload))
        .handle('passwordLink', ({ params }) => passwordLink(params.id))
        .handle('delete', ({ params }) => remove(params.id));
    }),
  );

const declared = <R>(
  operation: Effect.Effect<LinkSender, never, R> | undefined,
) => (operation === undefined ? Effect.succeedNone : Effect.asSome(operation));

// The users product with the optional operations this project supports:
//
//   usersLive({
//     invite: linkTo('https://example.com/welcome'),
//     passwordLink: linkTo('https://example.com/reset-password'),
//     delete: true,
//   })
export const usersLive = <Invite = never, PasswordLink = never>(
  operations: Operations<Invite, PasswordLink> = {},
) =>
  adminApi(UsersApi, {
    product: usersProduct.id,
    handlers: Layer.unwrap(
      Effect.gen(function* () {
        const invite = yield* declared(operations.invite);
        const passwordLink = yield* declared(operations.passwordLink);
        return usersHandlers({
          invite,
          passwordLink,
          delete: operations.delete === true,
        });
      }),
    ),
  });

// With none of them.
export const UsersLive = usersLive();
