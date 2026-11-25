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
- Better Auth: a ban ends sessions.
- The adopting projects pin Effect 4.1.2 and Alchemy beta.85.

## Goals / Non-Goals

**Goals:** a security core that cannot drift; early choices that later changes don't have to undo (a caller type that can carry an agent's key, access that does not depend on the transport).

**Non-Goals:** a plugin system that loads pages it doesn't know at build time; a generic product framework before the second product; rendering admin pages on a server; generated wiring, which waits until wiring by hand has worked.

## Decisions

### 1. The project owns the admin app; packages supply a core and pages

| Layer | Delivered as | Holds | Changes by |
| --- | --- | --- | --- |
| Core | dependency, required | access, permissions, impersonation, audit, closing Better Auth's endpoints | version bump |
| Products | dependency, each optional | an API, storage layers, later pages: `users`, `audit`, Edgehog | version bump |
| Project | its own code | routes, layout, nav order, `access.ts`, its own AdminApi and pages | the project |

The rule for placing something: if a project getting it wrong is a security bug, core. If most projects want it the same, a product. Otherwise the project's. The project *imports* pages; the package never *hosts* the project's.

*Alternatives.* A package-owned shell with plugin slots: most of the React project would live in slots, TanStack's file routes can't come from a package, and Foldkit's `Model` and `Message` unions are closed, so slots lose their types. Copying a scaffold: copies drift, and what drifts is the checks.

### 2. Project data is joined beside shared data

The users API returns account data only. A plan column comes from the project's own endpoint, under its own permission. So schemas stay closed, and an admin without `billing:read` still gets a users page. The Foldkit project makes two requests where it made one.

*Alternative.* A generic user schema: a type parameter through contract, client and both UIs, and the page's permission tied to the project's data.

### 3. Access rules come from the project's `access.ts`

`defineAccess({ products, statements, roles })` returns `ac`, `roles`, `can` and a typed `requires(...)`. `RequiredPermissions` is a structural record, so product contracts don't depend on one project's statements. Startup checks every mounted endpoint against the defined statements and dies on an unknown one. The admin app decides by `can`, never by the name `admin`. `adminRoles` for Better Auth is every role that grants an admin permission, so impersonating any of them needs `impersonate-admins`.

### 4. One access core, with an `HttpApi` middleware as its adapter

`AdminAccess` takes headers, required permissions and an optional audit action, and returns the caller or a refusal. Its caller type leaves room for a key acting for a user; only sessions exist now. It takes headers and not an `HttpApi` request, so the agents change can put an MCP gate and a CLI over the same core. Every product API is an `HttpApi`, so one adapter is enough.

The core refuses impersonated sessions, banned users and undeclared endpoints, and requires an `Audited` action on anything that writes. It provides `CurrentAdmin` and a request-scoped `AuditTrail`, and after success writes one entry. The target defaults to the `id` parameter; handlers add target or detail. A read may declare an action too.

If the audit write fails after the action happened, the request fails and everything is logged. Writing first would record actions that never happened, and D1 has no transaction that spans Better Auth and our table.

*Alternative.* Effect's `EventLog` for the audit log: Better Auth changes the user outside any `EventLog` handler, so action and entry could not commit together, the entries would be binary, and its SQL journal uses transactions, which D1 lacks.

### 5. Better Auth stays behind two ports

`AdminSessions` and `UserDirectory` are core services; `/better-auth` implements them and wraps the auth handler: 404 for admin paths except stop-impersonating, which it audits. The wrapper decides on the decoded, collapsed, lower-cased pathname. Only `/access` and `/better-auth` import Better Auth.

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
| `/better-auth` (admin) | decision 5 | `/server`, `@alchemy.run/better-auth` |
| `/sql` | stores and migrations over `SqlClient` | `.` |
| `/cloudflare` | Alchemy helpers | `.`, `/sql`, Alchemy |

Later changes add `/client`, `/foldkit` and `/react`. A test walks each entry's import graph, since `package-boundaries` can't, and proves that browser entries carry no server code. Alchemy and Better Auth are optional peers.

### 8. Migrations without transactions

Each product exports ordered, idempotent migrations (`IF NOT EXISTS`, one change each) and a small runner that records each after it succeeds in `<product>_migrations`. It runs at deploy through an Alchemy Action over the host's `SqlClient`, before the server that needs it. The audit table keeps the name and columns an existing project already has, so adoption copies nothing.

*Alternatives.* Effect's `Migrator`: dies on D1. SQL files in the host's migrations folder: one project generates that folder with Drizzle.

### 9. Products version together, apart from the CLI

Products get their own changesets `fixed` group. Within it server and admin app versions stay aligned, and the CLI is neither bumped nor held up by product patches. `versions.ts` derives every `shoemaker-*` pin from the CLI's version, so products need their own constant there once a generator emits them; a `^0.x` range then admits product patches without a CLI release.

*Alternative.* The CLI's existing group: every product patch would release seven unrelated packages, and the reverse.

### 10. Shared code stays in one folder

Description, mounting, migrations and references live in one folder of `shoemaker-admin` that is expected to move to its own package once another product proves what is shared (roadmap).

## Risks / Trade-offs

- [Wired by hand now, then again by generators] → Accepted: the second wiring deletes the first, and is right.
- [Adopting the core changes behavior: promotion keeps other roles, users and plan data load separately, the audit cursor no longer skips entries with one timestamp] → Listed in the changeset.
- [Projects pin older Effect, Alchemy and Foldkit] → Each upgrades before adopting. Foldkit 0.171 requires result messages on every command.
- [Roles can't be changed through the API until `extend-admin-users`] → The Foldkit project has no such page; `ADMIN_EMAILS` grants the first admins.

## Migration Plan

1. Publish; nothing changes for repos that don't install the package.
2. Foldkit project: upgrade pins, add the package and `access.ts`, mount, switch its admin API to the core, move `ADMIN_EMAILS` to the remote secrets store, remove the old code.
3. Rollback: revert the repo's commit. The audit table and roles stay compatible.

## References

- [Alchemy Git][git]: the pattern for a product that embeds in a host's API and leaves auth to it. Source: [`packages/git`](https://github.com/alchemy-run/alchemy/tree/v2.0.0-beta.87/packages/git).
- [Better Auth admin plugin](https://www.better-auth.com/docs/plugins/admin).
- [Effect `EventLog`](https://effect.website/blog/module-of-the-week/event-log).

[git]: https://alchemy.run/git/
