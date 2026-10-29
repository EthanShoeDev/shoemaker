---
'shoemaker': patch
---

An effect-api app's HttpApi now lives in its own package,
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
