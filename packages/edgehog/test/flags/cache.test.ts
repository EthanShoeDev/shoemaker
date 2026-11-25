import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Fiber, Ref, References, Tracer } from 'effect';
import { TestClock } from 'effect/testing';
import { equals } from 'shoemaker-utils/testing/assertions';

import { type FlagCacheEvent, makeFlagCache } from '../../src/flags.ts';
import { FlagDefinitions } from '../../src/index.ts';
import { boolean, define, definitions } from '../support/definitions.ts';
import { makeStorage } from '../support/storage.ts';

const first = definitions(define('f', boolean()));
const second = definitions(define('f', boolean([], false), 2));

const make = (held = first) => {
  const storage = makeStorage(held);
  const events: Array<FlagCacheEvent['kind']> = [];
  const cache = makeFlagCache({
    projectId: 1,
    onEvent: (event) => Effect.sync(() => void events.push(event.kind)),
  });
  return {
    storage,
    events,
    cache,
    read: cache.read.pipe(
      Effect.provide(storage.layer),
      Effect.provideService(References.MinimumLogLevel, 'None'),
    ),
  };
};

describe('cached definitions', () => {
  it.effect('are read at most once a minute, however often they are used', () =>
    Effect.gen(function* () {
      const { storage, read } = make();
      for (const _second of Arr.range(1, 600)) {
        yield* Effect.replicateEffect(read, 10, { discard: true });
        yield* TestClock.adjust('1 second');
      }
      yield* equals(storage.reads, 10);
    }),
  );

  it.effect('show a change within a minute of it', () =>
    Effect.gen(function* () {
      const { storage, read, events } = make();
      yield* read;
      yield* TestClock.adjust('1 second');
      yield* Ref.set(storage.held, second);
      yield* TestClock.adjust('58 seconds');
      yield* equals(read, first);
      yield* TestClock.adjust('1 second');
      yield* equals(read, second);
      assert.deepStrictEqual(events, ['ready', 'changed']);
    }),
  );

  it.effect('are kept and reported stale while storage fails', () =>
    Effect.gen(function* () {
      const { storage, read, events } = make();
      yield* read;
      yield* Ref.set(storage.outage, 'down');
      for (const _second of Arr.range(1, 160)) {
        yield* TestClock.adjust('1 second');
        yield* equals(read, first);
      }
      // At 0, then at 60 and every ten seconds to 160.
      yield* equals(storage.reads, 12);
      assert.deepStrictEqual(events, ['ready', 'stale']);
      yield* Ref.set(storage.outage, 'up');
      yield* Ref.set(storage.held, second);
      yield* TestClock.adjust('10 seconds');
      yield* equals(read, second);
      assert.deepStrictEqual(events, ['ready', 'stale', 'ready', 'changed']);
    }),
  );

  it.effect('that were never loaded are tried every ten seconds', () =>
    Effect.gen(function* () {
      const { storage, read, events } = make();
      yield* Ref.set(storage.outage, 'down');
      for (const _second of Arr.range(1, 60)) {
        yield* equals(read, null);
        yield* TestClock.adjust('1 second');
      }
      yield* equals(storage.reads, 6);
      assert.deepStrictEqual(events, ['error']);
      yield* Ref.set(storage.outage, 'up');
      yield* equals(read, first);
      assert.deepStrictEqual(events, ['error', 'ready']);
    }),
  );

  it.effect('are loaded once by many first readers', () =>
    Effect.gen(function* () {
      const { storage, read } = make();
      const readers = yield* Effect.forkChild(
        Effect.replicateEffect(read, 50, { concurrency: 'unbounded' }),
      );
      yield* TestClock.adjust('1 second');
      const found = yield* Fiber.join(readers);
      assert.isTrue(Arr.every(found, (definitions) => definitions === first));
      yield* equals(storage.reads, 1);
    }),
  );

  it.effect('are never served past a minute while storage answers', () =>
    Effect.gen(function* () {
      const { storage, read, events } = make();
      yield* read;
      yield* Ref.set(storage.held, second);
      yield* Ref.set(storage.outage, 'slow');
      yield* TestClock.adjust('8 hours');
      const readers = yield* Effect.forkChild(
        Effect.replicateEffect(read, 20, { concurrency: 'unbounded' }),
      );
      yield* TestClock.adjust('1900 millis');
      assert.isUndefined(readers.pollUnsafe());
      yield* TestClock.adjust('200 millis');
      const found = yield* Fiber.join(readers);
      assert.isTrue(Arr.every(found, (definitions) => definitions === second));
      yield* equals(storage.reads, 2);
      assert.deepStrictEqual(events, ['ready', 'changed']);
    }),
  );

  it.effect('are served as stale once a load has had its time', () =>
    Effect.gen(function* () {
      const { storage, read, events } = make();
      yield* read;
      yield* TestClock.adjust('1 minute');
      yield* Ref.set(storage.outage, 'hanging');
      const readers = yield* Effect.forkChild(
        Effect.replicateEffect(read, 3, { concurrency: 'unbounded' }),
      );
      yield* TestClock.adjust('5 seconds');
      const found = yield* Fiber.join(readers);
      assert.isTrue(Arr.every(found, (definitions) => definitions === first));
      assert.deepStrictEqual(events, ['ready', 'stale']);
      // Known to be late, so nobody waits for the next attempt but who makes it.
      yield* TestClock.adjust('5 seconds');
      const trying = yield* Effect.forkChild(read);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* equals(read, first);
      assert.isUndefined(trying.pollUnsafe());
      yield* TestClock.adjust('5 seconds');
      yield* equals(Fiber.join(trying), first);
    }),
  );

  const abandon = (cache: ReturnType<typeof makeFlagCache>) =>
    // A Worker may never run the rest of a request: nothing is cleaned up.
    cache.read.pipe(
      Effect.provideService(FlagDefinitions, {
        load: () => Effect.uninterruptible(Effect.never),
      }),
      Effect.forkDetach,
      Effect.andThen(Effect.yieldNow),
      Effect.andThen(Effect.yieldNow),
    );

  it.effect('are stale when whoever was refreshing them is gone', () =>
    Effect.gen(function* () {
      const { cache, read, events, storage } = make();
      yield* read;
      yield* TestClock.adjust('1 minute');
      yield* abandon(cache);
      yield* Ref.set(storage.held, second);
      const reader = yield* Effect.forkChild(read);
      yield* TestClock.adjust('5 seconds');
      yield* equals(Fiber.join(reader), first);
      assert.deepStrictEqual(events, ['ready', 'stale']);
      yield* TestClock.adjust('5 seconds');
      yield* equals(read, second);
      assert.deepStrictEqual(events, ['ready', 'stale', 'ready', 'changed']);
    }),
  );

  it.effect('survive a request that stops for good while loading', () =>
    Effect.gen(function* () {
      const { cache, read } = make();
      yield* abandon(cache);
      const waiting = yield* Effect.forkChild(read);
      yield* TestClock.adjust('9 seconds');
      // It may still load, so it is not answered with nothing.
      assert.isUndefined(waiting.pollUnsafe());
      yield* TestClock.adjust('1 second');
      yield* equals(Fiber.join(waiting), first);
    }),
  );

  it.effect('ignore a load that ends after a later one', () =>
    Effect.gen(function* () {
      const { cache, read } = make();
      const late = yield* Effect.forkChild(
        cache.read.pipe(
          Effect.provideService(FlagDefinitions, {
            load: () => Effect.succeed(second).pipe(Effect.delay('4 seconds')),
          }),
        ),
      );
      yield* Effect.yieldNow;
      yield* cache.reset;
      yield* equals(read, first);
      yield* TestClock.adjust('4 seconds');
      yield* Fiber.join(late);
      yield* equals(read, first);
    }),
  );

  it.effect('are not failed by a reader that gives up', () =>
    Effect.gen(function* () {
      const { storage, read, events } = make();
      yield* Ref.set(storage.outage, 'slow');
      const gone = yield* Effect.forkChild(read);
      yield* TestClock.adjust('1 second');
      yield* Fiber.interrupt(gone);
      const reader = yield* Effect.forkChild(read);
      yield* TestClock.adjust('1100 millis');
      yield* equals(Fiber.join(reader), first);
      yield* equals(storage.reads, 1);
      assert.deepStrictEqual(events, ['ready']);
    }),
  );

  it.effect('are read no more often by readers that keep giving up', () =>
    Effect.gen(function* () {
      const { storage, read } = make();
      yield* Ref.set(storage.outage, 'slow');
      for (const _time of Arr.range(1, 100)) {
        const gone = yield* Effect.forkChild(read);
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(gone);
        yield* TestClock.adjust('500 millis');
      }
      yield* equals(storage.reads, 1);
    }),
  );

  it.effect('are read no more often when the clock is set back', () =>
    Effect.gen(function* () {
      const { storage, read } = make();
      yield* TestClock.setTime(10_000_000);
      yield* read;
      for (const at of Arr.range(1, 100)) {
        yield* TestClock.setTime(10_000_000 - at * 1000);
        yield* read;
      }
      yield* equals(storage.reads, 1);
      // Nor are they kept for longer.
      yield* Ref.set(storage.held, second);
      yield* TestClock.adjust('1 minute');
      yield* equals(read, second);
    }),
  );

  it.effect('say what changed by id as well as by version', () =>
    Effect.gen(function* () {
      const { storage, read, events } = make();
      yield* read;
      // Deleted and made again, with another answer.
      yield* Ref.set(
        storage.held,
        definitions({ ...define('f', boolean([], false)), id: 'again' }),
      );
      yield* TestClock.adjust('1 minute');
      yield* read;
      assert.deepStrictEqual(events, ['ready', 'changed']);
      yield* Ref.set(storage.held, definitions());
      yield* TestClock.adjust('1 minute');
      yield* read;
      assert.deepStrictEqual(events, ['ready', 'changed', 'changed']);
    }),
  );

  it.effect('are another project’s only when asked for', () =>
    Effect.gen(function* () {
      const storage = makeStorage(first);
      const other = makeFlagCache({ projectId: 2 });
      const found = yield* Effect.provide(other.read, storage.layer);
      assert.deepStrictEqual(found, new Map());
    }),
  );

  it.effect('make no span but for a load', () =>
    Effect.gen(function* () {
      const spans: Array<string> = [];
      const { storage, read } = make();
      yield* Ref.set(storage.outage, 'slow');
      const tracer = Tracer.make({
        span: (options) => {
          spans.push(options.name);
          return new Tracer.NativeSpan(options);
        },
      });
      const readers = yield* Effect.forkChild(
        Effect.replicateEffect(read, 20, { concurrency: 'unbounded' }).pipe(
          Effect.withTracer(tracer),
        ),
      );
      yield* TestClock.adjust('3 seconds');
      yield* Fiber.join(readers);
      assert.deepStrictEqual(spans, ['FlagCache.load']);
    }),
  );
});
