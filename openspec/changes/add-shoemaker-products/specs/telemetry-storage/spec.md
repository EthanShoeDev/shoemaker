# Spec Delta

## Purpose

Stores and queries telemetry on a backend that fits the project's volume, and lets the project move to another without changing anything else.

## ADDED Requirements

### Requirement: Queries are structured
The query API SHALL accept structured queries for trends, funnels, retention, events and issue statistics, and SHALL NOT accept SQL.

<!-- step 3 -->

#### Scenario: Trend
- **WHEN** a caller asks for daily counts of one event over a week
- **THEN** it gets one count per day, with zero for days without events

### Requirement: Every backend gives the same answers
Every query backend SHALL pass one shared suite over one fixed dataset with identical results.

<!-- step 3 -->

#### Scenario: New backend
- **WHEN** a backend is added
- **THEN** it is released only once the shared suite passes against it

### Requirement: Low volume on Cloudflare needs no standing server
A project on Cloudflare SHALL be able to run Edgehog without any always-on server.

<!-- step 3 -->

#### Scenario: Idle project on Cloudflare
- **WHEN** a project receives no events
- **THEN** no Edgehog compute runs

### Requirement: Repeated occurrences are counted compactly
Storage SHALL be able to hold many occurrences as one counted row, and every count SHALL include them.

<!-- step 3 -->

#### Scenario: Capped error
- **WHEN** an error occurred 10,000 times and details of 100 were kept
- **THEN** its count is 10,000

### Requirement: Larger backends are available
A project SHALL be able to move event storage to Iceberg files, and later ClickHouse, through a storage choice alone.

<!-- step 12 -->

#### Scenario: Iceberg
- **WHEN** a project chooses Iceberg storage
- **THEN** ingest, queries and pages work without other changes

### Requirement: Moving backends loses nothing
A project SHALL be able to write to two backends at once, copy older events across, compare the two and switch reads, without losing or duplicating events.

<!-- step 12 -->

#### Scenario: Secondary fails
- **WHEN** the secondary backend rejects a write during a move
- **THEN** the event is kept in the primary, ingest succeeds, and the gap is reported

#### Scenario: Copy overlaps new writes
- **WHEN** copied events include ones already written to both
- **THEN** the new backend holds each event once

### Requirement: Data expires
Each project SHALL have a retention period per event kind, after which its events and blobs are deleted.

<!-- step 3 -->

#### Scenario: Expired error details
- **WHEN** every occurrence of an issue has expired
- **THEN** the issue keeps its state and shows that its occurrences have expired

#### Scenario: Expired replay
- **WHEN** a replay is older than the project's replay retention
- **THEN** it and its stored chunks are gone

### Requirement: Nearing capacity is visible
A backend with a size limit SHALL report how full it is and warn before it refuses writes.

<!-- step 9 -->

#### Scenario: Store filling up
- **WHEN** a project's store passes the warning level
- **THEN** the admin shows the warning and the suggested next backend
