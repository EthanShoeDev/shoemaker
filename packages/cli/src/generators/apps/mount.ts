import { Array as Arr, Option } from 'effect';

import type { App, ShoemakerConfig } from '../../config/schema.ts';

// An effect-api app's HttpApi lives in its own package,
// `packages/<api>-contract`, so every client (a web app, a mobile app, tests)
// depends on the contract and never on the server.
export const contractName = (api: { readonly name: string }) =>
  `${api.name}-contract`;

// A TanStack Start app can serve an effect-api app at /api (`app.api`): one
// origin, one deployment, and server rendering calls the API in-process.

// The effect-api app `site` serves, if any.
export const servedApi = (config: ShoemakerConfig, site: App) =>
  site.api === undefined
    ? undefined
    : Option.getOrUndefined(
        Arr.findFirst(
          config.apps,
          (app) => app.kind === 'effect-api' && app.name === site.api,
        ),
      );

// Whether a site serves this effect-api app, so it deploys with the site.
export const isServed = (config: ShoemakerConfig, api: App) =>
  Arr.some(
    config.apps,
    (app) => app.kind === 'tanstack-start' && app.api === api.name,
  );
