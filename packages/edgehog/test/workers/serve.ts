import { D1Client } from '@effect/sql-d1';
import { OpenFeature } from '@openfeature/server-sdk';
import { env } from 'cloudflare:workers';
import { Effect, Layer, ManagedRuntime } from 'effect';

import { edgehogProvider } from '../../src/openfeature.ts';
import { flagStoreLayer } from '../../src/sql.ts';
import { answer, instrument, shifted } from './probe.ts';

// A Worker with a D1 binding, as plain as one can be.
export const serve = (keep: (running: Promise<unknown>) => void) => {
  const runtime = ManagedRuntime.make(
    flagStoreLayer.pipe(
      instrument,
      Layer.provideMerge(D1Client.layer({ db: env.DB })),
    ),
  );
  OpenFeature.setProvider(
    edgehogProvider({
      projectId: 1,
      lazy: true,
      run: (effect) => {
        const running = effect.pipe(shifted, runtime.runPromise);
        keep(running);
        return running;
      },
    }),
  );
  return {
    fetch: (request: Request) =>
      runtime.runPromise(
        Effect.map(answer(new URL(request.url)), (body) =>
          Response.json(body ?? null),
        ),
      ),
  };
};
