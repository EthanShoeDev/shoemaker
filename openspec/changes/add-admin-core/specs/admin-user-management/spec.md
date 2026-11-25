# Spec Delta

## Purpose

Gives every project the same audited user operations, while leaving what a user means to that project (plans, usage, RSVPs) to the project.

## ADDED Requirements

### Requirement: Admins can find users
Admins SHALL be able to list users newest first, page through them, and search by email.

#### Scenario: Search
- **WHEN** an admin searches for `ada`
- **THEN** only users whose email contains `ada` are listed, with the total number of matches

#### Scenario: Page limit
- **WHEN** a request asks for more users than the maximum page size
- **THEN** the page holds the maximum number

### Requirement: Admins can view a user
Admins SHALL be able to see a user's id, name, email, roles, ban status and reason, and creation time.

#### Scenario: Unknown user
- **WHEN** an admin opens a user id that does not exist
- **THEN** the response is 404

### Requirement: Admins can ban and unban
Admins SHALL be able to ban a user with a reason, which ends all of that user's sessions, and to unban them. They SHALL NOT be able to ban themselves.

#### Scenario: Ban ends sessions
- **WHEN** an admin bans a signed-in user
- **THEN** that user's next request is unauthenticated

#### Scenario: Banning yourself
- **WHEN** an admin bans their own account
- **THEN** the response is 403 and the account is unchanged

### Requirement: Admins can impersonate users
Admins SHALL be able to sign in as a user for at most an hour. Impersonating another admin SHALL need a separate permission that the default admin role lacks.

#### Scenario: Impersonating a customer
- **WHEN** an admin impersonates a user
- **THEN** the browser is signed in as that user on the site and the admin subdomain

#### Scenario: Impersonating an admin
- **WHEN** an admin without the extra permission impersonates another admin
- **THEN** the response is 403
