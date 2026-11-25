# Design

## Context

See proposal.md for motivation. Three projects shape this, named here by what they are built with:

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

Facts checked in source, at the CLI's pins (Effect 4.1.5, Alchemy 2.0.0-beta.87, Foldkit 0.171) unless noted. Alchemy's `main` also calls itself beta.87 while holding unreleased work, so read its release tag, or say that a fact is from `main`. Sources are linked under References:

- `HttpApiBuilder.group` is typed against one `HttpApi`, and group services are keyed by API id, so separate APIs coexist in one router. `HttpRouter.prefixed` re-mounts routes.
- A `Domain.Api` is RPC with its own middleware. An `HttpApi` middleware does not run for it, nor for the MCP tools and CLI made from it; those carry the request's headers to the RPC middleware.
- `domain` runs on Durable Objects and on Effect Cluster. Cluster needs Postgres, and its Docker and AWS examples keep two runners up. It generates a Foldkit client, MCP tools, a CLI and plain HTTP endpoints, and no React client; Effect has `AtomRpc`.
- Only on Alchemy's `main`, not in beta.87: model verification (which adds `z3-solver` and `oxc-parser` as dependencies of every install), per-subject encryption, `DefaultConsistency`, `@alchemy.run/ai`, and the `cloudflare-ai-issues` example.
- `effect/sql`'s `Migrator` opens a transaction for SQLite, and the D1 client dies on transactions.
- `alchemy.run.ts` is a `seed` file: `sync` never rewrites it. `Contribution` cannot add to it, and two generators may not emit one path unless it is a JSON merge.
- `package-boundaries` checks app-to-app dependencies only.
- Better Auth 1.7.15: `set-role` lets you change your own role; `revoke-user-sessions` does not check that the user exists; a ban ends sessions; the key plugin stores permissions per key, which only server code can set.
- A Sentry SDK treats a bare 429 or `Retry-After` as a limit on everything, and `X-Sentry-Rate-Limits` as a limit on the kinds it names. A DSN's project id must be digits.
- Sentry maps many hashes to one issue with its own id, symbolicates before grouping, and tries old grouping rules after changing them. PostHog also maps fingerprints to separate issue ids.
- PostHog's newer capture protocol answers per event and never sends 429; the older one can. Its flag definitions need a secret key.
- OpenFeature Remote Evaluation Protocol (OFREP) 0.4.0 allows the reasons `STATIC`, `TARGETING_MATCH`, `SPLIT`, `DISABLED` and `UNKNOWN`, has a no-value answer for code defaults, and advises clients not to poll by default. The provider conformance suite and OpenFeature tracking are marked experimental.

Not verified: what `posthog-js` does when a startup request fails, how native and Cloudflare Sentry SDKs retry, and the licence of PostHog's flag test vectors, which it vendors from another repository.

## Goals / Non-Goals

**Goals:** something useful in a real project after every step; a security core that cannot drift; early choices that later steps don't have to undo (opaque issue ids, fingerprint versions, fixed flag assignment, transport-neutral access).

**Non-Goals:** a plugin system that loads pages it doesn't know at build time; a generic product framework before the second product; rendering admin pages on a server; feature parity with either vendor.

## Decisions

### 1. Ship in steps, each used before the next

| Step | Delivers | Waits |
| --- | --- | --- |
| 1 Admin core | access, audit, users API in both existing admins, under their current pages | shared pages, generators |
| 2 Flags, local | typed flags, targeting, in-process OpenFeature provider, one admin page | remote, experiments |
| 3 Errors, servers | Sentry Cloudflare SDK, Effect reporter, grouped issues, resolve, new-issue email, basic scrubbing | browsers, merge, agents |
| 4 Shared pages | Foldkit and React pages for users, audit, flags, issues | |
| 5 Generators | config, `add admin`, modules, `adopt`, `doctor` | |
| 6 Agents | keys, MCP, CLI | OAuth |
| 7 Errors, browser and mobile | source maps, resolve in release, archive, merge, filters, spikes | replay |
| 8 Flags, remote | OFREP for browsers and mobile | push, PostHog flags |
| 9 Analytics | PostHog capture, trends, people | funnels |
| 10 Deeper | funnels, retention, exposures, experiments, PostHog flags, change push | |
| 11 Replay | | |
| 12 Larger backends | Iceberg, ClickHouse, moving between them | |
| 13 Issue tracker | second product, OAuth for MCP, shared package | |

Flags come before errors because they need no ingest and no event store, so they test mounting, permissions, audit, migrations and navigation at the lowest cost. Neither depends on the other; swapping steps 2 and 3 changes nothing else. Generators come after four steps of wiring by hand, so the CLI generates only what has worked. Before a step starts, revise this file with what the last one taught.

Scrubbing starts in step 3, earlier than the rest of the filtering, because stored secrets cannot be un-stored.

### 2. The project owns the admin app; packages supply a core and pages

| Layer | Delivered as | Holds | Changes by |
| --- | --- | --- | --- |
| Core | dependency, required | access, permissions, impersonation, audit, closing Better Auth's endpoints | version bump |
| Products | dependency, each optional | an API, storage layers, pages: `users`, `audit`, Edgehog, issues | version bump |
| Project | its own code | routes, layout, nav order, `access.ts`, its own AdminApi and pages | the project |

The rule for placing something: if a project getting it wrong is a security bug, core. If most projects want it the same, a product. Otherwise the project's. The project *imports* pages; the package never *hosts* the project's. Each shared page is exported whole, as parts (user details, user actions, a table that takes extra columns), and as headless state.

*Alternatives.* A package-owned shell with plugin slots: most of the React project would live in slots, TanStack's file routes can't come from a package, and Foldkit's `Model` and `Message` unions are closed, so slots lose their types. Copying a scaffold: copies drift, and what drifts is the checks.

### 3. Project data is joined beside shared data

The users API returns account data only. A plan column comes from the project's own endpoint, under its own permission, and the table takes extra columns. So schemas stay closed, and an admin without `billing:read` still gets a users page. The Foldkit project makes two requests where it made one.

*Alternative.* A generic user schema: a type parameter through contract, client and both UIs, and the page's permission tied to the project's data.

### 4. Access rules come from the project's `access.ts`

`defineAccess({ products, statements, roles })` returns `ac`, `roles`, `can` and a typed `requires(...)`. `RequiredPermissions` is a structural record, so product contracts don't depend on one project's statements. Startup checks every mounted endpoint against the defined statements and dies on an unknown one. The admin app decides by `can`, never by the name `admin`. `adminRoles` for Better Auth is every role that grants an admin permission, so impersonating any of them needs `impersonate-admins`.

### 5. One access core, one adapter per transport

`AdminAccess` takes headers, required permissions and an optional audit action, and returns the caller or a refusal. It knows two kinds of caller: a session, and a key acting for a user. Adapters: an `HttpApi` middleware (step 1), an RPC middleware for `Domain` (step 3), and an MCP gate (step 6, because an MCP client needs an HTTP 401 that a tool's middleware cannot give).

The core refuses impersonated sessions, banned owners and undeclared endpoints, and requires an `Audited` action on anything that writes. It provides `CurrentAdmin` and a request-scoped `AuditTrail`, and after success writes one entry. The target defaults to the `id` parameter or the command's key; handlers add target or detail. A read may declare an action too (opening a replay).

If the audit write fails after the action happened, the request fails and everything is logged. Writing first would record actions that never happened, and D1 has no transaction that spans Better Auth and our table.

### 6. Better Auth stays behind two ports

`AdminSessions` and `UserDirectory` are core services; `/better-auth` implements them and wraps the auth handler: 404 for admin paths except stop-impersonating, which it audits. The wrapper decides on the decoded, collapsed, lower-cased pathname. It adds what Better Auth lacks: no changing your own roles, 404 before ending an unknown user's sessions, and a ban check when a key or token is resolved. Ending sessions also removes OAuth grants. Only `/access` and `/better-auth` import Better Auth.

### 7. Agents use a user's key; their name is only a label

A key belongs to a user, lists permissions, and expires. Each request is allowed only what the key and its owner's current roles both allow, less a fixed set that needs a person (impersonating, roles, users, keys). Keys come from the admin API, because Better Auth lets only server code set their permissions. `x-agent-name` is recorded beside the owner. Claims on work belong to key and name together.

MCP and the CLI send the same two headers, from environment variables that the generated, project-local MCP entry names. An MCP client sends an unset variable as its literal text, so names are validated.

OAuth follows in step 13, after one project's existing implementation.

*Alternatives.* One shared token and a self-declared name, as in Alchemy's [Board example][board]: anyone with the token acts as anyone, and an audit log of it proves nothing. Session cookies: agents have none.

### 8. Products ship their own API; `mountAt` prefixes the router

As in [Alchemy Git][git], a product's contract carries no prefix and the host owns auth. `mountAt(prefix)` provides it a prefixed `HttpRouter`, and its client takes the same prefix as base URL. The project's `/admin` contract subpath holds only its own AdminApi.

### 9. Package layout

| Subpath | Holds | May import |
| --- | --- | --- |
| `.` | schemas, tags, errors, product description (id, statements, nav) | `effect` |
| `/contract` | `HttpApi`s and RPC APIs | `.` |
| `/access` (admin) | `defineAccess` | `.`, better-auth access |
| `/server` | handlers, adapters, `mountAt` | `.`, `/contract` |
| `/better-auth` (admin) | decision 6 | `/server`, `@alchemy.run/better-auth` |
| `/sql` | stores and migrations over `SqlClient` | `.` |
| `/cloudflare` | Durable Object, R2 and Alchemy helpers | `.`, `/sql`, Alchemy |
| `/client` | headless state, no framework | `/contract` |
| `/foldkit`, `/react` | pages and parts | `/client` |
| `/flags`, `/openfeature` (Edgehog) | evaluator; providers and hook | `.`; `/flags`, OpenFeature SDKs |
| `/effect`, `/ingest` (Edgehog) | Effect reporter; protocol adapters and the ingest server | `.` |

A test walks each entry's import graph, since `package-boundaries` can't, and proves that browser entries carry no server code. React, Foldkit, Alchemy, `domain` and the OpenFeature SDKs are optional peers, so a flags-only project installs none of the rest. Tailwind classes reach a host through `@source`, colors through its tokens.

### 10. Migrations without transactions

Each product exports ordered, idempotent migrations (`IF NOT EXISTS`, one change each) and a small runner that records each after it succeeds in `<product>_migrations`. It runs at deploy through an Alchemy Action over the host's `SqlClient`, before the server that needs it. The audit table keeps the name and columns an existing project already has, so adoption copies nothing.

*Alternatives.* Effect's `Migrator`: dies on D1. SQL files in the host's migrations folder: one project generates that folder with Drizzle.

### 11. The CLI generates wiring files; product generators live in the CLI

`sync` owns small `products.gen.ts` files: beside the Stack (resources, migrations, `PromoteAdmins`), in the API app (a layer that mounts every product), in the admin app (nav and descriptions). Seeds import them once; existing repos get that line as numbered changeset steps, and `doctor` checks for it. `Contribution` gains a `products` field and a renderer builds the files.

Product generators sit in `packages/cli/src/generators/products/<name>.ts`. A `/shoemaker` subpath that imports the CLI's types while the CLI imports it would be a package cycle that `^build` cannot order, and every CLI install would pull each product.

### 12. Flags: an OpenFeature-shaped model with one evaluator

The evaluator is a pure function from definition and context to an [OpenFeature][openfeature] resolution. Everything else wraps it:

- **Local (step 2):** an OpenFeature server provider reads definitions from the host's storage and caches them for up to a minute, refreshing when read because Workers have no background timers. No key is involved, since the host reads its own database. Browsers and mobile get values their server evaluated, never rules.
- **Remote (step 8):** [OFREP][ofrep]'s single and bulk endpoints call the same function. Community OFREP providers are the clients. The bulk tag covers the definitions and the context.
- **PostHog (step 10):** an adapter projects results into `/flags` responses. PostHog local evaluation would need a second, secret key and expose rules, so it is not offered. From step 9, `posthog-js` gets an empty, valid answer.

Definitions are plain rows through SQL, not a `domain` aggregate: they need no lifecycle, and flags then run on any target. Assignment is PostHog's: the first 60 bits of SHA-1 over `key.id` plus a salt, so its SDKs agree later. Our own vectors pin it.

OFREP carries neither tracking nor exposures, so a thin Edgehog provider and hook add them (step 10), with OpenTelemetry's field names. Compliance means: every mandatory provider requirement, the pinned conformance suite with declared capabilities, and OFREP responses checked against its schema. `@numeric-coercion` may be withheld, since JavaScript cannot tell `10.0` from `10`. Where OFREP's schema and its examples disagree (unknown flags in a bulk answer), accept both and send what the pinned community providers accept.

*Alternatives.* PostHog's model with an OpenFeature adapter: it has no number variants, and the standard would inherit a vendor's shape. A separate flags package: small enough to share Edgehog's, and the optional peers already keep it light.

### 13. Edgehog telemetry

- **Pipeline:** decode, correct time, scrub, symbolicate, mark the project's frames, scrub again, fingerprint (current and previous rules), find or create the issue, store.
- **Issues** have opaque ids and a fingerprint table (project, fingerprint, rules version → issue). Events store fingerprint and version, and resolve through the table, so merge, split and new rules move no events. A unique constraint settles simultaneous first occurrences.
- **Lifecycle** is a `domain` aggregate per issue. Ingest sends it first seen, last seen and releases in batches; each is a minimum, a maximum or a set, so redelivery is harmless and needs no bookkeeping. `resolvedAt` is compared with time of receipt. Alerts are policies.
- **Counts** come from the event store. Past a cap per issue and minute, ingest writes one row per fingerprint and minute with a weight. It remembers recent ids for ten minutes so resends of those count once.
- **Grouping** per chained exception: type plus the project's frames (module, function, and the normalized source line where a map gives one), never line numbers; without usable frames, type plus the message with ids, numbers, addresses and dates replaced. Written from behavior, not from Sentry's code.
- **Source maps** are keyed by debug ID, which the SDKs already send. Sentry's MIT bundler plugin can insert the ids with uploading turned off; we write the uploader. Nothing is fetched from the web.
- **Sentry responses:** always the categorized limit header, exposed to browsers; unsupported kinds get 200 and a long limit on those kinds; unknown keys get a refusal and a long limit. Integer project ids, 32-hex keys.
- **PostHog:** two capture adapters, plus remote configuration and the SDK's on-demand scripts served from its pinned package.
- **Secrets in traces:** query and header names that carry keys use `HttpApi.RedactedNames`.
- **Data plane** services: `EventStore`, `Analytics` (structured queries), `PersonStore`, `BlobStore`, `Symbolicator`. Identities resolve at query time through a mapping table; only the ClickHouse layer stores the resolved person.
- **Deletion** filters reads at once and removes data after, leaving a tombstone so late data is dropped. `domain`'s per-subject encryption is an option for the control plane once released.

Telemetry runs on Cloudflare only for now. Elsewhere `domain` needs Postgres and standing runners, which defeats the purpose; the config says so. Flags have no such limit.

### 14. Effect's `EventLog` is not the base for this

`effect/eventlog` is for local-first state: each device writes to its own journal while offline, then syncs and agrees with the others. Most of this plan is owned by a server.

- **Telemetry:** payloads are stored as binary, so SQL cannot query their properties; on Postgres each write locks out other writers to the journal; vendor SDKs don't speak its protocol.
- **Audit:** Better Auth changes the user outside any `EventLog` handler, so the action and its entry could not commit together, and the entries would be binary.
- **Issue lifecycle and claims:** both need one authority that can refuse. `EventLog` hands a handler the conflicting entries to reconcile, and a handler that keeps failing on a synced entry stops sync from that remote. `domain` decides in one place.
- **Flag definitions:** servers read the host's own database.
- **D1:** its SQL journal and server storage use transactions, which the D1 client dies on. The Durable Object SQLite client supports them.

It is the first choice for two things outside the steps: the offline queue of a native Edgehog SDK (journals exist for IndexedDB and SQL, and Effect has a React Native SQLite driver), and drafts, comments and labels if the issue tracker should work offline (task 13.1), never claims. The module is marked unstable. Our own event storage service is called `EventStore` so the two are not confused.

### 15. The issue tracker starts from Alchemy's Board

Alchemy has two examples near this, and neither is a package to install:

| | [Board][board] (open pull request) | [`cloudflare-ai-issues`][ai-issues] (`main` only) |
| --- | --- | --- |
| What it is | a board where people and agents coordinate, after Vercel Board | agents that triage a GitHub repository's issues |
| Source of truth | itself | GitHub |
| Has | claims under leases, dependencies between tasks, labels, messages, follow-ups, live Foldkit UI, MCP, CLI, agent skill | agent sessions per issue, transcripts, rules proved by a solver |
| Lacks for us | accounts, permissions, audit, editing, reopening, links | claims, closing, assignment, accounts |
| Needs | an Alchemy newer than beta.87 | the same, and `@alchemy.run/ai` |

Board is the starting model (Apache-2.0, with its notice). `cloudflare-ai-issues` is a reference for agents that work on an issue and for verified rules. What changes from Board:

- its shared token and self-declared actor become the access core (decision 7);
- claims are held by key and agent name, where Board compares names only;
- its rule that a done task stays done gives way to reopening;
- editing, assignment, audit and links to other products are added;
- a command id chosen by one caller must not let a second believe it won a claim.

It waits for an Alchemy release that includes what Board needs; preview builds expire, so nothing here depends on one.

For offline use, `domain`'s own guide has the server decide and the device queue what the user asked for, with a conflict coming back as a rejection. That fits claims too. Device-decides state is where it points elsewhere, which is the role decision 14 leaves to `EventLog`.

### 16. What may be reused

- **PostHog outside `ee/`** (MIT): the flag hash and, if their own repository's licence allows, its test vectors; the funnel step algorithm; replay deduplication and mobile transforms. **OpenFeature** (Apache-2.0): the conformance suite and schemas. **Alchemy's examples** (Apache-2.0): Board's model. Each with its notice in `THIRD_PARTY_NOTICES`.
- **Sentry and Relay** (FSL-1.1-Apache-2.0): no code, tests, snapshots, rule files or expression lists, translated or not. Wire formats, headers and observed behavior are reimplemented; fixtures are recorded from the SDKs.
- Vendor names stay out of package names.

### 17. Extract shared code after the second product

Description, mounting, migrations and references live in one folder of `shoemaker-admin` that is expected to move. With the issue tracker built, what all three products use moves to its own package.

## Risks / Trade-offs

- [One change holds thirteen steps and can't archive until the last] → Each step stands alone; split finished ones into their own change and archive that. Revisit after step 5.
- [Closing Better Auth's endpoints breaks a page that calls them] → The page moves in the same commit as the wrapper.
- [Steps 1 to 4 are wired by hand in several repos, then again by generators] → Accepted: the second wiring deletes the first, and is right.
- [Adopting the core changes behavior: promotion keeps other roles, users and plan data load separately, the audit cursor no longer skips entries with one timestamp] → Listed in the changeset.
- [Local flags leave browsers and mobile without flags of their own until step 8] → Servers hand over results; step 8 can move up, since it depends only on step 2.
- [Flag assignment can never change] → Vectors in the repo, checked in every build.
- [The conformance suite, OpenFeature tracking and OFREP are young] → Pinned; updates are reviewed like any upgrade.
- [Recorded SDK fixtures go stale] → A script refreshes them; version bumps fail tests first.
- [Foldkit and React double the UI] → Logic in `/client`. For issue pages Foldkit has a generated client and React needs one over `AtomRpc`; pick the first framework then.
- [Projects pin older Effect, Alchemy and Foldkit] → Each upgrades before adopting. Foldkit 0.171 requires result messages on every command.
- [Product changes can hold up a CLI release through the fixed group] → Accepted for aligned versions.
- [The issue tracker depends on an unmerged example and an unreleased Alchemy] → It is the last step; until then Board is only read.
- [Stored personal data] → Scrubbing from step 3; retention, deletion, a replay permission and audited viewing are requirements.

## Migration Plan

1. Publish; nothing changes for repos whose config has no new keys.
2. Per repo: upgrade pins, add the package and `access.ts`, mount, switch its pages to the users API, close the endpoints, move `ADMIN_EMAILS` to the remote secrets store, remove the old code.
3. Rollback: revert the repo's commit. The audit table and roles stay compatible.

## Open Questions

- How experiments judge significance (frequentist or Bayesian); the spec needs only "not enough data".
- Whether DuckDB for Iceberg runs in a Worker or a Container.
- Which push mechanism serves flag changes; standing connections cost money on Durable Objects.

## References

Pinned where the content can move. `.external/references/` holds clones of most.

**Alchemy**

- [Alchemy Git][git]: the pattern for a product that embeds in a host's API and leaves auth to it. Source: [`packages/git`](https://github.com/alchemy-run/alchemy/tree/v2.0.0-beta.87/packages/git).
- [Board, pull request 3506][board]: coordination board for people and agents. Read at [`02e682f`](https://github.com/alchemy-run/alchemy/tree/02e682fcffc3ff54ae1b9c12b9c1d1e562a1dc1f/examples/cloudflare-domain-board). After [Vercel Board](https://vercel.com/blog/introducing-vercel-board).
- [`cloudflare-ai-issues`][ai-issues]: agents on GitHub issues.
- [Domain documentation](https://alchemy.run/domain), [`packages/domain`](https://github.com/alchemy-run/alchemy/tree/v2.0.0-beta.87/packages/domain), [`cluster-domain`](https://github.com/alchemy-run/alchemy/tree/v2.0.0-beta.87/examples/cluster-domain), [`cloudflare-domain-better-auth`](https://github.com/alchemy-run/alchemy/tree/v2.0.0-beta.87/examples/cloudflare-domain-better-auth), and the [offline guide](https://github.com/alchemy-run/alchemy/blob/v2.0.0-beta.87/website/src/content/docs/domain/local-first.mdx).

**Feature flags**

- [OpenFeature specification][openfeature], read at [`b489ba9`](https://github.com/open-feature/spec/tree/b489ba9/specification): [providers](https://github.com/open-feature/spec/blob/b489ba9/specification/sections/02-providers.md), [types](https://github.com/open-feature/spec/blob/b489ba9/specification/types.md), [tracking](https://github.com/open-feature/spec/blob/b489ba9/specification/sections/06-tracking.md), [observability](https://github.com/open-feature/spec/blob/b489ba9/specification/appendix-d-observability.md).
- [Provider conformance suite](https://github.com/open-feature/spec/tree/b489ba9/specification/assets/provider-tck).
- [OpenFeature Remote Evaluation Protocol][ofrep], read at [`98c4e0d`](https://github.com/open-feature/protocol/blob/98c4e0d/service/openapi.yaml).
- [PostHog's flag test vectors](https://github.com/PostHog/posthog-sdk-test-harness) (licence unchecked).

**Telemetry**

- [PostHog](https://github.com/PostHog/posthog), read at `0504b96` ([newer capture protocol](https://github.com/PostHog/posthog/blob/0504b962f/rust/capture/src/v1/README.md)).
- [Sentry](https://github.com/getsentry/sentry) at `5439070`, [Relay](https://github.com/getsentry/relay) at `97c1eca`, [self-hosted](https://github.com/getsentry/self-hosted) at `1baa2d6`: read for behavior, never copied (decision 16).
- [Hogflare](https://github.com/sidequery/hogflare), [GlitchTip](https://github.com/rh-cssre/glitchtip-backend) and [Bugsink](https://www.bugsink.com/sentry-sdk-compatible/): others who accept these SDKs.

**Auth and Effect**

- [Better Auth admin plugin](https://www.better-auth.com/docs/plugins/admin).
- [Effect `EventLog`](https://effect.website/blog/module-of-the-week/event-log), the subject of decision 14.

[git]: https://alchemy.run/git/
[board]: https://github.com/alchemy-run/alchemy/pull/3506
[ai-issues]: https://github.com/alchemy-run/alchemy/tree/7cf8e82ebf/examples/cloudflare-ai-issues
[openfeature]: https://github.com/open-feature/spec
[ofrep]: https://github.com/open-feature/protocol
