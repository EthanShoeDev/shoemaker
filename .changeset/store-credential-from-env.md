---
'shoemaker': patch
---

The credential that opens the secrets store (`INFISICAL_CLIENT_ID` and
`INFISICAL_CLIENT_SECRET`) comes from the environment only. `doctor`
(`secrets-backend`) now fails when a dotenv file holds it, even encrypted with
`varlock encrypt`, and AGENTS.md no longer offers that route.

Public repos use the self-hosted Infisical too, not just private ones: its URL
comes from `INFISICAL_DOMAIN`, which every machine sets, so no repo contains it.
AGENTS.md, the `.env.schema` and `secretspec.toml` headers and doctor's fixes
say so.

`sync` rewrites the AGENTS.md rule and the file headers. A repo that followed the earlier advice
and keeps the credential in a file needs these steps:

1. Run `bunx shoemaker doctor` and find the `secrets-backend` finding that
   names the file holding the store's credential.
2. Ask the user to set each variable it names in their environment (their
   shell profile or a password manager's shell integration, outside the repo).
   Do not print or copy the values yourself.
3. Check that `varlock load` resolves every variable from a new shell.
4. Have the user delete those lines from the file, and delete the file if
   nothing is left in it.
