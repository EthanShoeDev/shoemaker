import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, String as Str } from 'effect';

import {
  evaluateFlag,
  type FlagContext,
  resolveFlag,
} from '../../src/flags.ts';
import type {
  FlagCondition,
  FlagConfig,
  FlagRule,
  FlagResolution,
} from '../../src/index.ts';
import { boolean, define, definitions, text } from '../support/definitions.ts';

const value = (resolution: FlagResolution) =>
  resolution.kind === 'value' ? resolution.value : undefined;
const reason = (resolution: FlagResolution) =>
  resolution.kind === 'error' ? resolution.errorCode : resolution.reason;

const share = (percentage: number): FlagRule => ({
  conditions: [],
  share: percentage,
  variant: 'on',
});

const PEOPLE = 20_000;
const people = Arr.makeBy(PEOPLE, (at) => `person-${at}`);
const inRollout = (config: FlagConfig, key = 'rollout') =>
  new Set(
    Arr.filter(
      people,
      (targetingKey) =>
        value(evaluateFlag(define(key, config), { targetingKey })) === true,
    ),
  );

describe('a flag', () => {
  it('gives a falsy value', () => {
    const falsy: ReadonlyArray<FlagConfig> = [
      boolean(),
      text(''),
      {
        type: 'number',
        enabled: true,
        variants: { zero: 0 },
        defaultVariant: 'zero',
        rules: [],
      },
    ];
    assert.deepStrictEqual(
      Arr.map(falsy, (config) => value(evaluateFlag(define('f', config), {}))),
      [false, '', 0],
    );
  });

  it('matches a property rule', () => {
    const flag = define(
      'pro',
      boolean([
        {
          conditions: [{ property: 'plan', operator: 'in', values: ['pro'] }],
          variant: 'on',
        },
      ]),
    );
    assert.deepStrictEqual(evaluateFlag(flag, { plan: 'pro' }), {
      kind: 'value',
      value: true,
      variant: 'on',
      reason: 'TARGETING_MATCH',
      flagMetadata: { version: 1 },
    });
    assert.strictEqual(reason(evaluateFlag(flag, { plan: 'free' })), 'STATIC');
    assert.strictEqual(value(evaluateFlag(flag, {})), false);
  });

  it('tries rules in order, and needs every condition of one', () => {
    const flag = define(
      'ordered',
      text('none', [
        {
          conditions: [
            { property: 'plan', operator: 'in', values: ['pro'] },
            { property: 'beta', operator: 'in', values: [true] },
          ],
          variant: 'other',
        },
        {
          conditions: [{ property: 'plan', operator: 'exists' }],
          variant: 'base',
        },
      ]),
    );
    const pick = (context: FlagContext) => value(evaluateFlag(flag, context));
    assert.strictEqual(pick({ plan: 'pro', beta: true }), 'other');
    assert.strictEqual(pick({ plan: 'pro', beta: 'true' }), 'none');
  });

  it('rolls out to about its share, with the same answer each time', () => {
    const config = boolean([share(20)]);
    const first = inRollout(config);
    assert.closeTo(first.size / PEOPLE, 0.2, 0.01);
    assert.deepStrictEqual(inRollout(config), first);
    assert.notDeepEqual(inRollout(config, 'another'), first);
  });

  it('keeps everyone when a rollout widens', () => {
    const before = inRollout(boolean([share(20)]));
    const after = inRollout(boolean([share(40)]));
    assert.closeTo(after.size / PEOPLE, 0.4, 0.01);
    assert.isTrue(Arr.every([...before], (person) => after.has(person)));
  });

  it('moves nobody when rules are added, reordered or edited', () => {
    const before = inRollout(boolean([share(20)]));
    const staff: FlagRule = {
      conditions: [{ property: 'staff', operator: 'in', values: [true] }],
      variant: 'off',
    };
    assert.deepStrictEqual(inRollout(boolean([staff, share(20)])), before);
    assert.deepStrictEqual(inRollout(boolean([share(20), staff])), before);
  });

  it('rolls out to nobody and to everybody without a targeting key', () => {
    const at = (percentage: number) =>
      evaluateFlag(define('f', boolean([share(percentage)])), {});
    assert.strictEqual(value(at(0)), false);
    assert.strictEqual(reason(at(0)), 'STATIC');
    assert.strictEqual(value(at(100)), true);
    assert.strictEqual(reason(at(100)), 'SPLIT');
  });

  it('fails without a targeting key only when it reaches a share', () => {
    const flag = define(
      'f',
      boolean([
        {
          conditions: [{ property: 'plan', operator: 'in', values: ['pro'] }],
          variant: 'on',
        },
        {
          conditions: [{ property: 'country', operator: 'exists' }],
          share: 50,
          variant: 'on',
        },
      ]),
    );
    const at = (context: FlagContext) => reason(evaluateFlag(flag, context));
    assert.strictEqual(at({ plan: 'pro', country: 'nl' }), 'TARGETING_MATCH');
    assert.strictEqual(at({ plan: 'free' }), 'STATIC');
    assert.strictEqual(at({ country: 'nl' }), 'TARGETING_KEY_MISSING');
    assert.strictEqual(
      at({ country: 'nl', targetingKey: '' }),
      'TARGETING_KEY_MISSING',
    );
  });

  it('combines a property and a share', () => {
    const config = boolean([
      {
        conditions: [{ property: 'plan', operator: 'in', values: ['pro'] }],
        share: 50,
        variant: 'on',
      },
    ]);
    const all = inRollout(boolean([share(50)]), 'both');
    for (const targetingKey of Arr.take(people, 200)) {
      const pro = evaluateFlag(define('both', config), {
        plan: 'pro',
        targetingKey,
      });
      assert.strictEqual(value(pro), all.has(targetingKey));
      assert.strictEqual(
        reason(pro),
        all.has(targetingKey) ? 'SPLIT' : 'STATIC',
      );
      const free = evaluateFlag(define('both', config), {
        plan: 'free',
        targetingKey,
      });
      assert.strictEqual(value(free), false);
    }
  });

  it('answers nothing when disabled', () => {
    assert.deepStrictEqual(
      evaluateFlag(define('f', boolean([share(100)], false)), {}),
      { kind: 'disabled', reason: 'DISABLED', flagMetadata: { version: 1 } },
    );
  });

  it('fails when its stored definition cannot be read', () => {
    assert.strictEqual(
      reason(evaluateFlag(define('f', null), {})),
      'PARSE_ERROR',
    );
  });

  it('gives each caller an object of its own', () => {
    const flag = define('f', {
      type: 'object',
      enabled: true,
      variants: { a: { list: [1] } },
      defaultVariant: 'a',
      rules: [],
    });
    const first = value(evaluateFlag(flag, {})) as { list: Array<number> };
    first.list.push(2);
    assert.deepStrictEqual(value(evaluateFlag(flag, {})), { list: [1] });
  });

  it('fails, and does not throw, where the context cannot be read', () => {
    const flag = define(
      'f',
      boolean([
        { conditions: [{ property: 'p', operator: 'exists' }], variant: 'on' },
      ]),
    );
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const hostile = {
      get p(): string {
        throw new Error('boom');
      },
    };
    for (const context of [proxy, hostile, null as never]) {
      assert.strictEqual(reason(evaluateFlag(flag, context)), 'GENERAL');
    }
    assert.strictEqual(
      reason(evaluateFlag(flag, { p: { self: {} }, q: 1n, r: Symbol('r') })),
      'TARGETING_MATCH',
    );
  });

  it('refuses a targeting key that would be costly', () => {
    const flag = define('f', boolean([share(50)]));
    const at = (length: number) =>
      reason(evaluateFlag(flag, { targetingKey: Str.repeat(length)('x') }));
    assert.notStrictEqual(at(1000), 'INVALID_CONTEXT');
    assert.strictEqual(at(1001), 'INVALID_CONTEXT');
  });

  it('is not found in a name every object has', () => {
    const flag = define(
      'f',
      boolean([
        {
          conditions: [{ property: 'constructor', operator: 'exists' }],
          variant: 'on',
        },
      ]),
    );
    assert.strictEqual(value(evaluateFlag(flag, {})), false);
  });
});

describe('an operator', () => {
  const holds = (condition: FlagCondition, context: FlagContext) =>
    value(
      evaluateFlag(
        define('f', boolean([{ conditions: [condition], variant: 'on' }])),
        context,
      ),
    );

  it.each<[FlagCondition, unknown, boolean]>([
    [{ property: 'p', operator: 'in', values: ['a', 1] }, 1, true],
    [{ property: 'p', operator: 'in', values: ['1'] }, 1, false],
    [{ property: 'p', operator: 'in', values: ['a'] }, ['a'], false],
    [{ property: 'p', operator: 'not_in', values: ['a'] }, 'b', true],
    [{ property: 'p', operator: 'not_in', values: ['a'] }, 'a', false],
    [{ property: 'p', operator: 'not_in', values: ['a'] }, undefined, false],
    [{ property: 'p', operator: 'not_in', values: ['a'] }, null, false],
    [{ property: 'p', operator: 'contains', value: 'b' }, 'abc', true],
    [{ property: 'p', operator: 'contains', value: 'B' }, 'abc', false],
    [{ property: 'p', operator: 'starts_with', value: 'a' }, 'abc', true],
    [{ property: 'p', operator: 'starts_with', value: 'b' }, 'abc', false],
    [{ property: 'p', operator: 'ends_with', value: '@x.nl' }, 'a@x.nl', true],
    [
      { property: 'p', operator: 'ends_with', value: '@x.nl' },
      '@x.nl.ru',
      false,
    ],
    [{ property: 'p', operator: 'ends_with', value: 'x' }, 7, false],
    [{ property: 'p', operator: 'gt', value: 1 }, 1, false],
    [{ property: 'p', operator: 'gt', value: 1 }, 2, true],
    [{ property: 'p', operator: 'gte', value: 1 }, 1, true],
    [{ property: 'p', operator: 'lt', value: 1 }, 0, true],
    [{ property: 'p', operator: 'lt', value: 1 }, 1, false],
    [{ property: 'p', operator: 'lte', value: 1 }, 1, true],
    [{ property: 'p', operator: 'lte', value: 1 }, '0', false],
    [{ property: 'p', operator: 'lt', value: 1 }, undefined, false],
    [{ property: 'p', operator: 'exists' }, false, true],
    [{ property: 'p', operator: 'exists' }, null, false],
    [{ property: 'p', operator: 'missing' }, undefined, true],
    [{ property: 'p', operator: 'missing' }, '', false],
  ])('%j against %j', (condition, actual, expected) => {
    assert.strictEqual(
      holds(condition, actual === undefined ? {} : { p: actual }),
      expected,
    );
  });
});

describe('asking for a flag', () => {
  const held = definitions(
    define('text', text('hello')),
    define('off', boolean([], false)),
    define('broken', null),
  );
  const ask = (key: string, type: 'boolean' | 'number' | 'string') =>
    reason(resolveFlag(held, key, type, {}));

  it('that does not exist is FLAG_NOT_FOUND', () => {
    assert.strictEqual(ask('nope', 'boolean'), 'FLAG_NOT_FOUND');
    assert.strictEqual(ask('constructor', 'boolean'), 'FLAG_NOT_FOUND');
  });

  it('of another type is TYPE_MISMATCH', () => {
    assert.strictEqual(ask('text', 'number'), 'TYPE_MISMATCH');
    assert.strictEqual(ask('text', 'string'), 'STATIC');
  });

  it('that is disabled is DISABLED whatever the type', () => {
    assert.strictEqual(ask('off', 'number'), 'DISABLED');
  });

  it('that cannot be read is PARSE_ERROR and spoils no other', () => {
    assert.strictEqual(ask('broken', 'number'), 'PARSE_ERROR');
    assert.strictEqual(ask('text', 'string'), 'STATIC');
  });
});
