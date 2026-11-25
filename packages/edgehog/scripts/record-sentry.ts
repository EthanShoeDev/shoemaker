// Records what the pinned @sentry/cloudflare sends, as fixtures for ingest.
//
//   bun scripts/record-sentry.ts [--check]
//
// Each scenario is a Worker in workerd, the runtime Cloudflare deploys, whose
// only way out is a recorder on a socket here. Nothing reaches a network. The
// recordings are ours: none is copied from Sentry's repositories.
import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Function,
  Match,
  Option,
  Order,
  Path,
  Predicate,
  Record as Rec,
  Result,
  Schedule,
  Schema,
  String as Str,
} from 'effect';
import { Command, Flag } from 'effect/cli';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import { ChildProcess } from 'effect/process';
import workerd, { compatibilityDate } from 'workerd';

import { keptHeaders, normalizer } from './sentry/normalize.ts';
import { KEY, scenarios, type Scenario } from './sentry/scenarios.ts';

const PROJECT = '1';
const READY_ATTEMPTS = 200;
// After the last thing a scenario sends. The slowest flush waits two seconds.
const QUIET = '700 millis';
const SETTLE = '2500 millis';

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

class Drifted extends Schema.TaggedError<
  Drifted,
  { readonly brand: unique symbol }
>()('Drifted', { files: Schema.Array(Schema.String) }) {
  override get message() {
    return `The SDK no longer sends what is recorded in ${Arr.join(this.files, ', ')}. Review \`bun scripts/record-sentry.ts\`'s changes.`;
  }
}

const json = Schema.fromJsonString(Schema.Unknown, { space: 2 });
const encode = Schema.encodeEffect(json);

const bundle = Effect.gen(function* () {
  const path = yield* Path.Path;
  const built = yield* Effect.promise(() =>
    Bun.build({
      entrypoints: [path.join(import.meta.dirname, 'sentry/worker.ts')],
      target: 'browser',
      conditions: ['workerd', 'worker', 'production'],
      external: ['node:*', 'cloudflare:*'],
    }),
  );
  const [output] = built.outputs;
  if (output === undefined) return yield* Effect.die('Nothing was bundled.');
  return yield* Effect.promise(() => output.text());
});

const answering = (scenario: Scenario, received: Array<Sent>) =>
  Effect.fnUntraced(function* (request: Request) {
    const body = yield* Effect.promise(() => request.arrayBuffer());
    const url = new URL(request.url);
    received.push({
      method: request.method,
      url: `https://${request.headers.get('host') ?? ''}${url.pathname}${url.search}`,
      headers: Rec.fromEntries([...request.headers]),
      body: new Uint8Array(body),
    });
    const { answer } = scenario;
    if (answer === 'hang') return yield* Effect.never;
    if (answer === undefined || Predicate.isString(answer)) {
      return new Response('{}');
    }
    return new Response('{}', answer);
  });

const serve = (socket: string, scenario: Scenario, received: Array<Sent>) => {
  const answer = answering(scenario, received);
  return Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        unix: socket,
        fetch: (request) =>
          Effect.runPromise(answer(request), { signal: request.signal }),
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  );
};

interface Place {
  readonly name: string;
  readonly scenario: Scenario;
  readonly listens: string;
  readonly ingest: string;
}

const quoted = (text: string) => `"${text}"`;

const serviceOf = ({ name, scenario, ingest }: Place) => `
    ( name = "ingest-${name}",
      external = ( address = "unix:${ingest}", http = () ) ),
    ( name = "${name}",
      worker = (
        modules = [ ( name = "worker.js", esModule = embed "worker.js" ) ],
        compatibilityDate = ${quoted(compatibilityDate)},
        bindings = [
          ( name = "SCENARIO", text = "${name}" ),
          ( name = "DSN", text = "https://${KEY}@ingest.test/${PROJECT}" ),
          ${scenario.serviceBinding === true ? `( name = "INGEST", service = "ingest-${name}" ),` : ''}
        ],
        globalOutbound = "${scenario.serviceBinding === true ? 'nowhere' : `ingest-${name}`}" ) ),`;

const config = (places: ReadonlyArray<Place>) => `
using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
    ( name = "nowhere", network = ( allow = [] ) ),${Arr.join(Arr.map(places, serviceOf), '')}
  ],
  sockets = [${Arr.join(
    Arr.map(
      places,
      ({ name, listens }) => `
    ( name = "${name}", address = "unix:${listens}", http = (), service = "${name}" ),`,
    ),
    '',
  )}
  ],
);
`;

const call = Effect.fnUntraced(function* (
  place: Place,
  request: NonNullable<Scenario['requests']>[number],
) {
  const socket: BunFetchRequestInit = { unix: place.listens };
  const response = yield* HttpClientRequest.make(request.method ?? 'GET')(
    `http://shop.test${request.path ?? '/'}`,
    { headers: { 'user-agent': 'recorder/1.0', ...request.headers } },
  ).pipe(
    request.body === undefined
      ? Function.identity
      : HttpClientRequest.bodyText(request.body, 'application/json'),
    HttpClient.execute,
    Effect.provideService(FetchHttpClient.RequestInit, socket),
  );
  return { status: response.status, text: yield* response.text };
});

const decodeText = (bytes: Uint8Array) =>
  Result.try(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes));

// Bytes as text and back, one character for each.
const toLatin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const ids = /[0-9a-f]{16,32}|\d+/gu;

// Envelopes of one flush are sent at once, so they arrive in any order.
const inOrder = (sent: ReadonlyArray<Sent>) =>
  Arr.sort(
    sent,
    Order.mapInput(Str.Order, (one: Sent) =>
      Str.replaceAll(ids, '')(toLatin1(one.body)),
    ),
  );

const toFixture = (sent: Sent, normalize: (text: string) => string) => {
  const text = decodeText(sent.body);
  return {
    method: sent.method,
    url: normalize(sent.url),
    headers: keptHeaders(sent.headers),
    ...Result.match(text, {
      onSuccess: (body) => ({ body: normalize(body) }),
      onFailure: () => ({
        bodyBase64: Buffer.from(
          normalize(toLatin1(sent.body)),
          'latin1',
        ).toString('base64'),
      }),
    }),
  };
};

// Until nothing more arrives.
const settled = (received: ReadonlyArray<Sent>) =>
  Effect.gen(function* () {
    let before = -1;
    while (before !== received.length) {
      before = received.length;
      yield* Effect.sleep(QUIET);
    }
  });

const recordOne = (place: Place, received: Array<Sent>) =>
  Effect.gen(function* () {
    const normalize = normalizer();
    const steps: Array<unknown> = [];
    for (const request of place.scenario.requests ?? [{}]) {
      const before = received.length;
      const answer = yield* call(place, request);
      yield* settled(received);
      if (place.scenario.answer === 'hang') yield* Effect.sleep(SETTLE);
      const sent = inOrder(Arr.drop(received, before));
      steps.push({
        request: { method: 'GET', path: '/', ...request },
        worker: { status: answer.status, says: normalize(answer.text) },
        sent: Arr.map(sent, (one) => toFixture(one, normalize)),
      });
    }
    return {
      recordedFrom: '@sentry/cloudflare',
      answer: Match.value(place.scenario.answer).pipe(
        Match.when(undefined, () => ({ status: 200 })),
        Match.orElse((answer) => answer),
      ),
      steps,
    };
  });

const recordAll = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'sentry' });
  const received = Rec.map(scenarios, () => Arr.empty<Sent>());
  const places = Arr.map(
    Rec.toEntries(scenarios),
    ([name, scenario], index) => ({
      name,
      scenario,
      listens: path.join(dir, `l${index}`),
      ingest: path.join(dir, `i${index}`),
    }),
  );
  const source = yield* bundle;
  yield* fs.writeFileString(path.join(dir, 'worker.js'), source);
  const file = path.join(dir, 'config.capnp');
  yield* fs.writeFileString(file, config(places));
  yield* Effect.forEach(
    Arr.filter(places, (place) => place.scenario.answer !== 'unreachable'),
    (place) => serve(place.ingest, place.scenario, received[place.name] ?? []),
    { concurrency: 1 },
  );
  const spawned = yield* ChildProcess.make(workerd, ['serve', file], {
    stdout: 'ignore',
    // It also reports each error a scenario throws on purpose.
    stderr: 'ignore',
  });
  yield* Effect.forEach(
    places,
    (place) =>
      fs.exists(place.listens).pipe(
        Effect.filterOrFail(Boolean, () => 'not yet' as const),
        Effect.retry({
          times: READY_ATTEMPTS,
          schedule: Schedule.spaced('50 millis'),
        }),
      ),
    { concurrency: 1 },
  );
  const recorded = yield* Effect.forEach(
    places,
    (place) =>
      Effect.map(
        recordOne(place, received[place.name] ?? []),
        (fixture) => [place.name, fixture] as const,
      ),
    { concurrency: 8 },
  );
  yield* spawned.kill();
  return recorded;
}).pipe(Effect.scoped);

const record = Command.make(
  'record-sentry',
  {
    check: Flag.Boolean('check').pipe(
      Flag.withDescription('Fail if a recording differs; write nothing'),
      Flag.withDefault(false),
    ),
  },
  Effect.fnUntraced(function* ({ check }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.resolve(import.meta.dirname, '../test/fixtures/sentry');
    const recorded = yield* recordAll;
    const drifted: Array<string> = [];
    for (const [name, fixture] of recorded) {
      const file = path.join(dir, `${name}.gen.json`);
      const text = `${yield* encode(fixture)}\n`;
      if (!check) {
        yield* fs.writeFileString(file, text);
        continue;
      }
      const before = yield* fs.readFileString(file).pipe(Effect.option);
      if (!Option.contains(before, text)) drifted.push(`${name}.gen.json`);
    }
    if (Arr.isArrayNonEmpty(drifted))
      return yield* Drifted.make({ files: drifted });
    yield* Console.log(
      `${check ? 'Matched' : 'Recorded'} ${recorded.length} scenarios.`,
    );
  }),
).pipe(Command.withDescription('Record what the pinned Sentry SDK sends'));

Command.run(record, { version: '0.0.0' }).pipe(
  Effect.provide([BunServices.layer, FetchHttpClient.layer]),
  BunRuntime.runMain,
);
