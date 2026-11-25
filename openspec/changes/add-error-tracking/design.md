# Design

## Context

See proposal.md for motivation, and `add-admin-core`'s design for mounting, access, migrations, atomic writes and package layout.

Facts checked in source, at the CLI's pins (Effect 4.1.5, Alchemy 2.0.0-beta.87):

- A Sentry SDK treats a bare 429 or `Retry-After` as a limit on everything, and `X-Sentry-Rate-Limits` as a limit on the kinds it names. A DSN's project id must be digits.
- Sentry maps many hashes to one issue with its own id, and tries old grouping rules after changing them.
- The D1 client dies on transactions and has an atomic `batch`, which returns rows and not D1's count of rows written. The Postgres and SQLite clients have transactions. PGlite's client has one connection.
- Alchemy has Durable Objects, queues with a retry limit, cron triggers, rate-limit bindings, Worker CPU limits and zone rulesets. Its `Ruleset` owns a zone's whole phase, so a package must not declare one for the host. It bundles a Worker without renaming functions.
- Effect's HTTP client and server pass `traceparent` on.

Facts from Cloudflare's documentation, read 2026-11-25:

| | |
| --- | --- |
| D1 | $1.00 per million rows written past 50 million a month. Index updates and deletes count. No spending limit. One query at a time per database; 10 GB at most |
| Workers | $0.30 per million requests, $0.02 per million CPU ms. Subrequests and service bindings add no request fee. A spending limit exists, for the whole account, and rejects every Worker |
| Durable Objects | $0.15 per million requests, $12.50 per million GB-s, rows as D1. About 1,000 requests a second each |
| Queues | $0.40 per million operations, three for a message, one more for each retry |
| Email | $0.35 per 1,000 past 3,000 a month |
| Rate-limit binding | approximate, per location, 10 or 60 seconds |
| Zone rate-limit rules | one on the Free plan, by IP address, 10 seconds. "Only requests that hit a Worker" are billed; nothing found says so for blocked ones |

D1 storage is $0.75 per GB-month. The Durable Objects page rounds usage past the included amount up to the next unit; no other page says so.

Recorded from the Sentry Cloudflare SDK 11.17.0 in workerd (`scripts/record-sentry.ts`):

- It never resends: a 429, 500, 413, a hang and an unreachable host each drop the event.
- A bare 429, `Retry-After` or a limit header without categories stops everything; one that names errors stops errors only, on a 200 too. An isolate remembers it.
- It sends through a service binding with `transportOptions: { fetch: env.INGEST.fetch.bind(env.INGEST) }`.
- Its key comes in the query string, or in the envelope header's `dsn` through a tunnel. It never sends `X-Sentry-Auth`.
- It continues `sentry-trace` and not `traceparent`.
- It drops an error identical to the one before, across an isolate's requests.
- Each envelope holds one item. In a bundle every frame is marked as the app's, the SDK's included, and some names carry the bundler's suffix.
- It collects cookies, headers, bodies and IP addresses by default, and a JSON body's password and card number arrive unfiltered.

Not verified: whether a blocked request is billed, and whether D1 bills deletes from indexes (local D1 does not count them; the costs here do).

## Goals / Non-Goals

**Goals:** a real server failure becomes one issue and one email; no loop, flood or mistake can run up a bill or take the app down; early choices that later changes don't have to undo (opaque issue ids, fingerprint versions, trace ids on events, one place that meters).

**Non-Goals:** feature parity with Sentry; storing traces; exact counts past a limit.

## Decisions

### 1. Issues are SQL rows, not a `domain` aggregate

An issue row holds its id, state, `resolved_at` and first seen. Occurrences, people and last seen are computed from retained data. First seen is written at creation and again only by an earlier occurrence, so it outlives the events and no row is updated on every occurrence.

The two changes that can conflict are single conditional updates: resolving writes only where the issue is open, and a regression reopens only where `resolved_at` is earlier than the time of receipt **and this attempt stored the event**. A resend stores nothing, so it reopens nothing.

So error tracking runs on any target, as flags do; every endpoint is an `HttpApi` behind the one access adapter; and nothing here waits on a beta package.

*Alternative.* A `domain` aggregate per issue: off Cloudflare it needs Postgres and standing runners, its RPC needs a second access adapter, and it has no React client. It fits the issue tracker, where claims need one place that decides.

### 2. Opaque issue ids and a fingerprint table

Issues have opaque ids, and a fingerprint table maps (project, fingerprint, rules version) to an issue. Events and counted rows store fingerprint and version, and resolve through the table, so merge, split and new rules move no rows. When a fingerprint under current rules is unknown, the fingerprints under every earlier version that the project still has stored are tried, newest first, and a match gains the new one. A version's code is removed only with its stored fingerprints.

Grouping per chained exception: type plus the project's frames (module, function), never line numbers; without usable frames, type plus the message with ids, numbers, addresses and dates replaced. Written from behavior, not from Sentry's code.

**Which frames are the project's.** Where paths tell project from library, the project's. A bundled Worker is one file, so there the frames say nothing (the SDK marks every one as the app's), and library internals must not decide the group: the fingerprint is the type, the innermost named function without the suffix a bundler adds, and the message with its variable parts replaced. For a report from Effect, the failing span's name takes the place of the function, since the author wrote it and no bundler changes it. Source maps bring real frames later, as a new rules version.

### 3. A collector per project decides, the store records

Every occurrence goes through one collector for its project: a Durable Object on Cloudflare, part of the ingest process elsewhere. It holds in memory what would otherwise be contested rows: how many occurrences of each issue arrived this hour, the ids it counted without details, and what is left of each limit (decision 4).

- **An occurrence kept in detail** is written before it is acknowledged, as one unit: event, fingerprint, issue, alert and usage. The event is inserted first, unless its id exists, with an id for this attempt; each later statement applies only if that attempt is the one stored. The fingerprint is inserted unless known, and the issue and alert only if the fingerprint row names the new issue. So a resend changes nothing, two first occurrences make one issue without an error to recover from, and no issue exists without its event and alert.
- **An occurrence past the limit** is only counted, in memory, and written once a minute to a row per fingerprint, hour and collector run. The row is set to the total, not added to, so a repeated write counts once. A collector that stops loses at most its last minute of these.
- **Usage** is written in the same unit as what it meters, and with each minute's counts, so a collector that restarts in a loop does not start again with a full allowance.

The unit is `add-admin-core`'s atomic write: `batch` on D1, a transaction elsewhere. Both sit behind one `EventStore`, and one suite runs against each. With several ingest processes, the host says how many, and each collector has that share of the limits; the store's constraints still settle races.

**Queries** go through `Analytics`, as structured queries; every count sums counted rows. People are counted from occurrences kept in detail, so the number is shown as "at least" when some were only counted. Every query uses an index and has a maximum range and page.

*Alternatives.* Counter rows in SQL: each occurrence writes several rows, which is the cost to be avoided, and one issue's row is contested exactly in a crash loop, for several round trips on a remote Postgres. A queue in front: three operations an occurrence, more than a row costs, and it cannot refuse. The rate-limit binding alone: approximate and per location.

### 4. Spending is bounded by default

The reason for this product is to cost less than an always-on server, so a loop must not be able to cost more than one. Every limit is a finite number with a default. A project can change one and cannot turn it off.

| Limit, per project | Default | Past it |
| --- | --- | --- |
| Reports accepted | 20,000 an hour | refused with a limit until the hour ends, less a sample of ten a minute |
| Details of one issue | 100 an hour | counted only, using none of the other errors' allowance |
| New issues | 50 an hour | counted under one overflow issue |
| Rows written, deletes included | 100,000 a day: 45,000 for ingest, 45,000 for cleanup, 10,000 for usage, alerts and one counted row | occurrences counted in that one row |
| Stored data | 1 GB | counted only, until cleanup makes room |
| One occurrence | 64 KB after scrubbing | trimmed, and marked as trimmed |
| Emails | 20 a day | one summary a day |
| Sends of one alert | 5, with growing delays | marked failed and shown |

Where each is enforced, from the cheapest:

1. **The sender.** The Effect reporter merges repeats of one error into one report with a count, sends at a bounded rate, tries once, and never reports a failure of its own or of Edgehog's. A project's Worker reaches ingest through a service binding where it can.
2. **The edge.** The ingest Worker has no `workers.dev` or preview address, so the zone's rules apply, and a low CPU limit. The package exports the rate-limit rule; the host adds it to its own ruleset.
3. **Ingest, before reading the body.** Projects and keys are configuration, so an unknown key costs no read. Each isolate remembers the collector's last refusal, and while it holds answers without calling the collector. The rate-limit binding catches a flood before the collector knows.
4. **The collector**, which is the only place that counts exactly.
5. **The store.** `EventStore` takes a metered allowance, so no code path writes without one. Rows written are counted from a fixed cost for each operation, which a test compares with local D1's own number.

It fails closed: if the collector or its usage can't be read, or it is overloaded, the isolate refuses for a minute. Limits reset by themselves. The first time one is reached in a day, the admin shows it and one email says so; that email is inside the email limit. An admin can pause a project, which is audited and holds within a minute.

**Loops inside Edgehog.** Ingest, delivery and cleanup only log their failures. Queue and delivery retries are finite. Cleanup deletes in batches of 1,000 up to its share of the rows, and that share is as much as a day's ingest can need, which a test proves from the limits. Counted rows cost as much to delete as to write, so the shares are equal and a project's may not be less. Off Cloudflare, timers run only while something waits to be sent or written, so an idle database that bills for being awake can sleep; cleanup runs at start and once a day.

**The worst case is a number.** A test multiplies every limit by the prices above, recorded with their date, and fails above 20 dollars a month for a project whose account has used up every included amount. From these limits it is 17.03: D1 writes 3.10, accepted requests 4.60, CPU 1.55 (5 ms each), the collector 6.64, storage and email 1.02, queue and reads 0.12. If Cloudflare rounds Durable Object usage up as its page says, and nothing else in the account uses any, it is 26.29; see Open question. At ordinary volume all of it is inside the included amounts.

**What code can't bound.** A request refused by a Worker still costs a request: a thousand a second for a day is about 28 dollars. Only the edge rule, Cloudflare's own flood protection and the account's settings stop that. The README lists them: the rule, a budget alert, and Workers and Durable Object spending limits, with the warning that the Workers limit stops every Worker in the account, the app's too.

### 5. Its own database by default

Events, issues and alerts go to a database of their own: a D1 that the Cloudflare helper creates, or a separate Postgres database with a small pool. A flood then can't slow the app, fill its storage or use its database's one thread, and the tool survives what it reports on. Passing the host's own client is an explicit choice. Audit entries stay in the admin's table, through the core.

### 6. Projects, keys and alerts are configuration

The host declares projects where it mounts Edgehog and starts ingest: an integer id, a name, one or more 32-hex keys, limits, retention, alert recipients, and how an issue id becomes an address in its admin. Keys come from the environment, and two at once allow changing one. The mailer is a service the host provides to the delivery. Project names and limits are shown in the admin and not edited there; pausing is the one exception, and a row.

### 7. Alerts are an outbox

The alert row commits with the issue, with a unique key of issue and cause. After the commit, the collector hands its id to a delivery service: a queue on Cloudflare, a fiber in the ingest server elsewhere. Delivery claims the row by a conditional update with a lease, sends, and marks it sent; failures retry without touching ingest. A crash between sending and marking can send twice, which is accepted over not sending.

A delivery that crashed is retried by the queue, or elsewhere when its lease ends and when the process starts. A hand-over that was lost is picked up when the collector next stores an occurrence in detail, which it knows from its own memory or reads once as it starts, and by the daily cleanup.

### 8. Pipeline and times

Decode, replace impossible times, scrub, mark the project's frames, fingerprint (current and earlier rules), collect, and then store or count. Finding or creating the issue is part of storing (decision 3). Scrubbing comes before storage from the first release, because stored secrets cannot be un-stored.

Ingest is its own server: a Worker on Cloudflare, a separate process elsewhere. Retention hides expired events from reads at once; the daily cleanup deletes them.

**Event shape:** one shape for every reporter, with optional trace and span ids as each reporter sends them: Sentry's trace context, or the current Effect span. They agree when both continue one trace: the SDK continues only `sentry-trace` unless configured otherwise, so a shared `traceparent` alone is not enough. Or when the program starts its Effect span from Sentry's trace, for which the reporter has a helper. Neither is forced. They cost two columns now and cannot be added to stored events later.

### 9. Protocols

**Sentry.** Responses always carry the categorized limit header. Unsupported kinds get 200 and a long limit on those kinds; unknown keys get a refusal and a long limit. Integer project ids, 32-hex keys.

**Edgehog's own.** The Effect reporter sends to one `HttpApi` endpoint of ingest, with the same key, under the same limits and pipeline. A report holds its causes, spans, trace and a count of at most 10,000. It is for our reporter only; a native SDK stays out of scope.

Query and header names that carry keys use `HttpApi.RedactedNames`, so keys reach no log or span.

### 10. Package layout

As in `add-admin-core`, plus `/ingest` (adapters, pipeline, collector and the ingest server; imports `.`, `/contract`), `/effect` (the reporter; the same) and `/cloudflare` (the Durable Object, queue, Worker and D1 helpers; imports `/ingest`, `/sql`, `/alchemy`). Alchemy is an optional peer; `shoemaker-admin` and `effect` are peers.

`shoemaker-edgehog` holds errors and, later, flags. Whichever of this change and `add-feature-flags` is applied first scaffolds it.

### 11. What may be reused

Sentry and Relay (FSL-1.1-Apache-2.0): no code, tests, snapshots, rule files or expression lists, translated or not. Wire formats, headers and observed behavior are reimplemented; fixtures are recorded from the SDK. Vendor names stay out of package names.

### 12. Not Effect's `EventLog`

It is for local-first state: each device writes its own journal and syncs. Its payloads are binary, so SQL cannot query them, on Postgres each write locks out other writers, vendor SDKs don't speak its protocol, and its SQL journal uses transactions, which D1 lacks. Our service is called `EventStore` so the two are not confused.

## Risks / Trade-offs

- [The collector or D1 is too slow for a crash loop] → A bounded benchmark on a scratch deploy (tasks 1.4 and 1.5) comes before anything is built on it, since local D1 and PGlite have no network. Past the limit an occurrence costs no write, so the load on storage is the limit and not the loop.
- [One collector per project is one place to fail] → It fails closed and the app is unaffected; a missed error is better than a bill.
- [Past the limit on reports, a loop hides other errors until the hour ends, except for the sample] → Telling errors apart needs the body, which is what refusing avoids. The limit is above any ordinary hour, the reporter merges repeats, and the limit email says it happened.
- [Counts past a limit can miss a minute, or count a resend again after a restart] → Accepted, and said in the spec.
- [The defaults are guesses] → Adoption records what a real project uses, and a limit is one line to change.
- [Prices change] → Recorded with a date, beside the test that uses them.
- [Grouping in a bundle is coarse until source maps] → Two errors of one type, function and message are one issue.
- [Recorded SDK fixtures go stale] → A script refreshes them; version bumps fail tests first.
- [Two ways to be atomic] → Kept inside one service, behind one shared suite.
- [PGlite can't race] → Races run against the Postgres that `add-admin-core` gives the tests.
- [Stored personal data] → Scrubbing and retention from the first release.

- [Occurrences that arrive before their new issue is stored are each charged as new, and a resend is charged though it writes nothing] → Errs toward refusing; a detail is charged 10 rows and writes 6, so at most 4,500 a day are kept.
- [`AtomicWrites` returns no rows, so learning whether this attempt stored the event costs a query] → Group 2 makes it return them.
- [D1 allows 1,000 queries per invocation] → Counts are written in chunks.

## Open question

Does the 20 dollars mean proportional use, or the bill of an account that uses no other Durable Objects, where rounding alone is 12.50 (worst case 26.29)? Decide before group 2; `usage-limits` "The worst case is known" must say which. A test pins both numbers.

## Migration Plan

1. Publish, the first time by hand; nothing changes for repos that don't install it.
2. Adopting project: add the package, declare a project, mount its API, deploy the ingest server and its database, point the SDK or the reporter at it, add the edge rule and a budget alert.
3. Rollback: revert the repo's commit. Its database is its own and can stay.

## References

- [Sentry](https://github.com/getsentry/sentry) at `5439070`, [Relay](https://github.com/getsentry/relay) at `97c1eca`, [self-hosted](https://github.com/getsentry/self-hosted) at `1baa2d6`: read for behavior, never copied.
- [GlitchTip](https://github.com/rh-cssre/glitchtip-backend) and [Bugsink](https://www.bugsink.com/sentry-sdk-compatible/): others who accept these SDKs.
- Cloudflare: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/) and [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) prices, [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [spending limits](https://developers.cloudflare.com/workers/platform/spend-management/), [rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
- [Domain documentation](https://alchemy.run/domain), for decision 1; [Effect `EventLog`](https://effect.website/blog/module-of-the-week/event-log), for decision 12.
