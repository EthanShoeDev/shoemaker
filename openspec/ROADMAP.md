# Roadmap

What comes after the open changes. Nothing here is specified yet: each entry becomes its own OpenSpec change once the one before it is used by a real project, revised with what that taught. Delete an entry when its change is proposed.

## Open changes

| Order | Change | Needs | Ends in |
| --- | --- | --- | --- |
| 1 | `add-admin-core` | | the Foldkit project |
| 2 | `extend-admin-users` | 1 | the React project |
| 3 | `add-error-tracking` | 1 (2 to adopt in the React project) | one email for a real failure |
| 4 | `add-feature-flags` | 1 (2 to adopt in the React project) | one real flag |

3 and 4 are independent and can swap. Archive 1 before 2, because 2 adds to a capability that 1 creates.

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

## Next

### Shared pages (was step 4)

Foldkit and React pages for users, audit, issues and flags, over headless state in `/client`. Each is exported whole, as parts (details, actions, a table that takes extra columns) and as state. Foldkit and React use clients of the same `HttpApi`.

- Specs: `admin-app`, all of it; `admin-user-management` "Project data about users stays in the project"; unsupported operations hidden in the UI.
- Colors come from the host's tokens, Tailwind classes through `@source`. React and Foldkit are optional peers.
- Wait until the hand-written issues and flags pages exist.

### Generators (was step 5)

Config gains `auth`, an `admin` role on an app and a `modules` map; `init`, `sync`, `add`, `adopt` and `doctor` understand them. Configs without these keys keep their meaning. Generate only wiring that has worked by hand.

- Specs: `product-generation`, less the scenario that refuses errors off Cloudflare.
- `sync` owns small `products.gen.ts` files beside the Stack, in the API app and in the admin app. Seeds import them once; existing repos get that line as numbered changeset steps, and `doctor` checks for it. `alchemy.run.ts` is a seed file, `Contribution` cannot add to it, and two generators may not emit one path unless it is a JSON merge.
- Product generators sit in `packages/cli/src/generators/products/`. A `/shoemaker` subpath in a product would be a package cycle `^build` cannot order.
- Products need their own version constant in `versions.ts` and their own `doctor` check: today's derive every `shoemaker-*` range from the CLI's version.
- Adopts: the Foldkit, React and Expo projects.

### Agents (was step 6)

Keys that belong to a user, MCP and a CLI for issues.

- Specs: `admin-access` keys, names, "A ban stops every credential", "Every transport enforces the same rules"; `error-tracking` "People and agents use the same commands"; `product-generation` agent setup. `MODIFIED`: "Admin endpoints require a current session" also accepts a key; "Every admin write is recorded" also records the agent's name.
- Each request is allowed only what the key and its owner's current roles both allow, less a fixed set that needs a person. Keys come from the admin API, because Better Auth lets only server code set their permissions. A name is a label; claims belong to key and name together.
- An MCP client needs an HTTP 401 that a tool's middleware cannot give, so MCP gets a gate over the access core. Tools and CLI commands are written over the same `HttpApi`, with Effect's `McpServer` and `effect/cli`.
- An MCP client sends an unset variable as its literal text, so names are validated.
- Considered and refused: one shared token with a self-declared name.

### Errors from browsers and mobile (was step 7)

Source maps, resolve in a release, archive, merge and split, filters, spikes and webhooks.

- Specs: the rest of `error-tracking` and the Sentry part of `telemetry-ingest`. `MODIFIED`: "Issues have a lifecycle" gains archived and recent states; "Alerts" gains regressions, leaving the archive and an interval; "Secrets are removed before storage" runs again after mapping; "Sentry SDKs are slowed precisely" is readable by a browser.
- Maps are keyed by debug ID, which the SDKs already send. Sentry's MIT bundler plugin can insert the ids with uploading turned off; we write the uploader. Nothing is fetched from the web.
- Mapping comes before grouping. Grouping gains the normalized source line where a map gives one, as a new rules version.
- Archive conditions and merges are several rows: conditional updates and ordered, repeatable steps, since D1 has no transactions.

### Flags evaluated remotely (was step 8)

[OFREP](https://github.com/open-feature/protocol) endpoints for browsers and mobile over the same evaluator. Depends only on `add-feature-flags`, so it can move up.

- Specs: `feature-flags` "Clients evaluate remotely". `MODIFIED`: "A project key only sends" also allows reading evaluated flags.
- Where OFREP's schema and examples disagree, accept both and send what the pinned community providers accept.

## Later

- **Ending a user's sessions** (was in step 1): no admin offers it yet. Better Auth's `revoke-user-sessions` does not check that the user exists, and OAuth grants must end too.
- **Analytics** (was step 9): capture from the official PostHog SDKs, trends, people, and warnings as storage fills up. Specs: `product-analytics` less funnels and retention, the PostHog part of `telemetry-ingest`, `telemetry-storage` "Nearing capacity is visible". `MODIFIED`: "Queries are structured" and "One event shape" gain its queries and the session case; clocks are corrected, beyond replacing impossible times. Until PostHog flags exist, `posthog-js` gets an empty, valid answer.
- **Deeper analytics and experiments** (was step 10): funnels, retention, exposures, experiments, PostHog flags, telling clients of changes. Specs: the rest of `product-analytics` and `feature-flags`. Open: how significance is judged, and which push mechanism, since standing connections cost money on Durable Objects.
- **Replay** (was step 11): recording, playback with its own permission and audited viewing, context beside errors. Specs: `session-replay`, `error-tracking` "Context beside the error". `MODIFIED`: "Data expires" covers blobs.
- **Larger backends** (was step 12): Iceberg, ClickHouse, moving between them. Specs: the rest of `telemetry-storage`. Open: whether DuckDB runs in a Worker or a Container.
- **Issue tracker** (was step 13): a second product, where people and agents claim work. Here `domain` fits, since a claim needs one place that decides. Specs: `issue-tracker`, `product-composition` "Products link by reference".
  - Starts from Alchemy's [Board](https://github.com/alchemy-run/alchemy/pull/3506) (Apache-2.0, read at [`02e682f`](https://github.com/alchemy-run/alchemy/tree/02e682fcffc3ff54ae1b9c12b9c1d1e562a1dc1f/examples/cloudflare-domain-board)), which needs an Alchemy newer than beta.87. Nothing earlier may depend on it.
  - `domain` RPC needs its own adapter over the access core.
  - Open: whether it works offline. Claims never do.
- **OAuth for MCP clients** (was in step 13), after one project's existing implementation. Specs: `admin-access` "MCP clients can sign in through the browser".
- **A shared product package** (was in step 13): once another product proves what is common.

## Open question: traces

Performance tracing was out of scope. It is open, because Effect programs already have spans and errors already carry trace ids. Before deciding:

- Effect has an OTLP exporter, and a proxy that forwards payloads undecoded, so receiving OTLP needs a decoder of ours. `shoemaker-spanoptic` shows spans in process and receives none.
- Spans outnumber errors by orders of magnitude, so the storage and sampling that suit errors may not suit them.
- The alternative is linking an error's trace id to a tracing service the project already has.

## Out of scope

Admin pages generated from a Drizzle schema, native Edgehog SDKs, PostHog local evaluation (it needs a second, secret key and exposes rules), native crash dumps, and moving off Better Auth.

## Held by every change

- Useful in a real project at the end of each change.
- Sentry and Relay are read for behavior and never copied. PostHog outside `ee/`, OpenFeature and Alchemy's examples may be reused with a notice in `THIRD_PARTY_NOTICES`.
- `EventLog` is not the base for telemetry, audit or claims. It is the first choice for a native SDK's offline queue, and for drafts, comments and labels if the tracker works offline.
- Agent tooling stays project-local, and no secret is written to a file.
