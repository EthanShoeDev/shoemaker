# Proposal

## Why

Every project needs an admin panel, analytics and error tracking, and today each one gets a hand-copied admin and either nothing or a hosted vendor for the rest. Copying has already cost us: doc-convert-dev and shumate-draughn-inc share an ancestor for their admin code, yet only doc-convert-dev audits admin actions, refuses impersonated sessions and closes Better Auth's own admin endpoints. Self-hosting the usual tools needs an always-on server; a serverless, embeddable product costs close to nothing at low volume.

## What Changes

- **Admin packages.** A new `shoemaker-admin` package holds what must be identical everywhere (who is calling, permissions, impersonation rules, the audit log) plus the pages nearly every project wants (users, audit log), with Foldkit and React UIs. The admin *app* stays the project's: its routes, layout, pages and permissions. See design.md, decision 1.
- **Products mount, they don't take over.** A product is a self-contained API, storage layers and pages that a project mounts under a prefix it chooses, behind the admin's auth. `users` and `audit` are the first two, built through the same contract Edgehog uses.
- **Better Auth's `/api/auth/admin/*` endpoints close** in projects that adopt the package, except stopping an impersonation. Every admin action goes through an audited endpoint. **BREAKING** for shumate-draughn-inc, whose admin calls them from the browser.
- **CLI support.** Config gains `auth`, an `admin` role on an app and a `modules` map; `init`, `sync`, `add`, `adopt` and `doctor` understand them. Configs without these keys keep their meaning.
- **Edgehog** (`shoemaker-edgehog`), a serverless PostHog and Sentry alternative that accepts their official SDKs: error tracking with grouped issues and alerts first, then analytics, then flags and experiments, then replay. Storage backends are swappable layers.
- **A second product**, an issue tracker, after which the code products share moves into its own package.
- **Two existing projects move over, and one gains an admin**: doc-convert-dev, shumate-draughn-inc and tech-interview-prep, through numbered steps in the changesets. A project moves over before the next phase starts.

Out of scope: admin pages generated from a Drizzle schema, native Edgehog SDKs and protocol, `sentry-cli` compatibility, and moving off Better Auth.

## Capabilities

### New Capabilities

- `admin-access`: who may use an admin endpoint: sessions, permissions, impersonation limits, closed auth endpoints, and granting the first admins.
- `admin-audit-log`: what every admin action records, and reading it back.
- `admin-user-management`: the user operations every project gets.
- `admin-app`: what the admin UI shows in each session state, and how a project adds its own pages, columns and panels.
- `product-composition`: how a product mounts in a project: prefix, auth, permissions, tables, navigation, links, and storage choice.
- `product-generation`: the CLI's config, generated wiring, seeds, checks and adoption for admin and products.
- `telemetry-ingest`: accepting events from the official Sentry and PostHog SDKs.
- `telemetry-storage`: storing and querying events on swappable backends, and moving between them.
- `error-tracking`: grouping exceptions into issues, their lifecycle, alerts and source maps.
- `product-analytics`: trends, funnels, retention, and people with merged identities.
- `feature-flags`: flags and experiments, and evaluating them for the SDKs.
- `session-replay`: recording and playing back sessions, linked to errors.
- `issue-tracker`: work items people and agents act on, linked to error issues.

### Modified Capabilities

None: `openspec/specs` is empty.

## Impact

- **New packages**: `packages/admin`, `packages/edgehog`, `packages/issues`, released in the existing changesets `fixed` group. The names were free on npm on 2026-11-25.
- **CLI**: `config/schema.ts`, `generators/`, `adopt/infer.ts`, `doctor/`, `commands/add.ts`, `versions.ts`, e2e presets.
- **New pins**: the Better Auth family, `@alchemy.run/better-auth`, `@alchemy.run/domain`, `@effect/sql-d1`, SQLite drivers, and the PostHog and Sentry SDKs as test fixtures.
- **Other repos**: their changes happen in their own checkouts; `.external/` stays read-only. Their deploys are Ethan's to run.
- **Docs**: README gains a products section; this change replaces the standalone document as the brief.
