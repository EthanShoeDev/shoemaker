# Spec Delta

## Purpose

Shows what a person saw and did, above all just before an error.

## ADDED Requirements

### Requirement: Record
Edgehog SHALL store replays recorded by the official PostHog SDKs as chunks outside the event store.

<!-- step 11 -->

#### Scenario: Chunks out of order
- **WHEN** chunks of a session arrive out of order or twice
- **THEN** the replay plays in the right order, once

#### Scenario: Interrupted recording
- **WHEN** a stretch of time has no recorded data, or playback lacks a full snapshot to start from
- **THEN** the rest plays and the gap is shown

#### Scenario: Mobile recording
- **WHEN** a recording comes from the React Native SDK
- **THEN** it plays

#### Scenario: Late chunk of a deleted replay
- **WHEN** a chunk arrives for a replay that was deleted
- **THEN** it is dropped

### Requirement: Play back
Admins with the replay permission SHALL be able to play a session with its events and errors marked on the timeline.

<!-- step 11 -->

#### Scenario: From an issue
- **WHEN** an admin opens the replay from an occurrence
- **THEN** playback starts shortly before the error

#### Scenario: Without permission
- **WHEN** an admin without the replay permission requests a replay or a chunk
- **THEN** the response is 403

### Requirement: Viewing is recorded
Opening a replay SHALL be recorded in the audit log, though it is a read.

<!-- step 11 -->

#### Scenario: Opening a replay
- **WHEN** an admin opens a replay
- **THEN** the audit log names the admin and the session

### Requirement: Recorded content is not trusted
Playback SHALL NOT run scripts from a recording or let it act with the admin's session.

<!-- step 11 -->

#### Scenario: Malicious page
- **WHEN** a recording holds a script or an inline event handler
- **THEN** it does not run
