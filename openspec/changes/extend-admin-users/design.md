# Design

## Context

See proposal.md for motivation, and `add-admin-core`'s design for the access core, ports and package layout this builds on.

Checked in Better Auth 1.7.15: `set-role` lets you change your own role. The React project's pages list, ban, unban, impersonate, set roles, invite, send password links and delete; none of them ends a user's sessions, so that operation stays on the roadmap.

## Goals / Non-Goals

**Goals:** every user action the React project offers today, through the core.

**Non-Goals:** new pages; the project's own endpoints beyond what mounting the core needs.

## Decisions

### 1. Optional operations are declared by the project

Inviting and password links need passwords, and a project with emailed links has none. The host lists what it supports where it mounts the users product; the server refuses the rest, and the API tells a client what is supported, so one page works in both. The role, ban and impersonation operations are never optional.

*Alternative.* Inferring support from Better Auth's options: the mailer and the password page are the project's, so the options alone don't say whether the link leads anywhere.

### 2. The core adds what Better Auth lacks

Own-role changes are refused in the core, not in the Better Auth adapter, so another directory gets the same rule. Roles are checked against `defineAccess`, since Better Auth's list is not the project's.

### 3. Pages and closing land in one commit

The page moves from Better Auth's client to the users client in the commit that mounts the wrapper. The wrapper alone would break the page. This is the only breaking step in the plan, so it is its own change and can be reverted as one commit.

## Risks / Trade-offs

- [Something else in the React project calls a closed endpoint] → Search every `/api/auth/admin` and `admin.` client call, mobile app included, before mounting; stopping an impersonation stays open.
- [Upgrading pins and adopting at once hides the cause of a failure] → Pins go first, in their own commit.

## Migration Plan

1. React project: upgrade pins; add the package and `access.ts`, mount, switch the users page and close the endpoints in one commit; move `ADMIN_EMAILS` to the remote secrets store.
2. The migrations create the audit table if there is none.
3. Rollback: revert that commit. Roles stay compatible.
