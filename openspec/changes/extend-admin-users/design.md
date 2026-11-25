# Design

## Context

See proposal.md for motivation, and `add-admin-core`'s design for the access core, ports and package layout this builds on.

Checked in Better Auth 1.7.15: `set-role` lets you change your own role. The React project's pages list, ban, unban, impersonate, set roles, invite, send password links and delete; none of them ends a user's sessions, so that operation stays on the roadmap. They invite with a name and a role and mark the email verified, ban without a reason, and list 200 users where the API's page holds at most 100.

Resetting a password does not verify the email, so where sign-in requires a verified one, an account invited unverified would be sent a second email at its first sign-in.

## Goals / Non-Goals

**Goals:** every user action the React project offers today, through the core.

**Non-Goals:** new pages; the project's own endpoints beyond what mounting the core needs.

## Decisions

### 1. Optional operations are declared by the project

Inviting and password links need passwords, and a project with emailed links has none. The host lists what it supports where it mounts the users product; the server refuses the rest, and the API tells a client what is supported, so one page works in both. Deleting is declared too, since some projects keep their users. The role, ban and impersonation operations are never optional. The mailer is a port of its own, so declaring a link without one fails typecheck, and whether a link could work is checked before an invite creates anything.

*Alternative.* Inferring support from Better Auth's options: the mailer and the password page are the project's, so the options alone don't say whether the link leads anywhere.

### 2. The core adds what Better Auth lacks

Own-role changes are refused in the core, not in the Better Auth adapter, so another directory gets the same rule. Roles are checked against `defineAccess`, since Better Auth's list is not the project's.

`user:set-role` is full trust, as in Better Auth: it can give more than its holder has. Changing roles, banning and deleting end the impersonations as that user and by them, and an impersonation is checked again after it starts, so none outlives a decision made meanwhile.

### 3. Inviting keeps what the page does today

An invite carries a name and roles. Giving any role but the default needs the permission to set roles as well as to invite, as in Better Auth. The account is created with its email verified, because only a link sent to that address can give it a password. The project supplies where the links land, since an invite and a reset land on different pages.

Better Auth sends mail in the background and swallows failures, so the mailer is observed, on the final options, for links the core asked for. Only the kind of a failure is logged, since a mailer's message may hold the link in any encoding.

### 4. Pages and closing land in one commit

The page moves from Better Auth's client to the users client in the commit that mounts the wrapper. The wrapper alone would break the page. This is the only breaking step in the plan, so it is its own change and can be reverted as one commit.

## Risks / Trade-offs

- [Something else in the React project calls a closed endpoint] → Search every `/api/auth/admin` and `admin.` client call, mobile app included, before mounting; stopping an impersonation stays open.
- [Upgrading pins and adopting at once hides the cause of a failure] → Pins go first, in their own commit.

- [No transaction around deleting, as D1 has none] → If the user survives, their sign-in is put back and the outcome is logged; a crash between the two loses it.
- [A mailer that fails late may have delivered] → `LinkNotSent`, no entry, and a log line that names who asked.

## Open question

With Better Auth's cookie cache on, which the React project has, a banned user's public requests pass until it expires (5 minutes), and `admin-user-management` "Ban ends sessions" does not hold there. Either the project turns the cache off, at the price of a read per request, or the scenario is limited to what reads the database. Decide before 2.3.

## Migration Plan

1. React project: upgrade pins; add the package and `access.ts`, mount, switch the users page and close the endpoints in one commit; move `ADMIN_EMAILS` to the remote secrets store.
2. The migrations create the audit table if there is none.
3. Rollback: revert that commit. Roles stay compatible.
