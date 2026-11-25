# Spec Delta

## Purpose

Gives every project the same audited user operations, while leaving what a user means to that project (plans, usage, RSVPs) to the project.

## ADDED Requirements

### Requirement: Admins can find users
Admins SHALL be able to list users newest first, page through them, and search by email.

<!-- step 1 -->

#### Scenario: Search
- **WHEN** an admin searches for `ada`
- **THEN** only users whose email contains `ada` are listed, with the total number of matches

#### Scenario: Page limit
- **WHEN** a request asks for more users than the maximum page size
- **THEN** the page holds the maximum number

### Requirement: Admins can view a user
Admins SHALL be able to see a user's id, name, email, roles, ban status and reason, and creation time.

<!-- step 1 -->

#### Scenario: Unknown user
- **WHEN** an admin opens a user id that does not exist
- **THEN** the response is 404

### Requirement: Admins can ban and unban
Admins SHALL be able to ban a user with a reason, which ends all of that user's sessions, and to unban them. They SHALL NOT be able to ban themselves.

<!-- step 1 -->

#### Scenario: Ban ends sessions
- **WHEN** an admin bans a signed-in user
- **THEN** that user's next request is unauthenticated

#### Scenario: Banning yourself
- **WHEN** an admin bans their own account
- **THEN** the response is 403 and the account is unchanged

### Requirement: Admins can set roles
Admins SHALL be able to replace a user's roles with a set of roles the project defines. They SHALL NOT be able to change their own roles.

<!-- step 1 -->

#### Scenario: Several roles
- **WHEN** an admin sets a user's roles to `host` and `admin`
- **THEN** the user holds both

#### Scenario: Unknown role
- **WHEN** an admin sets a role the project does not define
- **THEN** the request is refused and the user's roles are unchanged

#### Scenario: Own roles
- **WHEN** an admin changes the roles of their own account
- **THEN** the response is 403

### Requirement: Admins can end a user's sessions
Admins SHALL be able to end every session of a user, which also ends the OAuth grants made in that user's name.

<!-- step 1 -->

#### Scenario: Sessions ended
- **WHEN** an admin ends a user's sessions
- **THEN** that user is signed out everywhere and can sign in again

#### Scenario: Unknown user
- **WHEN** an admin ends the sessions of a user id that does not exist
- **THEN** the response is 404

### Requirement: Admins can impersonate users
Admins SHALL be able to sign in as a user for at most an hour. Impersonating another admin SHALL need a separate permission that the default admin role lacks.

<!-- step 1 -->

#### Scenario: Impersonating a customer
- **WHEN** an admin impersonates a user
- **THEN** the browser is signed in as that user on the site and the admin subdomain

#### Scenario: Impersonating an admin
- **WHEN** an admin without the extra permission impersonates another admin
- **THEN** the response is 403

### Requirement: Admins can invite users
Admins SHALL be able to create an account without a password and email its owner a link to choose one, where the project supports passwords.

<!-- step 1 -->

#### Scenario: Invite
- **WHEN** an admin invites a new email address
- **THEN** the account exists, and only the emailed link can set its password

#### Scenario: Email already registered
- **WHEN** an admin invites an email that already has an account
- **THEN** the request is refused and no email is sent

### Requirement: Admins can send a password link
Admins SHALL be able to email a user a link to set a new password, where the project supports passwords. The link SHALL never appear in a response.

<!-- step 1 -->

#### Scenario: Link sent
- **WHEN** an admin sends a password link
- **THEN** the user receives it and the response contains no link or token

### Requirement: Admins can delete users
Admins SHALL be able to permanently delete a user after confirming. They SHALL NOT be able to delete themselves.

<!-- step 1 -->

#### Scenario: Delete
- **WHEN** an admin confirms deleting a user
- **THEN** the account and its sessions are gone and the audit log keeps the user's id

#### Scenario: Deleting yourself
- **WHEN** an admin deletes their own account
- **THEN** the response is 403

### Requirement: Unsupported operations are absent
A project SHALL declare which optional operations it supports. An operation it does not support SHALL be refused by the server and hidden in the UI.

<!-- step 1 -->

#### Scenario: No passwords
- **WHEN** a project signs users in only with GitHub
- **THEN** inviting and password links are refused and no page offers them

### Requirement: Project data about users stays in the project
The package's user endpoints SHALL return only account data. A project SHALL be able to show its own data beside it from its own endpoints, under its own permissions.

<!-- step 4 -->

#### Scenario: Plan column
- **WHEN** a project adds a plan column from its billing endpoint
- **THEN** the users page shows each user's plan

#### Scenario: Admin without the project's permission
- **WHEN** an admin may list users but not read billing
- **THEN** the users page works and the plan column is absent
