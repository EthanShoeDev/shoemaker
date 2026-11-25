# Design

## Context

See proposal.md for motivation. Two admins exist today, and comparing them decides most of this design. Read at doc-convert-dev `dc35d43` and shumate-draughn-inc `e308847`.

| | doc-convert-dev | shumate-draughn-inc |
| --- | --- | --- |
| Framework | Foldkit, client-only | TanStack Start, `ssr: false` admin routes |
| Pages that are the project's own | 1 of 3 in the nav, plus panels on the user page | 6 of 7 in the nav |
| API prefix | `/admin` | `/api/admin` |
| How `/api` reaches the API Worker | zone route | service binding, forwarded by an `/api/$` route |
| Better Auth tables | migrated by Alchemy | Drizzle, generated migrations |
| Sign-in | emailed link | password |
| User actions | through the AdminApi | straight to `/api/auth/admin/*` from the browser |
| Refuses impersonated sessions | yes | no |
| Audit log | yes | planned |
| Own roles | none | `host`, which its public app also checks |

`access.ts`, `RequiredPermissions`, the `AdminAuth` middleware, `can` and `promoteAdmins` are near-copies. What differs is what was lost or never carried over.

Facts checked in source that constrain the approach:

- `HttpApiBuilder.group` is typed against one `HttpApi`, and group services are keyed by API id, so separate APIs coexist in one router. `HttpRouter.prefixed` re-mounts routes under a prefix.
- A middleware wraps the handler's effect before typed errors are encoded, so it sees success as a response and failure as a failed effect.
- `effect/sql`'s `Migrator` runs in `withTransaction`; the D1 client dies on transactions. (Effect reference clone, 4.0.7.)
- `alchemy.run.ts` is a `seed` file: `sync` never rewrites it. `Contribution` has no way to add to it, and two generators may not emit one path unless it is a JSON merge.
- `package-boundaries` checks app-to-app dependencies only; it cannot see subpaths.
- Better Auth's `set-role` does not stop you changing your own role, and `revoke-user-sessions` does not check that the user exists.
- `promoteAdmins` in both repos overwrites a user's other roles.
- doc-convert-dev's audit page cursor is `created_at < ?`, which skips entries that share a timestamp.
- Both repos commit their admin email list.

## Goals / Non-Goals

**Goals:** a security core that cannot drift between projects; project-specific admin code that needs no permission from the package; the same product contract for `users`, `audit`, Edgehog and the issue tracker.

**Non-Goals:** a plugin system that loads pages it doesn't know at build time; a generic product framework before the second product (decision 10); rendering admin pages on a server.

## Decisions

### 1. The project owns the admin app; packages supply a core and pages

Three layers, split by *who should decide* and *what must not drift*:

| Layer | Delivered as | Holds | Changes by |
| --- | --- | --- | --- |
| Core | dependency, required | admin access, permissions, impersonation, audit, closing Better Auth's endpoints | version bump |
| Products | dependency, each optional | an API, storage layers, pages: `users`, `audit`, then Edgehog and issues | version bump |
| Project | its own code | routes, layout, nav order, `access.ts`, its own AdminApi and pages | the project |

Generated wiring (decision 9) joins the three. The rule for placing something: if a project getting it wrong is a security bug, core. If most projects want it the same, a product. Otherwise the project's.

The project *imports* pages; the package never *hosts* the project's. Each shared page is exported at three sizes: the whole page, its parts (user details, user actions, the users table with extra columns), and its headless state. doc-convert-dev's user page composes the shared parts with its billing panel and grant form; shumate-draughn-inc's six pages need only routes and nav entries.

*Alternatives.* A package-owned shell with plugin slots: most of shumate-draughn-inc would live in slots, TanStack's file routes can't come from a package, and Foldkit's `Model` and `Message` unions are closed, so slots lose their types. Copying a scaffold into each repo: that is what we have, and the table above is the result.

### 2. Project data is joined beside shared data, not merged into it

The users API returns account data only. A project's plan column comes from its own endpoint (accounts by user id) under its own permission, and the table takes extra columns with a cell function. So schemas stay closed and an admin without `billing:read` still gets a users page. In doc-convert-dev this becomes two requests where there was one, and `users.list` no longer needs `billing:read`.

*Alternative.* A generic user schema or a server-side extension hook: it spreads a type parameter through contract, client and both UIs, and ties the page's permission to the project's data.

### 3. Access rules: the project's `access.ts`, built from product declarations

`defineAccess({ products, statements, roles })` (subpath `/access`) returns `ac`, `roles`, `can` and a typed `requires(...)` for the project's endpoints. `RequiredPermissions` is a structural record, so product contracts don't depend on one project's statements. At startup the core checks every mounted endpoint against the defined statements and dies on an unknown one. `ac` and `roles` go to Better Auth's plugin and to the browser, and the admin app decides by `can`, never by the name `admin`. `adminRoles` for Better Auth is every role that grants an admin permission, so impersonating a `support` user also needs `impersonate-admins`.

### 4. One middleware does access and audit

`AdminAuth` reads a fresh session, refuses impersonation, checks `RequiredPermissions` (none declared: 403), and provides `CurrentAdmin`. For endpoints that are not GET it also requires an `Audited` annotation (none: 403), provides a request-scoped `AuditTrail`, and after a successful response writes one entry. The target defaults to the `id` path parameter; handlers add target or detail through `AuditTrail`. A GET may declare `Audited` too (opening a replay).

If the audit write fails after the action happened, the request fails and everything is logged. Writing the entry first would record actions that never happened, and D1 has no transaction spanning Better Auth and our table.

*Alternative.* Handlers call `record`, as today: each project's handlers must remember, and shumate-draughn-inc shows they don't.

### 5. Better Auth stays behind two ports

`AdminSessions` (current session, authorize) and `UserDirectory` (the user operations, plus which optional ones exist) are services in the core. `/better-auth` implements them on `@alchemy.run/better-auth` and wraps the auth handler: 404 for admin paths except stop-impersonating, which it audits. The wrapper decides on the decoded, collapsed, lower-cased pathname. It also adds what Better Auth lacks: no changing your own roles, and 404 before ending an unknown user's sessions. Only `/access` and `/better-auth` import Better Auth; moving to Effect's auth replaces those two.

### 6. Products ship their own `HttpApi`; `mountAt` prefixes the router

A product's contract carries no prefix. `mountAt(prefix)` provides it a prefixed `HttpRouter`, and its client takes the same prefix as base URL. The source document says both "don't `.add()` groups into the host API" and "the `/admin` contract subpath mounts shoemaker-admin's groups"; the first wins, and `/admin` holds only the project's own AdminApi.

### 7. Package layout

Subpaths per product, each importing only what is listed:

| Subpath | Holds | May import |
| --- | --- | --- |
| `.` | schemas, tags, errors, product description (id, statements, nav) | `effect` |
| `/contract` | `HttpApi`s | `.` |
| `/access` (admin only) | `defineAccess` | `.`, better-auth access |
| `/server` | handlers, middleware, `mountAt` | `.`, `/contract` |
| `/better-auth` (admin only) | decision 5 | `/server`, `@alchemy.run/better-auth` |
| `/sql` | stores and migrations over `SqlClient` | `.` |
| `/cloudflare` | Durable Object, R2 and Alchemy helpers | `.`, `/sql`, Alchemy |
| `/client` | headless state, no framework | `/contract` |
| `/foldkit`, `/react` | pages and parts | `/client` |
| `/effect`, `/ingest` (Edgehog only) | Effect reporter; protocol adapters and the ingest server | `.` |

The kickoff's `/alchemy` becomes `/cloudflare`, matching the anatomy table. A test walks each entry's import graph to enforce the table, since `package-boundaries` can't; it also proves the browser entries carry no server code. React, Foldkit, Alchemy and Cloudflare are optional peers. Tailwind classes reach a host through `@source`, colors through the host's tokens.

There is no `/shoemaker` subpath (decision 9).

### 8. Migrations without transactions

Each product exports ordered, idempotent migrations (`IF NOT EXISTS`, one change each) and a small runner that records each one after it succeeds in `<product>_migrations`. A failure midway reruns safely. The runner runs at deploy through an Alchemy Action over the host's `SqlClient`, ordered before the server that needs it, and in tests over in-memory SQLite. The audit table keeps doc-convert-dev's name and columns, so adoption needs no copy.

*Alternatives.* Effect's `Migrator`: dies on D1. SQL files in the host's migrations folder: shumate-draughn-inc generates that folder with Drizzle.

### 9. The CLI generates wiring files; product generators live in the CLI

`sync` owns small `products.gen.ts` files: one beside the Stack (resources, migrations, `PromoteAdmins`), one in the API app (a layer mounting every product), one in the admin app (nav entries and descriptions). Seeds import them once (`yield* Products`, `ProductsLive`, `productNav`). New repos get that line in the seed; existing repos get it as numbered changeset steps, and `doctor` checks for it. This replaces the document's plan to manage resources inside `alchemy.run.ts`, which is a seed. `Contribution` gains a `products` field, and a renderer builds the files from all of them.

Product generators sit in `packages/cli/src/generators/products/<name>.ts`, with one index line each. The document puts them in a `/shoemaker` subpath that the CLI imports while it imports the CLI's engine types: a package cycle that `^build` cannot order, and every CLI install would pull each product. The fixed release group already ships a product and its generator together.

The zone route and the service binding both stay: the wiring picks the forwarding route for a TanStack Start admin and the zone route for a Foldkit one, as the two repos do. Deployed cookies cross subdomains; under `alchemy dev` they stay on localhost.

### 10. Extract shared code after the second product, not before

The description, mounting, migration runner and reference format live in `shoemaker-admin` under one folder expected to move. `users` and `audit` use them as any product would. Edgehog imports them from `shoemaker-admin`. With the issue tracker built, what all three use moves to its own package.

### 11. Edgehog: control plane on `@alchemy.run/domain`, data plane on services

- Control plane: `Issue` (keyed `projectId:fingerprint`), then flags, experiments, releases, alert rules, dashboards. Alerts are policies. MCP and CLI come from the model.
- Data plane: `EventLog`, `Analytics`, `PersonStore`, `BlobStore`, `FlagEval`, `Symbolicator`. Events are keyed by id for idempotence. `Analytics` takes structured queries.
- Raw exceptions go to `EventLog`; batches of occurrences reach the aggregate about once a minute with a batch id, so redelivery doesn't count twice.
- Identities resolve at query time through a mapping table; only the ClickHouse layer stores the resolved person.
- Protocol adapters translate at the edge, tested with payloads recorded from each pinned SDK version.
- Ingest is its own Worker or Bun server.

The local Alchemy clone (2026-10-28, beta.84) has `domain` on Durable Objects but no cluster example, no Board and no `cloudflare-ai-issues`, all of which the document cites. Until the pinned version is shown to run `domain` off Cloudflare, a module with a control plane is rejected on other targets by the config rules.

### 12. Phases are gates

Phases run in order; each group in tasks.md ends by using the result in a real project. Later specs are firm about behavior, but their design is thin on purpose: before a phase starts, revise this file with what the last one taught. Work in other repos happens in their checkouts, in sessions started there. Deploys are Ethan's.

## Risks / Trade-offs

- [One change covers eight phases, so it stays open for months and can't archive] → The gates make a clean split possible: finished groups can move to their own change and archive. Revisit after phase 5.
- [Closing Better Auth's endpoints breaks shumate-draughn-inc's users page] → Its move to the package lands in the same commit as the wrapper.
- [Behavior changes in doc-convert-dev: merged roles on promote, a split users request, a fixed audit cursor] → Listed in the changeset; its existing admin tests move over and must pass otherwise unchanged.
- [`mountAt`, the middleware's view of failures and the D1 runner rest on reading source, some at 4.0.7] → Task 1.2 proves them at 4.1.5 before anything is built on them.
- [Foldkit and React pages double the UI cost] → Logic in `/client`; Edgehog and issues ship React first.
- [doc-convert-dev and shumate-draughn-inc pin Effect 4.1.2 and Alchemy beta.85; the CLI pins 4.1.5 and beta.87] → Each repo upgrades before adopting.
- [Better Auth minor releases change admin routes] → The wrapper denies by prefix, and a test lists the installed plugin's admin routes.
- [Product PRs can break every CLI release through the fixed group] → Accepted for aligned versions.
- [Replays and people hold personal data] → Retention, deletion, a replay permission and audited viewing are requirements, not later work.

## Migration Plan

1. Publish; nothing changes for repos whose config has no new keys.
2. Per repo: upgrade pins, add the package and `access.ts` via `defineAccess`, mount, move pages over, close the endpoints, move `ADMIN_EMAILS` to the environment, remove the old code.
3. Rollback: revert the repo's commit. The audit table and roles stay compatible with the old code.

## Open Questions

- Which email sender alerts use by default; the host supplies a service either way.
- How experiments judge significance (frequentist or Bayesian); the spec needs only "not enough data".
- Whether DuckDB for Iceberg runs in a Worker or a Container.
