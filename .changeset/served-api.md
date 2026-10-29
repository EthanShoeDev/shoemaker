---
'shoemaker': minor
---

A TanStack Start app can serve an effect-api app at `/api`
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
