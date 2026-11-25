# shoemaker-admin

The part of an admin panel that must be the same in every project, without UI:
who may call an admin endpoint, the audit log, and what admins do to users:
list, view, ban, impersonate, set roles, invite, send password links and delete. Effect 4 and Better Auth.

The project owns its admin app, its pages and its own admin endpoints. This
package is a library they call.

```sh
bun add shoemaker-admin
```

`effect` is required. `better-auth`, `@alchemy.run/better-auth` and `alchemy`
are needed only by the entries that name them.

| Import | Holds |
|---|---|
| `shoemaker-admin` | schemas, errors, annotations, services, product descriptions |
| `/contract` | the users and audit `HttpApi`s, and the `AdminAuth` middleware |
| `/access` | `defineAccess` (needs `better-auth`) |
| `/server` | the access check, handlers, `adminApi`, `mountAt` |
| `/better-auth` | Better Auth behind the two ports, and its closed handler |
| `/sql` | audit store, migrations, `promoteAdmins`, over any `SqlClient` (SQLite, D1, Postgres) |
| `/alchemy` | deploy Actions for migrations and the first admins |

The first three are safe in a browser.

## 1. Access rules

One file, imported by the server and by the admin app:

```ts
import { defineAccess } from 'shoemaker-admin/access';
import { auditProduct, usersProduct } from 'shoemaker-admin';

export const access = defineAccess({
  products: [usersProduct, auditProduct],
  statements: { billing: ['read', 'grant'], outing: ['host'] },
  roles: {
    host: { outing: ['host'] },
    support: { billing: ['grant'] },
  },
  publicStatements: { outing: ['host'] },
});
```

- `admin` grants everything defined except `user:impersonate-admins`. An
  `admin` entry in `roles` replaces that for the resources it names.
- One role must grant every permission an endpoint needs.
- `publicStatements` are the permissions the public app checks too. A role that
  grants anything else is an admin role, and impersonating its holders needs
  `user:impersonate-admins`. An admin endpoint may not need only public
  permissions: if one does, the permission is not public, and startup says so.
- `ac`, `roles` and `adminRoles` of what it returns are what Better Auth's server
  plugin takes, and its client plugin `ac` and `roles`.
- The admin app decides what to show with
  `access.can(session.user.role, { billing: ['read'] })`, never by the name of a
  role.

## 2. Better Auth

```ts
import { BetterAuth } from '@alchemy.run/better-auth';
import {
  adminPlugin,
  authHandler,
  directoryLayer,
  sessionsLayer,
} from 'shoemaker-admin/better-auth';

const auth = yield* BetterAuth({ /* ... */ plugins: [adminPlugin(access)] });
```

- `adminPlugin` replaces Better Auth's `admin`. It also keeps an impersonation
  to an hour, which Better Auth extends when its `dont_remember` cookie is
  dropped, and closes Better Auth's admin endpoints.
- `authHandler(auth)` replaces `auth.fetch`, inside whatever the project
  already does around it (throttling, OAuth). It answers 404 to every Better
  Auth admin endpoint, however it is spelled, but the one that stops an
  impersonation, which it audits. Without it stops are not recorded. So it needs the audit log where `auth.fetch` needed nothing:

  ```ts
  // `AuditLog` is the root entry's, `auditLogLayer` is `/sql`'s.
  // As a route.
  HttpRouter.add('*', '/api/auth/*', authHandler(auth)).pipe(
    HttpRouter.provideRequest(auditLogLayer),
  );
  // In a fetch written by hand, with `const auditLog = yield* AuditLog` where
  // it is built.
  yield* authHandler(auth).pipe(Effect.provideService(AuditLog, auditLog));
  ```

- With secondary storage, set `session.storeSessionInDatabase`.

## 3. The server

```ts
import { Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import {
  AdminAccess,
  AuditLive,
  UsersLive,
  adminApi,
  mountAt,
} from 'shoemaker-admin/server';
import { auditLogLayer } from 'shoemaker-admin/sql';

const AdminRoutes = Layer.mergeAll(
  Layer.mergeAll(UsersLive, AuditLive).pipe(mountAt('/admin')),
  // The project's own endpoints, checked the same way. `product` names the API
  // in startup failures.
  adminApi(AdminApi, { product: 'my-project', handlers: AdminHandlers }),
).pipe(
  Layer.provide(
    AdminAccess.layer({ origins: ['https://admin.example.com'] }),
  ),
  Layer.provide([
    access.layer,
    sessionsLayer(auth),
    directoryLayer(auth),
    auditLogLayer, // needs a SqlClient
  ]),
);
```

`origins` are the admin's own, each a scheme, a host and a port, with the ones
used in development. A write from anywhere else, or without an `Origin`, is
refused. A layer is mounted once.

`AdminRoutes` is served like any `HttpRouter` layer, beside the project's own,
with the platform's services (`HttpServer.layerServices`, or `alchemy/Http`'s
`Platform` on a Worker).

A contract carries no prefix, so its client's base URL does:

```ts
import { AuditApi, UsersApi } from 'shoemaker-admin/contract';

const users = yield* HttpApiClient.make(UsersApi, { baseUrl: '/api/admin' });
const page = yield* users.users.list({ query: { search: 'ada' } });
```

| Call | Takes | Permission |
|---|---|---|
| `users.list` | query `search?`, `limit?` (25, at most 100), `offset?` | `user:list` |
| `users.get` | params `id` | `user:get` |
| `users.ban` | params `id`, payload `{ reason? }` | `user:ban` |
| `users.unban` | params `id` | `user:ban` |
| `users.impersonate` | params `id` | `user:impersonate` |
| `users.setRoles` | params `id`, payload `{ roles }`, the whole list; none gives `user` | `user:set-role` |
| `users.operations` | | `user:list` |
| `users.invite` | payload `{ email, name, roles? }` | `user:create`, and `user:set-role` for any role but `user` |
| `users.passwordLink` | params `id` | `user:set-password` |
| `users.delete` | params `id` | `user:delete` |
| `audit.list` | query `limit?` (50, at most 200), `cursor?` (a page's `nextCursor`) | `audit:list` |

Errors are `Unauthorized`, `Forbidden`, `UserNotFound`, `InvalidCursor`,
`UnknownRole`, `EmailTaken`, `OperationUnsupported` and `LinkNotSent`.

### Optional operations

`invite`, `passwordLink` and `delete` are for the projects that support them. Declare them where the
users product is mounted, in place of `UsersLive`; the others answer
`OperationUnsupported`, and `users.operations` tells a page which to offer:

```ts
import { passwordLinksLayer } from 'shoemaker-admin/better-auth';
import { linkTo, usersLive } from 'shoemaker-admin/server';

usersLive({
  invite: linkTo('https://example.com/welcome'),
  passwordLink: linkTo('https://example.com/reset-password'),
  delete: true,
}).pipe(Layer.provide(passwordLinksLayer(auth)));
```

Links go out through Better Auth's `emailAndPassword.sendResetPassword`, and
only there. That hook must reject when sending fails: one that swallows the
failure makes `linkSent` always true. Links need Better Auth's `baseURL` (a
dynamic one needs its `fallback`) and the landing pages' origins in
`trustedOrigins`, wildcards included. Without them the request is a 500 before
an account is made, and `users.operations` still offers the operation, so check
in development too.

An invite creates the account with its email verified, since only the emailed
link can give it a password, and answers `{ user, linkSent }`. When `linkSent`
is false the account exists: offer a password link.

## 4. The project's own endpoints

```ts
import { AdminAuth } from 'shoemaker-admin/contract';
import {
  Audited,
  AuditTrail,
  CurrentAdmin,
  RequiredPermissions,
} from 'shoemaker-admin';

export const AdminApi = HttpApi.make('admin')
  .add(
    HttpApiGroup.make('billing').add(
      HttpApiEndpoint.post('grant', '/users/:id/grants', {
        params: { id: Schema.String },
        payload: Schema.Struct({ credits: Schema.Int }),
        success: HttpApiSchema.NoContent,
      })
        .annotate(RequiredPermissions, access.requires({ billing: ['grant'] }))
        .annotate(Audited, { action: 'billing.grant', targetKind: 'user' }),
    ),
  )
  .middleware(AdminAuth) // last, so nothing runs outside it
  .prefix('/admin');

export const AdminHandlers = HttpApiBuilder.group(
  AdminApi,
  'billing',
  (handlers) =>
    handlers.handle('grant', ({ params, payload }) =>
      Effect.gen(function* () {
        const admin = yield* CurrentAdmin;
        const trail = yield* AuditTrail;
        yield* grantCredit(params.id, payload.credits, admin.id);
        yield* trail.detail(`${payload.credits} credits`);
      }),
    ),
);
```

- An endpoint without `RequiredPermissions` is refused for everybody. Only its
  own annotations count, not its group's.
- A method other than GET or HEAD names its `Audited` action, or is marked
  `.annotate(ReadOnly, true)` (a query sent by POST).
- The entry's target is the `id` parameter, unless the handler calls
  `trail.target(...)`. `yield* trail.nothingChanged` leaves no entry.
- The entry is written after the endpoint succeeds. If that fails the request
  fails too, and the log holds what happened.
- Its paths sit beside the products' and may not repeat one: a project's own
  user page data is `/users/:id/billing`, not `/users/:id`.
- A handler that needs an account reads it with `directory.get(id)`, declaring
  `error: UserNotFound` (both from the root entry). Take the directory where the
  group is built, not in the handler:

  ```ts
  HttpApiBuilder.group(
    AdminApi,
    'billing',
    Effect.fnUntraced(function* (handlers) {
      const directory = yield* UserDirectory;
      return handlers.handle('grant', ({ params }) => /* ... */);
    }),
  );
  ```

A project's public endpoints learn of an impersonation from `impersonatedBy` of
`/server`: an Effect of the admin's id as an `Option`, which needs the request
and `sessionsLayer(auth)`.

## 5. Tables and the first admins

With Alchemy on Cloudflare D1:

```ts
import * as Cloudflare from '@alchemy.run/cloudflare';
import * as SQL from '@alchemy.run/cloudflare/D1/SQL';
import { Config, Effect, type Layer, Redacted } from 'effect';
import type { SqlClient } from 'effect/sql';
import { grantAdmins, migrateHost } from 'shoemaker-admin/alchemy';
import { adminMigrations, parseAdminEmails } from 'shoemaker-admin/sql';

export const deployDatabase = Effect.map(AppDb, (db) => ({
  identity: db.databaseId,
  client: Effect.map(
    Cloudflare.D1.QueryDatabase(db),
    (query): Layer.Layer<SqlClient.SqlClient> => SQL.D1Layer(query),
  ).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseLocal)),
}));

// In the Worker's init, so it is deployed after its tables exist. The guard
// keeps the migrations out of its bundle.
if (globalThis.__ALCHEMY_RUNTIME__ !== true) {
  yield* migrateHost('AdminMigrate', adminMigrations, deployDatabase);
}

// In the stack, after the Worker, which comes after Better Auth's own tables.
const api = yield* Api;
const adminEmails = yield* Config.Redacted('ADMIN_EMAILS');
yield* grantAdmins('Admins', parseAdminEmails(Redacted.value(adminEmails)), {
  ...(yield* deployDatabase),
  after: [api.url],
});
```

`ADMIN_EMAILS` is declared in `.env.schema` like the deploy's other secrets, and
its value lives in the remote store. `AppDb` is the project's
`Cloudflare.D1.Database`.

A Worker declared in the stack, not as a class, can take `migrate`'s output in
its `env` instead:

```ts
import * as Output from 'alchemy/Output';

const database = yield* deployDatabase;
const migrated = yield* migrate('AdminMigrate', adminMigrations, database);
yield* Cloudflare.Worker('Api', {
  main: './api.ts',
  env: { ADMIN_MIGRATIONS: Output.map(migrated.applied, String) },
});
```

Without Alchemy, run `runMigrations(adminMigrations)` and
`promoteAdmins(emails)` from the deploy script, before the server starts. Tests
that read the audit log run the migrations too.

`grantAdmins` runs when the list or the database changes, or after it failed.
Other roles are kept, and a demotion made in the admin stands while the list is
unchanged. An email without an account fails the deploy after the others were
granted.

## Limits

- `user:set-role` is full trust: it can give any role, more than the holder's
  own. Changing roles, banning and deleting end the impersonations as that user
  and by them.
- `LinkNotSent` does not mean that nothing was sent: a mailer that timed out may
  have delivered. No entry is written, and the log names who asked.
- A delete that a project hook or a foreign key refuses answers 500. The account
  keeps its sign-in and loses its sessions. Better Auth's `user.deleteUser`
  callbacks do not run; use database hooks.
- An email stored with capitals cannot be sent a link.
- Startup refuses an admin endpoint that is not behind `AdminAuth`, has a
  middleware outside it, needs an undefined or only public permission, or audits
  a target with no `id` in its path.
- A project hook that stops Better Auth from deleting sessions makes a ban fail
  after the user is marked as banned.
- Where secondary storage holds users, a role granted by SQL is seen here at
  once and by Better Auth, which impersonating needs, only when its copy ends.
- Signing out of an impersonated session ends it without an entry.
- Users created in one instant have no fixed order across pages.
- A ban ends every session. Where Better Auth's cookie cache is on, the public
  app may still accept a banned user until the cache expires; admin endpoints
  read the database.
- An impersonated session can use whatever the project's other plugins mint,
  such as API keys, unless the project refuses it with `impersonatedBy`.
- If the audit write fails after Better Auth has acted, the action stands, the
  request fails and the log holds it.
