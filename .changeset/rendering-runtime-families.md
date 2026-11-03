---
'shoemaker': patch
---

Foldkit apps server-render by default. `vite.config.ts` builds
`src/entry.server.ts` and prerenders the paths it lists (`/` and `/about` in
the starter). The deployed host renders every other request, and unknown
routes get a 404. The starter follows foldkit's SSG template: routing, a
hydrating `src/entry.ts`, `src/route.ts`, and no `index.html`.
`rendering: 'spa'` keeps the client-only app. `domain: 'example.com'` on a
Foldkit app sets the prerender origin (`Request.url` during the build) and,
on Cloudflare, `domain:` on its `Website.Foldkit`. On AWS a server-rendered
site gets `output: 'server'`. knip takes both entries as entry points. The new
`foldkit-rendering` doctor check flags a server-rendered app that still has an
`index.html` or has no server entry. `adopt` infers `rendering: 'spa'` for a
Foldkit app without `src/entry.server.ts`.

An Effect API takes `runtime: 'worker'` (a Cloudflare Worker alone: no
`src/bin.ts`, `tsdown.config.ts`, `start` task, `PORT` or
`@effect/platform-bun`) or `runtime: 'bun'` (a Bun server alone, also what a
container runs: no `src/worker.ts`, `./worker` export or alchemy
dependencies). Unset, nothing changes. `'worker'` needs `infra.deploy:
'cloudflare'` and an API no site serves. `adopt` infers the runtime from which
of `src/bin.ts` and `src/worker.ts` exists.

A file shoemaker owns and the user deleted is now a conflict instead of
being re-created silently on every sync. Its reason says to add the path to
`unmanaged` or restore it with `--force`.

`effect-versions:check` also checks alchemy's packages. Every `@alchemy.run/*`
package on alchemy's release train must resolve to `alchemy`'s version, and
every `@alchemy.run/*` or `@distilled.cloud/*` package must resolve to the
exact version alchemy's packages pin. The check also fails when a root
catalog pin in any of these families (or `@effect/*`) is behind, and
`shoemaker check effect-versions --fix` moves those pins. It leaves pins on
another major and ranges that already admit the version alone.

Existing repos (for a coding agent). Do this before running `sync`:

1. For each `kind: 'foldkit'` app in `shoemaker.config.ts` whose
   `apps/<app>/src/entry.server.ts` does not exist, add `rendering: 'spa'`.
   Without it, sync rewrites that app's `vite.config.ts` into an SSR build
   around a client-only `main.ts`. Leave the option off for an app that
   already has a server entry.
2. If such an app's `apps/<app>/vite.config.ts` is listed in `unmanaged`
   only because it holds the `ssr: { serverEntry, clientEntry, build }`
   block, remove it from `unmanaged`. Set the app's `domain` if `build.prerender`
   has an `origin`. Run `bunx shoemaker sync --dry-run` and check that the only
   difference left in `vite.config.ts` is formatting.
3. For each `kind: 'effect-api'` app, set `runtime: 'worker'` if
   `apps/<app>/src/bin.ts` does not exist and `src/worker.ts` does. Set
   `runtime: 'bun'` if the repo deploys to Cloudflare and `src/worker.ts` does
   not exist. Then remove that app's `package.json` and `tsdown.config.ts` from
   `unmanaged` if they are listed only because of the runtime.
4. Run `bunx shoemaker sync`. A conflict that reads "deleted by user" is an
   owned file you removed: add its path to `unmanaged` to keep it deleted, or
   pass `--force <path>` to restore it.
5. Run `bun install`, then `bun run effect-versions:check`. If it lists
   catalog pins behind their family, run
   `bunx shoemaker check effect-versions --fix` and `bun install` again.
6. Run `bunx shoemaker doctor .`, then the repo's lint, typecheck and tests.
