# Spec Delta

## Purpose

Accepts errors from the official Sentry server SDK and from Effect programs, so a project switches to Edgehog by changing configuration.

## ADDED Requirements

### Requirement: Sentry server SDKs work unchanged
Ingest SHALL accept error events from the official Sentry Cloudflare SDK when its DSN points at Edgehog, with every way the SDKs send a key, and project ids and keys in the form the SDKs accept.

#### Scenario: Worker exception
- **WHEN** a Worker using the Sentry Cloudflare SDK throws
- **THEN** Edgehog stores an exception with its stack, release and environment

#### Scenario: Unsupported item
- **WHEN** an envelope holds an item Edgehog does not support beside an error
- **THEN** the error is stored, the other item is dropped, and the SDK sees success

#### Scenario: Unusual framing
- **WHEN** an envelope omits item lengths or the final newline, or holds binary data
- **THEN** it is read correctly

#### Scenario: Two keys
- **WHEN** a request carries a key in two places
- **THEN** it is refused

### Requirement: Sentry SDKs are slowed precisely
A limit on one kind of Sentry data SHALL stop the SDK sending that kind only.

#### Scenario: Errors limited
- **WHEN** a project exceeds its error rate
- **THEN** the response limits errors for a stated time, and other kinds still send

#### Scenario: Unwanted kinds
- **WHEN** an SDK sends kinds Edgehog does not store
- **THEN** the response succeeds and asks the SDK to stop sending them for a while

### Requirement: One event shape
Ingest SHALL translate every report, whichever way it was sent, into one event shape with an id, project, kind, name, person, optional session, optional trace and span, time of occurrence, time of receipt and properties. Nothing past ingest SHALL depend on a vendor's format.

#### Scenario: Same trace, two reporters
- **WHEN** a Worker reports one exception through the Sentry SDK and another through the Effect reporter within one trace
- **THEN** both are found by that trace id

#### Scenario: No trace
- **WHEN** an exception is reported outside any trace
- **THEN** it is stored without one

### Requirement: Events are stored once
An event that carries an id SHALL be stored once per project however many times it is sent. Occurrences counted without details SHALL be counted once when resent within ten minutes.

#### Scenario: Retry
- **WHEN** an SDK resends a batch after a timeout
- **THEN** each event is stored once

#### Scenario: Same id, two projects
- **WHEN** two projects send events with one id
- **THEN** both are stored

### Requirement: A project key only sends
Ingest SHALL accept only requests with a known project key. The key is public, and SHALL allow nothing but sending data.

#### Scenario: Unknown key
- **WHEN** a request has an unknown key
- **THEN** it is refused, nothing is stored, and the SDK stops retrying

#### Scenario: Key used on the query API
- **WHEN** a project key is sent to an admin endpoint
- **THEN** the response is 401

#### Scenario: Key in an address
- **WHEN** an SDK sends its key in the query string
- **THEN** the key appears in no log or trace

### Requirement: Ingest protects itself
Ingest SHALL limit body size before and after decompression, the number of items in a body, and each project's rate.

#### Scenario: Decompression bomb
- **WHEN** a small body expands past the limit
- **THEN** it is refused without being fully expanded

### Requirement: Secrets are removed before storage
Ingest SHALL remove payment card numbers, private keys, bearer tokens, credentials in addresses, sensitive cookies and the values of password-like fields before storing. It SHALL NOT store an IP address unless the project asks.

#### Scenario: Token in a header
- **WHEN** an exception carries an authorization header
- **THEN** the stored event does not contain the token

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

### Requirement: Impossible times are replaced
An event whose time is in the future or older than the project's retention SHALL be kept with the time it was received.

#### Scenario: Far future
- **WHEN** an event claims a time next year
- **THEN** it is stored with the time it was received

#### Scenario: Unset clock
- **WHEN** an event claims a time in 1970
- **THEN** the issue's first seen is the time it was received
