# Spec Delta

## Purpose

Defines what an admin app shows, and how a project builds its own admin from shared pages without giving up control of the app.

## ADDED Requirements

### Requirement: The app reflects the session
The admin app SHALL show a distinct view for each session state: checking, API unreachable, signed out, signed in without access, impersonating, and admin. It SHALL show admin data only in the admin state.

<!-- step 4 -->

#### Scenario: Signed out
- **WHEN** a signed-out visitor opens an admin page
- **THEN** they see the sign-in page

#### Scenario: Not an admin
- **WHEN** a signed-in user who holds no admin permission opens the app
- **THEN** they see that their account has no access, and a way to sign out

#### Scenario: Impersonating
- **WHEN** the session is impersonated
- **THEN** the app names the user, links to the site and offers to stop impersonating

#### Scenario: Session ends mid-use
- **WHEN** a request is refused because the session changed
- **THEN** the app checks the session again and drops any admin data it holds

#### Scenario: API unreachable
- **WHEN** the session check gets no answer
- **THEN** the app says so and offers to retry

### Requirement: Access follows permissions, not a role name
The app SHALL decide what to show from the caller's permissions, so a project can define admin-like roles under any name.

<!-- step 4 -->

#### Scenario: Support role
- **WHEN** a user holds a `support` role that grants only listing users
- **THEN** the app lets them in and its navigation shows only Users

### Requirement: The sign-in page offers the project's methods
The sign-in page SHALL offer exactly the sign-in methods the project enables, among password and emailed link.

<!-- step 4 -->

#### Scenario: Emailed link only
- **WHEN** a project enables only emailed links
- **THEN** the page asks for an email and shows no password field

### Requirement: Navigation lists installed products and project pages
Navigation SHALL combine entries from installed products with the project's own, in an order the project chooses, and SHALL hide entries the caller's permissions do not cover.

<!-- step 4 -->

#### Scenario: Project pages among product pages
- **WHEN** a project puts its Events page before the product pages
- **THEN** Events comes first in the navigation

### Requirement: The project owns the app
A project SHALL own its routes, layout and pages, and SHALL be able to use any shared page whole, use parts of it, or replace it, without changing the package.

<!-- step 4 -->

#### Scenario: Extra panel on the user page
- **WHEN** a project adds a billing panel and a grant form to the user page
- **THEN** they appear with the shared user details and actions on one page

#### Scenario: Replaced page
- **WHEN** a project replaces the users page with its own
- **THEN** the other shared pages keep working

#### Scenario: Page a product knows nothing about
- **WHEN** a project adds an Imports page
- **THEN** it needs only a route and a navigation entry

### Requirement: Shared pages take the project's appearance
Shared pages SHALL take colors, fonts and radii from the project's design tokens.

<!-- step 4 -->

#### Scenario: Branded admin
- **WHEN** a project sets its own primary color
- **THEN** buttons on shared pages use it

### Requirement: The app is client-only and private
The admin app SHALL call APIs only from the browser on its own origin and SHALL ask search engines not to index it.

<!-- step 4 -->

#### Scenario: Search engines
- **WHEN** a crawler fetches the admin app
- **THEN** the page tells it not to index

### Requirement: Foldkit and React behave alike
The Foldkit and React UIs of a product SHALL offer the same operations with the same results. A product's UI may arrive in one framework first.

<!-- step 4 -->

#### Scenario: Same user page
- **WHEN** an admin bans a user from the Foldkit page or from the React page
- **THEN** the request, the audit entry and the outcome shown are the same
