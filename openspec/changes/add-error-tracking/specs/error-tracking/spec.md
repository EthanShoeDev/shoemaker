# Spec Delta

## Purpose

Turns exceptions into issues admins can triage, resolve and be alerted about.

## ADDED Requirements

### Requirement: Exceptions group into issues
Exceptions that match SHALL belong to one issue, found by fingerprint. An issue SHALL keep its identity when fingerprints are added to it, moved from it or computed differently.

#### Scenario: Same error twice
- **WHEN** the same error is thrown from the same place by two users
- **THEN** there is one issue with two occurrences

#### Scenario: Two first occurrences at once
- **WHEN** two requests report a new error at the same moment
- **THEN** one issue is created

#### Scenario: Line numbers move
- **WHEN** an unrelated edit moves the failing line
- **THEN** the error stays in its issue

### Requirement: Grouping can improve without losing issues
Every stored fingerprint SHALL carry the version of the rules that made it. After the rules change, an exception that matches an existing issue under the old rules SHALL join that issue.

#### Scenario: New grouping rules
- **WHEN** a release changes the rules and a known error occurs again
- **THEN** it joins its existing issue, which gains the new fingerprint

### Requirement: SDK fingerprints are honored
A fingerprint set by the SDK SHALL replace the computed one, `{{ default }}` alone SHALL mean the computed one, and `{{ default }}` with other values SHALL divide the computed group by those values.

#### Scenario: Custom fingerprint
- **WHEN** the SDK sets one fingerprint on two different errors
- **THEN** they share one issue

#### Scenario: Divided group
- **WHEN** one error is sent with `{{ default }}` and two different tenants
- **THEN** there are two issues

### Requirement: Issues have a lifecycle
An issue SHALL be open or resolved, and admins SHALL be able to resolve it. An open issue SHALL be shown as new or regressed while that is recent.

#### Scenario: Resolving twice
- **WHEN** a resolved issue is resolved again
- **THEN** nothing changes and no event is recorded

### Requirement: Regressions are real
A resolved issue SHALL reopen as a regression only for an occurrence received after it was resolved.

#### Scenario: Regression
- **WHEN** a resolved issue occurs again
- **THEN** it is open and marked as regressed

#### Scenario: Occurrence already on its way
- **WHEN** an occurrence received before the issue was resolved is processed after
- **THEN** the issue stays resolved

### Requirement: Counts describe retained data
An issue SHALL show occurrences, people affected, and first and last seen, computed from retained data. A late occurrence SHALL move first seen earlier.

#### Scenario: Late arrival
- **WHEN** an error from yesterday is reported today, after a delay
- **THEN** the issue was first seen yesterday

### Requirement: A crash loop does not slow ingest
One error's rate SHALL NOT limit ingest. Beyond a limit per issue and minute, occurrences SHALL be counted without keeping their details.

#### Scenario: Crash loop
- **WHEN** one error occurs ten thousand times in a minute and all are accepted
- **THEN** the issue shows ten thousand occurrences within two minutes, and details of only some

### Requirement: Alerts
A project SHALL be able to be alerted by email for a new issue. Each issue SHALL raise that alert once.

#### Scenario: New issue
- **WHEN** an issue is first seen
- **THEN** one email links to it in the admin

#### Scenario: Delivery fails
- **WHEN** an alert cannot be delivered
- **THEN** it is retried and ingest is unaffected

### Requirement: Issue changes are audited
Reading issues and changing them SHALL need separate permissions, and every change SHALL be recorded in the audit log.

#### Scenario: Resolving an issue
- **WHEN** an admin resolves an issue
- **THEN** one entry records the admin, `issue.resolve` and the issue

#### Scenario: Read only
- **WHEN** an admin who may only read issues resolves one
- **THEN** the response is 403 and the issue stays open
