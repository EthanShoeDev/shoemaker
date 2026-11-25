import { assert, describe, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { Flag } from '../../src/index.ts';
import { boolean } from '../support/definitions.ts';
import { makeHost } from '../support/host.ts';
import { makeProvider, register } from '../support/openfeature.ts';

const FLAGS = '/projects/1/flags';
const on = boolean([{ conditions: [], variant: 'on' }]);

const decodeFlag = Schema.decodeEffect(Schema.fromJsonString(Flag));

describe('an embedded project', () => {
  it.effect('evaluates what its admin set, and stops within a minute', () =>
    Effect.gen(function* () {
      const { send, entries, services } = yield* makeHost;
      const created = yield* send('admin', 'POST', FLAGS, {
        key: 'new-checkout',
        config: on,
      });
      const flag = yield* decodeFlag(created.body);
      const provider = yield* Effect.provide(makeProvider(), services);
      const { client } = yield* register(provider);
      const ask = Effect.promise(() =>
        client.getBooleanDetails('new-checkout', false),
      );
      const before = yield* ask;
      assert.isTrue(before.value);

      yield* TestClock.adjust('1 second');
      const saved = yield* send('admin', 'PUT', `${FLAGS}/${flag.id}`, {
        version: 1,
        config: { ...on, enabled: false },
      });
      assert.strictEqual(saved.status, 200);
      yield* TestClock.adjust('59 seconds');
      const after = yield* ask;
      assert.isFalse(after.value);
      assert.strictEqual(after.reason, 'DISABLED');

      const [entry] = yield* entries;
      assert.deepInclude(entry, {
        actorId: 'id-admin',
        actorEmail: 'admin@example.com',
        action: 'flag.update',
        targetId: flag.id,
      });
    }),
  );
});
