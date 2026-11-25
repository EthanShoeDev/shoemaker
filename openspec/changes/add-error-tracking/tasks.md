# Tasks

Tasks marked **[Foldkit project]** happen in that repo's own checkout, never in `.external/`. The React project can adopt after `extend-admin-users`, with the same tasks. Tasks marked **[Ethan]** include a deploy, which agents don't run. Package tasks also pass `bunx turbo run lint:check --filter=<pkg>` and `bun run test`.

## 1. Package and proofs

- [x] 1.1 Scaffold `packages/edgehog` at 0.1.0 if `add-feature-flags` has not, in the products' changesets group, with the subpaths in design.md; verify `bun install` and `lint:check` pass, and an install test that pulls no UI framework and no Cloudflare package
- [x] 1.2 Record fixtures from the pinned Sentry Cloudflare SDK with a refresh script, its retries included, and find out whether it can send through a service binding; verify the script reproduces them, with the finding recorded in design.md
- [x] 1.3 Limits with their defaults and recorded prices, and the test that computes the worst case and that cleanup keeps up; verify it fails when a default is raised past the amount, and update design.md's figures from it
- [x] 1.4 A benchmark of the collector and the atomic write with a fixed number of occurrences: one hot issue, many issues, details and counts; verify it runs locally on D1, SQLite and Postgres, that its own cost is computed first, and that it stops by itself
- [ ] 1.5 **[Ethan]** Deploy the benchmark to a scratch stage and destroy it after; record the numbers and the D1 rows really written in design.md, and whether blocked requests were billed. Groups 2 to 4 start only then; revise design.md if the collector or D1 does not keep up

## 2. Storage and limits

- [ ] 2.1 Event shape, `EventStore` with a metered allowance, `Analytics`, SQL layers and migrations; verify one shared suite on SQLite, D1 and Postgres, trace ids and maximum ranges included, and that a write without an allowance does not typecheck
- [ ] 2.2 The collector, in process: issue and project limits, counted rows, the overflow issue, usage written with what it meters; verify each `usage-limits` scenario with `TestClock`, a resend below and above the limit, one id in two projects, a repeated flush, a restart in a loop and unreadable usage
- [ ] 2.3 The fixed cost of each operation; verify it is never below local D1's own count of rows written, deletes and indexes included
- [ ] 2.4 Retention and the bounded cleanup; verify expiry with `TestClock`, an issue whose occurrences have all expired, an interrupted cleanup, and no database use while idle off Cloudflare

## 3. Ingest

- [ ] 3.1 Ingest server with declared projects and keys, the local refusal, and the Sentry adapter; verify every fixture, each way of sending a key, two keys at once, framing variants, retries, size tests, that a refusal reads no body and no storage, and that keys reach no log or span
- [ ] 3.2 Scrubbing, trimming and impossible times before storage; verify a fixture for each kind of secret, an oversized occurrence, a future time and an unset clock
- [ ] 3.3 The reporter's endpoint and the `/effect` reporter; verify concurrent causes and nested spans, a trace id shared through `traceparent` and through the helper, merged repeats, the bounded rate, and that its own failures are never reported

## 4. Issues

- [ ] 4.1 Fingerprints with versions, the three SDK forms, and the fingerprint table; verify grouping fixtures, a bundled Worker before and after a library upgrade, an Effect span, and rules changed twice
- [ ] 4.2 Storing an occurrence as one unit; verify on each backend a resend, a crash at each step, and on Postgres two first occurrences and two resolves at once
- [ ] 4.3 Resolve and regression; verify on each backend a resend after resolving, resolving twice without an audit entry, and an occurrence already on its way when resolved
- [ ] 4.4 Counts from events and counted rows, with first seen kept; verify a late arrival, an expired first occurrence, and people shown as a minimum
- [ ] 4.5 Issues API, limits shown, and pausing a project, behind the access core; verify permission and audit tests, and that a pause holds within a minute
- [ ] 4.6 New-issue and limit emails through the outbox; verify once per issue, a failed delivery that stops, the daily summary, on Postgres two deliverers with one row, a crashed delivery, and a lost hand-over

## 5. Delivery

- [ ] 5.1 Cloudflare helpers (Durable Object, its own D1, queue with finite retries, cleanup trigger, and an ingest Worker with a CPU limit and no `workers.dev` address), the exported edge rule, and a Bun ingest server; verify with a test of the collector in the Durable Object, and typecheck
- [ ] 5.2 Package README, root README section and changeset, with the limits, the worst case, what code can't bound, and the account settings to add; verify both examples typecheck as written
- [ ] 5.3 **[Ethan]** Publish `shoemaker-edgehog` once by hand and trust `release.yml` for it, unless `add-feature-flags` did

## 6. Adoption

- [ ] 6.1 **[Foldkit project]** Install with its own database, with a hand-written issues page that shows limits; verify its tests
- [ ] 6.2 **[Ethan]** Add the edge rule and a budget alert, deploy; confirm a real server failure becomes one issue and one email, that a forced crash loop is counted within two minutes and then refused at its limit, and that the rows written match the usage shown; record them
