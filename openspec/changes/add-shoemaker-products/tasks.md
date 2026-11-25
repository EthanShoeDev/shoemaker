# Tasks

Groups 1 to 13 are the steps in design.md, decision 1. Each ends in a real project, and the next starts only then. Tasks marked **[Foldkit project]**, **[React project]** or **[Expo project]** happen in that repo's own checkout, never in `.external/`. Tasks marked **[Ethan]** include a deploy, which agents don't run. Package tasks also pass `bunx turbo run lint:check --filter=<pkg>` and `bun run test`.

## 1. Admin core

- [ ] 1.1 Scaffold `packages/admin` with the subpaths this step needs, catalog pins, the vitest project and the changesets `fixed` entry; verify `bun install` and `lint:check` pass
- [ ] 1.2 Prove at the pinned versions, as tests that stay: `mountAt` under two prefixes, the middleware telling success from failure, and the migration runner on a client that refuses transactions; update design.md if one fails
- [ ] 1.3 Core schemas, errors, `RequiredPermissions`, `Audited`, `CurrentAdmin`, `AuditTrail`, the two ports and the product description; verify with an import-graph test that fails on a deliberate violation
- [ ] 1.4 `defineAccess` with product statements, project statements, roles and `can`; verify tests for comma-separated roles, split permissions and the default admin role
- [ ] 1.5 `AdminAccess` and its `HttpApi` adapter, with a caller type that already allows keys; verify each step 1 scenario of `admin-access` over in-memory sessions, plus the startup check
- [ ] 1.6 Migration runner and audit store; verify rerun after a partial failure, an existing table, and paging across equal timestamps
- [ ] 1.7 Audit in the core; verify each `admin-audit-log` scenario, including a failed write and a write endpoint with no action
- [ ] 1.8 `users` and `audit` contracts and handlers; verify one suite of `admin-user-management` scenarios against an in-memory directory and in-memory Better Auth
- [ ] 1.9 The auth handler wrapper; verify every admin route of the installed plugin answers 404, path variants included, and that stopping an impersonation is audited
- [ ] 1.10 `promoteAdmins` keeping other roles, and the deploy steps for it and migrations; verify merged roles, an unknown email and an empty list, with typecheck and tests only
- [ ] 1.11 Package README and changeset with numbered adoption steps and the list of behavior changes; verify a fresh reader can follow them
- [ ] 1.12 **[Foldkit project]** Upgrade pins, including Foldkit 0.171's result messages; verify its full checks pass before adopting anything
- [ ] 1.13 **[Foldkit project]** Adopt the server core under its current pages; verify its admin tests pass with only the listed differences
- [ ] 1.14 **[React project]** Upgrade pins, adopt the core, and switch its users page to the users API in the commit that closes Better Auth's endpoints; verify its tests, with every user action audited
- [ ] 1.15 **[Ethan]** Set `ADMIN_EMAILS`, deploy both, and confirm each admin works with its old audit entries

## 2. Flags, evaluated locally

- [ ] 2.1 Scaffold `packages/edgehog` with the flag subpaths and optional peers; verify a flags-only install pulls neither `domain` nor a UI framework
- [ ] 2.2 Check the licence of the flag test vectors PostHog vendors; verify with the finding recorded in design.md and, if reusable, the notices file
- [ ] 2.3 The evaluator: types, rules, shares, reasons, error codes; verify each scenario, plus committed assignment vectors that must never change
- [ ] 2.4 Definitions over `SqlClient` with migrations on SQLite, D1 and Postgres; verify one suite on each available locally
- [ ] 2.5 The OpenFeature server provider with cached definitions; verify with `TestClock` that a change arrives within a minute, stale and never-loaded behavior, and no request per evaluation
- [ ] 2.6 The pinned provider conformance suite against the provider; verify that mandatory scenarios pass and undeclared ones report as skipped
- [ ] 2.7 A helper that hands evaluated results to a client; verify the output holds no rules
- [ ] 2.8 Flags API behind `AdminAuth`; verify permission and audit tests
- [ ] 2.9 README and changeset; verify the example runs as written
- [ ] 2.10 **[React project]** Mount flags, add one flags page by hand, and put one real feature behind a flag; verify its tests
- [ ] 2.11 **[Ethan]** Deploy; confirm turning the flag off takes effect within a minute

## 3. Errors from servers

- [ ] 3.1 Revise design.md with what steps 1 and 2 taught, reading `domain` at the pinned release tag; verify an in-memory `domain` story and an RPC call refused by the access core's RPC adapter
- [ ] 3.2 Record fixtures from the pinned Sentry Cloudflare SDK with a refresh script; verify the script reproduces them
- [ ] 3.3 Event shape, `EventStore`, `Analytics`, SQL layers, weighted rows and retention; verify the shared backend suite, and expiry with `TestClock`
- [ ] 3.4 Ingest server with project keys, limits and the Sentry adapter; verify every fixture, each way of sending a key, framing variants, retries, size and rate tests, and that keys reach no log or span
- [ ] 3.5 Basic scrubbing before storage; verify a fixture for each kind of secret
- [ ] 3.6 Fingerprints with versions, the three SDK forms, and the fingerprint table; verify grouping fixtures, simultaneous first occurrences and a rules change
- [ ] 3.7 `Issue` aggregate with resolve and regression; verify stories, redelivered batches, and an occurrence already on its way when resolved
- [ ] 3.8 Counts from events, with the cap; verify the crash-loop scenario and a late arrival moving first seen
- [ ] 3.9 New-issue email as a policy; verify once per issue and retry
- [ ] 3.10 `/effect` reporter; verify a report with concurrent causes and nested spans
- [ ] 3.11 Cloudflare helpers, README and changeset; verify typecheck and tests only
- [ ] 3.12 **[React project]** Install, with a hand-written issues page; verify its tests
- [ ] 3.13 **[Ethan]** Deploy; confirm a real server failure becomes one issue and one email

## 4. Shared pages

- [ ] 4.1 `/client` state for sessions, users, audit, flags and issues; verify each session state and that data is dropped when the session changes
- [ ] 4.2 `/foldkit` pages and parts; verify story and scene tests with an extra column and an extra panel
- [ ] 4.3 `/react` pages and parts; verify component tests that match the Foldkit scenarios
- [ ] 4.4 Import-graph and install tests for both; verify that browser entries hold no server code and a Foldkit install has no React
- [ ] 4.5 README and changeset; verify the example pages build
- [ ] 4.6 **[Foldkit project]** Replace its generic pages, keeping its plan column, billing panel and grant form; verify its story and scene tests
- [ ] 4.7 **[React project]** Replace its generic pages; verify its tests
- [ ] 4.8 **[Ethan]** Deploy both and confirm each page works

## 5. Generators

- [ ] 5.1 Config schema: `auth`, `admin`, `modules` and their rules; verify a test per rejected config and that older configs decode
- [ ] 5.2 `products` in `Contribution` and the `products.gen.ts` renderer; verify two products combine deterministically and none emits nothing
- [ ] 5.3 Better Auth, `access.ts`, admin contract, Foldkit and TanStack Start admin, and Edgehog generators, with pins in `versions.ts`; verify generator tests
- [ ] 5.4 `doctor` checks; verify a failing and a passing fixture for each
- [ ] 5.5 `adopt` inference; verify fixtures shaped like both existing admins, and an app merely named `admin`
- [ ] 5.6 `shoemaker add admin` and modules; verify a command test that adds each and typechecks
- [ ] 5.7 e2e presets with a Foldkit admin, a React admin and Edgehog; verify `bun run test` checks them with no drift
- [ ] 5.8 README section on auth, admin, flags and errors; verify every command in it runs
- [ ] 5.9 **[Foldkit project]** and **[React project]** Replace hand wiring with generated wiring; verify `adopt` and `sync --check` report no conflicts
- [ ] 5.10 **[Expo project]** `shoemaker add admin`, flags and server errors; verify its checks
- [ ] 5.11 **[Ethan]** Deploy the Expo project; confirm its admin works at its subdomain

## 6. Agents

- [ ] 6.1 Keys: creating, listing, revoking, expiry, effective permissions and the fixed refusals; verify each key scenario of `admin-access`, including a ban and a lost role
- [ ] 6.2 MCP gate and CLI over the access core, with agent names; verify the same refusals through HTTP, RPC, MCP and CLI, and an unset name variable
- [ ] 6.3 Issue commands as MCP tools and CLI; verify audit entries name the owner and the agent
- [ ] 6.4 Generated MCP entry and agent skill, with no secret in any file; verify generator tests
- [ ] 6.5 Keys page in both UIs, README and changeset; verify a key is shown once
- [ ] 6.6 **[Ethan]** Deploy; confirm an agent lists and resolves a real issue

## 7. Errors from browsers and mobile

- [ ] 7.1 Revise design.md for this step; record browser and React Native fixtures; verify the script reproduces them
- [ ] 7.2 Origins, tunnel, exposed headers and limits for unwanted kinds; verify with the pinned browser SDK
- [ ] 7.3 Source maps by debug ID with an uploader for Vite and Metro; verify a minified and a Hermes fixture, that maps are not public, and that nothing is fetched
- [ ] 7.4 Mapping before grouping, and scrubbing after it; verify two builds join one issue and a secret in a mapped line is not stored
- [ ] 7.5 Releases, resolve in release or next release, and archive; verify an old app version, a newer release and each archive condition
- [ ] 7.6 Merge and split; verify counts and later occurrences follow
- [ ] 7.7 Filters, spike alerts and webhooks; verify reasons are counted and a second spike alerts after the interval
- [ ] 7.8 Pages, generator, README and changeset; verify e2e presets
- [ ] 7.9 **[Expo project]** **[Ethan]** Deploy; confirm a browser and a mobile error appear with readable stacks

## 8. Flags, evaluated remotely

- [ ] 8.1 OFREP single and bulk endpoints with tags and limits; verify every response against the pinned schema
- [ ] 8.2 The community server and web providers against it; verify the conformance suite for the capabilities each declares, and equality with local evaluation
- [ ] 8.3 SDK setup for web and Expo, README and changeset; verify e2e presets and that no rules reach a client
- [ ] 8.4 **[Expo project]** **[Ethan]** Deploy; confirm one flag answers alike on server, web and mobile

## 9. Analytics

- [ ] 9.1 Revise design.md for this step; record PostHog fixtures for both protocols, startup included; verify the script reproduces them
- [ ] 9.2 Both capture adapters, clocks, tokens and quotas; verify every fixture and each protocol's limit form against the pinned SDKs
- [ ] 9.3 Startup configuration and scripts; verify with a real browser that no request fails or goes to PostHog
- [ ] 9.4 Persons, aliases, events without a person, deletion; verify merge, refusal, placeholder and late-event cases
- [ ] 9.5 Trends with filters, breakdowns, time zone and week start; verify shared suite cases on every SQL layer
- [ ] 9.6 Pages, capacity warnings, generator, README and changeset; verify component tests and an e2e preset
- [ ] 9.7 **[Expo project]** **[Ethan]** Deploy; confirm a trend and a merged person

## 10. Deeper analytics and experiments

- [ ] 10.1 Funnels and retention; verify ties, restarts, windows and returning people in the shared suite
- [ ] 10.2 OpenFeature hook and tracking for exposures and goals; verify bulk fetches and repeated reads
- [ ] 10.3 Experiments; verify a clear winner, too little data and people who saw two variants
- [ ] 10.4 PostHog flags answer; verify the pinned posthog-js sees the variants an OpenFeature client sees, and definitions are refused
- [ ] 10.5 Telling remote clients of changes; verify the message holds no values, and record its idle cost
- [ ] 10.6 Pages, README and changeset; verify component tests
- [ ] 10.7 **[Expo project]** **[Ethan]** Deploy; confirm a funnel and one experiment

## 11. Replay

- [ ] 11.1 Ingest, blobs, retention and tombstones; verify duplicates, reordering, gaps and late chunks
- [ ] 11.2 Player, permission, audited viewing and mobile recordings; verify a recording with scripts runs none
- [ ] 11.3 Issue context: events, flags and replay; verify playback starts before the error
- [ ] 11.4 README and changeset; verify component tests
- [ ] 11.5 **[Expo project]** **[Ethan]** Deploy; confirm a replay opened from an error

## 12. Larger backends

- [ ] 12.1 Revise design.md, settling where DuckDB runs; verify a working local query
- [ ] 12.2 Iceberg layers; verify the shared suite
- [ ] 12.3 ClickHouse layers; verify the shared suite against a local ClickHouse
- [ ] 12.4 Writing to two, copying and comparing; verify a failed secondary and an overlapping copy
- [ ] 12.5 Config rules, generator, README and changeset; verify rejected-config tests

## 13. Issue tracker and shared package

- [ ] 13.1 Check that the pinned Alchemy release has what Board needs, read Board and `cloudflare-ai-issues` again, and decide whether the tracker works offline (decisions 14 and 15); verify a recorded model and decision
- [ ] 13.2 Domain model from Board with the changes in decision 15 and its notice; verify two claimants, two claimants with one command id, a vanished agent, one name with two keys, and reopening
- [ ] 13.3 API, MCP, CLI, pages and generator; verify permission tests through each and an e2e preset
- [ ] 13.4 Links to Edgehog; verify with it installed and absent
- [ ] 13.5 OAuth for MCP clients; verify consent, refusal while impersonating, refresh and a ban
- [ ] 13.6 Move what the products share into its own package; verify their tests pass unchanged and import-graph tests hold

## 14. Integration

- [ ] 14.1 Generate a sample with everything; verify every check passes and `sync --check` reports no drift
- [ ] 14.2 Run `bunx turbo run test` and `lint:check` across the repo; verify both pass

## Workflow follow-up

- Archive the change after every step is done, or split finished steps into their own change and archive that first.
