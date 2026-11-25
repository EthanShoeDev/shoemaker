# Tasks

Tasks marked **[repo]** happen in that repo's own checkout, never in `.external/`. Tasks marked **[Ethan]** include a deploy, which agents don't run. Package tasks also pass `bunx turbo run lint:check --filter=<pkg>` and `bun run test`.

## 1. Admin core

- [ ] 1.1 Scaffold `packages/admin` (`shoemaker-admin`) with the subpaths in design decision 7, catalog pins, the vitest project and the changesets `fixed` entry; verify `bun install` and `lint:check` pass
- [ ] 1.2 Prove at the pinned versions, as tests that stay: `mountAt` under two prefixes, the middleware telling success from failure, and the migration runner on a client that refuses transactions; update design.md if one fails
- [ ] 1.3 Core schemas, errors, `RequiredPermissions`, `Audited`, `CurrentAdmin`, `AuditTrail`, `AdminSessions`, product description; verify with a test that `.` imports only `effect`
- [ ] 1.4 Import-graph test for the whole subpath table; verify a deliberate violation fails it
- [ ] 1.5 `defineAccess` with product statements, project statements, roles and `can`; verify tests for comma-separated roles, split permissions and the default admin role
- [ ] 1.6 `AdminAuth` access checks; verify a test per `admin-access` scenario over an in-memory session source, plus the startup check for undefined permissions
- [ ] 1.7 Migration runner and audit store over `SqlClient`; verify rerun after a partial failure, adoption of an existing table, and paging across equal timestamps
- [ ] 1.8 Audit in the middleware; verify each `admin-audit-log` scenario, including a failed write and a write endpoint with no action

## 2. Users, Better Auth and the Foldkit UI

- [ ] 2.1 `users` and `audit` contracts and handlers over `UserDirectory`; verify each `admin-user-management` scenario against an in-memory directory
- [ ] 2.2 `/better-auth`: `AdminSessions` and `UserDirectory` on in-memory Better Auth; verify the same scenarios, so both implementations share one suite
- [ ] 2.3 The auth handler wrapper; verify every admin route of the installed plugin answers 404, path-spelling variants included, and that stopping an impersonation is audited
- [ ] 2.4 `promoteAdmins` keeping other roles; verify tests for merged roles, an unknown email and an empty list
- [ ] 2.5 `/client`: session states, users, user and audit state; verify tests for each session state and for dropping data when the session changes
- [ ] 2.6 `/foldkit`: session shell, sign-in by enabled method, users, user, audit, as pages and parts; verify story and scene tests, including an extra column and an extra panel
- [ ] 2.7 `/cloudflare`: deploy steps for migrations and `PromoteAdmins`, and the admin site helper for zone-route and forwarded APIs; verify typecheck and tests only
- [ ] 2.8 Package README and changeset with numbered adoption steps; verify a fresh reader can follow them against doc-convert-dev's layout

## 3. doc-convert-dev moves over

- [ ] 3.1 **[doc-convert-dev]** Upgrade to the CLI's Effect and Alchemy pins; verify its full checks pass before adopting anything
- [ ] 3.2 **[doc-convert-dev]** Adopt the server half, keeping billing and profitability; verify `apps/api/test/admin.test.ts` passes with only the differences listed in the changeset
- [ ] 3.3 **[doc-convert-dev]** Adopt the Foldkit pages with the plan column, billing panel and grant form; verify its story and scene tests pass
- [ ] 3.4 **[doc-convert-dev]** **[Ethan]** Move the email list to `ADMIN_EMAILS`, deploy, and confirm the admin works with its old audit entries

## 4. CLI config and the Foldkit generator

- [ ] 4.1 Config schema: `auth`, `admin`, `modules` and their rules; verify a test per rejected config and that older configs decode
- [ ] 4.2 `products` in `Contribution` and the `products.gen.ts` renderer; verify two products combine deterministically and a config without products emits nothing
- [ ] 4.3 Better Auth, `access.ts` seed, admin contract subpath and Foldkit admin generators, with the pins in `versions.ts`; verify generator tests
- [ ] 4.4 `doctor` checks from `product-generation`; verify a failing and a passing fixture for each
- [ ] 4.5 `adopt` inference for Better Auth and admin apps; verify fixtures shaped like doc-convert-dev and shumate-draughn-inc, and an app merely named `admin`
- [ ] 4.6 e2e preset with a Foldkit admin; verify `bun run test` generates, installs and checks it with no drift
- [ ] 4.7 README section on auth, admin and the three layers; verify every command in it runs
- [ ] 4.8 **[doc-convert-dev]** Add the config keys and generated wiring; verify `adopt` and `sync --check` report no admin conflicts

## 5. React admin

- [ ] 5.1 `/react` pages and parts from shumate-draughn-inc's admin, on `/client`; verify component tests match the Foldkit scenarios
- [ ] 5.2 TanStack Start admin generator with the forwarded API; verify generator tests and an e2e preset
- [ ] 5.3 `shoemaker add admin`; verify a command test that adds one to a repo and typechecks
- [ ] 5.4 **[shumate-draughn-inc]** Upgrade pins and adopt server and pages, closing Better Auth's endpoints in the same commit; verify its tests, with invite, roles, bans and impersonation now audited
- [ ] 5.5 **[tech-interview-prep]** Run `shoemaker add admin`; verify its checks pass
- [ ] 5.6 **[Ethan]** Deploy both; confirm each admin works at its subdomain

## 6. Edgehog: errors

- [ ] 6.1 Revise design.md for this phase: what phases 1 to 5 taught, and whether the pinned `@alchemy.run/domain` runs off Cloudflare; verify with a passing in-memory story and a decision recorded
- [ ] 6.2 Scaffold `packages/edgehog`; record payloads from the pinned Sentry and PostHog SDKs as fixtures with a script to refresh them; verify the script reproduces them
- [ ] 6.3 Event shape, `EventLog` and `Analytics` contracts, SQL layers (SQLite, D1, Postgres) and migrations; verify the first shared backend suite passes on each available locally
- [ ] 6.4 Ingest server: project keys, limits, Sentry adapter, PostHog capture adapter; verify every fixture decodes, plus retry, unknown key, size and rate tests
- [ ] 6.5 `Issue` aggregate with batching and regressions; verify domain stories and the crash-loop and double-batch scenarios
- [ ] 6.6 Alert policies and delivery; verify once-per-cause and retry tests
- [ ] 6.7 Source map upload and symbolication; verify a minified fixture stack resolves and maps are not publicly readable
- [ ] 6.8 `/effect` reporter; verify a report with concurrent causes and nested spans
- [ ] 6.9 Query API behind `AdminAuth`, MCP and CLI; verify permission and audit tests through each
- [ ] 6.10 `/client` and React issue pages with session context; verify component tests
- [ ] 6.11 Edgehog generator, `modules.edgehog`, SDK setup for web and Expo; verify an e2e preset
- [ ] 6.12 README and changeset; verify the documented setup matches the e2e sample
- [ ] 6.13 **[tech-interview-prep]** **[Ethan]** Install and deploy; confirm a real Effect failure appears as a grouped issue

## 7. Edgehog: analytics, flags, replay

- [ ] 7.1 Trends with filters and breakdowns, in every SQL layer; verify shared suite cases
- [ ] 7.2 Persons, aliases and deletion; verify merge, refused merge and deletion cases
- [ ] 7.3 Funnels and retention; verify ordering, window and returning-person cases in the shared suite
- [ ] 7.4 React analytics and people pages; verify component tests
- [ ] 7.5 Flags: definitions, audited changes, evaluation; verify answers equal the PostHog Node SDK's local evaluation over generated people
- [ ] 7.6 Experiments; verify a clear winner and a too-little-data fixture
- [ ] 7.7 Replay ingest and blob storage; verify ordering, duplicate and missing chunk tests
- [ ] 7.8 Replay player, permission and audited viewing, sandboxed; verify a recording with scripts runs none
- [ ] 7.9 Retention and capacity warnings; verify expiry with `TestClock` and the warning threshold
- [ ] 7.10 **[tech-interview-prep]** **[Ethan]** Deploy and confirm a trend, a flag and a replay opened from an error

## 8. Larger backends

- [ ] 8.1 Revise design.md for this phase, settling where DuckDB runs; verify with a recorded decision and a working local query
- [ ] 8.2 Iceberg `EventLog` and `Analytics`; verify the shared suite
- [ ] 8.3 ClickHouse `EventLog` and `Analytics`; verify the shared suite against a local ClickHouse
- [ ] 8.4 `EventLog.tee`, copying and comparing; verify a failed secondary and an overlapping copy lose and duplicate nothing
- [ ] 8.5 Config rules, generator and README for the new stores; verify rejected-config tests

## 9. Issue tracker and shared package

- [ ] 9.1 Revise design.md for this phase, reading the Alchemy issue-tracker example at the pinned version; verify with a recorded model
- [ ] 9.2 Domain model with claims that lapse; verify stories for two claimants and a vanished agent
- [ ] 9.3 API, MCP, CLI, React pages and generator; verify permission tests through each and an e2e preset
- [ ] 9.4 Links to Edgehog; verify with Edgehog installed and absent
- [ ] 9.5 Move what admin, Edgehog and issues share into its own package; verify all three packages' tests pass unchanged and the import-graph tests still hold

## 10. Integration

- [ ] 10.1 Generate a sample with both admin products, Edgehog and issues; verify every check passes and `sync --check` reports no drift
- [ ] 10.2 Run `bunx turbo run test` and `lint:check` across the repo; verify both pass

## Workflow follow-up

- Archive the change after every phase is done, or split finished phases into their own change and archive that first.
