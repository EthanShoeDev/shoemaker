import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { equals } from 'shoemaker-utils/testing/assertions';

import { Flag, FlagStore } from '../../src/index.ts';
import { boolean, text } from '../support/definitions.ts';
import { makeHost } from '../support/host.ts';

const FLAGS = '/projects/1/flags';

const decodeFlag = Schema.decodeEffect(Schema.fromJsonString(Flag));

const on = boolean([{ conditions: [], variant: 'on' }]);

const setup = Effect.gen(function* () {
  const host = yield* makeHost;
  const created = yield* host.send('admin', 'POST', FLAGS, {
    key: 'new-checkout',
    config: on,
  });
  assert.strictEqual(created.status, 201, created.body);
  const flag = yield* decodeFlag(created.body);
  const path = `${FLAGS}/${flag.id}`;
  const actions = Effect.map(
    host.entries,
    Arr.map((entry) => entry.action),
  );
  return { ...host, flag, path, actions };
});

describe('the flags API', () => {
  it.effect('turning a flag off is recorded with the admin', () =>
    Effect.gen(function* () {
      const { send, flag, path, entries } = yield* setup;
      const off = yield* send('admin', 'PUT', path, {
        version: 1,
        config: { ...on, enabled: false },
      });
      assert.strictEqual(off.status, 200, off.body);
      const [entry] = yield* entries;
      assert.deepInclude(entry, {
        actorId: 'id-admin',
        actorEmail: 'admin@example.com',
        action: 'flag.update',
        targetKind: 'flag',
        targetId: flag.id,
        detail: 'new-checkout of project 1: turned off',
      });
    }),
  );

  it.effect('records each change once, and what it was', () =>
    Effect.gen(function* () {
      const { send, path, entries } = yield* setup;
      yield* send('admin', 'PUT', path, {
        version: 1,
        config: { ...on, rules: [], defaultVariant: 'on' },
      });
      yield* send('admin', 'PUT', path, {
        version: 2,
        config: { ...on, enabled: false, defaultVariant: 'on', rules: [] },
      });
      yield* send('admin', 'PUT', path, {
        version: 3,
        config: { ...on, defaultVariant: 'off' },
      });
      yield* send('admin', 'DELETE', `${path}?version=4`);
      const all = yield* entries;
      assert.deepStrictEqual(
        Arr.map(all, (entry) => [entry.action, entry.detail]),
        [
          ['flag.delete', 'new-checkout of project 1'],
          [
            'flag.update',
            'new-checkout of project 1: turned on; changed defaultVariant, rules',
          ],
          ['flag.update', 'new-checkout of project 1: turned off'],
          [
            'flag.update',
            'new-checkout of project 1: changed defaultVariant, rules',
          ],
          ['flag.create', 'new-checkout of project 1'],
        ],
      );
      assert.strictEqual(new Set(Arr.map(all, (e) => e.targetId)).size, 1);
    }),
  );

  it.effect('a save that changes nothing is not recorded', () =>
    Effect.gen(function* () {
      const { send, path, actions } = yield* setup;
      const same = yield* send('admin', 'PUT', path, {
        version: 1,
        config: on,
      });
      assert.strictEqual(same.status, 200);
      const flag = yield* decodeFlag(same.body);
      assert.strictEqual(flag.version, 1);
      yield* equals(actions, ['flag.create']);
    }),
  );

  it.effect('a save over somebody else’s change is refused', () =>
    Effect.gen(function* () {
      const { send, path, actions } = yield* setup;
      yield* send('admin', 'PUT', path, { version: 1, config: boolean() });
      const late = yield* send('admin', 'PUT', path, {
        version: 1,
        config: boolean([], false),
      });
      assert.strictEqual(late.status, 409);
      assert.include(late.body, 'FlagChanged');
      // Also one that asks for what is there by now.
      const same = yield* send('admin', 'PUT', path, {
        version: 1,
        config: boolean(),
      });
      assert.strictEqual(same.status, 409);
      yield* equals(actions, ['flag.update', 'flag.create']);
    }),
  );

  it.effect('reading and writing need their own permissions', () =>
    Effect.gen(function* () {
      const { send, path, actions } = yield* setup;
      const statuses = (role: string | undefined) =>
        Effect.forEach(
          [
            ['GET', FLAGS],
            ['GET', path],
            ['POST', FLAGS, { key: 'x', config: on }],
            ['PUT', path, { version: 1, config: boolean() }],
            ['DELETE', `${path}?version=1`],
          ] as const,
          ([method, at, body]) =>
            Effect.map(send(role, method, at, body), ({ status }) => status),
          { concurrency: 1 },
        );
      yield* equals(statuses(undefined), [401, 401, 401, 401, 401]);
      yield* equals(statuses('nobody'), [403, 403, 403, 403, 403]);
      yield* equals(statuses('viewer'), [200, 200, 403, 403, 403]);
      yield* equals(actions, ['flag.create']);
    }),
  );

  it.effect('refuses what is not a flag, and records nothing', () =>
    Effect.gen(function* () {
      const { send, path, actions } = yield* setup;
      const refused = yield* Effect.forEach(
        [
          // Variants of two types.
          { ...on, variants: { on: true, off: 'no' } },
          // Left out, this would serve everybody.
          {
            ...on,
            rules: [{ conditions: [], variant: 'on', shares: 10 }],
          },
        ],
        (config) => send('admin', 'POST', FLAGS, { key: 'bad', config }),
        { concurrency: 1 },
      );
      assert.deepStrictEqual(
        Arr.map(refused, ({ status }) => status),
        [400, 400],
      );
      const strict = yield* send('admin', 'PUT', path, {
        version: 1,
        config: {
          ...on,
          rules: [{ conditions: [], variant: 'on', shares: 10 }],
        },
      });
      assert.strictEqual(strict.status, 400);
      const typed = yield* send('admin', 'PUT', path, {
        version: 1,
        config: text('x'),
      });
      assert.strictEqual(typed.status, 422);
      const taken = yield* send('admin', 'POST', FLAGS, {
        key: 'new-checkout',
        config: on,
      });
      assert.strictEqual(taken.status, 409);
      yield* equals(actions, ['flag.create']);
    }),
  );

  it.effect('knows only the projects the host declares', () =>
    Effect.gen(function* () {
      const { send, flag, services } = yield* setup;
      // The store would find them: only the declaration keeps them away.
      const elsewhere = yield* FlagStore.use((store) =>
        store.create(2, { key: 'hidden', config: on }),
      ).pipe(Effect.provide(services));
      const path = `/projects/2/flags/${elsewhere.id}`;
      const statuses = yield* Effect.forEach(
        [
          ['GET', '/projects/2/flags'],
          ['GET', path],
          ['POST', '/projects/2/flags', { key: 'x', config: on }],
          ['PUT', path, { version: 1, config: boolean() }],
          ['DELETE', `${path}?version=1`],
        ] as const,
        ([method, at, body]) =>
          Effect.map(send('admin', method, at, body), ({ status }) => status),
        { concurrency: 1 },
      );
      assert.deepStrictEqual(statuses, [404, 404, 404, 404, 404]);
      const listed = yield* send('admin', 'GET', FLAGS);
      assert.include(listed.body, flag.id);
      const gone = yield* send('admin', 'GET', `${FLAGS}/nope`);
      assert.strictEqual(gone.status, 404);
    }),
  );

  it.effect('does not replace what it cannot read', () =>
    Effect.gen(function* () {
      const { send, flag, path, services, actions } = yield* setup;
      yield* SqlClient.SqlClient.use(
        (sql) =>
          sql`UPDATE edgehog_flag SET definition = '{}' WHERE id = ${flag.id}`,
      ).pipe(Effect.provide(services));
      const saved = yield* send('admin', 'PUT', path, {
        version: 1,
        config: on,
      });
      assert.strictEqual(saved.status, 409);
      assert.include(saved.body, 'FlagUnreadable');
      yield* equals(actions, ['flag.create']);
    }),
  );
});
