# Spec Delta

## Purpose

Shows what a person saw and did, above all just before an error.

## ADDED Requirements

### Requirement: Record
Edgehog SHALL store replays recorded by the official PostHog SDKs as chunks outside the event store.

#### Scenario: Chunks out of order
- **WHEN** chunks of a session arrive out of order or twice
- **THEN** the replay plays in the right order, once

#### Scenario: Missing chunk
- **WHEN** a chunk never arrives
- **THEN** the rest plays and the gap is shown

### Requirement: Play back
Admins with the replay permission SHALL be able to play a session with its events and errors marked on the timeline.

#### Scenario: From an issue
- **WHEN** an admin opens the replay from an occurrence
- **THEN** playback starts shortly before the error

#### Scenario: Without permission
- **WHEN** an admin without the replay permission requests a replay or a chunk
- **THEN** the response is 403

### Requirement: Viewing is recorded
Opening a replay SHALL be recorded in the audit log, though it is a read.

#### Scenario: Opening a replay
- **WHEN** an admin opens a replay
- **THEN** the audit log names the admin and the session

### Requirement: Recorded content is not trusted
Playback SHALL NOT run scripts from a recording or let it act with the admin's session.

#### Scenario: Malicious page
- **WHEN** a recording holds a script or an inline event handler
- **THEN** it does not run
