import { assert, describe, it } from '@effect/vitest';
import {
  type Client,
  ErrorCode,
  ProviderEvents,
  ServerProviderStatus,
} from '@openfeature/server-sdk';
import {
  Array as Arr,
  Effect,
  Fiber,
  Record as Rec,
  Ref,
  References,
  Schema,
} from 'effect';
import { TestClock } from 'effect/testing';
import { equals } from 'shoemaker-utils/testing/assertions';

import {
  EvaluatedFlags,
  type FlagConfig,
  FlagDefinitions,
  readFlag,
} from '../../src/index.ts';
import { edgehogProvider, handOver } from '../../src/openfeature.ts';
import { boolean, define, definitions, text } from '../support/definitions.ts';
import { makeProvider, register, settle } from '../support/openfeature.ts';
import { makeStorage } from '../support/storage.ts';

const SECRET = 'plan-nobody-may-see';

const held = definitions(
  define('on', boolean([{ conditions: [], variant: 'on' }])),
  define(
    'ruled',
    boolean([
      {
        conditions: [{ property: 'plan', operator: 'in', values: [SECRET] }],
        variant: 'on',
      },
    ]),
    3,
  ),
  define('shared', boolean([{ conditions: [], share: 50, variant: 'on' }])),
  define('greeting', text('hello')),
  define('off', boolean([], false)),
  define('broken', null),
);

const setup = Effect.fnUntraced(function* (
  outage: 'down' | 'hanging' | 'up' = 'up',
  options: { readonly lazy?: boolean } = {},
) {
  const storage = makeStorage(held);
  yield* Ref.set(storage.outage, outage);
  const provider = yield* Effect.provide(makeProvider(options), storage.layer);
  const events: Array<string> = [];
  const { client, registered, announced } = yield* register(provider);
  for (const event of [
    ProviderEvents.Ready,
    ProviderEvents.Stale,
    ProviderEvents.Error,
    ProviderEvents.ConfigurationChanged,
  ] as const) {
    client.addHandler(event, () => void events.push(event));
  }
  yield* settle;
  return { storage, provider, client, events, registered, announced };
});

const ask = (client: Client, key: string, context = {}) =>
  Effect.promise(() => client.getBooleanDetails(key, false, context));

const quiet = Effect.provideService(References.MinimumLogLevel, 'None');

describe('the provider', () => {
  it.effect('answers in process, with metadata and no error', () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const details = yield* ask(client, 'ruled', { plan: SECRET });
      assert.deepInclude(details, {
        value: true,
        variant: 'on',
        reason: 'TARGETING_MATCH',
        flagMetadata: { version: 3 },
      });
      assert.isUndefined(details.errorCode);
    }),
  );

  it.effect('is announced ready once', () =>
    Effect.gen(function* () {
      const { announced } = yield* setup();
      assert.strictEqual(announced(), 1);
    }),
  );

  it.effect('gives the default and the reason or code', () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const codes = yield* Effect.forEach(
        ['nope', 'greeting', 'shared', 'broken', 'off'],
        (key) =>
          Effect.map(
            Effect.promise(() => client.getBooleanDetails(key, true)),
            (details) => [details.value, details.errorCode ?? details.reason],
          ),
        { concurrency: 1 },
      );
      assert.deepStrictEqual(codes, [
        [true, ErrorCode.FLAG_NOT_FOUND],
        [true, ErrorCode.TYPE_MISMATCH],
        [true, ErrorCode.TARGETING_KEY_MISSING],
        [true, ErrorCode.PARSE_ERROR],
        [true, 'DISABLED'],
      ]);
    }),
  );

  it.effect('reads at most once a minute in an endless loop', () =>
    Effect.gen(function* () {
      const { client, storage } = yield* setup();
      for (const _second of Arr.range(1, 180)) {
        yield* ask(client, 'on');
        yield* ask(client, 'nope');
        yield* TestClock.adjust('1 second');
      }
      yield* equals(storage.reads, 3);
    }),
  );

  it.effect('reports itself stale and answers while storage is down', () =>
    Effect.gen(function* () {
      const { client, storage, events } = yield* setup();
      yield* Ref.set(storage.outage, 'down');
      for (const _second of Arr.range(1, 100)) {
        yield* TestClock.adjust('1 second');
        const details = yield* ask(client, 'on');
        assert.isTrue(details.value);
        yield* ask(client, 'nope');
      }
      yield* settle;
      assert.strictEqual(client.providerStatus, ServerProviderStatus.STALE);
      // As it was registered, then at 60, 70, 80, 90 and 100 seconds.
      yield* equals(storage.reads, 6);
      yield* Ref.set(storage.outage, 'up');
      yield* TestClock.adjust('10 seconds');
      yield* ask(client, 'on');
      yield* settle;
      assert.strictEqual(client.providerStatus, ServerProviderStatus.READY);
      assert.deepStrictEqual(events, [
        ProviderEvents.Ready,
        ProviderEvents.Stale,
        ProviderEvents.Ready,
      ]);
    }).pipe(quiet),
  );

  it.effect('that never loaded gives every default, then recovers', () =>
    Effect.gen(function* () {
      const { client, storage, registered } = yield* setup('down');
      assert.strictEqual(registered._tag, 'Failure');
      assert.strictEqual(client.providerStatus, ServerProviderStatus.ERROR);
      const details = yield* ask(client, 'on');
      assert.isFalse(details.value);
      assert.strictEqual(details.errorCode, ErrorCode.GENERAL);
      yield* Ref.set(storage.outage, 'up');
      yield* TestClock.adjust('10 seconds');
      const after = yield* ask(client, 'on');
      assert.isTrue(after.value);
      yield* settle;
      assert.strictEqual(client.providerStatus, ServerProviderStatus.READY);
    }).pipe(quiet),
  );

  it.effect('fails to start within seconds when storage hangs', () =>
    Effect.gen(function* () {
      const setting = yield* Effect.forkChild(setup('hanging'));
      yield* settle;
      yield* TestClock.adjust('5 seconds');
      const { client } = yield* Fiber.join(setting);
      assert.strictEqual(client.providerStatus, ServerProviderStatus.ERROR);
    }).pipe(quiet),
  );

  it.effect('says which flags changed', () =>
    Effect.gen(function* () {
      const { client, storage } = yield* setup();
      const changed: Array<ReadonlyArray<string> | undefined> = [];
      client.addHandler(
        ProviderEvents.ConfigurationChanged,
        (event) => void changed.push(event?.flagsChanged),
      );
      yield* Ref.set(
        storage.held,
        new Map([
          ...held,
          ['on', define('on', boolean([], false), 2)] as const,
          ['new', define('new', boolean())] as const,
        ]),
      );
      yield* TestClock.adjust('1 minute');
      const details = yield* ask(client, 'on');
      assert.strictEqual(details.reason, 'DISABLED');
      yield* settle;
      assert.deepStrictEqual(changed, [['on', 'new']]);
    }),
  );
});

describe('a lazy provider', () => {
  it.effect('reads nothing until the first evaluation', () =>
    Effect.gen(function* () {
      const { client, storage, announced } = yield* setup('up', { lazy: true });
      assert.strictEqual(client.providerStatus, ServerProviderStatus.READY);
      yield* equals(storage.reads, 0);
      const details = yield* ask(client, 'on');
      assert.isTrue(details.value);
      yield* settle;
      yield* equals(storage.reads, 1);
      assert.strictEqual(announced(), 1);
    }),
  );

  it.effect('is in error, not ready, when it cannot load, and recovers', () =>
    Effect.gen(function* () {
      const { client, storage } = yield* setup('down', { lazy: true });
      const details = yield* ask(client, 'on');
      assert.strictEqual(details.errorCode, ErrorCode.GENERAL);
      yield* settle;
      assert.strictEqual(client.providerStatus, ServerProviderStatus.ERROR);
      yield* Ref.set(storage.outage, 'up');
      yield* TestClock.adjust('10 seconds');
      const after = yield* ask(client, 'on');
      assert.isTrue(after.value);
      yield* settle;
      assert.strictEqual(client.providerStatus, ServerProviderStatus.READY);
    }).pipe(quiet),
  );

  it.effect('answers every cold request from one load', () =>
    Effect.gen(function* () {
      const { client, storage } = yield* setup('up', { lazy: true });
      yield* Ref.set(storage.outage, 'slow');
      const asking = yield* Effect.forkChild(
        Effect.replicateEffect(ask(client, 'on'), 20, {
          concurrency: 'unbounded',
        }),
      );
      yield* settle;
      yield* TestClock.adjust('3 seconds');
      const found = yield* Fiber.join(asking);
      assert.isTrue(Arr.every(found, (details) => details.value));
      yield* equals(storage.reads, 1);
    }),
  );

  it.effect('outlives a first request that is stopped for good', () =>
    Effect.gen(function* () {
      const storage = makeStorage(held);
      const context = yield* Effect.context();
      const run = Effect.runPromiseWith(context);
      let first = true;
      const { client } = yield* register(
        edgehogProvider({
          projectId: 1,
          lazy: true,
          run: (effect) => {
            const stopped = first;
            first = false;
            return run(
              Effect.provideService(effect, FlagDefinitions, {
                // Not even its timers go on.
                load: stopped
                  ? () => Effect.uninterruptible(Effect.never)
                  : storage.load,
              }),
            );
          },
        }),
      );
      void client.getBooleanValue('on', false);
      yield* settle;
      const asking = yield* Effect.forkChild(ask(client, 'on'));
      yield* settle;
      yield* TestClock.adjust('10 seconds');
      yield* settle;
      const details = yield* Fiber.join(asking);
      assert.isTrue(details.value);
    }).pipe(quiet),
  );
});

describe('two projects', () => {
  it.effect('with a flag of one key each evaluate their own', () =>
    Effect.gen(function* () {
      const load = (projectId: number) =>
        Effect.succeed(
          definitions(
            define(
              'same',
              projectId === 1
                ? boolean([{ conditions: [], variant: 'on' }])
                : boolean(),
            ),
          ),
        );
      const answers = yield* Effect.forEach(
        [1, 2],
        Effect.fnUntraced(function* (projectId) {
          const provider = yield* makeProvider({ projectId });
          const { client } = yield* register(provider);
          const details = yield* ask(client, 'same');
          return details.value;
        }),
        { concurrency: 1 },
      ).pipe(Effect.provideService(FlagDefinitions, { load }));
      assert.deepStrictEqual(answers, [true, false]);
    }),
  );
});

describe('a provider that was closed', () => {
  it.effect('has forgotten what it held', () =>
    Effect.gen(function* () {
      const { provider, client, storage } = yield* setup();
      yield* Effect.promise(() => provider.onClose?.() ?? Promise.resolve());
      yield* Ref.set(storage.outage, 'down');
      const details = yield* ask(client, 'on');
      assert.strictEqual(details.errorCode, ErrorCode.GENERAL);
    }).pipe(quiet),
  );
});

describe('a context that cannot be read', () => {
  const hostile = () => ({
    get plan(): string {
      throw new Error('boom');
    },
  });

  it.effect('gives the defaults when handed over', () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const flags = yield* handOver(
        client,
        { on: false, greeting: 'x' },
        hostile(),
      );
      assert.deepStrictEqual(flags, {
        on: { value: false, reason: 'ERROR', errorCode: 'GENERAL' },
        greeting: { value: 'x', reason: 'ERROR', errorCode: 'GENERAL' },
      });
    }),
  );
});

const Page = Schema.fromJsonString(EvaluatedFlags);
const toJson = Schema.encodeEffect(Page);
const fromJson = Schema.decodeEffect(Page);

describe('handing over', () => {
  it.effect('a page holds values and variants, and no rules', () =>
    Effect.gen(function* () {
      const { client } = yield* setup();
      const flags = yield* handOver(
        client,
        { ruled: false, greeting: 'hi', off: true, nope: 7 },
        { plan: SECRET },
      );
      assert.deepStrictEqual(flags, {
        ruled: { value: true, variant: 'on', reason: 'TARGETING_MATCH' },
        greeting: { value: 'hello', variant: 'base', reason: 'STATIC' },
        off: { value: true, reason: 'DISABLED' },
        nope: { value: 7, reason: 'ERROR', errorCode: 'FLAG_NOT_FOUND' },
      });
      const page = yield* toJson(flags);
      assert.notInclude(page, SECRET);
      assert.notInclude(page, 'conditions');
      const read = yield* fromJson(page);
      assert.isTrue(readFlag(read, 'ruled', false));
      assert.strictEqual(readFlag(read, 'greeting', 'x'), 'hello');
      // Not handed over, and of another type.
      assert.isTrue(readFlag(read, 'shared', true));
      assert.strictEqual(readFlag(read, 'greeting', 1), 1);
      assert.strictEqual(readFlag(read, 'constructor', 'x'), 'x');
    }),
  );

  it.effect('comes from one state of the definitions, and a fresh one', () =>
    Effect.gen(function* () {
      const on = boolean([{ conditions: [], variant: 'on' }]);
      const all = (config: FlagConfig, version: number) =>
        definitions(
          ...Arr.map(['a', 'b', 'c'], (key) => define(key, config, version)),
        );
      const storage = makeStorage(all(on, 1));
      const provider = yield* Effect.provide(makeProvider(), storage.layer);
      const { client } = yield* register(provider);
      yield* ask(client, 'a');
      yield* Ref.set(storage.held, all(boolean([], false), 2));
      yield* TestClock.adjust('8 hours');
      const page = yield* handOver(client, { a: true, b: true, c: true }, {});
      assert.deepStrictEqual(
        Arr.map(Rec.values(page), (flag) => flag.reason),
        ['DISABLED', 'DISABLED', 'DISABLED'],
      );
      yield* equals(storage.reads, 2);
    }),
  );

  it.effect('keeps one state when storage changes halfway', () =>
    Effect.gen(function* () {
      // Always due, as if a minute passed between any two evaluations.
      let version = 0;
      const load = () =>
        Effect.map(
          Effect.andThen(
            TestClock.adjust('1 minute'),
            Effect.sync(() => {
              version += 1;
              return version;
            }),
          ),
          (at) =>
            definitions(
              ...Arr.map(['a', 'b'], (key) => define(key, text(`v${at}`))),
            ),
        );
      const provider = yield* makeProvider({ lazy: true }).pipe(
        Effect.provideService(FlagDefinitions, { load }),
      );
      const { client } = yield* register(provider);
      for (const _time of [1, 2, 3]) {
        const page = yield* handOver(client, { a: '', b: '' }, {});
        assert.strictEqual(page.a?.value, page.b?.value);
      }
    }),
  );
});
