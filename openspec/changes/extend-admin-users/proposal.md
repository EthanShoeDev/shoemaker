# Proposal

## Why

`shoemaker-admin` covers the Foldkit project's user operations. The React project's admin also sets roles, invites users, sends password links and deletes users. With those in the core, it can adopt the package too.

Needs `add-admin-core` archived first. Later changes are in `openspec/ROADMAP.md`.

## What Changes

- The users API gains setting roles, inviting, sending a password link and deleting, each with a permission and an audit entry.
- A project declares which optional operations it supports; the others are refused.
- The React project adopts the core.
- **BREAKING** for the React project's users page: it moves to the users API in the commit that mounts the core's Better Auth wrapper, which closes `/api/auth/admin/*`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `admin-user-management`: adds roles, invites, password links, deletion and optional operations. `add-admin-core` creates it.

## Impact

- **Package**: `packages/admin`, the users contract, handlers and the Better Auth directory.
- **Other repos**: the React project's API and users page, in its own checkout. Its deploy is Ethan's to run.
