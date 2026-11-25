# Spec Delta

## Purpose

Stores and queries telemetry on the host's own database, with the same answers on every one.

## ADDED Requirements

### Requirement: Queries are structured
The query API SHALL accept structured queries for events and issue statistics, and SHALL NOT accept SQL.

#### Scenario: Daily counts
- **WHEN** a caller asks for daily counts of one issue over a week
- **THEN** it gets one count per day, with zero for days without occurrences

### Requirement: Every backend gives the same answers
Every query backend SHALL pass one shared suite over one fixed dataset with identical results.

#### Scenario: New backend
- **WHEN** a backend is added
- **THEN** it is released only once the shared suite passes against it

### Requirement: Low volume on Cloudflare needs no standing server
A project on Cloudflare SHALL be able to run Edgehog without any always-on server.

#### Scenario: Idle project on Cloudflare
- **WHEN** a project receives no events
- **THEN** no Edgehog compute runs except a daily cleanup

### Requirement: Repeated occurrences are counted compactly
Storage SHALL be able to hold many occurrences as one counted row, and every count SHALL include them.

#### Scenario: Capped error
- **WHEN** an error occurred 10,000 times and details of 100 were kept
- **THEN** its count is 10,000

### Requirement: Data expires
Each project SHALL have a retention period per event kind, after which its events are deleted.

#### Scenario: Expired error details
- **WHEN** every occurrence of an issue has expired
- **THEN** the issue keeps its state and shows that its occurrences have expired

### Requirement: Error tracking runs on any target
Error tracking SHALL run on every deploy target and database the package supports, with the same behavior.

#### Scenario: Bun and Postgres
- **WHEN** a project on Bun and Postgres mounts error tracking
- **THEN** ingest, issues and alerts work, and it needs no Cloudflare package
