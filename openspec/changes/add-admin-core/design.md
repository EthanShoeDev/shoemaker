# Design

## Context

See proposal.md for motivation. Three projects shape this and the changes after it, named here by what they are built with:

- **the Foldkit project** has a client-only Foldkit admin on its own subdomain;
- **the React project** has a TanStack Start admin;
- **the Expo project** has a web and a mobile app, and no admin.

| | Foldkit project | React project |
| --- | --- | --- |
| Nav pages that are the project's own | 1 of 3, plus panels on the user page | 6 of 7 |
| API prefix | `/admin` | `/api/admin` |
| How `/api` reaches the API Worker | zone route | service binding, forwarded by an `/api/$` route |
| Better Auth tables | migrated by Alchemy | Drizzle, generated migrations |
| Sign-in | emailed link | password |
| Own roles | none | one, also checked by its public app |
| User operations in its pages | list, view, ban, unban, impersonate | those but viewing, plus roles, invite, password link, delete |

This change carries only the Foldkit project's operations, so it ends in one real project without breaking any page.

Facts checked in source, at the CLI's pins (Effect 4.1.5, Alchemy 2.0.0-beta.87, Better Auth 1.7.15). Alchemy's `main` also calls itself beta.87 while holding unreleased work, so read its release tag.

- `HttpApiBuilder.group` is typed against one `HttpApi`, and group services are keyed by API id, so separate APIs coexist in one router. `HttpRouter.prefixed` re-mounts routes.
- `effect/sql`'s `Migrator` opens a transaction for SQLite, and the D1 client dies on transactions. The D1 client does have `batch`, which runs statements as one atomic unit.
- `package-boundaries` checks app-to-app dependencies only.
- SQLite cannot add a column only if it is missing.
- Better Auth: a ban ends sessions. Its origin check runs only when it is handed a request, so calls through `auth.api` skip it. The Foldkit project calls it that way already; the React project would lose the check by moving to a core without its own.
- An Alchemy Action runs when its input changes, after it failed, or with `--force`; not on every deploy.
- `release.ts` publishes no package npm has never seen from CI; the first publish is by hand. `^0.0.1` admits no other version.
- The adopting projects pin Effect 4.1.2 and Alchemy beta.85.

Found while building, each now a test:

- Better Auth does not trim role names, in a caller's permissions or in a target's admin roles; `getSession` does not check a ban; a ban leaves the sessions the banned admin started by impersonation; and an impersonated session is extended to a full one when its `dont_remember` cookie is dropped.
- `HttpApi` answers some bad requests with a response and not an error, so success is judged by status too.
- Effect builds a layer once, so a second `mountAt` of one product layer in one host adds no routes.

## Goals / Non-Goals

**Goals:** a security core that cannot drift; early choices that later changes don't have to undo (a caller type that can carry an agent's key, access that does not depend on the transport).

**Non-Goals:** a plugin system that loads pages it doesn't know at build time; a generic product framework before the second product; rendering admin pages on a server; generated wiring, which waits until wiring by hand has worked.

## Decisions

### 1. The project owns the admin app; packages supply a core and pages

| Layer | Delivered as | Holds | Changes by |
| --- | --- | --- | --- |
| Core | dependency, required | access, permissions, impersonation, the audit log and its table, closing Better Auth's endpoints | version bump |
| Products | dependency, each optional | an API, storage layers, later pages: `users`, `audit` (reading the log), Edgehog | version bump |
| Project | its own code | routes, layout, nav order, `access.ts`, its own AdminApi and pages | the project |

The rule for placing something: if a project getting it wrong is a security bug, core. If most projects want it the same, a product. Otherwise the project's. The project *imports* pages; the package never *hosts* the project's.

*Alternatives.* A package-owned shell with plugin slots: most of the React project would live in slots, TanStack's file routes can't come from a package, and Foldkit's `Model` and `Message` unions are closed, so slots lose their types. Copying a scaffold: copies drift, and what drifts is the checks.

### 2. Project data is joined beside shared data

The users API returns account data only. A plan column comes from the project's own endpoint, under its own permission. So schemas stay closed, and an admin without `billing:read` still gets a users page. The Foldkit project's users pages make two requests where they made one, so those pages change when it adopts the core.

*Alternative.* A generic user schema: a type parameter through contract, client and both UIs, and the page's permission tied to the project's data.

### 3. Access rules come from the project's `access.ts`

`defineAccess({ products, statements, roles })` returns `ac`, `roles`, `can` and a typed `requires(...)`. `RequiredPermissions` is a structural record, so product contracts don't depend on one project's statements. Startup checks every mounted endpoint against the defined statements and dies on an unknown one. The admin app decides by `can`, never by the name `admin`. 

The project lists the permissions its public app also checks in `publicStatements`. A role is an admin role when it grants anything else, so the safe answer is the default. `adminRoles` for Better Auth is every admin role, so impersonating any of them needs `impersonate-admins`; the React project's `host` role, whose one permission is public, can be impersonated as it can today. Startup refuses an admin endpoint that needs only public permissions, and one that is not behind `AdminAuth`, has a middleware outside it, or audits a target without an `id` in its path. It checks the endpoints the handlers really serve, not the contract it was given. So the React project's `event:update`, which its public app also checks, stays out of the list: admin endpoints need it alone.

The default `admin` grants everything defined but `impersonate-admins`; in a role the project names `admin`, a resource it lists replaces that resource's default.

### 4. One access core, with an `HttpApi` middleware as its adapter

`AdminAccess` takes headers, required permissions and an optional audit action, and returns the caller or a refusal. Its caller type leaves room for a key acting for a user; only sessions exist now. It takes headers and not an `HttpApi` request, so the agents change can put an MCP gate and a CLI over the same core. Every product API is an `HttpApi`, so one adapter is enough.

The core refuses impersonated sessions, banned users and undeclared endpoints, and requires an `Audited` action on anything that writes. Writes are every method but GET and HEAD, unless the endpoint is annotated `ReadOnly` (a structured query sent by POST). Only an endpoint's own annotations count, not its group's. It provides `CurrentAdmin` and a request-scoped `AuditTrail`, and after success writes one entry. The target is a kind and an id, and the id defaults to the `id` parameter; handlers add target or detail, or say that nothing changed, which writes no entry. A read may declare an action too.

A cookie session may use a method other than GET or HEAD only from an origin the host lists, and a request without an `Origin` is refused. The list is the admin's own origins, narrower than Better Auth's trusted origins, which may include every subdomain. A later key is not a cookie, so the check does not apply to it.

If the audit write fails after the action happened, the request fails and everything is logged. An operation that breaks after it started (a defect, a response that cannot be encoded) leaves no entry, and the log says its outcome is unknown. Writing first would record actions that never happened, and D1 has no transaction that spans Better Auth and our table.

*Alternative.* Effect's `EventLog` for the audit log: Better Auth changes the user outside any `EventLog` handler, so action and entry could not commit together, the entries would be binary, and its SQL journal uses transactions, which D1 lacks.

### 5. Better Auth stays behind two ports

`AdminSessions` and `UserDirectory` are core services; `/better-auth` implements them and wraps the auth handler: 404 for admin paths except stop-impersonating, which it audits. The wrapper decides on the decoded, collapsed, lower-cased pathname of the very request Better Auth gets. The directory calls Better Auth's internal adapter, except to impersonate, which needs its cookies. A stop is recorded only by the request whose call ended the session row, so a replay or a race leaves one entry.

Projects install our `adminPlugin` in place of Better Auth's `admin`; without it a host does not typecheck. It wraps the database adapter, below every hook, because the project's own hooks run last and can undo a plugin's: there an impersonation is never extended and roles are read trimmed. It also closes the admin routes itself, so a host that keeps `auth.fetch` loses only the record of a stop. A second admin plugin, or secondary storage that does not also keep sessions in the database, fails when Better Auth starts. Only `/access` and `/better-auth` import Better Auth.

The endpoints close from the first release rather than in a follow-up. Adopting the core must never leave a project with less than it had, and leaving the endpoints open but audited would be code written only to be deleted. A project with pages that call them moves those pages in the same commit, which is why the React project is a change of its own (`extend-admin-users`).

### 6. Products ship their own API; `mountAt` prefixes the router

As in [Alchemy Git][git], a product's contract carries no prefix and the host owns auth. `mountAt(prefix)` provides it a prefixed `HttpRouter`, and its client takes the same prefix as base URL. The project's `/admin` contract subpath holds only its own AdminApi.

### 7. Package layout, shared by every product

| Subpath | Holds | May import |
| --- | --- | --- |
| `.` | schemas, tags, errors, product description (id, statements, nav) | `effect` |
| `/contract` | `HttpApi`s | `.` |
| `/access` (admin) | `defineAccess` | `.`, better-auth access |
| `/server` | handlers, the access adapter, `mountAt` | `.`, `/contract` |
| `/better-auth` (admin) | decision 5 | `.`, `better-auth`, `@alchemy.run/better-auth`, `alchemy/RuntimeContext` |
| `/sql` | stores and migrations over `SqlClient` | `.` |
| `/alchemy` | deploy Actions, for any cloud | `.`, `/sql`, `alchemy` |

Another product's entry may also import the same entry of `shoemaker-admin`. Edgehog adds `/cloudflare` (bindings and Worker helpers, over `/alchemy`); later changes add `/client`, `/foldkit` and `/react`. A test walks each entry's import graph, since `package-boundaries` can't, and proves that browser entries carry no server code. `effect` is a peer; Alchemy and Better Auth are optional peers.

### 8. Migrations without transactions

Each product exports ordered migrations, and a small runner applies each one together with its record in `<product>_migrations` as one unit: `batch` on D1, a transaction on SQLite and Postgres. So none is half recorded, a rerun skips what is done, and a migration may add a column. The record's name is unique, so of two deploys at once one rolls back. After any failure the runner reads the record again and believes it, because a lost reply looks like a failure and drivers name the errors differently. On Postgres deploys take turns by a lock on the history table. The service behind that unit is shared with products that need atomic writes.

It runs before the server that needs it: through an Alchemy Action whose input holds the migration names and the database's identity, or from the host's own deploy script where there is no Alchemy. A Worker registers it from its init (`migrateHost`), which makes it wait for the tables: a class Worker's props are evaluated in the deployed bundle too, so an Action cannot go there. Order is expressed by outputs an Action captures, which are not part of its input.

The audit table keeps the name and columns an existing project already has, so adoption copies nothing. Migrations add `target_kind` and `target_id`, since an issue or a flag is a target too. New entries about users also fill `target_user_id`, so old code still reads them after a rollback, and old entries are read as user targets. The core owns the table, under the prefix `admin_`. Paging is by the stored time and id, compared bytewise on every database.

`promoteAdmins` is an Action whose input is the list and the database's identity. It does not undo a demotion made in the admin while the list is unchanged.

*Alternatives.* Effect's `Migrator`: dies on D1. SQL files in the host's migrations folder: one project generates that folder with Drizzle.

### 9. Products version together, apart from the CLI

Products get their own changesets `fixed` group. Within it server and admin app versions stay aligned, and the CLI is neither bumped nor held up by product patches. `versions.ts` derives every `shoemaker-*` pin from the CLI's version, so products need their own constant there once a generator emits them; a `^0.1` range then admits product patches without a CLI release. They start at 0.1.0, because `^0.0.1` would admit none.

*Alternative.* The CLI's existing group: every product patch would release seven unrelated packages, and the reverse.

### 10. Shared code stays in one folder

Description, mounting, migrations and references live in one folder of `shoemaker-admin` that is expected to move to its own package once another product proves what is shared (roadmap).

## Risks / Trade-offs

- [Wired by hand now, then again by generators] → Accepted: the second wiring deletes the first, and is right.
- [Adopting the core changes behavior: promotion keeps other roles, users and plan data load separately, writes need a listed origin, the audit cursor no longer skips entries with one timestamp] → Listed in the changeset.
- [Projects pin older Effect, Alchemy and Foldkit] → Each upgrades before adopting. Foldkit 0.171 requires result messages on every command.
- [Cloudflare does not document that D1's REST API, which the deploy-time client uses, runs a batch atomically] → Proven for the binding and for local workerd, not hosted. The record is last in the batch, so an interruption that is not rolled back makes the next deploy fail on the repeated column, loudly. Checked on the first adoption deploy (4.3).
- [With Better Auth's cookie cache, a banned user's public requests may pass until it expires] → Admin endpoints read the database. The Foldkit project has no such cache; the React project does, so `extend-admin-users` decides.
- [An impersonated session can mint what other plugins offer, such as API keys, that outlive it] → Projects refuse it with `impersonatedBy`, as the Foldkit project already does.
- [Better Auth's adapter sorts by one field, so users created in one instant have no stable order across pages] → Accepted.
- [Searching for `%`, `_` or `\` scans every match, since Better Auth escapes no wildcard] → Accepted: admin only.
- [Signing out of an impersonated session ends it without an entry; only the stop endpoint records] → As in the Foldkit project today.
- [The startup check reads an Effect-internal shape, and the plugin an adapter's methods] → Both fail at startup or in tests when those change, never silently open.
- [Better Auth minor releases change admin routes] → The wrapper denies by prefix, and a test lists the installed plugin's routes.
- [Cookies cross subdomains when deployed but not under `alchemy dev`, where each app has its own localhost port] → The listed origins include the dev ones; the impersonation scenario is checked deployed.
- [Roles can't be changed through the API until `extend-admin-users`] → The Foldkit project has no such page; `ADMIN_EMAILS` grants the first admins.

## Migration Plan

1. Publish, the first time by hand; nothing changes for repos that don't install the package.
2. Foldkit project: upgrade pins, add the package and `access.ts`, mount, switch its admin API to the core and its users pages to the users client, move `ADMIN_EMAILS` to the remote secrets store, remove the old code.
3. Rollback: revert the repo's commit. The audit table keeps its old columns, and roles stay compatible.

## References

- [Alchemy Git][git]: the pattern for a product that embeds in a host's API and leaves auth to it. Source: [`packages/git`](https://github.com/alchemy-run/alchemy/tree/v2.0.0-beta.87/packages/git).
- [Better Auth admin plugin](https://www.better-auth.com/docs/plugins/admin).
- [Effect `EventLog`](https://effect.website/blog/module-of-the-week/event-log).

[git]: https://alchemy.run/git/
