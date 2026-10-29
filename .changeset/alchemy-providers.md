---
'shoemaker': minor
---

`init` no longer runs `bun install` (the `--install` flag is gone); the next
steps say to run it. Alchemy Stacks can register providers apart from where
apps deploy, including GitHub (repos, Actions secrets and variables) or none
at all: the wizard asks which providers to use, `--alchemy-providers` adds
them from the command line, and `infra.providers` records them in
`shoemaker.config.ts`.
