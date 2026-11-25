# Spec Delta

## Purpose

Decides who may use an admin endpoint, so every project and product enforces the same session, permission and impersonation rules.

## ADDED Requirements

### Requirement: Admin endpoints require a current session
An admin endpoint SHALL refuse a request without a valid session or agent key, and SHALL check the caller and its roles against the database rather than any cache.

<!-- step 1 -->

#### Scenario: No session
- **WHEN** a visitor calls an admin endpoint without signing in
- **THEN** the response is 401

#### Scenario: Role removed moments ago
- **WHEN** an admin's role is removed and they call an admin endpoint while a cached session still shows the role
- **THEN** the response is 403

#### Scenario: Banned admin
- **WHEN** an admin is banned and calls an admin endpoint with their old session
- **THEN** the response is 401

### Requirement: Every transport enforces the same rules
Access and audit rules SHALL give the same result for the same caller and action whether the call arrives over HTTP, RPC, MCP or the CLI.

<!-- step 6 -->

#### Scenario: Refused everywhere
- **WHEN** a caller lacks the permission to resolve an issue
- **THEN** the admin page, the RPC call, the MCP tool and the CLI command are all refused

#### Scenario: Undeclared RPC call
- **WHEN** a product serves an RPC call that declares no permissions
- **THEN** every caller is refused

### Requirement: Endpoints declare the permissions they need
An admin endpoint SHALL run only when one of the caller's roles grants every permission the endpoint declares. A user's roles are a comma-separated list, and surrounding spaces are ignored.

<!-- step 1 -->

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

<!-- step 1 -->

#### Scenario: Forgotten declaration
- **WHEN** an admin calls an endpoint that declares no permissions
- **THEN** the response is 403

### Requirement: Permissions combine from the project and its products
A project SHALL be able to add its own permissions and roles to those of Better Auth and of each installed product. The server SHALL fail to start when a mounted endpoint needs a permission the project never defined.

<!-- step 1 -->

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

<!-- step 1 -->

#### Scenario: Admin impersonating a customer
- **WHEN** an admin impersonates a user and then calls an admin endpoint
- **THEN** the response is 403 and the message says to stop impersonating

### Requirement: Better Auth's admin endpoints are closed
The server SHALL answer 404 to every Better Auth admin endpoint except the one that stops an impersonation, so no admin action can skip permission checks and the audit log.

<!-- step 1 -->

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

<!-- step 1 -->

#### Scenario: Project blocks a purchase
- **WHEN** a project marks its checkout endpoint as unavailable while impersonating and an impersonated session calls it
- **THEN** the project can refuse the request with its own error

### Requirement: Listed accounts become admins on deploy
A deploy SHALL give the admin role to every account whose email is in the `ADMIN_EMAILS` environment value, keeping the account's other roles. Emails match without regard to letter case.

<!-- step 1 -->

#### Scenario: Account with another role
- **WHEN** a listed account holds the role `host`
- **THEN** after the deploy it holds both `host` and `admin`

#### Scenario: Email with no account
- **WHEN** a listed email has no account
- **THEN** the deploy fails and names the email, and the other listed accounts are still granted the role

#### Scenario: Nobody listed
- **WHEN** `ADMIN_EMAILS` is empty
- **THEN** the deploy succeeds and no roles change

### Requirement: A ban stops every credential
Banning a user SHALL refuse their sessions, keys and tokens from the next request, and unbanning SHALL NOT bring back a credential that was revoked.

<!-- step 6 -->

#### Scenario: Key after a ban
- **WHEN** a user with an agent key is banned and the key is used
- **THEN** the response is 401

#### Scenario: Token after a ban
- **WHEN** a user with an OAuth access token is banned before it expires
- **THEN** the next request with the token is refused

### Requirement: Agents sign in with a user's key
An agent SHALL be able to act through a key that belongs to one user, sent the same way over MCP and the CLI. A shared key that belongs to nobody SHALL NOT exist.

<!-- step 6 -->

#### Scenario: Agent calls a tool
- **WHEN** an agent sends a valid key to the MCP endpoint
- **THEN** it acts as the key's owner

#### Scenario: Key on an ordinary page
- **WHEN** a key is sent where only a browser session is expected
- **THEN** it is refused

### Requirement: A key never exceeds its owner
A key SHALL allow only what both its own permissions and its owner's current roles allow, checked on every request.

<!-- step 6 -->

#### Scenario: Owner loses a role
- **WHEN** the owner loses the role that grants an action the key lists
- **THEN** the key's next attempt at that action is refused

#### Scenario: Narrow key
- **WHEN** an admin's key lists only reading issues
- **THEN** it cannot resolve one

### Requirement: Some actions need a person
Impersonating, changing roles, managing users and creating or changing keys SHALL be refused for every key. An impersonated session SHALL NOT be able to create a key.

<!-- step 6 -->

#### Scenario: Key with the permission
- **WHEN** a key whose owner may ban users tries to ban one
- **THEN** it is refused

#### Scenario: Key created while impersonating
- **WHEN** an impersonated session tries to create a key
- **THEN** it is refused

### Requirement: Keys are short-lived secrets
A key SHALL expire, SHALL be shown only when created, SHALL be revocable at once by its owner or an admin, and SHALL be deleted with its owner. Credentials SHALL NOT appear in logs, traces or audit entries.

<!-- step 6 -->

#### Scenario: Reading a key again
- **WHEN** its owner lists their keys
- **THEN** each shows its name, permissions and expiry, and not the key

#### Scenario: Request trace
- **WHEN** a request with a key is traced
- **THEN** the trace does not contain the key

### Requirement: An agent's name is only a label
An agent SHALL be able to send a name for itself, which is recorded beside the owner and grants nothing. A missing variable, an empty name or an invalid one SHALL be refused.

<!-- step 6 -->

#### Scenario: Named agent
- **WHEN** an agent named `fixer` acts with a user's key
- **THEN** the record shows the user, and `fixer` as the agent

#### Scenario: Unset variable
- **WHEN** a client sends the literal text of an unset variable as the name
- **THEN** the request is refused

### Requirement: MCP clients can sign in through the browser
An MCP client SHALL be able to obtain a user's consent through OAuth instead of using a key, under the same limits as a key.

<!-- step 13 -->

#### Scenario: Connecting
- **WHEN** a client without credentials calls the MCP endpoint
- **THEN** the response tells it where to ask for consent

#### Scenario: Consent while impersonating
- **WHEN** an impersonated session is asked for consent
- **THEN** it is refused

### Requirement: Products depend on admin access, not on Better Auth
A product SHALL get the caller and its permissions only through the admin access contract, so the auth provider can be replaced without changing any product.

<!-- step 1 -->

#### Scenario: Replacing the provider
- **WHEN** a test provides an in-memory session source instead of Better Auth
- **THEN** every product's endpoints enforce the same rules
