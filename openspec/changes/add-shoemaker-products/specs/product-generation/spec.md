# Spec Delta

## Purpose

Lets the shoemaker CLI add an admin app and products to new and existing repos, and keep their wiring current without touching project code.

## ADDED Requirements

### Requirement: Config describes auth, the admin app and modules
The config SHALL accept an auth kind (`better-auth` or `none`), an `admin` role on one app, and a `modules` map. All three are optional.

<!-- step 5 -->

#### Scenario: Older config
- **WHEN** a config written before these keys existed is synced
- **THEN** it decodes, and no admin or product file is generated

### Requirement: Invalid admin configs are rejected with the reason
The config SHALL be rejected when an admin app lacks Better Auth, names something other than an effect-api app, is not a TanStack Start or Foldkit app, or is not the only admin app.

<!-- step 5 -->

#### Scenario: No Better Auth
- **WHEN** an app has an admin role and auth is `none`
- **THEN** the error names the app and says the admin needs Better Auth

#### Scenario: Second admin app
- **WHEN** two apps have an admin role
- **THEN** the error names the second

### Requirement: Invalid module configs are rejected with the reason
The config SHALL be rejected when a module names a missing app, needs an admin app that does not exist, or chooses a store or a feature its deploy target cannot run.

<!-- step 5 -->

#### Scenario: Store and target disagree
- **WHEN** a repo that deploys to AWS chooses a D1 store
- **THEN** the error names the module, the store and the target

#### Scenario: Errors off Cloudflare
- **WHEN** a repo that does not deploy to Cloudflare enables error tracking
- **THEN** the error says that error tracking runs on Cloudflare

#### Scenario: Flags off Cloudflare
- **WHEN** a repo on Bun and Postgres enables only flags
- **THEN** the config is accepted

#### Scenario: Unknown SDK target
- **WHEN** a module lists an SDK for an app that does not exist
- **THEN** the error names that app

### Requirement: The admin uses the site's framework
Adding an admin app without naming a kind SHALL give it the kind of the repo's main site, and an explicit kind SHALL win.

<!-- step 5 -->

#### Scenario: Foldkit site
- **WHEN** the repo's site is Foldkit and the admin app's kind is not given
- **THEN** the admin app is Foldkit

### Requirement: Wiring is generated, everything else is seeded
Sync SHALL rewrite only generated wiring files and managed content. The admin's routes, layout, pages, access rules and module settings SHALL be written once and never changed again.

<!-- step 5 -->

#### Scenario: Edited page
- **WHEN** a project edits a seeded admin page and syncs
- **THEN** the page is unchanged

#### Scenario: Module added later
- **WHEN** a project adds a module to its config and syncs
- **THEN** its resources, server mount and navigation entry appear without edits to the Stack, the server or the admin's files

### Requirement: A missing connection is reported
`doctor` SHALL report a repo whose Stack, server or admin app does not use its generated wiring, and SHALL say which line to add.

<!-- step 5 -->

#### Scenario: Existing Stack
- **WHEN** an existing repo adds an admin and its Stack does not use the generated resources
- **THEN** doctor names the file and the line to add

### Requirement: Doctor checks admin safety
`doctor` SHALL report admin endpoints without declared permissions, write endpoints without an audit action, admin emails in committed files, reachable Better Auth admin endpoints, and product versions that differ between server and admin app.

<!-- step 5 -->

#### Scenario: Committed admin email
- **WHEN** a tracked source file holds the admin email list
- **THEN** doctor names the file and points to `ADMIN_EMAILS`

### Requirement: Add can create an admin or a module
`shoemaker add` SHALL add an admin app or a module to an existing repo and sync it.

<!-- step 5 -->

#### Scenario: Add an admin
- **WHEN** `shoemaker add admin` runs in a repo with a site, an effect-api app and Better Auth
- **THEN** the repo has an admin app that typechecks

### Requirement: Agent setup is generated in the repo
A repo with agent access SHALL get a project-local MCP entry that reads its address, key and agent name from the environment. No key SHALL be written to a file.

<!-- step 6 -->

#### Scenario: Generated entry
- **WHEN** a repo enables agent access and syncs
- **THEN** its MCP config names variables and holds no secret

### Requirement: Adopt recognizes existing admin apps
`adopt` SHALL infer Better Auth and an existing admin app, and SHALL NOT report that app's own files as conflicts.

<!-- step 5 -->

#### Scenario: Existing admins
- **WHEN** adopt runs on a repo with a Foldkit admin and on one with a React admin
- **THEN** the inferred config has its admin app and API, and no admin conflict is reported

#### Scenario: Admin-like app
- **WHEN** an app is named `admin` but serves no admin API
- **THEN** it is inferred as an ordinary app

### Requirement: Generated samples prove the wiring
The end-to-end tests SHALL generate, install and check at least one repo with a Foldkit admin, one with a React admin and one with Edgehog, without deploying anything.

<!-- step 5 -->

#### Scenario: End-to-end run
- **WHEN** the end-to-end tests run
- **THEN** each sample passes its own checks and sync reports no drift
