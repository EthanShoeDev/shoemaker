# Tasks

Tasks marked **[React project]** happen in that repo's own checkout, never in `.external/`; they need `extend-admin-users`. The Foldkit project can go first instead, with the same tasks. Tasks marked **[Ethan]** include a deploy, which agents don't run. Package tasks also pass `bunx turbo run lint:check --filter=<pkg>` and `bun run test`.

## 1. Package and proofs

- [ ] 1.1 Scaffold `packages/edgehog` if `add-feature-flags` has not, in the products' changesets group, with the subpaths in design.md; verify `bun install` and `lint:check` pass, and an install test that pulls no UI framework and no Cloudflare package
- [ ] 1.2 Record fixtures from the pinned Sentry Cloudflare SDK with a refresh script, its retries included; verify the script reproduces them
- [ ] 1.3 Measure the crash-loop write load on local D1, SQLite and PGlite with the atomic write of design.md, decision 3; verify with the numbers recorded there and the Durable Object fallback chosen or dropped

## 2. Storage and ingest

- [ ] 2.1 Event shape, `EventStore`, `Analytics`, SQL layers and migrations; verify one shared suite on SQLite, D1 and PGlite, trace ids included
- [ ] 2.2 Weighted rows, the cap and the ten-minute id table; verify the crash-loop scenario, a resend below and above the cap, and one id in two projects
- [ ] 2.3 Retention and the daily cleanup; verify expiry with `TestClock`, and an issue whose occurrences have all expired
- [ ] 2.4 Ingest server with project keys, limits and the Sentry adapter; verify every fixture, each way of sending a key, framing variants, retries, size and rate tests, and that keys reach no log or span
- [ ] 2.5 Scrubbing and impossible times before storage; verify a fixture for each kind of secret, a future time and an unset clock
- [ ] 2.6 `/effect` reporter; verify a report with concurrent causes and nested spans, and that it shares its trace id with a Sentry event

## 3. Issues

- [ ] 3.1 Fingerprints with versions, the three SDK forms, and the fingerprint table; verify grouping fixtures, simultaneous first occurrences and a rules change
- [ ] 3.2 Issue rows with resolve and regression; verify on each backend redelivered batches, resolving twice, and an occurrence already on its way when resolved
- [ ] 3.3 Counts from events; verify a late arrival moving first seen earlier, and people affected
- [ ] 3.4 Issues API behind the access core; verify permission and audit tests
- [ ] 3.5 New-issue email through the outbox; verify once per issue, a failed delivery, two deliverers with one row, and a lost hand-over picked up by the cleanup

## 4. Delivery

- [ ] 4.1 Cloudflare helpers (ingest Worker, queue, cleanup trigger) and a Bun ingest server; verify typecheck and tests only
- [ ] 4.2 Package README, root README section and changeset; verify both examples typecheck as written

## 5. Adoption

- [ ] 5.1 **[React project]** Install, with a hand-written issues page; verify its tests
- [ ] 5.2 **[Ethan]** Deploy; confirm a real server failure becomes one issue and one email, and that a forced crash loop is counted within two minutes
