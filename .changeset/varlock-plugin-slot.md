---
'shoemaker': patch
---

`.env.schema` leaves a project-owned spot for varlock plugins. The managed
`header` region now ends before the `# ---` divider, and the lines between it
and the divider belong to the project, so root decorators such as
`@plugin(@varlock/infisical-plugin)` and `@initInfisical(...)` survive `sync`.
varlock reads every comment block before the first item as header, so they
take effect there. shoemaker has no plugin option: plugin arguments such as a
self-hosted Infisical URL can be private, so each repo writes its own and can
pass them as `$VAR` references that resolve from `.env.local` or CI.

In an existing repo, after `shoemaker sync`:

1. In `.env.schema`, find `# shoemaker:end header`. `sync` removed the `# ---`
   divider that used to sit just above it.
2. Directly below that marker, with no blank line, add
   `# Project root decorators (plugins) go here; shoemaker never touches them.`
   and then `# ---`, then keep the blank line before `# shoemaker:begin vars`.
3. Put any plugin decorators between those two new lines. In a public repo,
   don't commit a private value such as a self-hosted URL: pass
   `siteUrl=$INFISICAL_SITE_URL`, and declare that variable (and the plugin's
   credentials) as `@sensitive` in the project-only section at the bottom.
