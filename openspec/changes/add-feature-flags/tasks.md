# Tasks

Tasks marked **[React project]** happen in that repo's own checkout, never in `.external/`; they need `extend-admin-users`. Tasks marked **[Ethan]** include a deploy, which agents don't run. Package tasks also pass `bunx turbo run lint:check --filter=<pkg>` and `bun run test`.

## 1. Evaluator

- [x] 1.1 Add the flag subpaths and optional peers to `packages/edgehog`, scaffolding it at 0.1.0 first if `add-error-tracking` has not; verify a flags-only install pulls neither a UI framework nor a Cloudflare package
- [x] 1.2 Check the licence of the flag test vectors PostHog vendors; verify with the finding recorded in design.md and, if reusable, the notices file
- [x] 1.3 The evaluator: types, rules, shares, reasons, error codes; verify each scenario, plus committed assignment vectors that must never change

## 2. Provider

- [x] 2.1 Definitions over `SqlClient` with migrations; verify one suite on SQLite, D1 and Postgres, with two projects and the limits
- [x] 2.2 The OpenFeature server provider with cached definitions; verify with `TestClock` that a change arrives within a minute, stale and never-loaded behavior, and the reads made by endless loops, unknown flags and failing storage included
- [x] 2.3 The pinned provider conformance suite against the provider; verify that mandatory scenarios pass and undeclared ones report as skipped
- [x] 2.4 A helper that hands evaluated results to a client; verify the output holds no rules

## 3. Admin

- [x] 3.1 Flags API behind the access core; verify permission and audit tests
- [x] 3.2 Package README, root README section and changeset; verify the example runs as written

- [ ] 3.3 **[Ethan]** Publish `shoemaker-edgehog` once by hand and trust `release.yml` for it, unless `add-error-tracking` did

## 4. Adoption

- [ ] 4.1 **[React project]** Mount flags, add one flags page by hand, and put one real feature behind a flag; verify its tests
- [ ] 4.2 **[Ethan]** Deploy; confirm turning the flag off takes effect within a minute
