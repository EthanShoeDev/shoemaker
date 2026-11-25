// Run by Bun: bundles one of the Workers as Alchemy does, serves it in workerd
// over a D1 on this machine, and prints what it answered. Nothing reaches a
// network.
//
//   bun test/workers/run.ts plain|kept|alchemy
import { layerRuntime, Runtime } from '@alchemy.run/cloudflare-runtime/core';
import { D1 } from '@alchemy.run/cloudflare-runtime/core/bindings';
import { Credentials } from '@alchemy.run/cloudflare/Credentials';
import { WorkerBundle } from '@alchemy.run/cloudflare/Workers/Sources/Rolldown';
import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  Array as Arr,
  Console,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Result,
  Schema,
  String as Str,
} from 'effect';
import { Argument, Command } from 'effect/cli';
import { FetchHttpClient } from 'effect/http';
import { compatibilityDate } from 'workerd';

import { Report } from './report.ts';

const toJson = Schema.encodeEffect(Report);

const REQUESTS = 20;
// The compatibility date has Node's modules on.
const FLAGS: Array<string> = [];

const bundle = Effect.fnUntraced(function* (worker: string) {
  const bundler = yield* WorkerBundle;
  const built = yield* bundler.build({
    id: worker,
    main: `${import.meta.dirname}/${worker}.ts`,
    compatibility: { date: compatibilityDate, flags: FLAGS },
    entry:
      worker === 'alchemy'
        ? { kind: 'effect', exports: {} }
        : { kind: 'external' },
    stack: { name: 'flags', stage: 'test' },
    extraOptions: undefined,
    rules: undefined,
  });
  return Arr.filterMap(built.files, ({ content, path }) =>
    Str.isString(content) && /\.m?js$/u.test(path)
      ? Result.succeed({ name: path, type: 'ESModule' as const, content })
      : Result.failVoid,
  );
});

const serve = Effect.fnUntraced(function* (worker: string) {
  const runtime = yield* Runtime;
  const modules = yield* bundle(worker);
  const said: Array<string> = [];

  // A new isolate, gone when `use` is done.
  const isolate = <A, E, R>(
    database: string,
    use: (place: {
      readonly send: (
        path: string,
        signal?: AbortSignal,
      ) => Effect.Effect<string>;
      readonly timed: (
        path: string,
      ) => Effect.Effect<{ readonly body: string; readonly millis: number }>;
    }) => Effect.Effect<A, E, R>,
  ) =>
    Effect.gen(function* () {
      const url = yield* runtime.start({
        name: `${worker}-${database}`,
        compatibilityDate,
        compatibilityFlags: FLAGS,
        bindings: [D1.local({ binding: 'DB', id: `dev:${database}` })],
        modules,
        logging: {
          verbose: true,
          onOutput: (chunk) => {
            said.push(chunk);
          },
        },
      });
      const send = (path: string, signal?: AbortSignal) =>
        Effect.promise(() =>
          // oxlint-disable-next-line effecttsgo/global-fetch-in-effect -- a client that hangs up is what is tested
          fetch(new URL(path, url), signal === undefined ? {} : { signal })
            .then((response) => response.text())
            .catch(() => 'gone'),
        );
      const timed = (path: string) =>
        Effect.map(Effect.timed(send(path)), ([took, body]) => ({
          body,
          millis: Math.round(Duration.toMillis(took)),
        }));
      return yield* use({ send, timed });
    }).pipe(Effect.scoped);

  const together = (send: Effect.Effect<string>) =>
    Effect.map(
      Effect.replicateEffect(send, REQUESTS, { concurrency: 'unbounded' }),
      Arr.dedupe,
    );

  // One that has served nothing, over a database that has the flag. Each has
  // its own, since two processes cannot open one.
  const on: typeof isolate = (database, use) =>
    Effect.andThen(
      isolate(database, ({ send }) => send('/migrate')),
      isolate(database, use),
    );

  const cold = on(
    'cold',
    Effect.fnUntraced(function* ({ send }) {
      const answers = yield* together(send('/flag?delay=300'));
      const page = yield* send('/page');
      return { answers, page, loads: yield* send('/loads') };
    }),
  );
  const aborted = on(
    'aborted',
    Effect.fnUntraced(function* ({ send, timed }) {
      const first = yield* send('/flag?delay=3000', AbortSignal.timeout(500));
      const next = yield* timed('/flag?delay=0');
      return { first, next, loads: yield* send('/loads') };
    }),
  );
  const early = on(
    'early',
    Effect.fnUntraced(function* ({ send, timed }) {
      const first = yield* send('/early?delay=3000');
      const next = yield* timed('/flag?delay=0');
      return { first, next, loads: yield* send('/loads') };
    }),
  );
  const refresh = on(
    'refresh',
    Effect.fnUntraced(function* ({ send, timed }) {
      yield* send('/flag');
      yield* send('/shift?ms=61000');
      const first = yield* send('/early?delay=3000');
      const next = yield* timed('/flag?delay=0');
      return { first, next, loads: yield* send('/loads') };
    }),
  );
  const changed = on(
    'changed',
    Effect.fnUntraced(function* ({ send }) {
      const before = yield* send('/flag');
      yield* send('/off');
      yield* send('/shift?ms=58000');
      const within = yield* send('/flag');
      yield* send('/shift?ms=2500');
      const after = yield* together(send('/flag?delay=300'));
      return { before, within, after, loads: yield* send('/loads') };
    }),
  );
  const found = yield* Effect.all(
    { cold, aborted, early, refresh, changed },
    { concurrency: 'unbounded' },
  );
  return { ...found, output: Arr.join(said, '') };
});

const main = Command.make(
  'run',
  { worker: Argument.Literals('worker', ['plain', 'kept', 'alchemy']) },
  Effect.fnUntraced(function* ({ worker }) {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'flags' });
    const runtime = layerRuntime({
      api: { accountId: Effect.succeed('local') },
      storage: { directory },
    }).pipe(
      Layer.provide(FetchHttpClient.layer),
      // For bindings that are remote, of which there are none.
      Layer.provide(
        Layer.succeed(Credentials, Effect.die('Nothing here has credentials.')),
      ),
    );
    const report = yield* Effect.provide(serve(worker), runtime);
    const line = yield* toJson(report);
    yield* Console.log(line);
  }, Effect.scoped),
);

Command.run(main, { version: '0.0.0' }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
