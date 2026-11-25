# Proposal

## Why

Projects need to know when they fail in production. Self-hosting the usual tools means dozens of always-on containers (Sentry's errors-only profile alone asks for 7 GB of memory); on serverless parts beside the project's own server, error tracking costs close to nothing at low volume. That is only an advantage if it also can't cost a lot by accident, so every use has a limit from the first release.

Needs `add-admin-core` archived first. The Foldkit project adopts it, so it does not wait for `extend-admin-users`. Later changes are in `openspec/ROADMAP.md`.

## What Changes

- A new product, Edgehog (`shoemaker-edgehog`), starts with errors from servers: an ingest server for the official Sentry Cloudflare SDK, and a reporter for Effect programs.
- Exceptions are scrubbed, grouped into issues, counted and kept for a set time. Issues can be resolved and reopen as regressions. A new issue sends one email.
- Every use is limited by default, with a known worst case: a loop or a flood is counted and refused, not paid for.
- Issues and events are plain SQL in a database of their own, so this runs on any target and a flood can't reach the app's database. Sharing the app's is a choice.
- Events keep trace and span ids, so traces can be joined to errors if they are ever stored.
- One project uses it with an issues page written by hand.

Not in this change: browsers and mobile, source maps, archive, merge, releases, filters, spike alerts, agents and shared pages (roadmap). Storing traces is an open question there.

## Capabilities

### New Capabilities

- `telemetry-ingest`: accepting errors from the official Sentry server SDK and from Effect programs.
- `telemetry-storage`: storing and querying events on a SQL database.
- `usage-limits`: what Edgehog may spend, how it stops, and how that is shown.
- `error-tracking`: grouping exceptions into issues, their lifecycle and alerts.

### Modified Capabilities

None.

## Impact

- **New package**: `packages/edgehog`, in the products' changesets group. The name was free on npm on 2026-11-25.
- **New pins**: the Sentry Cloudflare SDK as a test fixture. Durable Objects and a queue on Cloudflare. No `domain`, no unreleased Alchemy.
- **Licences**: nothing is copied from Sentry or Relay (design.md, decision 11).
- **Other repos**: adoption happens in the project's own checkout; its deploy is Ethan's to run.
- **Docs**: README gains an error tracking section, with its limits, worst case and the account settings to add.
