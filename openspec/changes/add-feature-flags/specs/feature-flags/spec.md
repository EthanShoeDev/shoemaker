# Spec Delta

## Purpose

Lets a project turn features on for some users through OpenFeature, so application code depends on an open standard and not on Edgehog.

## ADDED Requirements

### Requirement: Flags are typed
Admins SHALL be able to create flags whose variants are all booleans, all strings, all numbers or all objects, with a default variant and a state of enabled or disabled.

#### Scenario: Mixed types
- **WHEN** an admin gives one flag a boolean and a string variant
- **THEN** it is refused

#### Scenario: Falsy value
- **WHEN** a variant's value is `false`, `0` or an empty string
- **THEN** evaluating it returns that value

### Requirement: Flags belong to a project
A flag SHALL belong to one project, and its key SHALL be unique within that project.

#### Scenario: Same key, two projects
- **WHEN** two projects in one installation have a flag with the same key
- **THEN** each evaluates its own

### Requirement: The cost of evaluating is bounded
Reads of definitions SHALL NOT grow with the number of evaluations, whether storage works or not, and evaluating SHALL write nothing. The number and total size of a project's flags SHALL have a finite limit.

#### Scenario: Evaluating in a loop
- **WHEN** a server evaluates known and unknown flags in an endless loop
- **THEN** it reads definitions at most once a minute

#### Scenario: Loop while storage is down
- **WHEN** storage fails and a server evaluates in an endless loop
- **THEN** it tries to read at most once every ten seconds

#### Scenario: Too many flags
- **WHEN** an admin creates a flag past the limit
- **THEN** it is refused

### Requirement: Flags target by property and by share
A flag SHALL be able to choose a variant by properties of the evaluation context, by a share of targeting keys, or by both, with rules tried in order.

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

#### Scenario: Upgrade
- **WHEN** a project upgrades the package
- **THEN** no targeting key moves to another variant

### Requirement: Results follow OpenFeature
Evaluation SHALL return a value, variant, reason and flag metadata, or an error code, as OpenFeature defines them. A disabled flag SHALL return no value, so the application's default applies.

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

#### Scenario: Server-rendered page
- **WHEN** a page is rendered with evaluated flags
- **THEN** the page holds values and variants, and no rules

### Requirement: The provider is compliant
Edgehog's OpenFeature providers SHALL satisfy every mandatory requirement of the provider section of the pinned OpenFeature specification, and SHALL pass its conformance suite for each capability they declare.

#### Scenario: Conformance run
- **WHEN** the pinned suite runs against a provider
- **THEN** every untagged scenario and every declared capability passes, and the others are reported as skipped

### Requirement: Flag changes are audited
Creating, changing and deleting flags SHALL need a permission and SHALL be recorded in the audit log.

#### Scenario: Turning a flag off
- **WHEN** an admin turns a flag off
- **THEN** servers evaluating locally use the new answer within a minute and the audit log names the admin

### Requirement: Evaluation needs no event store
Flag evaluation SHALL NOT need the event store.

#### Scenario: Event store down
- **WHEN** the event store is unavailable
- **THEN** flags still evaluate

### Requirement: Flags run on any target
Flags SHALL work on every deploy target and database the package supports, without any Cloudflare service.

#### Scenario: Bun and Postgres
- **WHEN** a project on Bun and Postgres mounts flags
- **THEN** it can define and evaluate them, and needs no Cloudflare package
