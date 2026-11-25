# Tasks

Tasks marked **[Foldkit project]** happen in that repo's own checkout, never in `.external/`. Tasks marked **[Ethan]** include a deploy, which agents don't run. Package tasks also pass `bunx turbo run lint:check --filter=<pkg>` and `bun run test`.

## 1. Package and proofs

- [x] 1.1 Scaffold `packages/admin` with the subpaths in design.md, catalog pins, the vitest project and version 0.1.0 and a changesets `fixed` group for products; verify `bun install` and `lint:check` pass, and that `bunx changeset status` with an admin patch bumps no other package
- [x] 1.2 Prove at the pinned versions, as tests that stay: `mountAt` under two prefixes, the middleware telling success from failure, and one migration with its record as a D1 `batch` (through Alchemy's deploy-time client too) and as a transaction; update design.md if one fails

## 2. Core

- [x] 2.1 Schemas, errors, `RequiredPermissions`, `Audited`, `ReadOnly`, `CurrentAdmin`, `AuditTrail`, the two ports and the product description; verify with an import-graph test that fails on a deliberate violation, and an install test that pulls neither React nor a Cloudflare package
- [x] 2.2 `defineAccess` with product statements, project statements, roles and `can`; verify tests for comma-separated roles, split permissions, the default admin role, and public permissions with a role shaped like the React project's
- [x] 2.3 `AdminAccess` and its `HttpApi` adapter, with a caller type that already allows keys; verify the `admin-access` scenarios for callers, origins, permissions and impersonation over in-memory sessions, plus the startup check and a missing session source failing typecheck
- [x] 2.4 Migration runner, the atomic-write service and the audit store; verify one suite on SQLite, a D1-like client and PGlite: an interrupted migration that adds a column, an existing table read and written by its old statements, two products in one database, and paging across equal timestamps
- [x] 2.5 A Postgres for tests, from the dev shell and a CI service, since PGlite has one connection; verify two deploys at once against it, and that CI fails rather than skips without it
- [x] 2.6 Audit in the core; verify each `admin-audit-log` scenario not about stopping an impersonation (3.2 covers that), including a failed write, a change of nothing, a target that is not a user, a read by POST and a write endpoint with no action

## 3. Users and Better Auth

- [x] 3.1 `users` and `audit` contracts and handlers; verify one suite of `admin-user-management` scenarios against an in-memory directory and in-memory Better Auth, and that the host's API description lists neither
- [x] 3.2 The auth handler wrapper; verify every admin route of the installed plugin answers 404, path variants included, and that stopping an impersonation works and is audited
- [x] 3.3 `promoteAdmins` keeping other roles, and `/alchemy` Actions for it and migrations; verify merged roles, letter case, an unknown email, an empty list, and that each Action's input changes with its list and database, with typecheck and tests only
- [x] 3.4 Package README, the root README's products section, and a changeset with numbered adoption steps and the list of behavior changes; verify a fresh reader can follow them

- [ ] 3.5 **[Ethan]** Publish `shoemaker-admin` once by hand and trust `release.yml` for it, as `scripts/release.ts` describes

## 4. Adoption

- [ ] 4.1 **[Foldkit project]** Upgrade pins, including Foldkit 0.171's result messages; verify its full checks pass before adopting anything
- [ ] 4.2 **[Foldkit project]** Adopt the server core, with its users pages reading plan data from the project's own endpoint; verify its admin tests pass with only the listed differences
- [ ] 4.3 **[Ethan]** Set `ADMIN_EMAILS`, deploy, and confirm the admin works with its old audit entries
