# Proposal

## Why

Projects need to turn features on for some users without a deploy or a rented service. OpenFeature keeps application code on an open standard, so it doesn't depend on Edgehog.

The package needs `add-admin-core` archived first, and adoption by the React project needs `extend-admin-users`. It does not depend on `add-error-tracking`, and goes first if a project needs a flag sooner. Later changes are in `openspec/ROADMAP.md`.

## What Changes

- Edgehog (`shoemaker-edgehog`) gains typed flags with property rules and gradual rollouts, defined in the admin and audited.
- Servers evaluate them in process through the official OpenFeature SDK, and can hand results to a page.
- One project uses a flag, with a flags page written by hand.

Not in this change: remote evaluation for browsers and mobile, exposures, experiments, PostHog flags and shared pages (roadmap).

## Capabilities

### New Capabilities

- `feature-flags`: typed flags on OpenFeature, evaluated locally.

### Modified Capabilities

None.

## Impact

- **Package**: `packages/edgehog`.
- **New pins**: the OpenFeature server SDK, as an optional peer.
- **Standards**: the [OpenFeature specification](https://github.com/open-feature/spec) and its provider conformance suite, pinned.
- **Licences**: reused MIT and Apache-2.0 material is listed in a notices file (design.md, decision 4).
- **Other repos**: adoption happens in the project's own checkout; its deploy is Ethan's to run.
- **Docs**: README gains a flags section.
