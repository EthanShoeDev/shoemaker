# Proposal

## Why

Projects need to know when they fail in production. Self-hosting the usual tools means dozens of always-on containers (Sentry's errors-only profile alone asks for 7 GB of memory); embedded in the project's own server and database, error tracking costs close to nothing at low volume.

The package needs `add-admin-core` archived first, and adoption by the React project needs `extend-admin-users`. Later changes are in `openspec/ROADMAP.md`.

## What Changes

- A new product, Edgehog (`shoemaker-edgehog`), starts with errors from servers: an ingest server for the official Sentry Cloudflare SDK, and a reporter for Effect programs.
- Exceptions are scrubbed, grouped into issues, counted and kept for a set time. Issues can be resolved and reopen as regressions. A new issue sends one email.
- Issues and events are plain SQL on the host's database, so this runs on any target.
- Events keep trace and span ids, so traces can be joined to errors if they are ever stored.
- One project uses it with an issues page written by hand.

Not in this change: browsers and mobile, source maps, archive, merge, releases, filters, spike alerts, agents and shared pages (roadmap). Storing traces is an open question there.

## Capabilities

### New Capabilities

- `telemetry-ingest`: accepting errors from the official Sentry server SDK and from Effect programs.
- `telemetry-storage`: storing and querying events on the host's database.
- `error-tracking`: grouping exceptions into issues, their lifecycle and alerts.

### Modified Capabilities

None.

## Impact

- **New package**: `packages/edgehog`, in the products' changesets group. The name was free on npm on 2026-11-25.
- **New pins**: the Sentry Cloudflare SDK as a test fixture. No `domain`, no unreleased Alchemy.
- **Licences**: nothing is copied from Sentry or Relay (design.md, decision 8).
- **Other repos**: adoption happens in the project's own checkout; its deploy is Ethan's to run.
- **Docs**: README gains an error tracking section.
