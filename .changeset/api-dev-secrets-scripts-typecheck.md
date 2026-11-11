---
'shoemaker': patch
---

An Effect API's `dev` script runs under the repo's secrets tool
(`varlock run -- bun --watch src/bin.ts`, or `secretspec run`), so the API
can read env vars beyond its defaulted `PORT`. Under varlock its package.json
sets `varlock.loadPath` to the repo root, where `.env.schema` lives, as a
TanStack Start app's already does.

Package tsconfigs include `scripts/**/*`, so build scripts there are
typechecked and get oxlint's type-aware rules.

A TanStack Start app's `vite.config.ts` always configures import protection
with `behavior: 'error'`, which fails `vite dev` as well as the build instead
of mocking a denied import in dev. The client deny-list adds
`@effect/platform-bun/**` and `@effect/platform-node/**`, `alchemy/**` and
`@alchemy.run/**` when the repo uses alchemy, and every export of a served
API (`<api>/**`, which was `<api>/handlers` only).

Sync rewrites all three files, so existing repos pick this up with no manual
steps. A repo whose client code imports one of the newly denied packages
fails `vite dev` and `vite build` after syncing until that import moves
behind a `*.server.*` file or server function.
