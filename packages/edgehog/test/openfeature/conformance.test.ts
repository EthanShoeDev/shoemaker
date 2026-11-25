import {
  AstBuilder,
  compile,
  GherkinClassicTokenMatcher,
  Parser,
} from '@cucumber/gherkin';
import type { PickleStep } from '@cucumber/messages';
import { NodeServices } from '@effect/platform-node';
import { assert, describe, it } from '@effect/vitest';
import {
  type Client,
  type EvaluationDetails,
  type JsonValue,
  type Provider,
  ProviderEvents,
  ServerProviderStatus,
} from '@openfeature/server-sdk';
import {
  Array as Arr,
  Effect,
  Exit,
  FileSystem,
  Match,
  Option,
  Predicate,
  Record as Rec,
  Ref,
  References,
  Schema,
  String as Str,
} from 'effect';
import { Hex } from 'effect/encoding';
import { TestClock } from 'effect/testing';

import type { FlagConfig, FlagDefinition, FlagType } from '../../src/index.ts';
import { define, definitions, text } from '../support/definitions.ts';
import { makeProvider, register, settle } from '../support/openfeature.ts';
import { makeStorage } from '../support/storage.ts';

const VENDOR = `${import.meta.dirname}/vendor/provider-tck`;

// What the provider can do. Not declared: `@numeric-coercion`, since JavaScript
// cannot tell 10.0 from 10, and `@standard-reasons`, which wants `DEFAULT`
// where a rule did not match and OpenFeature's remote evaluation has no such
// reason.
const LAZY = [
  '@events',
  '@stale',
  '@configuration-change',
  '@object',
  '@variants',
  '@disabled-flags',
  '@string-typing',
  '@fully-typed-values',
  '@large-integers',
  '@targeting',
];

const MODES = [
  {
    mode: 'loading when registered' as const,
    declared: new Set([
      ...LAZY,
      '@lifecycle',
      '@unavailable',
      '@reinitialization',
    ]),
    skipped: 12,
  },
  // Nothing is loaded on registration, so there is no initialization to test.
  { mode: 'lazy' as const, declared: new Set(LAZY), skipped: 18 },
];

type Mode = (typeof MODES)[number]['mode'];

const Canonical = Schema.fromJsonString(
  Schema.Struct({
    flags: Schema.Record(
      Schema.String,
      Schema.Struct({
        state: Schema.Literals(['ENABLED', 'DISABLED']),
        variants: Schema.Record(Schema.String, Schema.Json),
        defaultVariant: Schema.String,
      }),
    ),
  }),
);

const TARGETED = '5c3d8535-f81a-4478-a6d3-afaa4d51199e';

const typeOf = (value: unknown): FlagType => {
  if (Predicate.isBoolean(value)) return 'boolean';
  if (Predicate.isNumber(value)) return 'number';
  return Predicate.isString(value) ? 'string' : 'object';
};

const toDefinitions = (
  flags: (typeof Canonical.Type)['flags'],
): ReadonlyArray<FlagDefinition> =>
  Arr.map(Rec.toEntries(flags), ([key, flag]) =>
    define(key, {
      type: typeOf(flag.variants[flag.defaultVariant]),
      enabled: flag.state === 'ENABLED',
      variants: flag.variants,
      defaultVariant: flag.defaultVariant,
      rules:
        key === 'targeting-key-flag'
          ? [
              {
                conditions: [
                  {
                    property: 'targetingKey',
                    operator: 'in',
                    values: [TARGETED],
                  },
                ],
                variant: 'hit',
              },
            ]
          : [],
    } as FlagConfig),
  );

const EVENTS = {
  ready: ProviderEvents.Ready,
  stale: ProviderEvents.Stale,
  error: ProviderEvents.Error,
  change: ProviderEvents.ConfigurationChanged,
} as const;

const STATES = {
  ready: ServerProviderStatus.READY,
  stale: ServerProviderStatus.STALE,
  error: ServerProviderStatus.ERROR,
} as const;

const toValue = (type: string, written: string): JsonValue =>
  Match.value(type).pipe(
    Match.when('Boolean', () => written === 'true'),
    Match.whenOr('Integer', 'Float', () => Number(written)),
    // The suite's only object is the empty one.
    Match.when('Object', () => ({})),
    Match.orElse(() => written),
  );

const decodeCanonical = Schema.decodeEffect(Canonical);

const { canonical, features } = await Effect.runPromise(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files = yield* fs.readDirectory(VENDOR);
    const flags = yield* Effect.flatMap(
      fs.readFileString(`${VENDOR}/canonical-flags.json`),
      decodeCanonical,
    );
    return {
      canonical: toDefinitions(flags.flags),
      features: yield* Effect.forEach(
        Arr.filter(files, Str.endsWith('.feature')),
        (name) =>
          Effect.map(fs.readFileString(`${VENDOR}/${name}`), (source) => ({
            name,
            source,
          })),
        { concurrency: 1 },
      ),
    };
  }).pipe(Effect.provide(NodeServices.layer)),
);

// One scenario’s state, and the steps the suite is written in.
const makeWorld = Effect.fnUntraced(function* (mode: Mode) {
  const storage = makeStorage(definitions(...canonical));
  const provider: Provider = yield* Effect.provide(
    makeProvider(),
    storage.layer,
  );
  const fired: Array<{ name: string; flags: ReadonlyArray<string> }> = [];
  let client: Client | undefined;
  let flag = { type: '', key: '', fallback: '' };
  let context = {};
  let details: EvaluationDetails<JsonValue> | undefined;
  let remembered: JsonValue | undefined;
  let threw = false;
  let flagsFired: ReadonlyArray<string> = [];

  const open = () => {
    assert.isDefined(client);
    return client;
  };

  const evaluate = Effect.gen(function* () {
    const fallback = toValue(flag.type, flag.fallback);
    const call = (): Promise<EvaluationDetails<JsonValue>> => {
      const { key } = flag;
      if (Predicate.isBoolean(fallback)) {
        return open().getBooleanDetails(key, fallback, context);
      }
      if (Predicate.isNumber(fallback)) {
        return open().getNumberDetails(key, fallback, context);
      }
      return Predicate.isString(fallback)
        ? open().getStringDetails(key, fallback, context)
        : open().getObjectDetails(key, fallback, context);
    };
    const exit = yield* Effect.exit(Effect.promise(call));
    if (Exit.isSuccess(exit)) details = exit.value;
    else threw = true;
  });

  // The provider looks at its storage when it is asked for a flag, as Workers
  // have no background timers. So time passes, and the application goes on.
  const traffic = Effect.gen(function* () {
    yield* TestClock.adjust('1 minute');
    yield* Effect.promise(() => open().getStringValue('string-flag', ''));
    yield* settle;
  });

  const occurred = (name: string) =>
    Effect.gen(function* () {
      yield* settle;
      const at = Arr.findFirstIndex(fired, (event) => event.name === name);
      if (Option.isNone(at)) return yield* Effect.die(`no ${name} event`);
      flagsFired = fired.splice(at.value, 1)[0]?.flags ?? [];
    });

  const attempt = (call: () => Promise<unknown>) =>
    Effect.map(Effect.exit(Effect.promise(call)), (exit) => {
      if (Exit.isFailure(exit)) threw = true;
    });

  const steps: ReadonlyArray<
    readonly [
      RegExp,
      (args: ReadonlyArray<string>, step: PickleStep) => Effect.Effect<void>,
    ]
  > = [
    [
      /^a (stable|unavailable) provider$/u,
      ([kind]) =>
        Effect.gen(function* () {
          yield* Ref.set(storage.outage, kind === 'stable' ? 'up' : 'down');
          ({ client } = yield* register(provider));
          // An application that is already in use.
          if (mode === 'lazy') yield* traffic;
        }),
    ],
    [
      /^a (ready|stale|error|change) event handler$/u,
      ([name = '']) =>
        Effect.sync(() => {
          open().addHandler(EVENTS[name as keyof typeof EVENTS], (event) => {
            const flags =
              event !== undefined && 'flagsChanged' in event
                ? (event.flagsChanged as ReadonlyArray<string>)
                : [];
            fired.push({ name, flags });
          });
        }),
    ],
    [
      /^a (\w+)-flag with key "([^"]*)" and a default value "([^"]*)"$/u,
      ([type = '', key = '', fallback = '']) =>
        Effect.sync(() => {
          flag = { type, key, fallback };
        }),
    ],
    [
      /^a context containing a targeting key with value "([^"]*)"$/u,
      ([targetingKey]) =>
        Effect.sync(() => {
          context = { targetingKey };
        }),
    ],
    [/^the flag was evaluated with details$/u, () => evaluate],
    [
      /^the resolved value is remembered$/u,
      () =>
        Effect.sync(() => {
          remembered = details?.value;
        }),
    ],
    [
      /^the flag was modified$/u,
      () =>
        Effect.gen(function* () {
          yield* Ref.update(
            storage.held,
            (held) =>
              new Map([...held, [flag.key, define(flag.key, text('bar'), 2)]]),
          );
          yield* traffic;
        }),
    ],
    [
      /^the connection is (lost|restored)$/u,
      ([state]) =>
        Effect.andThen(
          Ref.set(storage.outage, state === 'lost' ? 'down' : 'up'),
          traffic,
        ),
    ],
    [
      /^the provider is shut down$/u,
      () => attempt(() => provider.onClose?.() ?? Promise.resolve()),
    ],
    [
      /^the provider is initialized again$/u,
      () => attempt(() => provider.initialize?.() ?? Promise.resolve()),
    ],
    [/^the shutdown should have completed within \d+ms$/u, () => Effect.void],
    [
      /^the (ready|stale|error|change) event handler should have been executed(?: within \d+ms)?$/u,
      ([name = '']) => occurred(name),
    ],
    [/^a (ready) event was fired$/u, ([name = '']) => occurred(name)],
    [
      /^the flag should be part of the event payload$/u,
      () =>
        Effect.sync(() => {
          assert.include(flagsFired, flag.key);
        }),
    ],
    [
      /^the client should be in (ready|stale|error) state$/u,
      ([state = '']) =>
        Effect.sync(() => {
          assert.strictEqual(
            open().providerStatus,
            STATES[state as keyof typeof STATES],
          );
        }),
    ],
    [
      /^the resolved details value should be "([^"]*)"$/u,
      ([expected = '']) =>
        Effect.sync(() => {
          assert.deepStrictEqual(details?.value, toValue(flag.type, expected));
        }),
    ],
    [
      /^the resolved details value should have changed$/u,
      () =>
        Effect.sync(() => {
          assert.notDeepEqual(details?.value, remembered);
        }),
    ],
    [
      /^the resolved object value should contain$/u,
      (_args, step) =>
        Effect.sync(() => {
          const rows = step.argument?.dataTable?.rows ?? [];
          for (const row of Arr.drop(rows, 1)) {
            const [key = '', type = '', written = ''] = Arr.map(
              row.cells,
              (cell) => cell.value,
            );
            assert.deepPropertyVal(details?.value, key, toValue(type, written));
          }
        }),
    ],
    [
      /^the variant should be "([^"]*)"$/u,
      ([expected]) =>
        Effect.sync(() => {
          assert.strictEqual(details?.variant, expected);
        }),
    ],
    [
      /^the reason should be "([^"]*)"$/u,
      ([expected]) =>
        Effect.sync(() => {
          assert.strictEqual(details?.reason, expected);
        }),
    ],
    [
      /^the error-code should be "([^"]*)"$/u,
      ([expected]) =>
        Effect.sync(() => {
          assert.strictEqual(details?.errorCode ?? '', expected);
        }),
    ],
    [
      /^the error message should be empty$/u,
      () =>
        Effect.sync(() => {
          assert.strictEqual(details?.errorMessage ?? '', '');
        }),
    ],
    [
      /^no exception should have been thrown$/u,
      () =>
        Effect.sync(() => {
          assert.isFalse(threw);
        }),
    ],
    [
      /^the provider metadata name should not be empty$/u,
      () =>
        Effect.sync(() => {
          assert.isNotEmpty(open().metadata.providerMetadata.name);
        }),
    ],
  ];

  return Effect.fnUntraced(function* (step: PickleStep) {
    const found = Arr.findFirst(steps, ([pattern]) => pattern.test(step.text));
    if (Option.isNone(found)) {
      return yield* Effect.die(new Error(`No step for: ${step.text}`));
    }
    const [pattern, run] = found.value;
    yield* run(Arr.drop(pattern.exec(step.text) ?? [], 1), step);
  });
});

let ids = 0;
const newId = () => {
  ids += 1;
  return String(ids);
};

const pickles = (
  file: { readonly name: string; readonly source: string },
  declared: ReadonlySet<string>,
) => {
  const parser = new Parser(
    new AstBuilder(newId),
    new GherkinClassicTokenMatcher(),
  );
  const compiled = compile(parser.parse(file.source), file.name, newId);
  return Arr.map(compiled, (pickle, at) => {
    const missing = Arr.filter(
      Arr.map(pickle.tags, (tag) => tag.name),
      (tag) => !declared.has(tag),
    );
    return {
      steps: pickle.steps,
      skipped: missing.length > 0,
      name: Arr.join(
        [
          `${at + 1}. ${pickle.name}`,
          ...Arr.map(missing, (tag) => `(needs ${tag})`),
        ],
        ' ',
      ),
    };
  });
};

// Changed only when the pin moves, and then what is declared is looked at again.
const PINNED = {
  'canonical-flags.json':
    'a01b9c9c53e1c676894b28f829a0db159ec0fa4a96f25777ece77e2417b37ada',
  'errors.feature':
    'e05223d0c31495c0d0c2518f4895069c7ec003e494e69b3761a1162f8bba93d4',
  'evaluation.feature':
    '0f80658799f8143e37ea74ccdb6429660abd0a7122145cb873fa7fd43ed9b479',
  'events.feature':
    '7562455d118e7a4857ee9427b94cf4b2e9418cff12fbb0d481b91fefbf1f43ad',
  'lifecycle.feature':
    '2276713f89d44532d03e2e723584e42e339f4c39a95aa2381f508da7d9511b24',
  'metadata.feature':
    'b6c5733220e3a05f77671f1de0dfbad7ecc5eb51efd1cc2c105de0581b4ad50f',
  'reason.feature':
    'a6dea16f03d442956cae04f3ec1e01a82bf1b115277b7fea24fa495019a3c7fc',
};

it.layer(NodeServices.layer)('the pinned suite', (it) => {
  it.effect('is what was vendored', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const names = yield* fs.readDirectory(VENDOR);
      const files = Arr.filter(names, (name) =>
        /\.(?:feature|json)$/u.test(name),
      );
      const sums = yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (name) {
          const bytes = yield* fs.readFile(`${VENDOR}/${name}`);
          const buffer = yield* Effect.promise(() =>
            crypto.subtle.digest('SHA-256', new Uint8Array(bytes)),
          );
          return [name, Hex.encode(new Uint8Array(buffer))] as const;
        }),
        { concurrency: 1 },
      );
      assert.deepStrictEqual(Rec.fromEntries(sums), PINNED);
    }),
  );
});

describe.each(MODES)(
  'OpenFeature’s provider conformance suite, $mode',
  ({ declared, mode, skipped: expected }) => {
    it('skips only what is not declared', () => {
      const all = Arr.flatMap(features, (file) => pickles(file, declared));
      assert.lengthOf(
        Arr.filter(all, ({ skipped }) => skipped),
        expected,
      );
      assert.lengthOf(all, 65);
    });

    describe.each(features)('$name', (file) => {
      for (const { name, skipped, steps } of pickles(file, declared)) {
        it.effect.skipIf(skipped)(name, () =>
          Effect.gen(function* () {
            const run = yield* makeWorld(mode);
            yield* Effect.forEach(steps, run, {
              concurrency: 1,
              discard: true,
            });
          }).pipe(Effect.provideService(References.MinimumLogLevel, 'None')),
        );
      }
    });
  },
);
