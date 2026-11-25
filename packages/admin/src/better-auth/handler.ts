import {
  Array as Arr,
  Effect,
  Exit,
  Option,
  Predicate,
  String as Str,
} from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';

import { AuditLog, type NewAuditEntry } from '../core/audit.ts';
import { type EndedImpersonation, watch } from './guard.ts';
import {
  type AnyAuth,
  type AuthInstance,
  type HasAdminPlugin,
  openAuth,
  toStoredUser,
} from './instance.ts';
import { isAdminPath, isStop } from './path.ts';
import { readSession } from './sessions.ts';

const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const DEFAULT_BASE_PATH = '/api/auth';

type Context = Awaited<AnyAuth['$context']>;

const pathnameOf = (url: string) => new URL(url).pathname;

// Where Better Auth's router may be mounted: the path of its base URL, or its
// `basePath` where the base URL comes from each request.
const basePaths = (auth: AnyAuth, context: Context) =>
  Arr.dedupe([
    auth.options.basePath ?? DEFAULT_BASE_PATH,
    ...(Predicate.isString(context.baseURL) && Str.isNonEmpty(context.baseURL)
      ? [pathnameOf(context.baseURL)]
      : []),
  ]);

const emailOf = Effect.fnUntraced(function* (context: Context, id: string) {
  const row = yield* Effect.promise(() =>
    context.internalAdapter.findUserById(id),
  );
  return row === null ? null : (yield* toStoredUser(row)).email;
});

const recordStop = Effect.fnUntraced(function* (
  ended: EndedImpersonation,
  actorEmail: string | null,
  response: HttpServerResponse.HttpServerResponse,
) {
  const log = yield* AuditLog;
  const entry: NewAuditEntry = {
    actorId: ended.impersonatedBy,
    actorEmail,
    action: 'user.stop-impersonating',
    target: { kind: 'user', id: ended.userId },
    detail: null,
  };
  return yield* log.record(entry).pipe(
    Effect.as(response),
    Effect.catchTag('AuditWriteFailed', (error) =>
      Effect.logError(
        'An impersonation was stopped and its audit entry was not written.',
        error,
      ).pipe(
        Effect.annotateLogs({
          actor: entry.actorId,
          action: entry.action,
          target: ended.userId,
        }),
        // The impersonated session is gone, so the admin's own still reaches
        // the browser.
        Effect.as(
          HttpServerResponse.empty({
            status: HTTP_SERVER_ERROR,
            cookies: response.cookies,
          }),
        ),
      ),
    ),
  );
});

const handOver = (auth: AnyAuth, request: Request) =>
  Effect.map(
    Effect.promise(() => auth.handler(request)),
    HttpServerResponse.fromWeb,
  );

// One entry for the one request that ended the session: repeating the request,
// at once or with an old cookie, ends nothing more. Better Auth may answer such
// a repeat from its cookie cache, so its answer does not say.
const stopImpersonating = Effect.fn('BetterAuth.stopImpersonating')(function* (
  auth: AnyAuth,
  context: Context,
  request: Request,
) {
  // As Better Auth will read it: through the cookie cache, when there is one.
  const found = yield* readSession(auth, request.headers, { allowCache: true });
  const actorId = found?.session.impersonatedBy ?? null;
  if (found === null || actorId === null) return yield* handOver(auth, request);
  const actorEmail = yield* emailOf(context, actorId);
  const { watcher, forget } = watch(context.adapter, found.session.token);
  const answer = yield* Effect.exit(handOver(auth, request));
  forget();
  // Whatever the answer: a hook of the project may fail once the session has
  // been ended.
  if (Option.isNone(watcher.ended)) return yield* answer;
  const recorded = yield* recordStop(
    watcher.ended.value,
    actorEmail,
    Exit.getSuccess(answer).pipe(
      Option.getOrElse(() =>
        HttpServerResponse.empty({ status: HTTP_SERVER_ERROR }),
      ),
    ),
  );
  return Exit.isSuccess(answer) ? recorded : yield* answer;
}, Effect.uninterruptible);

// Better Auth's handler with its admin endpoints closed, except stopping an
// impersonation, which is recorded. It decides on the URL of the very request
// Better Auth gets, whatever the router made of the path.
export const authHandler = <A extends AnyAuth>(
  instance: AuthInstance<A> & HasAdminPlugin<A>,
) =>
  Effect.gen(function* () {
    const request = yield* Effect.flatMap(
      HttpServerRequest.HttpServerRequest,
      HttpServerRequest.toWeb,
    ).pipe(Effect.orDie);
    const { auth, context } = yield* openAuth(instance);
    const pathname = pathnameOf(request.url);
    const bases = basePaths(auth, context);
    if (isStop(request.method, pathname, bases)) {
      return yield* stopImpersonating(auth, context, request);
    }
    return isAdminPath(pathname, bases)
      ? HttpServerResponse.empty({ status: HTTP_NOT_FOUND })
      : yield* handOver(auth, request);
  });
