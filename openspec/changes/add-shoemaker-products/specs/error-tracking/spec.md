# Spec Delta

## Purpose

Turns exceptions into issues people and agents can triage, resolve and be alerted about.

## ADDED Requirements

### Requirement: Exceptions group into issues
Exceptions with the same project and fingerprint SHALL belong to one issue, and a fingerprint set by the SDK SHALL win over the computed one.

#### Scenario: Same error twice
- **WHEN** the same error is thrown from the same place by two users
- **THEN** there is one issue with two occurrences

#### Scenario: Custom fingerprint
- **WHEN** the SDK sets a fingerprint on two different errors
- **THEN** they share one issue

### Requirement: Issues have a lifecycle
An issue SHALL be new when first seen, open once triaged, and resolved when resolved. A new occurrence of a resolved issue SHALL reopen it as a regression.

#### Scenario: Regression
- **WHEN** a resolved issue occurs again
- **THEN** it is open and marked as regressed

#### Scenario: Resolving twice
- **WHEN** a resolved issue is resolved again
- **THEN** nothing changes and no event is recorded

### Requirement: A crash loop does not slow ingest
Occurrences SHALL reach an issue in batches, so the rate of one error does not limit ingest. Counts SHALL be exact once the batch is applied.

#### Scenario: Crash loop
- **WHEN** one error occurs ten thousand times in a minute
- **THEN** every occurrence is stored and the issue's count reaches ten thousand within two minutes

#### Scenario: Batch applied twice
- **WHEN** a batch is delivered again after a failure
- **THEN** the count does not change

### Requirement: Alerts
A project SHALL be able to be alerted by email or webhook for a new issue, a regression or a spike, at most once per cause.

#### Scenario: New issue
- **WHEN** an issue is first seen
- **THEN** one alert links to it in the admin

#### Scenario: Webhook down
- **WHEN** a webhook fails
- **THEN** it is retried and ingest is unaffected

### Requirement: Readable stacks
A project SHALL be able to upload source maps for a release, and stacks from that release SHALL show original files, lines and names. Source maps SHALL NOT be public.

#### Scenario: Minified stack
- **WHEN** an exception arrives from a release with source maps
- **THEN** the issue shows the original locations

#### Scenario: No source map
- **WHEN** the release has none
- **THEN** the issue shows the stack as sent

### Requirement: Context beside the error
An issue SHALL show, for an occurrence, the same session's recent events and active flags, and its replay when one exists.

#### Scenario: Session context
- **WHEN** an admin opens an occurrence with a session id
- **THEN** the events leading up to it are listed

### Requirement: People and agents use the same commands
Issue commands SHALL be available in the admin, through a CLI and through MCP, with the same permission checks and audit entries.

#### Scenario: Agent resolves an issue
- **WHEN** an agent resolves an issue through MCP
- **THEN** the issue is resolved and the audit log names the account the agent acts for
