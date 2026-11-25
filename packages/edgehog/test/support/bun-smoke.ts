// Run by Bun: flags defined and evaluated on PGlite, with nothing of
// Cloudflare's.
import { PgliteClient } from '@effect/sql-pglite';
import { OpenFeature } from '@openfeature/server-sdk';
import { Console, Effect, Layer, ManagedRuntime } from 'effect';
import { runMigrations } from 'shoemaker-admin/sql';

import { FlagStore } from '../../src/index.ts';
import { edgehogProvider } from '../../src/openfeature.ts';
import { flagMigrations, flagStoreLayer } from '../../src/sql.ts';
import { boolean } from './definitions.ts';

const runtime = ManagedRuntime.make(
  flagStoreLayer.pipe(
    Layer.provide(Layer.effectDiscard(runMigrations(flagMigrations))),
    Layer.provide(PgliteClient.layer({})),
  ),
);

await runtime.runPromise(
  Effect.gen(function* () {
    const store = yield* FlagStore;
    yield* store.create(1, {
      key: 'f',
      config: boolean([{ conditions: [], share: 100, variant: 'on' }]),
    });
    yield* Effect.promise(() =>
      OpenFeature.setProviderAndWait(
        edgehogProvider({
          projectId: 1,
          run: (effect) => runtime.runPromise(effect),
        }),
      ),
    );
    const details = yield* Effect.promise(() =>
      OpenFeature.getClient().getBooleanDetails('f', false),
    );
    yield* Console.log(`bun ${'bun' in process.versions} ${details.value}`);
  }),
);
await runtime.dispose();
