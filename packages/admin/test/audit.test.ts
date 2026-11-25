import { assert, describe, it } from '@effect/vitest';
import {
  Array as Arr,
  Context,
  Effect,
  Layer,
  Ref,
  Schema,
  String as Str,
} from 'effect';
import { HttpRouter, HttpServer, HttpServerResponse } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';

import { AdminAuth } from '../src/contract.ts';
import {
  type AuditEntry,
  AuditLog,
  AuditPage,
  AuditTrail,
  Audited,
  ReadOnly,
  RequiredPermissions,
} from '../src/index.ts';
import { AuditLive, adminApi, mountAt } from '../src/server.ts';
import { access } from './support/access.ts';
import { Accounts } from './support/accounts.ts';
import { AccessLive, as, post, serve } from './support/app.ts';
import { captureLogs } from './support/logs.ts';
import { AuditOutage } from './support/memory-audit-log.ts';
import { MemoryUsers } from './support/memory-users.ts';

const grant = access.requires({ billing: ['grant'] });

class Broke extends Schema.TaggedError<
  Broke,
  { readonly brand: unique symbol }
>()('Broke', {}, { httpApiStatus: 409 }) {}

const Payload = Schema.Struct({ credit: Schema.Int });

// A project's own admin API, with every shape of endpoint the log cares about.
const ProjectApi = HttpApi.make('admin')
  .add(
    HttpApiGroup.make('project')
      .add(
        HttpApiEndpoint.post('grant', '/customers/:id/credit', {
          params: { id: Schema.String },
          payload: Payload,
          success: HttpApiSchema.NoContent,
        })
          .annotate(RequiredPermissions, grant)
          .annotate(Audited, { action: 'billing.grant', targetKind: 'user' }),
      )
      .add(
        HttpApiEndpoint.put('flag', '/flags/:id', {
          params: { id: Schema.String },
          success: HttpApiSchema.NoContent,
        })
          .annotate(RequiredPermissions, grant)
          .annotate(Audited, { action: 'flag.write', targetKind: 'flag' }),
      )
      .add(
        HttpApiEndpoint.post('create', '/flags', {
          success: HttpApiSchema.NoContent,
        })
          .annotate(RequiredPermissions, grant)
          .annotate(Audited, { action: 'flag.create' }),
      )
      .add(
        HttpApiEndpoint.post('same', '/same', {
          success: HttpApiSchema.NoContent,
        })
          .annotate(RequiredPermissions, grant)
          .annotate(Audited, { action: 'same' }),
      )
      .add(
        HttpApiEndpoint.post('fails', '/fails', { error: Broke })
          .annotate(RequiredPermissions, grant)
          .annotate(Audited, { action: 'fails' }),
      )
      .add(
        HttpApiEndpoint.post('raw', '/raw', {
          success: HttpApiSchema.NoContent,
        })
          .annotate(RequiredPermissions, grant)
          .annotate(Audited, { action: 'raw' }),
      )
      .add(
        HttpApiEndpoint.get('exportAll', '/export', {
          success: HttpApiSchema.NoContent,
        })
          .annotate(RequiredPermissions, grant)
          .annotate(Audited, { action: 'customers.export' }),
      )
      .add(
        HttpApiEndpoint.post('forgotten', '/forgotten').annotate(
          RequiredPermissions,
          grant,
        ),
      )
      .add(
        HttpApiEndpoint.post('query', '/query', {
          success: HttpApiSchema.NoContent,
        })
          .annotate(RequiredPermissions, grant)
          .annotate(ReadOnly, true),
      )
      .add(
        HttpApiEndpoint.post('breaks', '/breaks/:id', {
          params: { id: Schema.String },
          success: HttpApiSchema.NoContent,
        })
          .annotate(RequiredPermissions, grant)
          .annotate(Audited, { action: 'breaks', targetKind: 'flag' }),
      )
      .add(
        HttpApiEndpoint.post('unencodable', '/unencodable/:id', {
          params: { id: Schema.String },
          success: Schema.Int,
        })
          .annotate(RequiredPermissions, grant)
          .annotate(Audited, { action: 'unencodable', targetKind: 'flag' }),
      )
      .add(HttpApiEndpoint.get('undeclared', '/undeclared')),
  )
  .add(
    HttpApiGroup.make('inherits')
      .add(
        HttpApiEndpoint.get('read', '/inherits', {
          success: HttpApiSchema.NoContent,
        }),
      )
      .annotate(RequiredPermissions, grant),
  )
  .middleware(AdminAuth);

const trail = <A>(use: (trail: AuditTrail['Service']) => Effect.Effect<A>) =>
  Effect.flatMap(AuditTrail, use);

const setup = Effect.gen(function* () {
  const calls = yield* Ref.make(0);
  const called = Ref.update(calls, (n) => n + 1);
  const ProjectHandlers = HttpApiBuilder.group(
    ProjectApi,
    'project',
    (handlers) =>
      handlers
        .handle('grant', ({ payload }) =>
          trail((found) => found.detail(`${payload.credit} credits`)),
        )
        .handle('flag', () => called)
        .handle('create', () =>
          trail((found) => found.target({ kind: 'flag', id: 'new' })),
        )
        .handle('same', () => trail((found) => found.nothingChanged))
        .handle('fails', () => Effect.fail(Broke.make({})))
        .handle('raw', () =>
          Effect.succeed(HttpServerResponse.empty({ status: 422 })),
        )
        .handle('exportAll', () => called)
        .handle('forgotten', () => called)
        .handle('query', () => called)
        .handle('breaks', () =>
          called.pipe(
            Effect.andThen(trail((found) => found.detail('half'))),
            Effect.andThen(Effect.die('broke')),
          ),
        )
        .handle('unencodable', () => Effect.as(called, 1.5))
        .handle('undeclared', () => called),
  );
  const InheritsHandlers = HttpApiBuilder.group(
    ProjectApi,
    'inherits',
    (handlers) => handlers.handle('read', () => called),
  );
  const logs = yield* captureLogs;
  const services = yield* Layer.build(
    AccessLive.pipe(Layer.provideMerge(MemoryUsers)),
  );
  const send = yield* serve(
    HttpRouter.toWebHandler(
      mountAt('/admin')(
        Layer.mergeAll(
          adminApi(ProjectApi, {
            product: 'host',
            handlers: Layer.merge(ProjectHandlers, InheritsHandlers),
          }),
          AuditLive,
        ),
      ).pipe(
        Layer.provide(Layer.succeedContext(services)),
        Layer.provide(HttpServer.layerServices),
        Layer.provideMerge(logs.layer),
      ),
      { disableLogger: true },
    ),
  );
  const accounts = Context.get(services, Accounts);
  const ada = yield* accounts.create({
    email: 'ada@example.com',
    roles: 'admin',
  });
  const cookie = yield* accounts.signIn(ada.id);
  const entries = Effect.map(
    Context.get(services, AuditLog).list({ limit: 100 }),
    (page) => page.items,
  );
  return {
    ada,
    accounts,
    calls: Ref.get(calls),
    log: Context.get(services, AuditLog),
    logged: logs.lines,
    cookie,
    entries,
    outage: Context.get(services, AuditOutage),
    asAda: (path: string, init?: RequestInit) =>
      send(`/admin${path}`, as(cookie, init)),
    send,
  };
});

const actions = (entries: ReadonlyArray<typeof AuditEntry.Type>) =>
  Arr.map(entries, (entry) => entry.action);

describe('Every admin write is recorded', () => {
  it.effect('Project action', () =>
    Effect.gen(function* () {
      const { ada, asAda, entries } = yield* setup;
      const response = yield* asAda(
        '/customers/u%201/credit',
        post({ credit: 5 }),
      );
      assert.strictEqual(response.status, 204);
      const all = yield* entries;
      assert.strictEqual(all.length, 1);
      assert.deepInclude(all[0], {
        actorId: ada.id,
        actorEmail: 'ada@example.com',
        action: 'billing.grant',
        targetKind: 'user',
        targetId: 'u 1',
        targetUserId: 'u 1',
        detail: '5 credits',
      });
    }),
  );

  it.effect('Target that is not a user', () =>
    Effect.gen(function* () {
      const { asAda, entries } = yield* setup;
      yield* asAda('/flags/dark-mode', { method: 'PUT' });
      yield* asAda('/flags', post());
      const all = yield* entries;
      assert.deepStrictEqual(
        Arr.map(all, (entry) => [
          entry.targetKind,
          entry.targetId,
          entry.targetUserId,
        ]),
        [
          ['flag', 'new', null],
          ['flag', 'dark-mode', null],
        ],
      );
    }),
  );

  it.effect('Nothing changed', () =>
    Effect.gen(function* () {
      const { asAda, entries } = yield* setup;
      const response = yield* asAda('/same', post());
      assert.strictEqual(response.status, 204);
      const recorded = yield* entries;
      assert.deepStrictEqual(recorded, []);
    }),
  );

  it.effect('Refused request', () =>
    Effect.gen(function* () {
      const { accounts, asAda, cookie, entries, logged, send } = yield* setup;
      const bob = yield* accounts.create({ email: 'bob@example.com' });
      const bobCookie = yield* accounts.signIn(bob.id);
      const statuses = yield* Effect.forEach(
        [
          asAda('/fails', post()),
          asAda('/raw', post()),
          // Bad payloads: an undecodable one, and one the builder answers
          // itself without failing.
          asAda('/customers/u1/credit', post({ credit: 'x' })),
          asAda('/customers/u1/credit', {
            method: 'POST',
            body: 'credit',
            headers: { 'content-type': 'text/plain' },
          }),
          send('/admin/flags/a', as(bobCookie, { method: 'PUT' })),
          send('/admin/flags/a', { method: 'PUT', headers: { cookie } }),
          send('/admin/flags/a', { method: 'PUT' }),
        ],
        (sent) => Effect.map(sent, (response) => response.status),
        { concurrency: 1 },
      );
      assert.deepStrictEqual(statuses, [409, 422, 400, 415, 403, 403, 401]);
      const lines = yield* logged;
      assert.deepStrictEqual(lines, []);
      const recorded = yield* entries;
      assert.deepStrictEqual(recorded, []);
    }),
  );

  it.effect('a read that declares an action', () =>
    Effect.gen(function* () {
      const { asAda, entries } = yield* setup;
      yield* asAda('/export');
      const recorded = yield* entries;
      assert.deepStrictEqual(actions(recorded), ['customers.export']);
    }),
  );
});

describe('Writes must name their action', () => {
  it.effect('Forgotten action', () =>
    Effect.gen(function* () {
      const { asAda, calls, entries } = yield* setup;
      const response = yield* asAda('/forgotten', post());
      assert.strictEqual(response.status, 403);
      const ran = yield* calls;
      assert.strictEqual(ran, 0);
      const recorded = yield* entries;
      assert.deepStrictEqual(recorded, []);
    }),
  );

  it.effect('Query by POST', () =>
    Effect.gen(function* () {
      const { asAda, calls, entries } = yield* setup;
      const response = yield* asAda('/query', post());
      assert.strictEqual(response.status, 204);
      const ran = yield* calls;
      assert.strictEqual(ran, 1);
      const recorded = yield* entries;
      assert.deepStrictEqual(recorded, []);
    }),
  );

  it.effect('Forgotten declaration', () =>
    Effect.gen(function* () {
      const { asAda, calls, send } = yield* setup;
      const asAdmin = yield* asAda('/undeclared');
      assert.strictEqual(asAdmin.status, 403);
      const asVisitor = yield* send('/admin/undeclared');
      assert.strictEqual(asVisitor.status, 401);
      const ran = yield* calls;
      assert.strictEqual(ran, 0);
    }),
  );
});

describe('Only an endpoint’s own annotations count', () => {
  it.effect('a permission declared on its group does not', () =>
    Effect.gen(function* () {
      const { asAda, calls } = yield* setup;
      const response = yield* asAda('/inherits');
      assert.strictEqual(response.status, 403);
      const ran = yield* calls;
      assert.strictEqual(ran, 0);
    }),
  );
});

describe('A missing audit entry is never silent', () => {
  it.effect('Audit store is down', () =>
    Effect.gen(function* () {
      const { ada, asAda, calls, entries, logged, outage } = yield* setup;
      yield* Ref.set(outage, true);
      const response = yield* asAda(
        '/customers/u1/credit',
        post({ credit: 5 }),
      );
      assert.strictEqual(response.status, 500);
      const put = yield* asAda('/flags/a', { method: 'PUT' });
      assert.strictEqual(put.status, 500);
      const ran = yield* calls;
      assert.strictEqual(ran, 1);
      const recorded = yield* entries;
      assert.deepStrictEqual(recorded, []);
      const lines = yield* logged;
      const parts = [ada.id, 'ada@example.com', 'billing.grant', 'user:u1'];
      for (const part of [...parts, '5 credits', 'without an audit entry']) {
        assert.include(lines[0], part);
      }
      assert.include(lines[1], 'flag:a');
      assert.strictEqual(lines.length, 2);
    }),
  );

  it.effect('an action that broke may have happened', () =>
    Effect.gen(function* () {
      const { ada, asAda, calls, entries, logged } = yield* setup;
      for (const path of ['/breaks/a', '/unencodable/a']) {
        const response = yield* asAda(path, post());
        assert.strictEqual(response.status, 500, path);
      }
      const ran = yield* calls;
      assert.strictEqual(ran, 2);
      const recorded = yield* entries;
      assert.deepStrictEqual(recorded, []);
      const lines = yield* logged;
      const about = Arr.filter(lines, Str.includes('outcome is unknown'));
      assert.strictEqual(about.length, 2);
      for (const part of [ada.id, 'action=breaks', 'flag:a', 'detail=half']) {
        assert.include(about[0], part);
      }
      assert.include(about[1], 'action=unencodable');
    }),
  );
});

describe('The log can be read page by page', () => {
  it.effect('through the API, and only with a cursor it gave out', () =>
    Effect.gen(function* () {
      const { asAda } = yield* setup;
      yield* asAda('/flags/a', { method: 'PUT' });
      yield* asAda('/flags/b', { method: 'PUT' });
      const read = (path: string) =>
        Effect.flatMap(asAda(path), (response) =>
          Effect.promise(() => response.json()),
        ).pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({
                items: Schema.Array(Schema.Struct({ targetId: Schema.String })),
                nextCursor: Schema.NullOr(Schema.String),
              }),
            ),
          ),
        );
      const first = yield* read('/audit?limit=1');
      const second = yield* read(
        `/audit?limit=1&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      );
      assert.deepStrictEqual(
        Arr.map([...first.items, ...second.items], (entry) => entry.targetId),
        ['b', 'a'],
      );
      assert.strictEqual(second.nextCursor, null);
      const unknown = yield* asAda('/audit?cursor=nope');
      assert.strictEqual(unknown.status, 400);
    }),
  );

  it.effect('two hundred entries at most', () =>
    Effect.gen(function* () {
      const { asAda, log } = yield* setup;
      yield* Effect.forEach(
        Arr.range(1, 201),
        (n) =>
          log.record({
            actorId: 'ada',
            actorEmail: null,
            action: 'many',
            target: null,
            detail: String(n),
          }),
        { concurrency: 1, discard: true },
      );
      for (const [query, size] of [
        ['', 50],
        ['?limit=200', 200],
        ['?limit=1000', 200],
        ['?limit=0', 1],
      ]) {
        const response = yield* asAda(`/audit${query}`);
        const page = yield* Effect.promise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(AuditPage)),
        );
        assert.strictEqual(page.items.length, size, String(query));
      }
    }),
  );

  it.effect('Without permission', () =>
    Effect.gen(function* () {
      const { accounts, send } = yield* setup;
      const bob = yield* accounts.create({
        email: 'bob@example.com',
        roles: 'lister',
      });
      const cookie = yield* accounts.signIn(bob.id);
      const response = yield* send('/admin/audit', as(cookie));
      assert.strictEqual(response.status, 403);
    }),
  );
});
