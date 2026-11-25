# Spec Delta

## Purpose

Lets a project turn features on for some people and measure the effect, through the PostHog SDKs it already uses.

## ADDED Requirements

### Requirement: Flags
Admins SHALL be able to create boolean and multi-variant flags that target a share of people, people with given properties, or both.

#### Scenario: Partial rollout
- **WHEN** a flag targets 20% of people
- **THEN** about 20% get it, and each person always gets the same answer

#### Scenario: Widening a rollout
- **WHEN** the share grows from 20% to 40%
- **THEN** everyone who had the flag keeps it

### Requirement: Evaluation matches the official SDKs
Flag answers SHALL match what the official PostHog SDKs compute for the same definition and person, whether evaluated on the server or locally by the SDK.

#### Scenario: Local and remote
- **WHEN** a Node SDK evaluates a flag locally and a browser SDK asks the server for the same person
- **THEN** both get the same answer

### Requirement: Evaluation survives a store outage
Flag evaluation SHALL NOT need the event store.

#### Scenario: Event store down
- **WHEN** the event store is unavailable
- **THEN** flags still evaluate

### Requirement: Flag changes are audited
Creating, changing and deleting flags SHALL need a permission and SHALL be recorded in the audit log.

#### Scenario: Turning a flag off
- **WHEN** an admin turns a flag off
- **THEN** SDKs get the new answer within a minute and the audit log names the admin

### Requirement: Experiments
Admins SHALL be able to compare a goal between a flag's variants and see whether the difference is likely real.

#### Scenario: Too little data
- **WHEN** an experiment has too few people to tell
- **THEN** it says so instead of naming a winner
