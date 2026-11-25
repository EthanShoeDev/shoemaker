# Spec Delta

## Purpose

Turns exceptions into issues people and agents can triage, resolve and be alerted about.

## ADDED Requirements

### Requirement: Exceptions group into issues
Exceptions that match SHALL belong to one issue, found by fingerprint. An issue SHALL keep its identity when fingerprints are added to it, moved from it or computed differently.

<!-- step 3 -->

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

<!-- step 3 -->

#### Scenario: New grouping rules
- **WHEN** a release changes the rules and a known error occurs again
- **THEN** it joins its existing issue, which gains the new fingerprint

### Requirement: SDK fingerprints are honored
A fingerprint set by the SDK SHALL replace the computed one, `{{ default }}` alone SHALL mean the computed one, and `{{ default }}` with other values SHALL divide the computed group by those values.

<!-- step 3 -->

#### Scenario: Custom fingerprint
- **WHEN** the SDK sets one fingerprint on two different errors
- **THEN** they share one issue

#### Scenario: Divided group
- **WHEN** one error is sent with `{{ default }}` and two different tenants
- **THEN** there are two issues

### Requirement: Grouping uses readable code
Where a source map is available, an exception SHALL be mapped to original code before it is grouped, and only the project's own frames SHALL decide the group when there are any.

<!-- step 7 -->

#### Scenario: New build
- **WHEN** a new build renames minified functions and the same error occurs
- **THEN** it joins its existing issue

#### Scenario: Map arrives late
- **WHEN** a source map arrives after an exception was grouped
- **THEN** later exceptions are mapped, and the earlier one keeps its issue

### Requirement: Issues have a lifecycle
An issue SHALL be open, resolved or archived. An open issue SHALL be shown as new or regressed while that is recent.

<!-- step 7 -->

#### Scenario: Resolving twice
- **WHEN** a resolved issue is resolved again
- **THEN** nothing changes and no event is recorded

### Requirement: Regressions are real
A resolved issue SHALL reopen as a regression only for an occurrence received after it was resolved.

<!-- step 3 -->

#### Scenario: Regression
- **WHEN** a resolved issue occurs again
- **THEN** it is open and marked as regressed

#### Scenario: Occurrence already on its way
- **WHEN** an occurrence received before the issue was resolved is processed after
- **THEN** the issue stays resolved

### Requirement: Resolved in a release
An issue SHALL be resolvable in a named release or the next one. An occurrence from an older release, or from none, SHALL NOT reopen it.

<!-- step 7 -->

#### Scenario: Old app version
- **WHEN** an issue is resolved in release 2 and a phone still on release 1 reports it
- **THEN** the issue stays resolved

#### Scenario: Newer release
- **WHEN** release 3 reports it
- **THEN** the issue is reopened as a regression

### Requirement: Issues can be archived
An issue SHALL be archivable forever, until a time, or until it occurs a number of times more. An archived issue SHALL raise no alerts.

<!-- step 7 -->

#### Scenario: Until it happens more
- **WHEN** an issue archived until 100 more occurrences reaches them
- **THEN** it is open again and an alert says so

### Requirement: Issues can be merged and split
Admins SHALL be able to merge issues and to split one by fingerprint. Counts, people and occurrences SHALL follow.

<!-- step 7 -->

#### Scenario: Merge
- **WHEN** two issues are merged and either error occurs again
- **THEN** it joins the merged issue

#### Scenario: Split
- **WHEN** a merged fingerprint is split off
- **THEN** its past and future occurrences belong to the new issue

### Requirement: Counts describe retained data
An issue SHALL show occurrences, people affected, and first and last seen, computed from retained data. A late occurrence SHALL move first seen earlier.

<!-- step 3 -->

#### Scenario: Late arrival
- **WHEN** a phone that was offline reports an error from yesterday
- **THEN** the issue was first seen yesterday

### Requirement: A crash loop does not slow ingest
One error's rate SHALL NOT limit ingest. Beyond a limit per issue and minute, occurrences SHALL be counted without keeping their details.

<!-- step 3 -->

#### Scenario: Crash loop
- **WHEN** one error occurs ten thousand times in a minute and all are accepted
- **THEN** the issue shows ten thousand occurrences within two minutes, and details of only some

### Requirement: Alerts
A project SHALL be able to be alerted for a new issue, a regression, or an issue that leaves the archive, at most once per issue, cause and interval.

<!-- step 7 -->

#### Scenario: New issue
- **WHEN** an issue is first seen
- **THEN** one email links to it in the admin

#### Scenario: Delivery fails
- **WHEN** an alert cannot be delivered
- **THEN** it is retried and ingest is unaffected

### Requirement: Spike alerts and webhooks
A project SHALL be able to be alerted when an issue occurs more than a set number of times in a set window, and to receive any alert by webhook.

<!-- step 7 -->

#### Scenario: Second spike
- **WHEN** an issue spikes again after the interval
- **THEN** there is a second alert

### Requirement: Readable stacks
A project SHALL be able to upload source maps, matched to code by the identifier built into both, and stacks SHALL show original files, lines and names. Source maps SHALL NOT be public, and Edgehog SHALL NOT fetch them from the web.

<!-- step 7 -->

#### Scenario: Minified stack
- **WHEN** an exception arrives from code whose map was uploaded
- **THEN** the issue shows the original locations

#### Scenario: One build, two releases
- **WHEN** the same built file ships in two releases
- **THEN** one map serves both

#### Scenario: No source map
- **WHEN** no map matches
- **THEN** the issue shows the stack as sent

### Requirement: Context beside the error
An issue SHALL show, for an occurrence, the same session's recent events and active flags, and its replay when one exists.

<!-- step 11 -->

#### Scenario: Session context
- **WHEN** an admin opens an occurrence with a session id
- **THEN** the events leading up to it are listed

### Requirement: People and agents use the same commands
Issue commands SHALL be available in the admin, through a CLI and through MCP.

<!-- step 6 -->

#### Scenario: Agent resolves an issue
- **WHEN** an agent resolves an issue through MCP
- **THEN** the issue is resolved and the audit log names the key's owner and the agent
