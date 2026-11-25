import {
  OpenFeature,
  type Provider,
  ProviderEvents,
} from '@openfeature/server-sdk';
import { Effect } from 'effect';

import type { FlagDefinitions } from '../../src/index.ts';
import { edgehogProvider } from '../../src/openfeature.ts';

// A provider on the services of the test, its clock among them.
export const makeProvider = Effect.fnUntraced(function* (
  options: { readonly lazy?: boolean; readonly projectId?: number } = {},
) {
  const context = yield* Effect.context<FlagDefinitions>();
  return edgehogProvider({
    projectId: 1,
    run: Effect.runPromiseWith(context),
    ...options,
  });
});

let domains = 0;

// The SDK keeps its providers for the whole process, so each test has a domain.
export const register = Effect.fnUntraced(function* (provider: Provider) {
  domains += 1;
  const domain = `test-${domains}`;
  const client = OpenFeature.getClient(domain);
  let announced = 0;
  client.addHandler(ProviderEvents.Ready, () => {
    announced += 1;
  });
  const registered = yield* Effect.exit(
    Effect.promise(() => OpenFeature.setProviderAndWait(domain, provider)),
  );
  return { client, registered, announced: () => announced };
});

// The SDK delivers its events a few turns later.
export const settle = Effect.forEach(
  [1, 2, 3, 4, 5],
  () =>
    Effect.callback<void>((resume) => {
      setImmediate(() => {
        resume(Effect.void);
      });
    }),
  { concurrency: 1, discard: true },
);
