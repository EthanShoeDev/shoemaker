# Spec Delta

## Purpose

Defines how a self-contained product fits into a host project, so products can be added, removed and moved between backends without rewriting the host.

## ADDED Requirements

### Requirement: The host chooses where a product is mounted
A product SHALL serve its API under any prefix the host gives it, and its client SHALL use the same prefix. Mounting it SHALL NOT change the host's own API, client or published API description.

#### Scenario: Different prefixes
- **WHEN** one host mounts the users product at `/admin` and another at `/api/admin`
- **THEN** both work without changes to the product

#### Scenario: Public API description
- **WHEN** a host mounts a product
- **THEN** the host's public API description lists no product endpoint

### Requirement: Products share the host's admin auth
Every product endpoint meant for admins SHALL run behind the host's one admin access check.

#### Scenario: Product endpoint
- **WHEN** a visitor without a session calls any admin endpoint of any mounted product
- **THEN** the response is 401

### Requirement: Products can share the host's database
A product SHALL keep its tables under its own name prefix and its migration history in its own table. Its migrations SHALL be safe to run again after a partial failure, including on databases without transactions.

#### Scenario: Shared database
- **WHEN** two products and the host use one database
- **THEN** none of them reads or changes another's tables or migration history

#### Scenario: Interrupted migration
- **WHEN** a migration fails halfway on D1 and the deploy runs again
- **THEN** it completes and is recorded once

### Requirement: Storage is the host's choice
A product SHALL NOT depend on a particular storage backend. Changing the backend SHALL need only a different storage choice in the host's wiring.

#### Scenario: Moving from D1 to Postgres
- **WHEN** a host replaces a product's D1 storage with Postgres
- **THEN** the product's API, pages and the rest of the host are unchanged

### Requirement: A missing choice fails before requests are served
A host that mounts a product without a required storage or auth choice SHALL fail at typecheck or at startup, never on a request.

#### Scenario: No blob store
- **WHEN** a product that needs a blob store is mounted without one
- **THEN** the host does not typecheck

### Requirement: Products describe themselves
A product SHALL publish its id, permissions and navigation entries in a form that both server and browser can read, carrying no server code.

#### Scenario: Browser bundle
- **WHEN** an admin app imports a product's description and pages
- **THEN** its bundle contains no server, database or infrastructure code

### Requirement: Products link by reference
A product SHALL refer to another product's item by a text reference `<product>:<kind>:<id>`, and SHALL keep working when that product is absent.

#### Scenario: Product present
- **WHEN** an issue refers to `edgehog:issue:abc123` and Edgehog is installed
- **THEN** the page links to that error issue

#### Scenario: Product absent
- **WHEN** Edgehog is not installed
- **THEN** the page shows the reference as plain text

### Requirement: A project installs only what it uses
Installing a product SHALL NOT require the frameworks or cloud packages of variants the project does not use.

#### Scenario: Foldkit project
- **WHEN** a Foldkit project on Bun and Postgres installs a product
- **THEN** it needs neither React nor the Cloudflare packages
