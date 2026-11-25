# Spec Delta

## Purpose

Answers how people use a product: trends, funnels, retention, and who did what.

## ADDED Requirements

### Requirement: Trends
Admins SHALL be able to chart counts or unique people for events over time, filtered and broken down by a property.

#### Scenario: Unique people
- **WHEN** one person fires an event five times in a day
- **THEN** the unique count for that day is one

### Requirement: Funnels
Admins SHALL be able to see how many people complete ordered steps within a time window.

#### Scenario: Out of order
- **WHEN** a person does step two before step one and never again
- **THEN** they count for step one only

#### Scenario: Too late
- **WHEN** a person does step two after the window
- **THEN** they do not count for step two

### Requirement: Retention
Admins SHALL be able to see how many people from each starting period return in later periods.

#### Scenario: Returning person
- **WHEN** a person starts in week one and returns in week three
- **THEN** they count in week one and week three of that group

### Requirement: Identities merge
Events sent before and after a person is identified SHALL count as one person in every query, including past events.

#### Scenario: Signing in
- **WHEN** an anonymous visitor identifies as a user
- **THEN** their earlier events count as that user's

#### Scenario: Two known users
- **WHEN** an SDK tries to merge two already identified people
- **THEN** they stay separate and the attempt is logged

### Requirement: People pages
Admins SHALL be able to find a person and see their properties, ids and recent events.

#### Scenario: Search
- **WHEN** an admin searches for an email held as a person property
- **THEN** that person is found

### Requirement: A person's data can be deleted
Admins SHALL be able to delete a person with all their events and replays.

#### Scenario: Deletion
- **WHEN** an admin deletes a person
- **THEN** no query or page returns their data, and the audit log records the deletion
