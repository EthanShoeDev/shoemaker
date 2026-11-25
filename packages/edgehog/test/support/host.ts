import { Effect, Layer, Option, Schema } from 'effect';
import { Headers, HttpRouter, HttpServer } from 'effect/http';
import { AdminSessions, auditProduct, AuditLog } from 'shoemaker-admin';
import { defineAccess } from 'shoemaker-admin/access';
import { AdminAccess, mountAt } from 'shoemaker-admin/server';
import {
  adminMigrations,
  auditLogLayer,
  runMigrations,
} from 'shoemaker-admin/sql';
import { sqlite } from 'shoemaker-utils/testing/databases';

import { FlagProjects, flagsProduct } from '../../src/index.ts';
import { FlagsLive } from '../../src/server.ts';
import { flagMigrations, flagStoreLayer } from '../../src/sql.ts';

const ORIGIN = 'http://admin.test';

const access = defineAccess({
  products: [flagsProduct, auditProduct],
  roles: { viewer: { flag: ['read'] }, nobody: { audit: ['list'] } },
});

// Whoever the test says: the cookie is a role.
const Sessions = Layer.succeed(AdminSessions, {
  find: (headers) =>
    Effect.succeed(
      Option.map(Headers.get(headers, 'cookie'), (role) => ({
        user: {
          id: `id-${role}`,
          email: `${role}@example.com`,
          roles: [role],
          ban: null,
        },
        impersonatedBy: null,
      })),
    ),
});

// The host's one database, with the admin's tables beside the flags'.
const Database = Layer.mergeAll(
  Layer.effectDiscard(runMigrations(adminMigrations)),
  Layer.effectDiscard(runMigrations(flagMigrations)),
).pipe(Layer.provideMerge(sqlite), Layer.orDie);

const Services = Layer.mergeAll(auditLogLayer, flagStoreLayer).pipe(
  Layer.provideMerge(Database),
);

// oxlint-disable-next-line effecttsgo/schema-sync -- the bodies are literals in the tests
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

// A host that mounts flags at /admin, on one database.
export const makeHost = Effect.gen(function* () {
  const services = yield* Layer.build(Services);
  const app = HttpRouter.toWebHandler(
    FlagsLive.pipe(
      mountAt('/admin'),
      Layer.provide(AdminAccess.layer({ origins: [ORIGIN] })),
      Layer.provide([
        access.layer,
        Sessions,
        Layer.succeed(FlagProjects, [{ id: 1, name: 'Site' }]),
        Layer.succeedContext(services),
      ]),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() => Effect.promise(app.dispose));
  const send = Effect.fnUntraced(function* (
    role: string | undefined,
    method: string,
    path: string,
    body?: unknown,
  ) {
    const response = yield* Effect.promise(() =>
      app.handler(
        new Request(`http://localhost/admin${path}`, {
          method,
          headers: {
            origin: ORIGIN,
            ...(role === undefined ? {} : { cookie: role }),
            ...(body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: encodeJson(body) }),
        }),
      ),
    );
    const content = yield* Effect.promise(() => response.text());
    return { status: response.status, body: content };
  });
  const entries = AuditLog.use((log) => log.list({ limit: 100 })).pipe(
    Effect.map((page) => page.items),
    Effect.provide(services),
  );
  return { send, entries, services };
});
