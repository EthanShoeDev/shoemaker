# Spec Delta

## Purpose

Answers how people use a product: trends, funnels, retention, and who did what.

## ADDED Requirements

### Requirement: Trends
Admins SHALL be able to chart counts or unique people for events over time, filtered and broken down by a property.

<!-- step 9 -->

#### Scenario: Unique people
- **WHEN** one person fires an event five times in a day
- **THEN** the unique count for that day is one

### Requirement: Days and weeks follow the project
Days and weeks SHALL follow the project's time zone and first day of the week, by default UTC and Sunday.

<!-- step 9 -->

#### Scenario: Late evening
- **WHEN** an event happens at 23:30 in the project's time zone
- **THEN** it counts on that day

### Requirement: Funnels
Admins SHALL be able to see how many people complete ordered steps within a time window that starts at the first step and includes its end. Steps at the same instant SHALL count in order.

<!-- step 10 -->

#### Scenario: Out of order
- **WHEN** a person does step two before step one and never again
- **THEN** they count for step one only

#### Scenario: Starting again
- **WHEN** a person does step one, waits past the window, then does both steps
- **THEN** they complete the funnel

#### Scenario: Too late
- **WHEN** a person does step two after the window
- **THEN** they do not count for step two

### Requirement: Retention
Admins SHALL be able to see how many people from each starting period return in later periods, where a person starts in every period they do the first event.

<!-- step 10 -->

#### Scenario: Returning person
- **WHEN** a person starts in week one and returns in week three
- **THEN** they count in week one and week three of that group

### Requirement: Identities merge
Events sent before and after a person is identified SHALL count as one person in every query, including past events. Where both have a property, the identified person's value SHALL win.

<!-- step 9 -->

#### Scenario: Signing in
- **WHEN** an anonymous visitor identifies as a user
- **THEN** their earlier events count as that user's

#### Scenario: Two known users
- **WHEN** an SDK tries to merge a person who is already identified into another
- **THEN** they stay separate and the attempt is logged

#### Scenario: Forced merge
- **WHEN** an SDK asks for a forced merge
- **THEN** it is refused, and an admin can merge the two people instead

#### Scenario: Placeholder id
- **WHEN** an SDK identifies someone as `anonymous`, `null` or `0`
- **THEN** nobody is merged

### Requirement: Events without a person
An event marked as having no person SHALL be stored and counted without creating one.

<!-- step 9 -->

#### Scenario: Anonymous page view
- **WHEN** an SDK sends a page view marked that way
- **THEN** it counts in trends and no person exists for it

### Requirement: Person properties are current
A query that filters by a person property SHALL use the person's current value.

<!-- step 9 -->

#### Scenario: Changed plan
- **WHEN** a person moved from free to pro
- **THEN** filtering by pro includes their earlier events

### Requirement: People pages
Admins SHALL be able to find a person and see their properties, ids and recent events.

<!-- step 9 -->

#### Scenario: Search
- **WHEN** an admin searches for an email held as a person property
- **THEN** that person is found

### Requirement: A person's data can be deleted
Admins SHALL be able to delete a person with all their events and replays.

<!-- step 9 -->

#### Scenario: Deletion
- **WHEN** an admin deletes a person
- **THEN** no query or page returns their data from that moment, and the audit log records the deletion

#### Scenario: Event after deletion
- **WHEN** a delayed event for a deleted session arrives
- **THEN** it is dropped
