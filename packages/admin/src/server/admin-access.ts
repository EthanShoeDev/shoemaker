import {
  Array as Arr,
  Cause,
  Context,
  DateTime,
  Effect,
  Function,
  Layer,
  Option,
  Ref,
} from 'effect';
import { Headers } from 'effect/http';

import { AccessRules } from '../core/access-rules.ts';
import type { AuditedAction, Permissions } from '../core/annotations.ts';
import {
  AuditLog,
  AuditTrail,
  type AuditTarget,
  type NewAuditEntry,
} from '../core/audit.ts';
import { type AdminCaller, CurrentAdmin } from '../core/caller.ts';
import { Forbidden, Unauthorized } from '../core/errors.ts';
import { AdminSessions, type Ban } from '../core/ports.ts';
import { AdminSetupError } from './setup-error.ts';

// One call, whatever transport it came by.
export interface AdminRequest {
  readonly headers: Headers.Headers;
  // Whether the method can change something: every one but GET and HEAD.
  readonly unsafeMethod: boolean;
  // Null refuses the call.
  readonly permissions: Permissions | null;
  readonly audited: AuditedAction | null;
  // An unsafe method that changes nothing.
  readonly readOnly: boolean;
  // The id an audited action is about, unless its handler names another target.
  readonly targetId?: string | undefined;
}

const refuse = (message: string) => Effect.fail(Forbidden.make({ message }));

const isActive = (ban: Ban | null, now: DateTime.Utc) =>
  ban !== null &&
  (ban.expiresAt === null || DateTime.isGreaterThan(ban.expiresAt, now));

// What a browser would send as `Origin` for a listed address.
const originOf = (listed: string) => {
  const origin = URL.canParse(listed) ? new URL(listed) : undefined;
  return origin === undefined ||
    origin.origin === 'null' ||
    origin.href !== `${origin.origin}/`
    ? Effect.die(
        AdminSetupError.make({
          message: `"${listed}" is not an origin: a scheme, a host and a port`,
        }),
      )
    : Effect.succeed(origin.origin);
};

const make = Effect.fnUntraced(function* (options: {
  readonly origins: ReadonlyArray<string>;
}) {
  const rules = yield* AccessRules;
  const sessions = yield* AdminSessions;
  const log = yield* AuditLog;
  const origins = yield* Effect.forEach(options.origins, originOf, {
    concurrency: 1,
  }).pipe(Effect.map((listed) => new Set(listed)));

  const findCaller = Effect.fnUntraced(function* (headers: Headers.Headers) {
    const found = yield* sessions.find(headers);
    if (Option.isNone(found)) {
      return yield* Unauthorized.make({ message: 'Sign in to use the admin.' });
    }
    const { user, impersonatedBy } = found.value;
    // Better Auth checks a ban only when a session is created, so a session
    // that outlived one is caught here.
    const now = yield* DateTime.now;
    if (isActive(user.ban, now)) {
      return yield* Unauthorized.make({ message: 'This account is banned.' });
    }
    if (impersonatedBy !== null) {
      return yield* refuse('Stop impersonating to use the admin.');
    }
    const caller: AdminCaller = {
      id: user.id,
      email: user.email,
      roles: user.roles,
      credential: { kind: 'session' },
    };
    return caller;
  });

  // Who is calling, or why they may not.
  const authorize = Effect.fn('AdminAccess.authorize')(function* (
    request: AdminRequest,
  ) {
    const caller = yield* findCaller(request.headers);
    const { permissions } = request;
    if (permissions === null) {
      return yield* refuse('This endpoint declares no permissions.');
    }
    if (caller.credential.kind === 'session' && request.unsafeMethod) {
      const origin = Headers.get(request.headers, 'origin');
      if (Option.isNone(origin) || !origins.has(origin.value)) {
        return yield* refuse('This did not come from the admin’s own pages.');
      }
    }
    // Startup refuses both, unless an API was mounted around it.
    if (
      Arr.isReadonlyArrayNonEmpty(rules.undefinedIn(permissions)) ||
      rules.isPublic(permissions) ||
      !rules.can(caller.roles, permissions)
    ) {
      return yield* refuse('Your account can’t do that.');
    }
    if (request.unsafeMethod && request.audited === null && !request.readOnly) {
      return yield* refuse('This endpoint names no action to record.');
    }
    return caller;
  });

  // Says in the log what the audit log could not.
  const logUnrecorded = (
    message: string,
    entry: NewAuditEntry,
    cause: Cause.Cause<unknown>,
  ) =>
    Effect.logError(message, cause).pipe(
      Effect.annotateLogs({
        actorId: entry.actorId,
        actorEmail: entry.actorEmail ?? '',
        action: entry.action,
        target:
          entry.target === null
            ? ''
            : `${entry.target.kind}:${entry.target.id}`,
        detail: entry.detail ?? '',
      }),
    );

  // Runs an admin operation as its caller, and records its one entry once it
  // has succeeded. A typed failure means nothing happened, unless `uncertain`
  // or the operation says otherwise; a defect always leaves that open.
  const run = <A, E, R>(
    request: AdminRequest,
    operation: Effect.Effect<A, E, R>,
    succeeded: (value: A) => boolean,
    uncertain: (error: E) => boolean = Function.constFalse,
  ) =>
    Effect.gen(function* () {
      const caller = yield* authorize(request);
      const { audited, targetId } = request;
      const target = yield* Ref.make<AuditTarget | null>(
        audited?.targetKind === undefined || targetId === undefined
          ? null
          : { kind: audited.targetKind, id: targetId },
      );
      const detail = yield* Ref.make<string | null>(null);
      const unchanged = yield* Ref.make(false);
      const acted = yield* Ref.make(false);
      const provided = operation.pipe(
        Effect.provideService(CurrentAdmin, caller),
        Effect.provideService(AuditTrail, {
          target: (named) => Ref.set(target, named),
          detail: (text) => Ref.set(detail, text),
          mayHaveActed: Ref.set(acted, true),
          nothingChanged: Ref.set(unchanged, true),
        }),
      );
      if (audited === null) return yield* provided;
      const currentEntry = Effect.gen(function* () {
        const entry: NewAuditEntry = {
          actorId: caller.id,
          actorEmail: caller.email,
          action: audited.action,
          target: yield* Ref.get(target),
          detail: yield* Ref.get(detail),
        };
        return entry;
      });
      const record = Effect.fnUntraced(function* (value: A) {
        if (!succeeded(value) || (yield* Ref.get(unchanged))) return;
        const entry = yield* currentEntry;
        yield* log.record(entry).pipe(
          Effect.tapCause((cause) =>
            logUnrecorded(
              'An admin action happened without an audit entry',
              entry,
              cause,
            ),
          ),
          Effect.orDie,
        );
      });
      const logUncertain = Effect.fnUntraced(function* (cause: Cause.Cause<E>) {
        const known =
          !(yield* Ref.get(acted)) &&
          Arr.every(
            cause.reasons,
            (reason) => Cause.isFailReason(reason) && !uncertain(reason.error),
          );
        if (known) return;
        const entry = yield* currentEntry;
        yield* logUnrecorded(
          'An admin action failed, its outcome is unknown',
          entry,
          cause,
        );
      });
      // A client that hangs up must not separate an action from its entry.
      return yield* Effect.uninterruptible(
        provided.pipe(Effect.tapCause(logUncertain), Effect.tap(record)),
      );
    });

  return { authorize, run };
});

// The one access check of a host: sessions, bans, impersonation, origins,
// permissions and the audit entry. Knows nothing of HTTP APIs, so any
// transport can stand on it.
export class AdminAccess extends Context.Service<
  AdminAccess,
  Effect.Success<ReturnType<typeof make>>
>()('shoemaker-admin/server/admin-access/AdminAccess') {
  // `origins` are the admin's own, such as `https://admin.example.com`:
  // narrower than Better Auth's trusted origins.
  static readonly layer = (options: {
    readonly origins: ReadonlyArray<string>;
  }) => Layer.effect(AdminAccess, make(options));
}
