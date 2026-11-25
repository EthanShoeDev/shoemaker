# Design

## Context

See proposal.md for motivation, and `add-admin-core`'s design for mounting, access, migrations and package layout.

Facts checked in source:

- The OpenFeature provider conformance suite is marked experimental.
- OpenFeature Remote Evaluation Protocol (OFREP) 0.4.0 allows the reasons `STATIC`, `TARGETING_MATCH`, `SPLIT`, `DISABLED` and `UNKNOWN`, and has a no-value answer for code defaults. Results here use the same reasons, so remote evaluation can be added without changing them.

Not verified: the licence of PostHog's flag test vectors, which it vendors from another repository.

## Goals / Non-Goals

**Goals:** flags on any target; one evaluator that remote evaluation and other protocols can wrap later; assignment that never has to change.

**Non-Goals:** sending definitions to clients; parity with a vendor.

## Decisions

### 1. An OpenFeature-shaped model with one evaluator

The evaluator is a pure function from definition and context to an [OpenFeature][openfeature] resolution. Everything else wraps it. An OpenFeature server provider reads definitions from the host's storage and caches them for up to a minute, refreshing when read because Workers have no background timers. No key is involved, since the host reads its own database. Browsers and mobile get values their server evaluated, never rules.

Compliance means every mandatory provider requirement and the pinned conformance suite with declared capabilities. `@numeric-coercion` may be withheld, since JavaScript cannot tell `10.0` from `10`.

*Alternatives.* PostHog's model with an OpenFeature adapter: it has no number variants, and the standard would inherit a vendor's shape. A separate flags package: small enough to share Edgehog's, and the optional peers already keep it light.

### 2. Definitions are plain rows

They need no lifecycle, and flags then run on any target. `EventLog` is for devices that write offline; servers here read the host's own database.

### 3. Assignment is PostHog's

The first 60 bits of SHA-1 over `key.id` plus a salt, so its SDKs agree if they are supported later. Our own vectors pin it.

### 4. Package layout and reuse

As in `add-admin-core`, plus `/flags` (the evaluator, imports `.`) and `/openfeature` (the provider, imports `/flags` and the OpenFeature SDK). Whichever of this change and `add-error-tracking` is applied first scaffolds the package.

Reused with a notice in `THIRD_PARTY_NOTICES`: PostHog's flag hash, from outside `ee/` (MIT); its test vectors, if their own repository's licence allows; OpenFeature's conformance suite (Apache-2.0).

## Risks / Trade-offs

- [Flag assignment can never change] → Vectors in the repo, checked in every build.
- [The conformance suite is young] → Pinned; updates are reviewed like any upgrade.
- [Browsers and mobile have no flags of their own yet] → Servers hand over results; remote evaluation depends only on this change and can move up the roadmap.

## Migration Plan

1. Publish; nothing changes for repos that don't install it.
2. Adopting project: add the package, mount its API, register the provider.
3. Rollback: revert the repo's commit; code defaults apply.

## References

- [OpenFeature specification][openfeature], read at [`b489ba9`](https://github.com/open-feature/spec/tree/b489ba9/specification): [providers](https://github.com/open-feature/spec/blob/b489ba9/specification/sections/02-providers.md), [types](https://github.com/open-feature/spec/blob/b489ba9/specification/types.md), [provider conformance suite](https://github.com/open-feature/spec/tree/b489ba9/specification/assets/provider-tck).
- [OpenFeature Remote Evaluation Protocol](https://github.com/open-feature/protocol), read at [`98c4e0d`](https://github.com/open-feature/protocol/blob/98c4e0d/service/openapi.yaml).
- [PostHog's flag test vectors](https://github.com/PostHog/posthog-sdk-test-harness) (licence unchecked).

[openfeature]: https://github.com/open-feature/spec
