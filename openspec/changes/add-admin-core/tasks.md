# Tasks

Tasks marked **[Foldkit project]** happen in that repo's own checkout, never in `.external/`. Tasks marked **[Ethan]** include a deploy, which agents don't run. Package tasks also pass `bunx turbo run lint:check --filter=<pkg>` and `bun run test`.

## 1. Package and proofs

- [ ] 1.1 Scaffold `packages/admin` with the subpaths in design.md, catalog pins, the vitest project and a changesets `fixed` group for products; verify `bun install` and `lint:check` pass, and that `bunx changeset status` with an admin patch bumps no other package
- [ ] 1.2 Prove at the pinned versions, as tests that stay: `mountAt` under two prefixes, the middleware telling success from failure, and the migration runner on a client that refuses transactions; update design.md if one fails

## 2. Core

- [ ] 2.1 Schemas, errors, `RequiredPermissions`, `Audited`, `CurrentAdmin`, `AuditTrail`, the two ports and the product description; verify with an import-graph test that fails on a deliberate violation, and an install test that pulls neither React nor a Cloudflare package
- [ ] 2.2 `defineAccess` with product statements, project statements, roles and `can`; verify tests for comma-separated roles, split permissions and the default admin role
- [ ] 2.3 `AdminAccess` and its `HttpApi` adapter, with a caller type that already allows keys; verify the `admin-access` scenarios for callers, permissions and impersonation over in-memory sessions, plus the startup check and a missing session source failing typecheck
- [ ] 2.4 Migration runner and audit store over `SqlClient`; verify one suite on SQLite, a D1-like client and PGlite: rerun after a partial failure, an existing table, two products in one database, and paging across equal timestamps
- [ ] 2.5 Audit in the core; verify each `admin-audit-log` scenario not about stopping an impersonation (3.2 covers that), including a failed write and a write endpoint with no action

## 3. Users and Better Auth

- [ ] 3.1 `users` and `audit` contracts and handlers; verify one suite of `admin-user-management` scenarios against an in-memory directory and in-memory Better Auth, and that the host's API description lists neither
- [ ] 3.2 The auth handler wrapper; verify every admin route of the installed plugin answers 404, path variants included, and that stopping an impersonation works and is audited
- [ ] 3.3 `promoteAdmins` keeping other roles, and the deploy steps for it and migrations; verify merged roles, letter case, an unknown email and an empty list, with typecheck and tests only
- [ ] 3.4 Package README, the root README's products section, and a changeset with numbered adoption steps and the list of behavior changes; verify a fresh reader can follow them

## 4. Adoption

- [ ] 4.1 **[Foldkit project]** Upgrade pins, including Foldkit 0.171's result messages; verify its full checks pass before adopting anything
- [ ] 4.2 **[Foldkit project]** Adopt the server core under its current pages; verify its admin tests pass with only the listed differences
- [ ] 4.3 **[Ethan]** Set `ADMIN_EMAILS`, deploy, and confirm the admin works with its old audit entries
