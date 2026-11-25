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
Every stored fingerprint SHALL carry the version of the rules that made it. After the rules change, an exception whose new fingerprint is unknown SHALL join the issue it matches under the newest earlier rules that still have stored fingerprints.

#### Scenario: New grouping rules
- **WHEN** a release changes the rules and a known error occurs again
- **THEN** it joins its existing issue, which gains the new fingerprint

#### Scenario: Unseen for two versions
- **WHEN** a known error occurs again after the rules changed twice
- **THEN** it joins its existing issue

### Requirement: Library code does not decide the group
Grouping SHALL use the project's own code where the stack tells it from library code, and SHALL NOT depend on library frames where the stack does not.

#### Scenario: Bundled server
- **WHEN** a bundled server without source maps throws the same error after a library it uses is upgraded
- **THEN** the error stays in its issue

#### Scenario: Effect failure
- **WHEN** an Effect program fails in the same named span with the same error, in two builds
- **THEN** both are one issue

### Requirement: SDK fingerprints are honored
A fingerprint set by the SDK SHALL replace the computed one, `{{ default }}` alone SHALL mean the computed one, and `{{ default }}` with other values SHALL divide the computed group by those values.

#### Scenario: Custom fingerprint
- **WHEN** the SDK sets one fingerprint on two different errors
- **THEN** they share one issue

#### Scenario: Divided group
- **WHEN** one error is sent with `{{ default }}` and two different tenants
- **THEN** there are two issues

### Requirement: Issues have a lifecycle
An issue SHALL be open or resolved, and admins SHALL be able to resolve it. An open issue SHALL be shown as new or regressed for a day after it opened or reopened.

#### Scenario: Resolving twice
- **WHEN** a resolved issue is resolved again
- **THEN** nothing changes and no audit entry is written

### Requirement: Regressions are real
A resolved issue SHALL reopen as a regression only for a new occurrence received after it was resolved.

#### Scenario: Regression
- **WHEN** a resolved issue occurs again
- **THEN** it is open and marked as regressed

#### Scenario: Resend after resolving
- **WHEN** an event stored before the issue was resolved is sent again after
- **THEN** the issue stays resolved

#### Scenario: Occurrence already on its way
- **WHEN** an occurrence received before the issue was resolved is processed after
- **THEN** the issue stays resolved

### Requirement: Counts describe retained data
An issue SHALL show occurrences, people affected and last seen, computed from retained data, and when it was first seen, which is kept with the issue. A late occurrence SHALL move first seen earlier. People SHALL be shown as a minimum when some occurrences were counted without details.

#### Scenario: Late arrival
- **WHEN** an error from yesterday is reported today, after a delay
- **THEN** the issue was first seen yesterday

#### Scenario: First occurrence expired
- **WHEN** an issue's first occurrence is older than the retention period
- **THEN** it still shows when it was first seen

### Requirement: A crash loop does not slow ingest
Beyond a limit per issue and hour, occurrences SHALL be counted without keeping their details or using the allowance of other errors. If the part that counts them stops, at most the last minute of these counts MAY be lost.

#### Scenario: Crash loop
- **WHEN** one error occurs ten thousand times in a minute and all are accepted
- **THEN** the issue shows ten thousand occurrences within two minutes, and details of only some

### Requirement: Alerts
A project SHALL be able to be alerted by email for a new issue. Each issue SHALL raise that alert once. An alert SHALL be sent again only when a crash hid whether it was sent.

#### Scenario: New issue
- **WHEN** an issue is first seen
- **THEN** one email links to it in the admin

#### Scenario: Crash before the hand-over
- **WHEN** ingest stops after storing a new issue and before its alert is handed over
- **THEN** the alert is sent after the next stored error or the next daily cleanup

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
