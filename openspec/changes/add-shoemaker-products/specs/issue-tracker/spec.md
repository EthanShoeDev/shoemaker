# Spec Delta

## Purpose

Tracks work for people and agents inside a project's own admin, and proves that a second product fits the structure the first one set.

## ADDED Requirements

### Requirement: Issues
Users with permission SHALL be able to create, edit, assign, label, comment on, close and reopen issues.

#### Scenario: Reopening
- **WHEN** a closed issue is reopened
- **THEN** it is open with its history and comments intact

### Requirement: One assignee works at a time
Claiming an issue SHALL succeed for one person or agent, and a claim by an agent SHALL lapse when it stops renewing it.

#### Scenario: Two agents
- **WHEN** two agents claim one issue at once
- **THEN** one succeeds and the other is told who holds it

#### Scenario: Agent disappears
- **WHEN** an agent stops renewing its claim
- **THEN** the issue becomes available again

### Requirement: Links to error issues
An issue SHALL be able to refer to an error issue, and both SHALL show the link.

#### Scenario: Created from an error
- **WHEN** a user creates an issue from an error issue
- **THEN** each links to the other

#### Scenario: Error tracking not installed
- **WHEN** a project has the tracker without Edgehog
- **THEN** every tracker feature except links works

### Requirement: Agents use the same commands
Every issue operation SHALL be available through a CLI and MCP with the same permission checks and history.

#### Scenario: Agent comments
- **WHEN** an agent comments through MCP
- **THEN** the comment shows the account the agent acts for
