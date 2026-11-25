# Proposal

## Why

Every project needs an admin panel. Today the admin is copied from project to project, where copies drift apart, and what drifts is the checks. A shared core keeps access, audit and user operations identical everywhere, and is the base that error tracking and feature flags mount on.

First of the changes in `openspec/ROADMAP.md`.

## What Changes

- A new `shoemaker-admin` package, without UI, holds what must be the same everywhere: who is calling, permissions, impersonation limits, the audit log, and listing, viewing, banning and impersonating users.
- A way for a product to ship its own API and tables and mount in a host under any prefix. The users and audit APIs are the first two products.
- A wrapper that closes Better Auth's `/api/auth/admin/*` endpoints, except stopping an impersonation.
- The Foldkit project adopts it under the pages it has. Nothing breaks there, since its pages already use an admin API.

Not in this change: roles, invites, password links and deleting users, and adoption by the React project (`extend-admin-users`); shared pages, generators, agent keys (roadmap).

## Capabilities

### New Capabilities

- `admin-access`: who may use an admin endpoint: sessions, permissions, impersonation limits, closed auth endpoints, and granting the first admins.
- `admin-audit-log`: what every admin action records, and reading it back.
- `admin-user-management`: the user operations every project gets.
- `product-composition`: how a product mounts in a project: prefix, auth, permissions, tables, description, and storage choice.

### Modified Capabilities

None: `openspec/specs` is empty.

## Impact

- **New package**: `packages/admin`, in a changesets `fixed` group of its own, so a product patch does not bump the CLI. The name was free on npm on 2026-11-25.
- **CLI**: untouched. Its `shoemakerFamily` list and `shoemaker-versions` check do not cover products.
- **New pins**: the Better Auth family, `@alchemy.run/better-auth`, `@effect/sql-d1`, `@effect/sql-pglite`, a SQLite driver.
- **Other repos**: their changes happen in their own checkouts; `.external/` stays read-only. Their deploys are Ethan's to run.
- **Docs**: README gains a products section.
