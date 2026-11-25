import * as Cloudflare from '@alchemy.run/cloudflare';
import * as SQL from '@alchemy.run/cloudflare/D1/SQL';
import { OpenFeature } from '@openfeature/server-sdk';
import { waitUntil } from 'cloudflare:workers';
import { Effect, Layer } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';

import { edgehogProvider } from '../../src/openfeature.ts';
import { flagStoreLayer } from '../../src/sql.ts';
import { answer, instrument, shifted } from './probe.ts';

const AppDb = Cloudflare.D1.Database('DB');

// A Worker as an Alchemy project writes one: its client is opened per
// execution, and it answers with an Effect.
export default class Flags extends Cloudflare.Worker<Flags>()(
  'Flags',
  { main: import.meta.url },
  Effect.gen(function* () {
    const db = yield* Cloudflare.D1.QueryDatabase(AppDb);
    const services = yield* Layer.build(
      flagStoreLayer.pipe(instrument, Layer.provideMerge(SQL.D1Layer(db))),
    );
    const run = Effect.runPromiseWith(services);
    OpenFeature.setProvider(
      edgehogProvider({
        projectId: 1,
        lazy: true,
        // The client needs the scope of an execution, and this is one.
        run: (effect) => {
          const running = effect.pipe(shifted, Effect.scoped, run);
          waitUntil(running);
          return running;
        },
      }),
    );
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const body = yield* answer(new URL(request.url, 'http://worker.test'));
        return yield* HttpServerResponse.json(body ?? null);
      }).pipe(Effect.provide(services), Effect.orDie),
    };
  }).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseBinding)),
) {}
