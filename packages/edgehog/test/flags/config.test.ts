import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Option, Record as Rec, Schema } from 'effect';

import { FlagConfig } from '../../src/index.ts';
import { boolean } from '../support/definitions.ts';

const decode = Schema.decodeUnknownOption(FlagConfig, {
  onExcessProperty: 'error',
});
const accepts = (config: unknown) => Option.isSome(decode(config));

const Json = Schema.fromJsonString(Schema.Unknown);
const decodeJson = Schema.decodeEffect(Json);

const rule = { conditions: [], variant: 'on' };

describe('a flag’s configuration', () => {
  it('is of one type', () => {
    assert.isTrue(accepts(boolean()));
    assert.isFalse(
      accepts({ ...boolean(), variants: { on: true, off: 'no' } }),
    );
    assert.isFalse(accepts({ ...boolean(), type: 'string' }));
    assert.isFalse(
      accepts({
        ...boolean(),
        type: 'object',
        variants: { on: [], off: {} },
      }),
    );
  });

  it.each([
    ['a default that is no variant', { defaultVariant: 'maybe' }],
    ['a rule whose variant is none', { rules: [{ ...rule, variant: 'x' }] }],
    ['no variants', { variants: {} }],
    [
      'a variant with no usable name',
      { variants: { on: true, off: false, '': true } },
    ],
    [
      'a number that JSON has no way to write',
      { type: 'number', variants: { on: Number.NaN, off: 1 } },
    ],
    ['a share past all', { rules: [{ ...rule, share: 101 }] }],
    ['a negative share', { rules: [{ ...rule, share: -1 }] }],
    ['a misspelt share', { rules: [{ ...rule, shares: 10 }] }],
    [
      'an unknown operator',
      {
        rules: [
          {
            ...rule,
            conditions: [{ property: 'a', operator: 'regex', value: '.*' }],
          },
        ],
      },
    ],
    [
      'too many variants',
      {
        variants: {
          ...Rec.fromIterableWith(Arr.range(1, 50), (n) => [`v${n}`, true]),
          on: true,
          off: false,
        },
      },
    ],
    [
      'too many conditions',
      {
        rules: [
          {
            ...rule,
            conditions: Arr.makeBy(21, () => ({
              property: 'a',
              operator: 'exists',
            })),
          },
        ],
      },
    ],
    [
      'too many values',
      {
        rules: [
          {
            ...rule,
            conditions: [
              { property: 'a', operator: 'in', values: Arr.range(0, 1000) },
            ],
          },
        ],
      },
    ],
    ['too many rules', { rules: Arr.makeBy(51, () => rule) }],
  ])('is refused with %s', (_name, change) => {
    assert.isFalse(accepts({ ...boolean(), ...change }));
  });

  const object = (value: unknown) => ({
    type: 'object',
    enabled: true,
    variants: { a: value },
    defaultVariant: 'a',
    rules: [],
  });

  it.effect('holds no own __proto__, at any depth', () =>
    Effect.gen(function* () {
      const bad = yield* decodeJson('{"x":[{"__proto__":{"isAdmin":true}}]}');
      const good = yield* decodeJson('{"x":[{"proto":{"isAdmin":true}}]}');
      assert.isFalse(accepts(object(bad)));
      assert.isTrue(accepts(object(good)));
    }),
  );

  it('is not nested without end', () => {
    const nested = (depth: number): unknown =>
      depth === 0 ? 0 : { a: nested(depth - 1) };
    assert.isTrue(accepts(object(nested(20))));
    assert.isFalse(accepts(object(nested(21))));
  });
});
