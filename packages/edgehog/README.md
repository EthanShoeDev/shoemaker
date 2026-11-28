# shoemaker-edgehog

Feature flags inside an Effect project: no service to rent, no request per
evaluation, on the project's own database. Applications use
[OpenFeature](https://openfeature.dev), so their code does not depend on this
package. Error tracking is being built here too.

```sh
bun add shoemaker-edgehog shoemaker-admin better-auth @openfeature/server-sdk
```

and the project's SQL driver. The admin API needs `shoemaker-admin` mounted,
with its migrations, as [its README](../admin/README.md) describes.

| Import | Holds |
|---|---|
| `shoemaker-edgehog` | schemas, errors, the product description, results for a browser |
| `/contract` | the flags `HttpApi` |
| `/server` | its handlers, for a host with `shoemaker-admin` |
| `/sql` | flags over any `SqlClient` (SQLite, D1, Postgres), and migrations |
| `/flags` | the evaluator, a pure function |
| `/openfeature` | the OpenFeature server provider |

The first two and `/flags` are safe in a browser.

## Set up

```ts
import { PgClient } from '@effect/sql-pg';
import { OpenFeature } from '@openfeature/server-sdk';
import { Config, Effect, Layer, ManagedRuntime } from 'effect';
import { auditProduct, usersProduct } from 'shoemaker-admin';
import { defineAccess } from 'shoemaker-admin/access';
import { mountAt } from 'shoemaker-admin/server';
import { adminMigrations, runMigrations } from 'shoemaker-admin/sql';
import { FlagProjects, flagsProduct, readFlag } from 'shoemaker-edgehog';
import { edgehogProvider, handOver } from 'shoemaker-edgehog/openfeature';
import { FlagsLive } from 'shoemaker-edgehog/server';
import { flagMigrations, flagStoreLayer } from 'shoemaker-edgehog/sql';

export const access = defineAccess({
  products: [usersProduct, auditProduct, flagsProduct],
});

// Before the server starts, or `migrateHost` of shoemaker-admin on Alchemy.
export const deploy = Effect.andThen(
  runMigrations(adminMigrations),
  runMigrations(flagMigrations),
);

// Use the app's own client where it has one: a second layer is a second pool.
export const Flags = flagStoreLayer.pipe(
  Layer.provide(PgClient.layerConfig({ url: Config.Redacted('DATABASE_URL') })),
);

// Beside the other admin routes, under the same `AdminAccess`.
export const AdminFlags = FlagsLive.pipe(
  mountAt('/admin'),
  Layer.provide([
    Flags,
    Layer.succeed(FlagProjects, [{ id: 1, name: 'Site' }]),
  ]),
);

const runtime = ManagedRuntime.make(Flags);
export const start = OpenFeature.setProviderAndWait(
  edgehogProvider({ projectId: 1, run: (effect) => runtime.runPromise(effect) }),
);

// When the process stops.
export const stop = async () => {
  await OpenFeature.close();
  await runtime.dispose();
};

export const page = Effect.gen(function* () {
  const client = OpenFeature.getClient();
  const user = { targetingKey: 'user-1', plan: 'pro' };
  const enabled = yield* Effect.promise(() =>
    client.getBooleanValue('new-checkout', false, user),
  );
  // Values for a browser, and no rules.
  const flags = yield* handOver(client, { 'new-checkout': false }, user);
  return { enabled, flags };
});

// In the browser, with what `handOver` gave.
export const inBrowser = (flags: Parameters<typeof readFlag>[0]) =>
  readFlag(flags, 'new-checkout', false);
```

### On Workers

A request that ends takes its reads with it, so register a lazy provider, which
loads on the first evaluation, and let a load outlive the request that began it.
Without `waitUntil` one aborted request can make the next wait ten seconds.

```ts
import { env, waitUntil } from 'cloudflare:workers';

const runtime = ManagedRuntime.make(
  flagStoreLayer.pipe(Layer.provide(D1Client.layer({ db: env.DB }))),
);
OpenFeature.setProvider(
  edgehogProvider({
    projectId: 1,
    lazy: true,
    run: (effect) => {
      const running = runtime.runPromise(effect);
      waitUntil(running);
      return running;
    },
  }),
);
```

In an Alchemy Worker's init:

```ts
const db = yield* Cloudflare.D1.QueryDatabase(AppDb);
const services = yield* Layer.build(
  flagStoreLayer.pipe(Layer.provide(SQL.D1Layer(db))),
);
const run = Effect.runPromiseWith(services);
OpenFeature.setProvider(
  edgehogProvider({
    projectId: 1,
    lazy: true,
    run: (effect) => {
      const running = run(Effect.scoped(effect)); // Alchemy opens the client per scope
      waitUntil(running);
      return running;
    },
  }),
);
```

Both were run in local workerd over D1, not on Cloudflare.

## A flag

```json
{
  "key": "new-checkout",
  "config": {
    "type": "boolean",
    "enabled": true,
    "variants": { "on": true, "off": false },
    "defaultVariant": "off",
    "rules": [
      {
        "conditions": [
          { "property": "plan", "operator": "in", "values": ["pro"] }
        ],
        "variant": "on"
      },
      { "conditions": [], "share": 20, "variant": "on" }
    ]
  }
}
```

- Variants are all booleans, all strings, all numbers or all objects.
- Rules are tried in order; the first whose conditions all match, and whose
  share holds the targeting key, answers. Otherwise the default does.
- Operators: `in`, `not_in`, `contains`, `starts_with`, `ends_with`, `gt`,
  `gte`, `lt`, `lte`, `exists`, `missing`. A property the context lacks, or holds
  as null, matches only `missing`.
- A targeting key has one position in a flag, the same for every rule, so write
  shares cumulatively: 20 for `a`, then 40 for `b`, gives each a fifth. Two
  rules of 20 give `b` nobody. Widening a share keeps whoever had it, and
  reordering rules moves nobody.
- The position is fixed by the flag's key and the targeting key, as PostHog's
  SDKs compute it, and never changes between versions.
- A rule with a share between 0 and 100 needs a targeting key. Without one the
  application's default is used, with `TARGETING_KEY_MISSING`, and not the
  flag's. Give anonymous users a key that stays the same.
- A disabled flag gives the application's default.
- A flag keeps its key and type for as long as it exists. A key is letters,
  digits, `.`, `_` and `-`, starts with a letter or digit, and has 128
  characters at most.
- A project holds 500 flags and 1 MB of them. A targeting key may have 1,000
  characters.

## What it costs and how fresh it is

A process reads the definitions at most once a minute while something evaluates,
however often, and not at all otherwise. While storage fails it tries at most
every ten seconds. Evaluating writes nothing.

An answer is never from definitions older than a minute while storage answers,
so a change takes effect within a minute. If storage does not answer in five
seconds, the last definitions are used and the provider reports itself stale.
Never loaded, every flag gives the application's default.

## Admin API

`FlagsApi` of `/contract`, with permissions `flag:read` and `flag:write`:

| Call | Takes |
|---|---|
| `flags.list` | params `projectId` |
| `flags.get` | params `projectId`, `id` |
| `flags.create` | params `projectId`, payload `{ key, config }` |
| `flags.update` | params `projectId`, `id`, payload `{ version, config }` |
| `flags.remove` | params `projectId`, `id`, query `version` |

```ts
const client = yield* HttpApiClient.make(FlagsApi, { baseUrl: '/api/admin' });
yield* client.flags.create({
  params: { projectId: 1 },
  payload: { key: 'new-checkout', config },
});
```

Errors are the admin's `Unauthorized` and `Forbidden`, and `FlagProjectNotFound`,
`FlagNotFound`, `FlagKeyTaken`, `FlagTypeFixed`, `FlagChanged`, `FlagUnreadable`
and `FlagLimitReached`.

A save or delete names the version it was made from, and is refused with
`FlagChanged` if somebody else saved first. Every change is in the audit
log, as `flag.create`, `flag.update` or `flag.delete`.

## Limits

- Browsers and mobile apps get what their server hands over; they do not
  evaluate.
- `handOver` gives the defaults if a context makes the OpenFeature SDK throw.
  The SDK's own calls reject then.
- Two conformance capabilities are not declared: `@numeric-coercion`, since
  JavaScript cannot tell `10.0` from `10`, and `@standard-reasons`, since a
  default answers `STATIC` here, as OFREP has it.
- A row written by a newer version that this one cannot read evaluates to the
  default, and cannot be saved over.

Third-party notices are in `THIRD_PARTY_NOTICES`.
