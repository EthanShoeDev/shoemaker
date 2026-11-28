---
'shoemaker': patch
---

Secret values come from a remote store, never from a local file, gitignored or
not. The generated AGENTS.md, `.env.schema` and `secretspec.toml` say so and
carry the Infisical setup for private repos, whose URL comes from
`INFISICAL_DOMAIN`. The new `secrets-backend` doctor check fails on a secrets
manager with no remote backend, a local secretspec provider, or a secret left
in `.env`, `.env.local` or a stage's dotenv file (`.env.production.local`; not
`.env.test`).

In an existing repo, after `shoemaker sync`:

1. Run `bunx shoemaker doctor` and read the `secrets-backend` findings. They
   name variables, never values.
2. Pick the store: the user's self-hosted Infisical for a private repo, any
   remote store for a public one. If `INFISICAL_DOMAIN` is unset, ask the user
   for it and have them set it in their environment. Never write the URL into a
   public repo.
3. Add the plugin or provider the way the comment at the top of `.env.schema`
   or `secretspec.toml` shows. With varlock, install the plugin first
   (`bun add -d @varlock/infisical-plugin`, then `bun run catalog:fix`).
4. Ask the user to put each named value in the store. Do not print or copy
   values yourself.
5. Check that `varlock load` or `secretspec check` resolves every variable,
   then have the user delete the values from the local files.
6. Keep only the credential that opens the store on the machine, in its
   environment or encrypted with `bunx varlock encrypt --file .env.local`.
