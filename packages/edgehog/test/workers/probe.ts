// What the Workers under test have in common: what they count, and how a test
// asks.
import { type Client, OpenFeature } from '@openfeature/server-sdk';
import { Clock, Effect, Layer } from 'effect';
import type { SqlClient } from 'effect/sql';
import { runMigrations } from 'shoemaker-admin/sql';

import { FlagDefinitions, FlagStore } from '../../src/index.ts';
import { handOver } from '../../src/openfeature.ts';
import { flagMigrations } from '../../src/sql.ts';
import { boolean } from '../support/definitions.ts';

const KEY = 'new-checkout';

// Of the isolate, so a new one starts at zero.
const isolate = { loads: 0, delay: 0, shift: 0 };

// Counts loads, and holds them up.
export const instrument = <E, R>(
  flags: Layer.Layer<FlagDefinitions | FlagStore, E, R>,
) =>
  Layer.effect(
    FlagDefinitions,
    Effect.map(Effect.service(FlagDefinitions), (definitions) => ({
      load: Effect.fnUntraced(function* (projectId: number) {
        isolate.loads += 1;
        yield* Effect.sleep(isolate.delay);
        return yield* definitions.load(projectId);
      }),
    })),
  ).pipe(Layer.provideMerge(flags));

// Lets a test pass a minute without waiting for one.
export const shifted = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Clock.clockWith((clock) =>
    Effect.provideService(effect, Clock.Clock, {
      currentTimeMillisUnsafe: () =>
        clock.currentTimeMillisUnsafe() + isolate.shift,
      currentTimeMillis: Effect.map(
        clock.currentTimeMillis,
        (at) => at + isolate.shift,
      ),
      currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
      currentTimeNanos: clock.currentTimeNanos,
      monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
      monotonicTimeNanos: clock.monotonicTimeNanos,
      sleep: (duration) => clock.sleep(duration),
    }),
  );

const ask = (client: Client) =>
  Effect.promise(() =>
    client.getBooleanDetails(KEY, false, { targetingKey: 'user-1' }),
  );

const set = Effect.fnUntraced(function* (enabled: boolean) {
  const store = yield* FlagStore;
  const [flag] = yield* store.list(1);
  const config = boolean([{ conditions: [], variant: 'on' }], enabled);
  yield* flag === undefined
    ? store.create(1, { key: KEY, config })
    : store.update(1, flag.id, { version: flag.version, config });
});

// What a Worker under test answers.
export const answer = Effect.fnUntraced(function* (
  url: URL,
): Effect.fn.Return<unknown, never, FlagStore | SqlClient.SqlClient> {
  const client = OpenFeature.getClient();
  const number = (name: string) => Number(url.searchParams.get(name) ?? 0);
  if (url.searchParams.has('delay')) isolate.delay = number('delay');
  switch (url.pathname) {
    case '/migrate': {
      yield* Effect.orDie(runMigrations(flagMigrations));
      return yield* Effect.orDie(set(true));
    }
    case '/off': {
      return yield* Effect.orDie(set(false));
    }
    case '/shift': {
      isolate.shift += number('ms');
      return isolate.shift;
    }
    case '/loads': {
      return isolate.loads;
    }
    case '/page': {
      return yield* handOver(client, { [KEY]: false, nope: 'x' }, {});
    }
    // Answers while its load has hardly begun, so the platform drops the rest.
    case '/early': {
      yield* Effect.forkDetach(ask(client));
      yield* Effect.sleep('50 millis');
      return 'early';
    }
    default: {
      const details = yield* ask(client);
      return [details.value, details.errorCode ?? details.reason];
    }
  }
});
