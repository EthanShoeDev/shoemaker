# Tasks

Tasks marked **[React project]** happen in that repo's own checkout, never in `.external/`. Tasks marked **[Ethan]** include a deploy, which agents don't run. Package tasks also pass `bunx turbo run lint:check --filter=<pkg>` and `bun run test`.

## 1. Operations

- [ ] 1.1 Set roles, with unknown and own roles refused; verify each scenario against the in-memory directory and in-memory Better Auth, with audit entries
- [ ] 1.2 Declared optional operations, readable by a client; verify an undeclared one is refused and reported as unsupported
- [ ] 1.3 Invite with name and roles, and password link; verify each scenario, one with a verified email required, and that no response, log or audit entry holds a link or token
- [ ] 1.4 Delete; verify each scenario, and that the audit log keeps the user's id
- [ ] 1.5 README and changeset with numbered adoption steps that name the breaking one; verify a fresh reader can follow them

## 2. Adoption

- [ ] 2.1 **[React project]** Upgrade pins; verify its full checks pass before adopting anything
- [ ] 2.2 **[React project]** Find every caller of a Better Auth admin endpoint, mobile app included; verify the list is in the commit message of 2.3
- [ ] 2.3 **[React project]** Adopt the core mark `outing` as public, and switch the users page to the users API, paging past 100 users, in the commit that closes Better Auth's endpoints; verify its tests, with every user action audited and only stop-impersonating still open
- [ ] 2.4 **[Ethan]** Set `ADMIN_EMAILS`, deploy, and confirm each user action works and appears in the audit log
