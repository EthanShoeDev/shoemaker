# Spec Delta

## Purpose

Accepts errors, events and replays from the official Sentry and PostHog SDKs, so a project switches to Edgehog by changing configuration.

## ADDED Requirements

### Requirement: Sentry server SDKs work unchanged
Ingest SHALL accept error events from the official Sentry Cloudflare SDK when its DSN points at Edgehog, with every way the SDKs send a key, and project ids and keys in the form the SDKs accept.

<!-- step 3 -->

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

### Requirement: Sentry browser and mobile SDKs work unchanged
Ingest SHALL accept error events from the official Sentry browser and React Native SDKs, directly or through a tunnel, from the origins a project allows.

<!-- step 7 -->

#### Scenario: Browser exception
- **WHEN** a page using the Sentry browser SDK throws
- **THEN** Edgehog stores an exception with its stack, release and user

#### Scenario: Tunnel
- **WHEN** the SDK sends to a tunnel address on the project's own origin
- **THEN** the event is stored

#### Scenario: Origin not allowed
- **WHEN** a project lists its origins and a page elsewhere sends an event
- **THEN** it is refused

### Requirement: Sentry SDKs are slowed precisely
A limit on one kind of Sentry data SHALL stop the SDK sending that kind only. A browser SHALL be able to read the limit.

<!-- step 3 -->

#### Scenario: Errors limited
- **WHEN** a project exceeds its error rate
- **THEN** the response limits errors for a stated time, and other kinds still send

#### Scenario: Unwanted kinds
- **WHEN** an SDK sends kinds Edgehog does not store
- **THEN** the response succeeds and asks the SDK to stop sending them for a while

### Requirement: PostHog capture works unchanged
Ingest SHALL accept events from the official PostHog JavaScript, React Native and Node SDKs, over both capture protocols those SDKs use.

<!-- step 9 -->

#### Scenario: Older protocol
- **WHEN** an SDK sends a batch in any encoding the recorded payloads include
- **THEN** every event in it is stored

#### Scenario: Newer protocol
- **WHEN** an SDK sends a batch in which one event is invalid
- **THEN** the response gives each event its own result and the others are stored

#### Scenario: Several tokens
- **WHEN** one batch carries two different tokens
- **THEN** it is refused

### Requirement: PostHog limits follow the protocol
Data over a quota SHALL be dropped in the way its protocol defines, without the SDK retrying it. A temporary overload SHALL make the SDK retry.

<!-- step 9 -->

#### Scenario: Over quota
- **WHEN** a project is over its quota
- **THEN** the SDK is told in its protocol's own form and does not resend

#### Scenario: Overloaded
- **WHEN** storage is briefly unavailable
- **THEN** the SDK resends and each event is stored once

### Requirement: PostHog SDKs start cleanly
Edgehog SHALL serve what the pinned PostHog browser SDK fetches when it starts, including its configuration and the scripts it loads on demand, without contacting PostHog.

<!-- step 9 -->

#### Scenario: Start
- **WHEN** a page starts the SDK against Edgehog
- **THEN** it sends events, no request fails, and none goes to PostHog

#### Scenario: Feature not offered
- **WHEN** the SDK asks about a feature Edgehog does not offer
- **THEN** the answer turns it off

### Requirement: One event shape
Ingest SHALL translate every protocol into one event shape with an id, project, kind, name, person, optional session, time of occurrence, time of receipt and properties. Nothing past ingest SHALL depend on a vendor's format.

<!-- step 9 -->

#### Scenario: Same session, two SDKs
- **WHEN** one browser session sends a pageview through PostHog and an exception through Sentry with the same person and session ids
- **THEN** both are found by that session id

### Requirement: Events are stored once
An event that carries an id SHALL be stored once per project however many times it is sent. Occurrences counted without details SHALL be counted once when resent within ten minutes.

<!-- step 3 -->

#### Scenario: Retry
- **WHEN** an SDK resends a batch after a timeout
- **THEN** each event is stored once

#### Scenario: Same id, two projects
- **WHEN** two projects send events with one id
- **THEN** both are stored

### Requirement: Wrong clocks are corrected
Ingest SHALL correct an event's time when the sender's clock is wrong, and SHALL keep an event whose time is impossible rather than refuse it.

<!-- step 9 -->

#### Scenario: Slow clock
- **WHEN** a device whose clock is an hour slow sends an event with its sending time
- **THEN** the stored time is within a minute of the real one

#### Scenario: Far future
- **WHEN** an event claims a time next year
- **THEN** it is stored with the time it was received

### Requirement: A project key only sends
Ingest SHALL accept only requests with a known project key. The key is public, and SHALL allow nothing but sending data and reading evaluated flags.

<!-- step 3 -->

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

<!-- step 3 -->

#### Scenario: Decompression bomb
- **WHEN** a small body expands past the limit
- **THEN** it is refused without being fully expanded

### Requirement: Secrets are removed before storage
Ingest SHALL remove payment card numbers, private keys, bearer tokens, credentials in addresses, sensitive cookies and the values of password-like fields, before storing and again after a stack is mapped. It SHALL NOT store an IP address unless the project asks.

<!-- step 7 -->

#### Scenario: Token in a header
- **WHEN** an exception carries an authorization header
- **THEN** the stored event does not contain the token

#### Scenario: Secret in mapped source
- **WHEN** mapping a stack adds a source line that contains a key
- **THEN** the key is not stored

### Requirement: Noise can be filtered
A project SHALL be able to drop errors from browser extensions, local development, old browsers, crawlers, and failed chunk loads. Dropped errors SHALL be counted by reason.

<!-- step 7 -->

#### Scenario: Extension error
- **WHEN** a browser extension throws on the project's page
- **THEN** it is counted as filtered and creates no issue

### Requirement: Ingest runs apart from the admin
Ingest SHALL run as its own server, so client traffic never reaches the server that serves the admin.

<!-- step 3 -->

#### Scenario: Traffic spike
- **WHEN** clients flood ingest
- **THEN** the admin's server receives none of those requests

### Requirement: Effect failures are reported in full
The package SHALL let an Effect program report failures with every cause, the failing span and its parents.

<!-- step 3 -->

#### Scenario: Several causes
- **WHEN** an Effect fails with two concurrent causes inside nested spans
- **THEN** one report holds both causes and the span names
