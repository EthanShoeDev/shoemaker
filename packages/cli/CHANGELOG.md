# shoemaker

## 0.2.1

### Patch Changes

- [`d0cbf79`](https://github.com/EthanShoeDev/shoemaker/commit/d0cbf79e6802140a5634403e48d0350244293fe5) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - An effect-api app's HttpApi now lives in its own package,
  `packages/<api>-contract` (`@scope/<api>-contract`), with a test that the
  contract documents every endpoint. The API implements it, and clients (the
  site that serves it, a future mobile app) depend on the contract rather than
  the server. The API app no longer exports `./api`. `adopt` reads an existing
  `packages/<api>-contract` as part of the API, and an app or package can't take
  that name. `shoemaker check package-boundaries` now allows one app dependency:
  a TanStack Start site with an `src/routes/api.$.ts` route may depend on the
  API it mounts there.
  
  Existing repos (for a coding agent; `api` stands for the effect-api app's
  name, `@scope` for the repo's scope):
  
  1. Run `bun run shoemaker:sync`. It writes `packages/api-contract/`
     (`package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`,
     `test/index.test.ts`, `README.md`) and adds `@scope/api-contract` to
     `apps/api/package.json` (and to the serving site's, if any).
  2. Replace the seeded `packages/api-contract/src/index.ts` with the body of
     `apps/api/src/api.ts`, keeping any `.prefix('/api')`, then delete
     `apps/api/src/api.ts`. Update `packages/api-contract/test/index.test.ts`
     to list the API's real paths.
  3. Change every `from './api.ts'`, `from '../src/api.ts'` and
     `from '@scope/api/api'` import to `from '@scope/api-contract'`.
  4. Remove the `./api` export from `apps/api/package.json`.
  5. `bun install`, then `bunx turbo run lint:check typecheck test build`.
- Updated dependencies []:
  - shoemaker-oxfmt-config@0.2.1

## 0.2.0

### Minor Changes

- [`8799d00`](https://github.com/EthanShoeDev/shoemaker/commit/8799d00e71dd531643f87ef153189dfab614a2da) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - `init` no longer runs `bun install` (the `--install` flag is gone); the next
  steps say to run it. Alchemy Stacks can register providers apart from where
  apps deploy, including GitHub (repos, Actions secrets and variables) or none
  at all: the wizard asks which providers to use, `--alchemy-providers` adds
  them from the command line, and `infra.providers` records them in
  `shoemaker.config.ts`.

- [`8799d00`](https://github.com/EthanShoeDev/shoemaker/commit/8799d00e71dd531643f87ef153189dfab614a2da) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - `init` commits the generated files as "init via shoemaker", so the first
  commit shows exactly what shoemaker wrote. `--no-git` still skips git
  entirely; without a git identity the files are left staged.

- [`8799d00`](https://github.com/EthanShoeDev/shoemaker/commit/8799d00e71dd531643f87ef153189dfab614a2da) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - A TanStack Start app can serve an effect-api app at `/api`
  (`{ kind: 'tanstack-start', api: '<api app>' }` in `shoemaker.config.ts`).
  `init` does this by default when both are chosen; `--no-serve-api` keeps them
  apart. The site mounts the API's handlers on an `/api/$` server route and
  calls it through one typed client, `callApi`. While the server renders, the
  client reaches the API in-process; in the browser it uses same-origin
  `fetch`. `createIsomorphicFn` chooses between the two. Import protection
  blocks the API's handlers from the browser bundle, and the site deploys the
  API, so it gets no Worker of its own.
  
  Existing repos (for a coding agent; `web` and `api` stand for the app names):
  
  1. Add `api: 'api'` to the `web` app in `shoemaker.config.ts`, then run
     `bun run shoemaker:sync`. That writes `apps/web/src/api.server.ts`,
     `src/api-client.ts`, `src/routes/api.$.ts` and `test/api-client.test.ts`,
     and updates both apps' `package.json` and `apps/web/vite.config.ts`.
  2. In `apps/api/src/api.ts`, append `.prefix('/api')` to the `HttpApi`
     chain.
  3. If the repo deploys to Cloudflare: in `alchemy.run.ts`, remove the
     `./apps/api/src/worker.ts` import and the API's `yield*` and output.
     Delete `apps/api/src/worker.ts`, the `./worker` export, and the
     `@alchemy.run/cloudflare` and `alchemy` dependencies in
     `apps/api/package.json`.
  4. Optionally load data through the API in `apps/web/src/routes/index.tsx`:
     `loader: ({ abortController }) => callApi((api) => ..., { signal: abortController.signal })`.
  5. `bun install`, then `bunx turbo run lint:check typecheck test build`. The
     build regenerates `src/routeTree.gen.ts` with the `/api/$` route.

### Patch Changes

- [`8799d00`](https://github.com/EthanShoeDev/shoemaker/commit/8799d00e71dd531643f87ef153189dfab614a2da) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - Ignore `.external/` (reference repos cloned for agents to read) instead of
  `docs/cloned-repos-as-docs/`: generated repos gitignore it, and the shared
  oxlint, oxfmt and knip configs, jscpd and VS Code skip it.

- [`8799d00`](https://github.com/EthanShoeDev/shoemaker/commit/8799d00e71dd531643f87ef153189dfab614a2da) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - New repos get a `flake.lock` pinned to a known nixpkgs revision, so the first
  `nix fmt` (run by `lint:check`) or `nix develop` no longer writes one and
  leaves the fresh repo with an uncommitted file. `bun run update:nix-flake`
  moves it forward. Existing repos already have the lock nix wrote: commit it.
- Updated dependencies [[`8799d00`](https://github.com/EthanShoeDev/shoemaker/commit/8799d00e71dd531643f87ef153189dfab614a2da)]:
  - shoemaker-oxfmt-config@0.2.0

## 0.1.1

### Patch Changes

- [`ecdfb45`](https://github.com/EthanShoeDev/shoemaker/commit/ecdfb451f77bc5cfc5ba05d106561c7aea157aa1) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - Move to Effect 4.1.0, and pin `@effect/platform-node-shared` alongside it so
  `bunx shoemaker` no longer crashes with "Cannot find module
  'effect/crypto/Aead'" when `@effect/platform-bun`'s `^` range resolves past
  the pinned `effect`. Generated repos now get Effect 4.1.0; foldkit apps will
  not build until foldkit supports it.
- Updated dependencies []:
  - shoemaker-oxfmt-config@0.1.1
