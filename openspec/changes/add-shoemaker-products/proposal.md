# Proposal

## Why

Every project needs an admin panel, feature flags, error tracking and analytics. Today the admin is copied from project to project, where copies drift apart, and the rest is missing or rented. Self-hosting the usual tools means dozens of always-on containers (Sentry's errors-only profile alone asks for 7 GB of memory); on Cloudflare an embedded product costs close to nothing at low volume.

## What Changes

Work ships in steps, each used by a real project before the next begins. Spec requirements carry a `step` comment naming the step that fully delivers them; parts may arrive earlier.

- **Admin core first, without UI.** A new `shoemaker-admin` package holds what must be identical everywhere: who is calling, permissions, impersonation limits, the audit log and user management. Existing admins adopt it under the pages they have. Shared Foldkit and React pages come later, and the admin *app* always stays the project's.
- **Better Auth's `/api/auth/admin/*` endpoints close** in projects that adopt the package, except stopping an impersonation. **BREAKING** for an admin whose pages call them directly.
- **Feature flags second**, built on OpenFeature: evaluated locally on servers first, remotely for browsers and mobile later.
- **Error tracking third**, for servers first, from the official Sentry SDK; then browsers and mobile.
- **CLI support after the wiring is proven by hand**: config gains `auth`, an `admin` role on an app and a `modules` map; `init`, `sync`, `add`, `adopt` and `doctor` understand them. Configs without these keys keep their meaning.
- **Agents** act through MCP and a CLI, with keys that belong to a user.
- **Then** analytics from the official PostHog SDKs, experiments, replay, larger storage backends, and an issue tracker as the second product, after which shared code moves to its own package.

Flags and telemetry form one product, Edgehog (`shoemaker-edgehog`). Out of scope: admin pages generated from a Drizzle schema, native Edgehog SDKs, PostHog local evaluation, native crash dumps, performance tracing, and moving off Better Auth.

## Capabilities

### New Capabilities

- `admin-access`: who may use an admin endpoint: sessions, agent keys, permissions, impersonation limits, closed auth endpoints, and granting the first admins.
- `admin-audit-log`: what every admin action records, and reading it back.
- `admin-user-management`: the user operations every project gets.
- `admin-app`: what the admin UI shows in each session state, and how a project adds its own pages, columns and panels.
- `product-composition`: how a product mounts in a project: prefix, auth, permissions, tables, navigation, links, and storage choice.
- `product-generation`: the CLI's config, generated wiring, seeds, checks and adoption for admin and products.
- `feature-flags`: typed flags on OpenFeature, evaluated locally and remotely, with exposures and experiments.
- `telemetry-ingest`: accepting events from the official Sentry and PostHog SDKs.
- `telemetry-storage`: storing and querying events on swappable backends, and moving between them.
- `error-tracking`: grouping exceptions into issues, their lifecycle, alerts and source maps.
- `product-analytics`: trends, funnels, retention, and people with merged identities.
- `session-replay`: recording and playing back sessions, linked to errors.
- `issue-tracker`: work items people and agents act on, linked to error issues.

### Modified Capabilities

None: `openspec/specs` is empty.

## Impact

- **New packages**: `packages/admin`, `packages/edgehog`, `packages/issues`, released in the existing changesets `fixed` group. The names were free on npm on 2026-11-25.
- **CLI**: `config/schema.ts`, `generators/`, `adopt/infer.ts`, `doctor/`, `commands/add.ts`, `versions.ts`, e2e presets.
- **New pins**: the Better Auth family, `@alchemy.run/better-auth`, `@alchemy.run/domain`, `@effect/sql-d1`, SQLite drivers, the OpenFeature SDKs, and the PostHog and Sentry SDKs as test fixtures.
- **Standards**: the [OpenFeature specification](https://github.com/open-feature/spec), its provider conformance suite and the [OpenFeature Remote Evaluation Protocol](https://github.com/open-feature/protocol), each pinned.
- **Prior art**: [Alchemy Git](https://alchemy.run/git/) for how a product embeds, and Alchemy's [Board](https://github.com/alchemy-run/alchemy/pull/3506) and [`cloudflare-ai-issues`](https://github.com/alchemy-run/alchemy/tree/main/examples/cloudflare-ai-issues) for the issue tracker. design.md lists every source.
- **Licences**: reused MIT and Apache-2.0 material is listed in a notices file. Nothing is copied from Sentry or Relay (design.md, decision 16).
- **Other repos**: their changes happen in their own checkouts; `.external/` stays read-only. Their deploys are Ethan's to run.
- **Docs**: README gains a products section.
