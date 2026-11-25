# Spec Delta

## Purpose

Accepts errors, events and replays from the official Sentry and PostHog SDKs, so a project switches to Edgehog by changing configuration.

## ADDED Requirements

### Requirement: Official Sentry SDKs work unchanged
Ingest SHALL accept error events from the official Sentry browser, React Native and Cloudflare SDKs when their DSN points at Edgehog.

#### Scenario: Browser exception
- **WHEN** a page using the Sentry browser SDK throws
- **THEN** Edgehog stores an exception with its stack, release, environment and user

#### Scenario: Unsupported envelope item
- **WHEN** an envelope holds an item Edgehog does not support beside an error
- **THEN** the error is stored, the other item is dropped, and the SDK sees success

### Requirement: Official PostHog SDKs work unchanged
Ingest SHALL accept captures, batches, identification, flags and replay from the official PostHog JavaScript, React Native and Node SDKs when their host points at Edgehog.

#### Scenario: Compressed batch
- **WHEN** an SDK sends a batch in any encoding the recorded payloads include
- **THEN** every event in it is stored

### Requirement: One event shape
Ingest SHALL translate every protocol into one event shape with an id, project, kind, name, person, optional session, time and properties. Nothing past ingest SHALL depend on a vendor's format.

#### Scenario: Same session, two SDKs
- **WHEN** one browser session sends a pageview through PostHog and an exception through Sentry with the same person and session ids
- **THEN** both are found by that session id

### Requirement: Events are stored once
Ingest SHALL store an event once however many times the SDK retries it.

#### Scenario: Retry
- **WHEN** an SDK resends a batch after a timeout
- **THEN** each event is stored once

### Requirement: A project key identifies the project
Ingest SHALL accept only requests with a known project key, and the key SHALL allow nothing but sending data and reading flags.

#### Scenario: Unknown key
- **WHEN** a request has an unknown key
- **THEN** it is refused and nothing is stored

#### Scenario: Key used on the query API
- **WHEN** a project key is sent to an admin endpoint
- **THEN** the response is 401

### Requirement: Ingest protects itself
Ingest SHALL limit body size before and after decompression and limit each project's rate, answering in a way that makes the SDK back off.

#### Scenario: Decompression bomb
- **WHEN** a small body expands past the limit
- **THEN** it is refused without being fully expanded

#### Scenario: Over the rate limit
- **WHEN** a project exceeds its rate
- **THEN** the response is 429 with a retry time

### Requirement: Ingest runs apart from the admin
Ingest SHALL run as its own server, so client traffic never reaches the server that serves the admin.

#### Scenario: Traffic spike
- **WHEN** clients flood ingest
- **THEN** the admin's server receives none of those requests

### Requirement: Effect failures are reported in full
The package SHALL let an Effect program report failures with every cause, the failing span and its parents.

#### Scenario: Several causes
- **WHEN** an Effect fails with two concurrent causes inside nested spans
- **THEN** one report holds both causes and the span names
