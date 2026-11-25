# Design

## Context

See proposal.md for motivation, and `add-admin-core`'s design for mounting, access, migrations and package layout.

Facts checked in source:

- The OpenFeature provider conformance suite is marked experimental.
- OpenFeature Remote Evaluation Protocol (OFREP) 0.4.0 allows the reasons `STATIC`, `TARGETING_MATCH`, `SPLIT`, `DISABLED` and `UNKNOWN`, and has a no-value answer for code defaults. Results here use the same reasons, so remote evaluation can be added without changing them.

Reads from D1 cost $0.001 per million rows (2026-11-25), so refreshing 500 flags every minute in a hundred isolates all month is about two dollars.

PostHog's flag test vectors come from `PostHog/posthog-sdk-test-harness`, read at `4a8715a`: MIT.

## Goals / Non-Goals

**Goals:** flags on any target; one evaluator that remote evaluation and other protocols can wrap later; assignment that never has to change.

**Non-Goals:** sending definitions to clients; parity with a vendor.

## Decisions

### 1. An OpenFeature-shaped model with one evaluator

The evaluator is a pure function from definition and context to an [OpenFeature][openfeature] resolution. Everything else wraps it. An OpenFeature server provider reads definitions from the host's storage and caches them for up to a minute, refreshing when read because Workers have no background timers. While storage fails, it tries again at most once every ten seconds, and an unknown flag never causes a read, so evaluating in a loop costs no more than not.

Both promises hold together because freshness counts from the start of a load: loads start at least a minute apart, and definitions older than that are not served as fresh. Readers past it wait, each on its own timer since a Worker must not await another request's work, for five seconds at most; then what is held is served and the provider is stale. A change therefore takes a minute and the time of one load. Stale and change events fire on the next evaluation. Object values are cloned for each caller, and one hand-over uses one snapshot. On Workers the provider is registered lazily, because a registration killed with its request would leave the SDK not ready for good. Its `run` keeps a load alive with `waitUntil`; tests run both the plain and the Alchemy form in local workerd over D1, with aborted requests. No key is involved, since the host reads its own database. Browsers and mobile get values their server evaluated, never rules.

Compliance means every mandatory provider requirement and the pinned conformance suite with declared capabilities. `@numeric-coercion` is withheld, since JavaScript cannot tell `10.0` from `10`, and `@standard-reasons`, which wants `DEFAULT` where OFREP and our spec say `STATIC`. The suite runs in both modes. Requirements 2.8.1 to 2.8.3 (the provider emits READY and ERROR): the JavaScript SDK synthesizes them from `initialize`, so the provider emits only what the SDK cannot know: STALE, CONFIGURATION_CHANGED, READY after a recovery, and ERROR when a lazy provider cannot load. Emitting them itself would announce each twice.

*Alternatives.* PostHog's model with an OpenFeature adapter: it has no number variants, and the standard would inherit a vendor's shape. A separate flags package: small enough to share Edgehog's, and the optional peers already keep it light.

### 2. Definitions are plain rows

They need no lifecycle, and flags then run on any target. They live in the host's database and not in Edgehog's event database, so a flood of errors can't reach what the app needs to run. A row belongs to a project, since remote evaluation will let a project's key read that project's flags only, and a key is unique within it.

A project may hold 500 flags and 1 MB of definitions, which bounds what a refresh reads. The size counts UTF-8 bytes of the key and the stored definition, and both limits are one conditional statement, behind a table lock on Postgres. A row this version cannot read is kept and never saved over, so a rollback loses nothing newer. An isolate refreshes once a minute at most, so reads grow with running isolates and not with evaluations, and evaluating writes nothing. `EventLog` is for devices that write offline; servers here read the host's own database.

### 3. Assignment is PostHog's

The first 60 bits of SHA-1 over `key.id` plus a salt, so its SDKs agree if they are supported later. Our own vectors pin it, 384 of them by checksum, beside PostHog's. The position depends on the flag's key and the targeting key only, so editing or reordering rules moves nobody. Keys past 1,000 characters are refused; PostHog's server truncates at 200, its SDKs do not.

### 4. Package layout and reuse

As in `add-admin-core`, without `/alchemy`, since hosts use `migrateHost` of the admin package, plus `/flags` (the evaluator, imports `.`) and `/openfeature` (the provider, imports `/flags` and the OpenFeature SDK). Whichever of this change and `add-error-tracking` is applied first scaffolds the package.

Reused with a notice in `THIRD_PARTY_NOTICES`, which ships: PostHog's flag hash, from outside `ee/` (MIT). Kept in tests only, beside their licences: its test vectors (MIT) and OpenFeature's conformance suite at `b489ba9` (Apache-2.0).

## Risks / Trade-offs

- [Flag assignment can never change] → Vectors in the repo, checked in every build.
- [The conformance suite is young] → Pinned; updates are reviewed like any upgrade.
- [Browsers and mobile have no flags of their own yet] → Servers hand over results; remote evaluation depends only on this change and can move up the roadmap.

## Migration Plan

1. Publish, the first time by hand; nothing changes for repos that don't install it.
2. Adopting project: add the package, mount its API, register the provider.
3. Rollback: revert the repo's commit; code defaults apply.

## References

- [OpenFeature specification][openfeature], read at [`b489ba9`](https://github.com/open-feature/spec/tree/b489ba9/specification): [providers](https://github.com/open-feature/spec/blob/b489ba9/specification/sections/02-providers.md), [types](https://github.com/open-feature/spec/blob/b489ba9/specification/types.md), [provider conformance suite](https://github.com/open-feature/spec/tree/b489ba9/specification/assets/provider-tck).
- [OpenFeature Remote Evaluation Protocol](https://github.com/open-feature/protocol), read at [`98c4e0d`](https://github.com/open-feature/protocol/blob/98c4e0d/service/openapi.yaml).
- [PostHog's flag test vectors](https://github.com/PostHog/posthog-sdk-test-harness) (MIT).

[openfeature]: https://github.com/open-feature/spec
