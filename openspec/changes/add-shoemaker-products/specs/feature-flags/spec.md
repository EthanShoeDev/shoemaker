# Spec Delta

## Purpose

Lets a project turn features on for some users and measure the effect through OpenFeature, so application code depends on an open standard and not on Edgehog.

## ADDED Requirements

### Requirement: Flags are typed
Admins SHALL be able to create flags whose variants are all booleans, all strings, all numbers or all objects, with a default variant and a state of enabled or disabled.

<!-- step 2 -->

#### Scenario: Mixed types
- **WHEN** an admin gives one flag a boolean and a string variant
- **THEN** it is refused

#### Scenario: Falsy value
- **WHEN** a variant's value is `false`, `0` or an empty string
- **THEN** evaluating it returns that value

### Requirement: Flags target by property and by share
A flag SHALL be able to choose a variant by properties of the evaluation context, by a share of targeting keys, or by both, with rules tried in order.

<!-- step 2 -->

#### Scenario: Property rule
- **WHEN** a rule matches `plan` equal to `pro` and the context has it
- **THEN** that rule's variant is returned

#### Scenario: Partial rollout
- **WHEN** a flag targets 20% of targeting keys
- **THEN** about 20% get it, and each targeting key always gets the same answer

#### Scenario: Widening a rollout
- **WHEN** the share grows from 20% to 40%
- **THEN** every targeting key that had the flag keeps it

#### Scenario: No targeting key
- **WHEN** a flag needs a targeting key and the context has none
- **THEN** evaluation fails with `TARGETING_KEY_MISSING`

### Requirement: Assignment never changes by accident
The way a targeting key is assigned to a share SHALL be fixed and covered by published test vectors, and SHALL match what PostHog SDKs compute for the same flag key and id.

<!-- step 2 -->

#### Scenario: Upgrade
- **WHEN** a project upgrades the package
- **THEN** no targeting key moves to another variant

### Requirement: Results follow OpenFeature
Evaluation SHALL return a value, variant, reason and flag metadata, or an error code, as OpenFeature defines them. A disabled flag SHALL return no value, so the application's default applies.

<!-- step 2 -->

#### Scenario: Reasons
- **WHEN** a flag is answered by its default, a property rule or a share
- **THEN** the reason is `STATIC`, `TARGETING_MATCH` or `SPLIT`

#### Scenario: Disabled flag
- **WHEN** a disabled flag is evaluated
- **THEN** the application's default is used and the reason is `DISABLED`

#### Scenario: Unknown flag
- **WHEN** a flag does not exist
- **THEN** the error is `FLAG_NOT_FOUND` and the application's default is used

#### Scenario: Wrong type
- **WHEN** an application asks for a number from a string flag
- **THEN** the error is `TYPE_MISMATCH` and the application's default is used

### Requirement: Servers evaluate locally
A server SHALL be able to evaluate flags in its own process through the official OpenFeature server SDK, needing only the definitions and the context, with no request per evaluation and no extra credential.

<!-- step 2 -->

#### Scenario: Embedded project
- **WHEN** a server in the project evaluates a flag
- **THEN** it reads definitions from the project's own storage and answers in process

#### Scenario: Definitions unavailable
- **WHEN** storage fails after definitions were loaded
- **THEN** the last definitions are used and the provider reports itself stale

#### Scenario: Never loaded
- **WHEN** storage fails before definitions were ever loaded
- **THEN** every evaluation returns the application's default with an error code

### Requirement: Targeting rules stay on the server
Flag definitions SHALL NOT be sent to a browser or a mobile app. Until remote evaluation exists, a project SHALL be able to evaluate on its server and hand the results to the client.

<!-- step 2 -->

#### Scenario: Server-rendered page
- **WHEN** a page is rendered with evaluated flags
- **THEN** the page holds values and variants, and no rules

### Requirement: The provider is compliant
Edgehog's OpenFeature providers SHALL satisfy every mandatory requirement of the provider section of the pinned OpenFeature specification, and SHALL pass its conformance suite for each capability they declare.

<!-- step 2 -->

#### Scenario: Conformance run
- **WHEN** the pinned suite runs against a provider
- **THEN** every untagged scenario and every declared capability passes, and the others are reported as skipped

### Requirement: Flag changes are audited
Creating, changing and deleting flags SHALL need a permission and SHALL be recorded in the audit log.

<!-- step 2 -->

#### Scenario: Turning a flag off
- **WHEN** an admin turns a flag off
- **THEN** servers evaluating locally use the new answer within a minute and the audit log names the admin

### Requirement: Evaluation needs no event store
Flag evaluation SHALL NOT need the event store.

<!-- step 2 -->

#### Scenario: Event store down
- **WHEN** the event store is unavailable
- **THEN** flags still evaluate

### Requirement: Clients evaluate remotely
Edgehog SHALL serve the single and bulk evaluation endpoints of the pinned OpenFeature Remote Evaluation Protocol, so existing providers for that protocol work unchanged.

<!-- step 8 -->

#### Scenario: Browser
- **WHEN** a browser using the community web provider asks for all flags
- **THEN** it gets values and variants for its context, and no rules

#### Scenario: Nothing changed
- **WHEN** a client asks again for the same context with the tag it was given and no flag changed
- **THEN** the response is 304

#### Scenario: Too many requests
- **WHEN** a client exceeds its rate
- **THEN** the response is 429 with a retry time

#### Scenario: Same answer
- **WHEN** a server evaluates locally and a client remotely with one context
- **THEN** both get the same value, variant and reason

### Requirement: Remote clients learn of changes
A remote client SHALL get changed flags the next time it asks, and SHALL be able to be told of a change without polling.

<!-- step 10 -->

#### Scenario: Next request
- **WHEN** a flag changes and a client asks again
- **THEN** it gets the new answer

#### Scenario: Told of a change
- **WHEN** a connected client is told of a change
- **THEN** it asks again, and the message itself holds no values

### Requirement: Exposures and goals are recorded
A project SHALL be able to record which variant a user saw and the goals they reached through OpenFeature's hooks and tracking. Flag values SHALL be left out unless the project asks for them.

<!-- step 10 -->

#### Scenario: Bulk evaluation
- **WHEN** a client fetches every flag and the application reads one
- **THEN** only the one it read counts as seen

#### Scenario: Repeated reads
- **WHEN** the application reads one flag many times in a session
- **THEN** one exposure is recorded

### Requirement: Experiments
Admins SHALL be able to compare a goal between a flag's variants and see whether the difference is likely real. A user who saw more than one variant SHALL be left out and counted.

<!-- step 10 -->

#### Scenario: Too little data
- **WHEN** an experiment has too few users to tell
- **THEN** it says so instead of naming a winner

### Requirement: PostHog SDKs can read flags
PostHog SDKs SHALL be able to evaluate flags remotely, with boolean flags as booleans and other flags as their variant name and value. PostHog's own local evaluation SHALL NOT be offered.

<!-- step 10 -->

#### Scenario: posthog-js
- **WHEN** posthog-js asks for flags
- **THEN** it gets the same variants an OpenFeature client gets

#### Scenario: Local evaluation
- **WHEN** a PostHog SDK asks for flag definitions
- **THEN** it is refused
