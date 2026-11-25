# Spec Delta

## Purpose

Keeps a record of every admin action in every project, so it is always possible to see who did what to whom.

## ADDED Requirements

### Requirement: Every admin write is recorded
A successful admin request that changes something SHALL leave exactly one audit entry with the actor's id and email, the action, the target, an optional detail and the time.

#### Scenario: Banning a user
- **WHEN** an admin bans a user with the reason "Abuse"
- **THEN** one entry records the admin, `user.ban`, the user's id, "Abuse" and the time

#### Scenario: Target that is not a user
- **WHEN** an admin action changes something other than a user
- **THEN** the entry names the kind of target and its id

#### Scenario: Nothing changed
- **WHEN** an admin request succeeds without changing anything
- **THEN** no entry is written

#### Scenario: Refused request
- **WHEN** an admin request is refused or fails
- **THEN** no entry is written

#### Scenario: Project action
- **WHEN** a project's own admin endpoint grants a customer credit and adds a detail
- **THEN** the entry carries the project's action name and that detail

### Requirement: Writes must name their action
An admin endpoint whose method is not GET or HEAD SHALL declare the action it records or be marked as a read, and one that does neither SHALL be refused.

#### Scenario: Forgotten action
- **WHEN** a project adds a POST admin endpoint with no declared action and an admin calls it
- **THEN** the response is 403 and nothing changes

#### Scenario: Query by POST
- **WHEN** an endpoint marked as a read is called with POST
- **THEN** it runs and no entry is written

### Requirement: A missing audit entry is never silent
A request whose action happened but whose audit entry could not be written SHALL NOT report success, and SHALL log the failure with the actor, action and target.

#### Scenario: Audit store is down
- **WHEN** a ban succeeds and writing its entry fails
- **THEN** the response is a server error and the log holds the actor, action and target

### Requirement: Stopping an impersonation is recorded
Stopping an impersonation SHALL record the admin who was impersonating as the actor and the impersonated user as the target.

#### Scenario: Admin stops impersonating
- **WHEN** an admin who impersonated a user stops
- **THEN** the log holds `user.impersonate` and then `user.stop-impersonating` for the same admin and user

### Requirement: The log can be read page by page
Admins with the audit permission SHALL be able to read entries newest first, a page at a time, without entries being skipped or repeated.

#### Scenario: Entries with the same time
- **WHEN** several entries share one timestamp across a page boundary
- **THEN** reading every page returns each entry exactly once

#### Scenario: Without permission
- **WHEN** an admin whose roles do not include the audit permission reads the log
- **THEN** the response is 403

### Requirement: Existing audit entries survive adoption
Adopting the package in a project that already has an `admin_audit_log` table with the expected columns SHALL keep its entries readable.

#### Scenario: Existing table
- **WHEN** the package's migrations run on a database with existing audit rows
- **THEN** reading the log returns the old rows alongside new ones, with users as their targets

#### Scenario: Rollback
- **WHEN** the project returns to its earlier code after adopting the package
- **THEN** that code still reads and writes the table
