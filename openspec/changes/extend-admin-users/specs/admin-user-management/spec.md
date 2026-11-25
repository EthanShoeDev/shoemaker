# Spec Delta

## ADDED Requirements

### Requirement: Admins can set roles
Admins SHALL be able to replace a user's roles with a set of roles the project defines. They SHALL NOT be able to change their own roles.

#### Scenario: Several roles
- **WHEN** an admin sets a user's roles to `host` and `admin`
- **THEN** the user holds both

#### Scenario: Unknown role
- **WHEN** an admin sets a role the project does not define
- **THEN** the request is refused and the user's roles are unchanged

#### Scenario: Own roles
- **WHEN** an admin changes the roles of their own account
- **THEN** the response is 403

### Requirement: Admins can invite users
Admins SHALL be able to create an account without a password and email its owner a link to choose one, where the project supports passwords.

#### Scenario: Invite
- **WHEN** an admin invites a new email address
- **THEN** the account exists, and only the emailed link can set its password

#### Scenario: Email already registered
- **WHEN** an admin invites an email that already has an account
- **THEN** the request is refused and no email is sent

### Requirement: Admins can send a password link
Admins SHALL be able to email a user a link to set a new password, where the project supports passwords. The link SHALL never appear in a response.

#### Scenario: Link sent
- **WHEN** an admin sends a password link
- **THEN** the user receives it and the response contains no link or token

### Requirement: Admins can delete users
Admins SHALL be able to permanently delete a user after confirming. They SHALL NOT be able to delete themselves.

#### Scenario: Delete
- **WHEN** an admin confirms deleting a user
- **THEN** the account and its sessions are gone and the audit log keeps the user's id

#### Scenario: Deleting yourself
- **WHEN** an admin deletes their own account
- **THEN** the response is 403

### Requirement: Unsupported operations are absent
A project SHALL declare which optional operations it supports. An operation it does not support SHALL be refused by the server, and a client SHALL be able to find out that it is not supported.

#### Scenario: No passwords
- **WHEN** a project signs users in only with GitHub
- **THEN** inviting and password links are refused, and the project's pages can tell not to offer them
