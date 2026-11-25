# Design

## Context

See proposal.md for motivation, and `add-admin-core`'s design for mounting, access, migrations and package layout.

Facts checked in source, at the CLI's pins (Effect 4.1.5, Alchemy 2.0.0-beta.87):

- A Sentry SDK treats a bare 429 or `Retry-After` as a limit on everything, and `X-Sentry-Rate-Limits` as a limit on the kinds it names. A DSN's project id must be digits.
- Sentry maps many hashes to one issue with its own id, and tries old grouping rules after changing them.
- The D1 client dies on transactions and has an atomic `batch`. The Postgres and SQLite clients have transactions.
- Alchemy has queues with consumers and cron triggers for Workers.
- Effect has an HTTP client for any `HttpApi`, and `AtomHttpApi` for React.

Not verified: how the Cloudflare Sentry SDK retries.

## Goals / Non-Goals

**Goals:** a real server failure becomes one issue and one email; early choices that later changes don't have to undo (opaque issue ids, fingerprint versions, trace ids on events).

**Non-Goals:** feature parity with Sentry; storing traces.

## Decisions

### 1. Issues are SQL rows, not a `domain` aggregate

Ingest merges first seen and last seen into an issue as a minimum and a maximum, and counts come from the event store, so redelivery is harmless and one upsert is enough. The two changes that can conflict are single conditional updates: resolving writes only where the issue is open, and a regression reopens only where `resolved_at` is earlier than the time the occurrence was received.

So error tracking runs on any target, as flags do; every endpoint is an `HttpApi` behind the one access adapter; both UI frameworks have a client for it; and nothing here waits on a beta package.

*Alternative.* A `domain` aggregate per issue: off Cloudflare it needs Postgres and standing runners, its RPC needs a second access adapter, and it has no React client. What it would have given is taken on here: alert delivery after commit (decision 4) and, later, MCP and CLI commands, which are few and written over the same API (roadmap). It fits the issue tracker, where claims need one place that decides.

### 2. Opaque issue ids and a fingerprint table

Issues have opaque ids, and a fingerprint table maps (project, fingerprint, rules version) to an issue. Events store fingerprint and version, and resolve through the table, so merge, split and new rules move no events. A unique constraint settles simultaneous first occurrences: the loser reads the winner's row. When a fingerprint under current rules is unknown, the previous rules' fingerprint is tried, and a match gains the new one.

Grouping per chained exception: type plus the project's frames (module, function), never line numbers; without usable frames, type plus the message with ids, numbers, addresses and dates replaced. Written from behavior, not from Sentry's code.

### 3. One atomic write per backend

Storing an occurrence inserts the event, updates the issue and, for a new one, inserts the alert. The store layer makes that one unit: a transaction on Postgres and SQLite, `batch` on D1. Both sit behind one `EventStore` service, and one suite runs against each.

- **Once:** an event's id is unique per project; a resend inserts nothing and so changes no count.
- **Cap:** a counter row per issue and minute says how many occurrences have arrived. Past the cap, the occurrence adds to a weighted row instead of storing details, and its id goes to a table kept for ten minutes, so a resend of those counts once. Both are in SQL because a Worker's isolates share no memory.
- **Queries** go through `Analytics`, as structured queries; every count sums weights.

The crash loop in the spec is about 170 writes a second to one database. Task 1.3 measures that first. If D1 cannot keep up, a Durable Object per project collects writes in front of the same service on Cloudflare; callers do not change.

### 4. Alerts are an outbox

The alert row commits with the issue, with a unique key of issue and cause. After the commit, ingest hands its id to a delivery service: a queue on Cloudflare, a fiber in the ingest server elsewhere. Delivery claims the row by a conditional update with a lease, sends through the host's mailer, and marks it sent; failures retry without touching ingest. A crash between sending and marking can send twice, which is accepted over not sending. A daily cleanup also picks up rows whose hand-over was lost.

### 5. Pipeline

Decode, replace impossible times, scrub, mark the project's frames, fingerprint (current and previous rules), find or create the issue, store. Scrubbing comes before storage from the first release, because stored secrets cannot be un-stored.

Ingest is its own server: a Worker on Cloudflare, a separate process elsewhere. Retention hides expired events from reads at once; the daily cleanup deletes them.

**Event shape:** one shape for every reporter, with optional trace and span ids, from Sentry's trace context or the current Effect span. They cost two columns now and cannot be added to stored events later. A later traces feature joins on them.

### 6. Sentry protocol

Responses always carry the categorized limit header. Unsupported kinds get 200 and a long limit on those kinds; unknown keys get a refusal and a long limit. Integer project ids, 32-hex keys. Query and header names that carry keys use `HttpApi.RedactedNames`, so keys reach no log or span.

### 7. Package layout

As in `add-admin-core`, plus `/ingest` (protocol adapters and the ingest server) and `/effect` (the reporter), which import only `.`. Alchemy is an optional peer.

`shoemaker-edgehog` holds errors and, later, flags. Whichever of this change and `add-feature-flags` is applied first scaffolds it.

### 8. What may be reused

Sentry and Relay (FSL-1.1-Apache-2.0): no code, tests, snapshots, rule files or expression lists, translated or not. Wire formats, headers and observed behavior are reimplemented; fixtures are recorded from the SDK. Vendor names stay out of package names.

### 9. Not Effect's `EventLog`

It is for local-first state: each device writes its own journal and syncs. Its payloads are binary, so SQL cannot query them, on Postgres each write locks out other writers, vendor SDKs don't speak its protocol, and its SQL journal uses transactions, which D1 lacks. Our service is called `EventStore` so the two are not confused.

## Risks / Trade-offs

- [D1 is too slow for a crash loop] → Measured before anything is built on it; decision 3 has the fallback. A local run does not prove production speed, so 5.2 checks the deployed one.
- [Recorded SDK fixtures go stale] → A script refreshes them; version bumps fail tests first.
- [Two ways to be atomic] → Kept inside the store layer, behind one shared suite.
- [Stored personal data] → Scrubbing and retention from the first release.

## Migration Plan

1. Publish; nothing changes for repos that don't install it.
2. Adopting project: add the package, mount its API, deploy the ingest server, point the SDK or the reporter at it.
3. Rollback: revert the repo's commit. Its tables are its own and can stay.

## References

- [Sentry](https://github.com/getsentry/sentry) at `5439070`, [Relay](https://github.com/getsentry/relay) at `97c1eca`, [self-hosted](https://github.com/getsentry/self-hosted) at `1baa2d6`: read for behavior, never copied.
- [GlitchTip](https://github.com/rh-cssre/glitchtip-backend) and [Bugsink](https://www.bugsink.com/sentry-sdk-compatible/): others who accept these SDKs.
- [Domain documentation](https://alchemy.run/domain), for decision 1; [Effect `EventLog`](https://effect.website/blog/module-of-the-week/event-log), for decision 9.
