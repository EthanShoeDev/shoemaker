---
'shoemaker-admin': patch
---

`shoemaker-admin`: the admin core. Access checks, the audit log, and listing,
viewing, banning and impersonating users, without UI. The package README
describes each piece.

To adopt it in a project that has its own admin API over Better Auth:

1. Move to Effect 4.1.5, Alchemy 2.0.0-beta.87 and Better Auth 1.7.15 or later:
   every pin, root `overrides` entry and version-named patch of their families.
   Make every check pass before changing anything else.
2. Add `shoemaker-admin` to the catalog, and to each package that imports it:
   the admin contract, the API, the admin app and the root, whose
   `alchemy.run.ts` uses `/alchemy` and `/sql`.
3. Replace the access file with `defineAccess` (README 1). Keep statement and
   role names. Drop what Better Auth and the products bring: the
   `defaultStatements` and `adminAc` spreads, and your `audit` statement. `can`
   and `requires` come from what `defineAccess` returns. List only permissions the public app checks and no admin endpoint
   needs on its own in `publicStatements`.
4. Replace Better Auth's `admin({ ac, roles, ... })` with `adminPlugin(access)`,
   and `auth.fetch` with `authHandler(auth)` at every place requests
   reach Better Auth (`/api/auth` and `/.well-known/oauth-*`), inside any throttling or OAuth rules (README 2). Delete the code that
   closed or audited its admin endpoints.
5. In your admin contract, delete the users (list, get, ban, unban, impersonate)
   and audit endpoints, and your own `AdminAuth`, `CurrentAdmin` and its actor
   schema, `RequiredPermissions`, `Forbidden` and `UserNotFound`; import the
   package's. Use the package's `Unauthorized` in the admin contract only: one
   that your public API also uses stays there. Write permissions with
   `access.requires(...)`, and annotate each remaining write with `Audited`,
   keeping its action name (README 4). Handlers that looked a user up through
   Better Auth read `UserDirectory`, taken
   where the group is built.
6. Serve your admin API with `adminApi`, mount `UsersLive` and `AuditLive` under
   the prefix the old endpoints had, and pass the admin's origins in from
   where the server is built: the deployed one, the ones `alchemy dev` serves
   the admin on, and the tests' (README 3). In handlers, replace the audit call with `AuditTrail`.
7. Add an endpoint of your own for the project data the users list and the user
   page showed (plan, usage), under its own permission and a path the products
   don't use, and join the two in those pages. `role` is now `roles`, a list.
   The admin app has a client for each API, decides by `access.can` and not by
   the name `admin`, and no longer takes every `Forbidden` for a lost session:
   banning yourself is one too.
8. Add `migrateHost` to the API Worker and `grantAdmins` to the stack (README
   5), remove your own promotion Action, and move its list to `ADMIN_EMAILS` in
   the remote secrets store, declared in `.env.schema`. Leave the old migration that made `admin_audit_log` where it is.
9. Remove the old middleware, the audit half of the old store (its other
   queries stay), and the tests of both. Test databases also run
   `runMigrations(adminMigrations)`, and tests that write to the admin API send
   a listed `Origin`. Update the project's own docs.

What changes in behavior:

- A write needs a listed origin, and one without an `Origin` is refused.
- Promotion keeps an account's other roles.
- Users and project data load separately.
- The audit cursor is `cursor`, opaque, and no longer skips entries that share a
  timestamp.
- Stopping an impersonation records the admin's email too.
- Banning needs no reason, banning or impersonating yourself is 403, and a
  banned user can't be impersonated.
- Banning an admin also ends the sessions they started by impersonation.
- Unbanning a user who is not banned leaves no entry.
- An impersonation never outlives its hour.

Rolling back is reverting the commit: the audit table keeps its old columns, and
old code reads and writes it.
