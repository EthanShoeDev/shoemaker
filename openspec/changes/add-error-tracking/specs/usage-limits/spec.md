# Spec Delta

## Purpose

Keeps what Edgehog can spend bounded by default, so no loop, flood or mistake can cost more than the server it replaces or harm the app it watches.

## ADDED Requirements

### Requirement: Every use has a finite limit
Each project SHALL have a limit on reports accepted, details kept for one issue, new issues, rows written, data stored, the size of one occurrence, emails, and sends of one alert. Each SHALL have a default, and none SHALL be removable.

#### Scenario: Nothing configured
- **WHEN** a project sets no limits
- **THEN** every limit has its default

#### Scenario: Limit turned off
- **WHEN** a project configures a limit as absent, negative or infinite
- **THEN** ingest does not start and names the limit

### Requirement: The worst case is known
With the default limits, the most a project can cost each month in storage, writes, accepted requests and email SHALL be computed from the limits and recorded prices, and SHALL NOT exceed 20 dollars on Cloudflare. Requests refused before they are accepted are not part of it, and the documentation SHALL say so.

#### Scenario: A default is raised
- **WHEN** a change raises a default so that the worst case passes the amount
- **THEN** the package's tests fail

### Requirement: A loop in the app is contained
A project whose code fails in an endless loop SHALL stay within its limits. While reports are accepted, the loop SHALL NOT keep its other errors from being recorded. Once they are refused, a small sample SHALL still be accepted.

#### Scenario: One error for a day
- **WHEN** one error occurs a thousand times a second for a day
- **THEN** no limit is passed, and each hour a different error that arrives before the limit on reports becomes an issue

#### Scenario: Every error is different
- **WHEN** a loop throws errors that never match each other
- **THEN** issues stop being created at the limit, the rest are counted under one overflow issue, and emails stay within their limit

### Requirement: Refusing is cheap
Ingest SHALL refuse a request over a limit, or with an unknown key, without reading its body or any storage. A reporter that repeats after a refusal SHALL be refused the same way until the limit resets.

#### Scenario: Flood over the limit
- **WHEN** a project has reached its limit on accepted reports and more arrive
- **THEN** they are refused with the time to wait, and storage is neither read nor written for them, except for the sample

#### Scenario: Flood with unknown keys
- **WHEN** requests with unknown keys arrive in a loop
- **THEN** none of them reads or writes storage

### Requirement: Limits hold through restarts
Restarting any part of Edgehog SHALL NOT restore an allowance that was used, except that reports accepted in the last minute before it MAY go uncounted. Rows written SHALL always be counted.

#### Scenario: Restarting in a loop
- **WHEN** ingest restarts a hundred times in a day
- **THEN** the rows written that day stay within the limit

### Requirement: Limits fail closed
When Edgehog cannot tell whether a limit was reached, it SHALL refuse the request rather than store it.

#### Scenario: Usage unreadable
- **WHEN** the record of usage cannot be read
- **THEN** occurrences are refused and the app that sent them is unaffected

### Requirement: Edgehog never feeds itself
A failure of Edgehog's own ingest, delivery, cleanup or reporter SHALL NOT be reported to Edgehog, and every retry SHALL be finite.

#### Scenario: Reporter cannot send
- **WHEN** ingest is down and the reporter fails to send
- **THEN** it logs the failure, and sends no report about it

#### Scenario: Mailer always fails
- **WHEN** every send of an alert fails
- **THEN** sending stops after the limit, the alert is shown as failed, and no issue is created for it

### Requirement: The reporter limits itself
The Effect reporter SHALL merge repeats of one error into one report with a count and SHALL send at a bounded rate.

#### Scenario: Failing loop
- **WHEN** a program fails the same way ten thousand times in a second
- **THEN** a bounded number of requests is sent, and their counts add up to ten thousand

### Requirement: Cleanup is bounded and keeps up
One cleanup SHALL delete at most its share of the rows a project may write in a day, and that share SHALL be enough for everything a day of ingest can store.

#### Scenario: Interrupted cleanup
- **WHEN** a cleanup stops halfway
- **THEN** the next one continues, and expired events stay hidden meanwhile

### Requirement: Reaching a limit is visible
Reaching a limit SHALL be shown in the admin with what was refused or only counted, and SHALL send one email a day at most. Limits SHALL reset without anyone acting.

#### Scenario: Limit reached
- **WHEN** a project reaches a limit for the first time that day
- **THEN** one email names the project and the limit, and the admin shows when it resets

### Requirement: A project can be paused
An admin with permission to change issues SHALL be able to pause a project and resume it, and both SHALL be recorded in the audit log.

#### Scenario: Pause
- **WHEN** an admin pauses a project
- **THEN** within a minute its occurrences are refused and nothing is stored for them

### Requirement: The app's database is not at risk by default
Edgehog's events SHALL go to a database of their own unless the host chooses to share its own.

#### Scenario: Default setup
- **WHEN** a project adds error tracking without choosing a database
- **THEN** a flood of errors reads and writes nothing in the app's database
