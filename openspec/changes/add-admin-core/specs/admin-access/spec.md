# Spec Delta

## Purpose

Decides who may use an admin endpoint, so every project and product enforces the same session, permission and impersonation rules.

## ADDED Requirements

### Requirement: Admin endpoints require a current session
An admin endpoint SHALL refuse a request without a valid session, and SHALL check the caller and its roles against the database rather than any cache.

#### Scenario: No session
- **WHEN** a visitor calls an admin endpoint without signing in
- **THEN** the response is 401

#### Scenario: Role removed moments ago
- **WHEN** an admin's role is removed and they call an admin endpoint while a cached session still shows the role
- **THEN** the response is 403

#### Scenario: Banned admin
- **WHEN** an admin is banned and calls an admin endpoint with their old session
- **THEN** the response is 401

### Requirement: Endpoints declare the permissions they need
An admin endpoint SHALL run only when one of the caller's roles grants every permission the endpoint declares. A user's roles are a comma-separated list, and surrounding spaces are ignored.

#### Scenario: Role grants the permission
- **WHEN** a caller with roles `host, admin` calls an endpoint that the `admin` role covers
- **THEN** the endpoint runs

#### Scenario: Permissions split across roles
- **WHEN** an endpoint needs two permissions and each of the caller's two roles grants only one of them
- **THEN** the response is 403

#### Scenario: Ordinary user
- **WHEN** a signed-in user with no admin role calls an admin endpoint
- **THEN** the response is 403

### Requirement: Undeclared endpoints are refused
An admin endpoint that declares no permissions SHALL be refused for every caller.

#### Scenario: Forgotten declaration
- **WHEN** an admin calls an endpoint that declares no permissions
- **THEN** the response is 403

### Requirement: Permissions combine from the project and its products
A project SHALL be able to add its own permissions and roles to those of Better Auth and of each installed product. The server SHALL fail to start when a mounted endpoint needs a permission the project never defined.

#### Scenario: Project permission
- **WHEN** a project defines `billing: ['grant']`, grants it to a `support` role and tags an endpoint with it
- **THEN** a `support` user can call that endpoint and no other admin endpoint

#### Scenario: Product mounted without its permissions
- **WHEN** a project mounts a product whose permissions are missing from its access rules
- **THEN** startup fails with a message naming the product and the missing permission

#### Scenario: Default admin role
- **WHEN** a project installs a product and defines no roles of its own for it
- **THEN** the `admin` role grants all of the product's permissions

### Requirement: Impersonated sessions cannot use admin endpoints
An admin endpoint SHALL refuse a session that was started by impersonation, whatever roles the impersonated user holds.

#### Scenario: Admin impersonating a customer
- **WHEN** an admin impersonates a user and then calls an admin endpoint
- **THEN** the response is 403 and the message says to stop impersonating

### Requirement: Better Auth's admin endpoints are closed
A server that adopts the package SHALL answer 404 to every Better Auth admin endpoint except the one that stops an impersonation, so no admin action can skip permission checks and the audit log.

#### Scenario: Direct call
- **WHEN** an admin posts to `/api/auth/admin/ban-user`
- **THEN** the response is 404 and the user is not banned

#### Scenario: Unusual spelling of the path
- **WHEN** a request reaches an admin endpoint through repeated slashes, percent-encoding or different letter case
- **THEN** the response is 404 or the request reaches no Better Auth endpoint

#### Scenario: Stopping an impersonation
- **WHEN** an impersonated session posts to the stop-impersonating endpoint
- **THEN** the admin's own session is restored

### Requirement: Projects can tell when a request is impersonated
The package SHALL let a project's own endpoints find out that a request comes from an impersonated session, so the project can restrict them.

#### Scenario: Project blocks a purchase
- **WHEN** a project marks its checkout endpoint as unavailable while impersonating and an impersonated session calls it
- **THEN** the project can refuse the request with its own error

### Requirement: Listed accounts become admins on deploy
A deploy SHALL give the admin role to every account whose email is in the `ADMIN_EMAILS` environment value, keeping the account's other roles. Emails match without regard to letter case.

#### Scenario: Account with another role
- **WHEN** a listed account holds the role `host`
- **THEN** after the deploy it holds both `host` and `admin`

#### Scenario: Email with no account
- **WHEN** a listed email has no account
- **THEN** the deploy fails and names the email, and the other listed accounts are still granted the role

#### Scenario: Nobody listed
- **WHEN** `ADMIN_EMAILS` is empty
- **THEN** the deploy succeeds and no roles change

### Requirement: Products depend on admin access, not on Better Auth
A product SHALL get the caller and its permissions only through the admin access contract, so the auth provider can be replaced without changing any product.

#### Scenario: Replacing the provider
- **WHEN** a test provides an in-memory session source instead of Better Auth
- **THEN** every product's endpoints enforce the same rules
