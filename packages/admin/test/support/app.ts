import { Effect, Layer, Record as Rec, Schema } from 'effect';
import { Cookies, HttpRouter, HttpServer } from 'effect/http';

import type {
  AdminSessions,
  PasswordLinks,
  UserDirectory,
} from '../../src/index.ts';
import {
  AdminAccess,
  AuditLive,
  linkTo,
  mountAt,
  usersLive,
} from '../../src/server.ts';
import { access } from './access.ts';
import type { Accounts } from './accounts.ts';
import { MemoryAuditLog } from './memory-audit-log.ts';

export const SITE = 'http://localhost:3000';
export const ADMIN_ORIGIN = 'http://admin.test';

// A host's access check over the test access rules and an in-memory log.
export const AccessLive = AdminAccess.layer({ origins: [ADMIN_ORIGIN] }).pipe(
  Layer.provideMerge(access.layer),
  Layer.provideMerge(MemoryAuditLog),
);

export const LANDINGS = {
  invite: `${SITE}/welcome`,
  passwordLink: `${SITE}/reset-password`,
};

export const AllUsersLive = usersLive({
  invite: linkTo(LANDINGS.invite),
  passwordLink: linkTo(LANDINGS.passwordLink),
  delete: true,
});

export type Backend = AdminSessions | UserDirectory | PasswordLinks | Accounts;

// A host that mounts both products at /admin, and what tests need beside it.
export const makeHost = <E>(
  backend: Layer.Layer<Backend, E>,
  // The users product, and what else the host's programs run with.
  users: typeof AllUsersLive = AllUsersLive,
  environment: Layer.Layer<never> = Layer.empty,
) =>
  Effect.gen(function* () {
    const services = yield* Layer.build(
      AccessLive.pipe(Layer.provideMerge(backend)),
    );
    const send = yield* serve(
      HttpRouter.toWebHandler(
        mountAt('/admin')(Layer.mergeAll(users, AuditLive)).pipe(
          Layer.provide(Layer.succeedContext(services)),
          Layer.provide(HttpServer.layerServices),
          Layer.provideMerge(environment),
        ),
        { disableLogger: true },
      ),
    );
    return { services, send };
  });

// Serves a web handler until the test ends.
export const serve = (app: {
  readonly handler: (request: Request) => Promise<Response>;
  readonly dispose: () => Promise<void>;
}) =>
  Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.promise(app.dispose));
    return (path: string, init: RequestInit = {}) =>
      Effect.promise(() => app.handler(new Request(`${SITE}${path}`, init)));
  });

// A request from the admin's own pages.
export const as = (cookie: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: {
    cookie,
    origin: ADMIN_ORIGIN,
    ...Rec.fromEntries(new Headers(init.headers)),
  },
});

// oxlint-disable-next-line effecttsgo/schema-sync -- the bodies are literals in the tests
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export const post = (body?: unknown, method = 'POST'): RequestInit => ({
  method,
  ...(body === undefined
    ? {}
    : {
        body: encodeJson(body),
        headers: { 'content-type': 'application/json' },
      }),
});

// The Cookie header a browser would send after these Set-Cookies.
export const cookieFrom = (response: Response) =>
  Cookies.toCookieHeader(
    Cookies.fromSetCookie(response.headers.getSetCookie()),
  );
