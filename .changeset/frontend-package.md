---
'shoemaker': patch
---

New package kind `frontend` (`{ name: 'frontend', kind: 'frontend', api: 'api' }`):
client code the repo's frontends share, with no React and no UI. It holds the
effect-api app's endpoints as Effect atoms: `ApiClient` (`AtomHttpApi` over the
contract), `withApiTransport` to seed an atom registry with where requests go,
and one atom module per resource. `init` adds one when a TanStack Start site
serves an API (`--no-frontend` to skip).

A site that serves an API with a frontend package reads it through those atoms
instead of `callApi`: the router owns a raf-effect-atom registry (one per
server request, one per tab), route loaders start atoms with
`context.atoms.ensure`, components read them with `useAtomResult`, and the
server's results stream into the browser's registry. Every TanStack Start
app's `tsconfig.json` now sets `declaration: false`, since an app emits no
declarations and raf-effect-atom's router context otherwise fails TS2883.

Existing repos with a site serving an API that want this (for a coding agent;
`web` stands for the site, `api` for the effect-api app, `@scope` for the
repo's scope):

1. Add `{ name: 'frontend', kind: 'frontend', api: 'api' }` to `packages` in
   `shoemaker.config.ts`, then run `bun run shoemaker:sync`. It writes
   `packages/frontend/` and updates `apps/web/package.json`
   (`@scope/frontend`, `@effect/atom-react` and `raf-effect-atom` in;
   `@scope/api-contract` out) and `apps/web/tsconfig.json`.
2. Generate a scratch repo with the same config
   (`bunx shoemaker init /tmp/frontend-ref --yes --no-git --apps tanstack-start,effect-api`)
   and copy its `apps/web/src/api-transport.ts` and
   `apps/web/test/api-transport.test.ts` into the repo, fixing the scope.
3. Merge the scratch repo's `apps/web/src/router.tsx` (`makeRegistry`,
   `Loader.make`, `setupRouterAtoms`) and `apps/web/src/routes/__root.tsx`
   (`createRootRouteWithContext`, `WaterfallDetection`) into the repo's.
4. For each `callApi(...)` in a loader, add a query atom to
   `packages/frontend/src/<resource>.ts` (`ApiClient.query` with a
   `serializationKey`), return `context.atoms.ensure(atom, ...args)` from the
   loader, and read it in the component with
   `useAtomResult(atom, Route.useLoaderData())`. Writes become
   `ApiClient.mutation` atoms that pass `reactivityKeys`.
5. Delete `apps/web/src/api-client.ts` and its test once nothing imports
   `callApi`.
6. `bun install`, then `bunx turbo run lint:check typecheck test build`.
