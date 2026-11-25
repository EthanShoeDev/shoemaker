# Roadmap

What comes after the open changes. Nothing here is specified yet: each entry becomes its own OpenSpec change once the one before it is used by a real project, revised with what that taught. Delete an entry when its change is proposed.

## Open changes

| Order | Change | Needs | Ends in |
| --- | --- | --- | --- |
| 1 | `add-admin-core` | | the Foldkit project |
| 2 | `extend-admin-users` | 1 | the React project |
| 3 | `add-error-tracking` | 1 | the Foldkit project: one email for a real failure, inside known limits |
| 4 | `add-feature-flags` | 1 (2 to adopt in the React project) | one real flag |

2, 3 and 4 are independent after 1, except that 4's adoption needs 2. Archive 1 before 2, because 2 adds to a capability that 1 creates.

## The first full plan

Entries were first written as one change with complete requirements, scenarios and tasks. They are starting points, not commitments, and some rest on decisions since changed (below). Read them with:

```sh
git show 13d9f0b:openspec/changes/add-shoemaker-products/design.md
git show 13d9f0b:openspec/changes/add-shoemaker-products/tasks.md
git show 13d9f0b:openspec/changes/add-shoemaker-products/specs/<capability>/spec.md
```

"Was step n" below is the step number there. Changed since:

- Error issues are plain SQL, not a `domain` aggregate, so telemetry runs on any target and every API is an `HttpApi`. Its decisions 5 (RPC adapter) and 13 (lifecycle, Cloudflare only) no longer hold.
- Errors come before flags.
- Products have their own changesets group.
- Events have their own database, one collector per project decides what is stored, and every use has a limit (`usage-limits`). The per-minute cap in SQL no longer holds.
- A migration and its record are one unit; `IF NOT EXISTS` is no longer needed.
- Edgehog's projects and keys are configuration.

## Next

### Shared pages (was step 4)

Foldkit and React pages for users, audit, issues and flags, over headless state in `/client`. Each is exported whole, as parts (details, actions, a table that takes extra columns) and as state. Foldkit and React use clients of the same `HttpApi`.

- Specs: `admin-app`, all of it; from `admin-user-management` "Project data about users stays in the project", the plan column (its API half is in `add-admin-core`); unsupported operations hidden in the UI. `MODIFIED`: "Products describe themselves" covers pages too.
- Colors come from the host's tokens, Tailwind classes through `@source`. React and Foldkit are optional peers.
- Wait until the hand-written issues and flags pages exist.

### Generators (was step 5)

Config gains `auth`, an `admin` role on an app and a `modules` map; `init`, `sync`, `add`, `adopt` and `doctor` understand them. Configs without these keys keep their meaning. Generate only wiring that has worked by hand.

- Specs: `product-generation`, less the scenario that refuses errors off Cloudflare.
- `sync` owns small `products.gen.ts` files beside the Stack, in the API app and in the admin app. Seeds import them once; existing repos get that line as numbered changeset steps, and `doctor` checks for it. `alchemy.run.ts` is a seed file, `Contribution` cannot add to it, and two generators may not emit one path unless it is a JSON merge.
- Product generators sit in `packages/cli/src/generators/products/`. A `/shoemaker` subpath in a product would be a package cycle `^build` cannot order.
- Products need their own version constant in `versions.ts` and their own `doctor` check: today's derive every `shoemaker-*` range from the CLI's version.
- Adopts: the Foldkit, React and Expo projects.
- Under `alchemy dev` cookies stay on localhost; deployed they cross subdomains. A TanStack Start admin gets the forwarding route, a Foldkit one the zone route.
- Generate the ingest Worker's edge rule only into a ruleset the project owns, since Alchemy's resource owns a zone's whole phase. `doctor` reports an ingest Worker with a `workers.dev` address and no such rule.

### Database and ORM selector

A project picks the SQL library of an API. Independent of the products, and possible rather than decided. What the candidates do today is under "Open question: the SQL library".

- Options: `drizzle`, `effect-orm`, and none, which is plain `SqlClient` and what a config without the key means.
- Shoemaker generates no database today, so the database is the first choice and the ORM the second. One key on an `effect-api` app holds both, say `database: { kind: 'd1', orm: 'effect-orm' }`: an API owns its database, and one repo may have several. `schema.ts` refuses pairs that cannot work, as it does for `api`.
- D1 on a `worker` API comes first, since both adopters run it. Postgres follows, and brings a second runtime and a dev database.
- Generated: the dependencies, a schema with one table, one query through the existing `HttpApi`, a test on local SQLite or Miniflare, migrations that Alchemy's D1 resource applies, and an `AGENTS.md` line naming the library. Schema and queries are seeds, so switching later is a migration by hand.
- Both write drizzle-kit 1.0 folders, so the infra generator needs one path. Drizzle's are generated at deploy by Alchemy's `Drizzle.Schema`; effect-orm's by `effect-orm generate`, whose folder `check` needs a CI step.
- The wizard says what `effect-orm` lacks on SQLite (foreign keys, CHECK, AUTOINCREMENT, partial indexes).
- `adopt` infers the option from dependencies. `doctor` compares it with them.
- Products work with every option: they use `SqlClient` only.
- With `auth`, D1 gives Better Auth the raw binding under every option. Drizzle also has its adapter, when the tables should live in the Drizzle schema.
- Versions: the Effect drivers are in `drizzle-orm` 1.0, under `rc` on npm; `latest` is 0.45. `update-versions.ts` reads only `latest`, so it leaves an rc pin alone (it never downgrades) and someone moves it by hand until 1.0 is `latest`.
- A preset per option in `packages/cli/test/presets.ts`.
- Wait until effect-orm 1.0.0 is out and its port in the Foldkit project has been judged. Drizzle needs no such wait, since the React project runs it, but the key is designed for both at once.

### Agents (was step 6)

Keys that belong to a user, MCP and a CLI for issues.

- Specs: `admin-access` keys, names, "A ban stops every credential", "Every transport enforces the same rules"; `error-tracking` "People and agents use the same commands"; `product-generation` agent setup. `MODIFIED`: "Admin endpoints require a current session" also accepts a key; "Every admin write is recorded" also records the agent's name.
- Each request is allowed only what the key and its owner's current roles both allow, less a fixed set that needs a person. Keys come from the admin API, because Better Auth lets only server code set their permissions. A name is a label; claims belong to key and name together.
- An MCP client needs an HTTP 401 that a tool's middleware cannot give, so MCP gets a gate over the access core. Tools and CLI commands are written over the same `HttpApi`, with Effect's `McpServer` and `effect/cli`.
- An MCP client sends an unset variable as its literal text, so names are validated.
- The Foldkit project already has keys and OAuth for its customers, and a ban does not end those. If it needs that sooner, "A ban stops every credential" moves ahead of the rest.
- A key has its own rate, so an agent in a loop can't run up reads.
- Considered and refused: one shared token with a self-declared name.

### Errors from browsers and mobile (was step 7)

Source maps, resolve in a release, archive, merge and split, filters, spikes and webhooks.

- Specs: the rest of `error-tracking` and the Sentry part of `telemetry-ingest`. `MODIFIED`: "Issues have a lifecycle" gains the archived state; "Regressions are real" also considers when a delayed occurrence happened; "Alerts" gains regressions, leaving the archive and an interval; "Secrets are removed before storage" runs again after mapping; "Sentry SDKs are slowed precisely" is readable by a browser.
- A browser's key is public, so this is where floods by strangers begin. `usage-limits` gains limits by address and by origin, and the edge rule is required, before the first browser sends.
- Maps are keyed by debug ID, which the SDKs already send. Sentry's MIT bundler plugin can insert the ids with uploading turned off; we write the uploader. Nothing is fetched from the web.
- Mapping comes before grouping. Grouping gains the normalized source line where a map gives one, as a new rules version.
- Archive conditions and merges are several rows: conditional updates and ordered, repeatable steps, since D1 has no transactions.

### Flags evaluated remotely (was step 8)

[OFREP](https://github.com/open-feature/protocol) endpoints for browsers and mobile over the same evaluator. Depends only on `add-feature-flags`, so it can move up.

- Specs: `feature-flags` "Clients evaluate remotely". `MODIFIED`: "A project key only sends" also allows reading evaluated flags.
- Every page view may ask, so it needs limits by key and address, answers from memory, and the polling advice of the protocol, with its worst case in the same test.
- Where OFREP's schema and examples disagree, accept both and send what the pinned community providers accept.

## Later

- **Ending a user's sessions** (was in step 1): no admin offers it yet. Better Auth's `revoke-user-sessions` does not check that the user exists, and OAuth grants must end too.
- **Analytics** (was step 9): capture from the official PostHog SDKs, trends, people, and warnings as storage fills up. Specs: `product-analytics` less funnels and retention, the PostHog part of `telemetry-ingest`, `telemetry-storage` "Nearing capacity is visible". `MODIFIED`: "Queries are structured" and "One event shape" gain its queries and the session case; clocks are corrected, beyond replacing impossible times. Until PostHog flags exist, `posthog-js` gets an empty, valid answer. Events are kept in detail, unlike repeated errors, so the row and size limits need their own design first: batches written as one row, sampling, or Iceberg from the start.
- **Deeper analytics and experiments** (was step 10): funnels, retention, exposures, experiments, PostHog flags, telling clients of changes. Specs: the rest of `product-analytics` and `feature-flags`. Open: how significance is judged, and which push mechanism, since standing connections cost money on Durable Objects.
- **Replay** (was step 11): recording, playback with its own permission and audited viewing, context beside errors. Specs: `session-replay`, `error-tracking` "Context beside the error". `MODIFIED`: "Data expires" covers blobs; "A missing choice fails before requests are served" gains a missing blob store. The largest data of all: sampling on by default, and limits on sessions, chunks, bytes and object writes a day.
- **Larger backends** (was step 12): Iceberg, ClickHouse, moving between them. Specs: the rest of `telemetry-storage`. Open: whether DuckDB runs in a Worker or a Container.
- **Issue tracker** (was step 13): a second product, where people and agents claim work. Here `domain` fits, since a claim needs one place that decides. Specs: `issue-tracker`, `product-composition` "Products link by reference".
  - Starts from Alchemy's [Board](https://github.com/alchemy-run/alchemy/pull/3506) (Apache-2.0, read at [`02e682f`](https://github.com/alchemy-run/alchemy/tree/02e682fcffc3ff54ae1b9c12b9c1d1e562a1dc1f/examples/cloudflare-domain-board)), which needs an Alchemy newer than beta.87. Nothing earlier may depend on it.
  - `domain` RPC needs its own adapter over the access core. `MODIFIED`: "Products share the host's admin auth" gains an RPC call.
  - [`cloudflare-ai-issues`](https://github.com/alchemy-run/alchemy/tree/7cf8e82ebf/examples/cloudflare-ai-issues) is a reference for agents that work on an issue. Agents that trigger agents need a limit on depth and on runs.
  - Open: whether it works offline. Claims never do.
- **OAuth for MCP clients** (was in step 13), after one project's existing implementation. Specs: `admin-access` "MCP clients can sign in through the browser".
- **A shared product package** (was in step 13): once another product proves what is common.

## Open question: traces

Performance tracing was out of scope. It is open, because Effect programs already have spans and errors already carry trace ids. Before deciding:

- Effect has an OTLP exporter, and a proxy that forwards payloads undecoded, so receiving OTLP needs a decoder of ours. `shoemaker-spanoptic` shows spans in process and receives none.
- Spans outnumber errors by orders of magnitude, so the storage and sampling that suit errors may not suit them.
- The alternative is linking an error's trace id to a tracing service the project already has.

## Open question: the SQL library

Researched 2026-11-25; nothing is adopted. Ran: Effect 4.1.5, Better Auth 1.7.28, `better-auth-effect` 1.0.1, `drizzle-orm` 1.0.0-rc.6, `@maple-dev/effect-orm` 0.11.0, on Postgres 18 and Miniflare's D1. Versions move fast here, so check again before acting.

**One connection for the app and Better Auth.** Better Auth's Drizzle adapter awaits promises and cannot take an Effect Drizzle client; support was [declined](https://github.com/better-auth/better-auth/issues/7234).

- Postgres: [`better-auth-effect`](https://github.com/alex-golubev/better-auth-effect-adapter) runs Better Auth on the app's `SqlClient`. With Drizzle's `effect-postgres` and with effect-orm, 60 concurrent calls stayed within a pool of 5, and a rollback undid the sign-up.
  - Auth calls go through `EffectSqlAdapter.bind`. A plain `Effect.tryPromise` escaped the transaction, and the user stayed.
  - Better Auth's `after` hooks run before the outer transaction commits.
  - Small, with one main author: pin or vendor it.
- Postgres, official packages only: one pool of `drizzle-orm/postgres` behind both a promise client and an Effect client. It shares the pool but not the transaction. Its Effect client [connects eagerly](https://github.com/drizzle-team/drizzle-orm/issues/6708) and [runs after-commit hooks early](https://github.com/drizzle-team/drizzle-orm/issues/6731).
- D1: `better-auth-effect` fails at sign-up, which opens a transaction. Keep the official adapter on the raw binding: there is no pool to share.

**[effect-orm](https://effect-orm.maple.dev)** is the candidate for queries. It runs on any `SqlClient`, column types are Schemas, rows are decoded, and errors are typed.

- Ran on D1: a conditional insert as a quota, filters, aggregates, and a `Db.batch` that rolled back whole. `Db.transaction` fails with a typed error there, before sending anything.
- Not run: Alchemy's D1 client (it has the `batch` that effect-orm looks for), bundle size, and how the types feel, since the trial code was loosely typed.
- SQLite tables cannot declare foreign keys, CHECK, AUTOINCREMENT or partial indexes, and effect-orm does not apply SQLite migrations. It generates drizzle-kit 1.0 folders, which Alchemy's D1 resource applies.
- A table is `external: true` when something else owns its DDL, so queries can be adopted without moving migrations.
- Alpha, MIT, first published October 2026, two main authors; its known users, Maple and Hazel, are its own company's. [1.0.0](https://github.com/MapleTechLabs/effect-orm/pull/146) was open.

Leaning:

- The Foldkit project first: it has plain SQL on D1, SQL migrations and no foreign keys, so external tables change only queries. Start with one read-mostly store.
- The React project stays on Drizzle: its tables need foreign keys and AUTOINCREMENT.
- Products here stay on plain `SqlClient`, so no host has to take an ORM. `Db.batch` and our `AtomicWrites` do the same job.

Before deciding: 1.0.0 is out, one store in the Foldkit project has been ported with its tests, and the Worker's size before and after is known.

Others looked at: `effect-qb` (one main author, requires `effect <4.1`), TypeSQL (SQL strings; repo from October 2026, already v9), `effect-linq` (one day of commits, Postgres only), `@effect/sql-drizzle` (Effect 3 only).

## Out of scope

Admin pages generated from a Drizzle schema, native Edgehog SDKs, PostHog local evaluation (it needs a second, secret key and exposes rules), native crash dumps, moving off Better Auth, and running a product without a host project.

## Held by every change

- Useful in a real project at the end of each change.
- Before a change starts, its design is revised with what the last one taught.
- Nothing can cost without limit. Whatever a stranger, a loop or a schedule can trigger has a finite default limit, is refused before it costs storage, fails closed, never feeds itself, retries a finite number of times, and shows when it stopped. Each Edgehog change extends the test that computes the worst case, and raising the amount is a decision. A change that needs something always on says what it costs when idle.
- Sentry and Relay are read for behavior and never copied. PostHog outside `ee/`, OpenFeature and Alchemy's examples may be reused with a notice in `THIRD_PARTY_NOTICES`.
- `EventLog` is not the base for telemetry, audit or claims. It is the first choice for a native SDK's offline queue, and for drafts, comments and labels if the tracker works offline.
- Agent tooling stays project-local, and no secret is written to a file.
