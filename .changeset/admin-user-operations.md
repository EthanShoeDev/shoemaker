---
'shoemaker-admin': patch
---

Admins can set a user's roles, invite users, email password links and delete
users. The last three are optional: a project declares the ones it supports
(package README, "Optional operations").

To adopt the package in a project whose users page calls Better Auth's admin
endpoints from the browser, first do steps 1 to 3 of the changeset that
introduced `shoemaker-admin`; Better Auth's client plugin takes `ac` and `roles`
from `access` until step 5 removes it. Then, **in one commit, because it breaks such a
page on its own**:

1. Find every caller of a Better Auth admin endpoint: search for
   `/api/auth/admin`, `'/admin/` and `admin.` on every auth client, mobile apps
   and tests included. List them in the commit message.
2. Do the remaining steps of that changeset, so `authHandler` closes those
   endpoints. Build the layers where the Better Auth instance is made, if your
   own auth service hides it; a schema-generating script shares `adminPlugin`.
   Better Auth may stay on Drizzle, while the audit log takes a `SqlClient`.
   Stopping an impersonation stays open where it is.
3. Set Better Auth's `baseURL`, in development too, and make
   `sendResetPassword` reject when sending fails. Put the origins of the pages that links land on
   in `trustedOrigins`, and add `passwordLinksLayer(auth)`.
4. Mount `usersLive({ invite, passwordLink, delete })` with what the project
   supports, and `linkTo` each landing page.
5. Move the page to the users client: `listUsers`, `createUser`, `setRole`,
   `banUser`, `unbanUser`, `impersonateUser` and `removeUser` of Better Auth's
   client, and any `requestPasswordReset` it calls for another user.
6. Page through users, 100 at most per request. `roles` is a list, and
   `setRoles` takes the whole of it, so adding one sends the others too.
7. Show an invite's `linkSent: false` as "send a password link". Hide the
   actions on the admin's own row, and offer what `users.operations` names.
8. Give every test client that writes a listed `Origin`, and move tests that
   call closed endpoints to the users API.

What changes in behavior: every action is audited and needs its permission;
changing roles ends impersonations as and by that user; `setRoles` refuses your
own account and roles the project does not define.
