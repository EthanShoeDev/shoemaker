import { NodeServices } from '@effect/platform-node';
import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, FileSystem, Path, Schema, Stream } from 'effect';
import { ChildProcess } from 'effect/process';

// What the pinned SDK does, which ingest is written against. The fixtures are
// recorded by scripts/record-sentry.ts.
const RECORDING_TIMEOUT = 60_000;

const Fixture = Schema.Struct({
  steps: Schema.Array(
    Schema.Struct({
      worker: Schema.Struct({ status: Schema.Int, says: Schema.String }),
      sent: Schema.Array(
        Schema.Struct({
          url: Schema.String,
          headers: Schema.Record(Schema.String, Schema.String),
          body: Schema.optional(Schema.String),
          bodyBase64: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
});
const decode = Schema.decodeEffect(Schema.fromJsonString(Fixture));

const load = Effect.fnUntraced(function* (name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fs.readFileString(
    path.join(import.meta.dirname, `../fixtures/sentry/${name}.gen.json`),
  );
  return yield* decode(text);
});

const bodies = (fixture: typeof Fixture.Type) =>
  Arr.flatMap(fixture.steps, (step) =>
    Arr.map(step.sent, (sent) => sent.body ?? ''),
  );

// Per request to the Worker, whether an error and whether a check-in was sent.
const kinds = (fixture: typeof Fixture.Type) =>
  Arr.map(fixture.steps, (step) => ({
    error: Arr.some(step.sent, (sent) =>
      /\n\{"type":"event"\}/u.test(sent.body ?? ''),
    ),
    checkIn: Arr.some(step.sent, (sent) =>
      /\n\{"type":"check_in"\}/u.test(sent.body ?? ''),
    ),
  }));

const all = { error: true, checkIn: true };
const none = { error: false, checkIn: false };

it.layer(NodeServices.layer)('the Sentry SDK', (it) => {
  it.effect(
    'still sends what is recorded',
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const handle = yield* ChildProcess.make('bun', [
          path.join(import.meta.dirname, '../../scripts/record-sentry.ts'),
          '--check',
        ]);
        const [output, code] = yield* Effect.all(
          [
            handle.all.pipe(Stream.decodeText, Stream.mkString),
            handle.exitCode,
          ],
          { concurrency: 2 },
        );
        assert.strictEqual(Number(code), 0, output);
      }).pipe(Effect.scoped),
    // Retried once: it waits for a silence, which a busy machine can fake.
    { timeout: RECORDING_TIMEOUT, retry: 1 },
  );

  describe('after an answer', () => {
    for (const [name, second] of [
      ['answer-429', none],
      ['answer-429-retry-after', none],
      ['answer-403', none],
      ['answer-429-limits', { error: false, checkIn: true }],
      ['answer-200-limits', { error: false, checkIn: true }],
      ['answer-413', all],
    ] as const) {
      it.effect(
        `${name} sends ${second === none ? 'nothing' : 'what is left'}`,
        () =>
          Effect.gen(function* () {
            const fixture = yield* load(name);
            assert.deepStrictEqual(kinds(fixture), [all, second]);
          }),
      );
    }

    it.effect('500 drops the error and sends the next', () =>
      Effect.gen(function* () {
        const fixture = yield* load('answer-500');
        assert.deepStrictEqual(
          Arr.map(fixture.steps, (step) => step.sent.length),
          [1, 1],
        );
      }),
    );

    it.effect('none gives up and never resends', () =>
      Effect.gen(function* () {
        const fixture = yield* load('no-answer');
        assert.deepStrictEqual(
          Arr.map(fixture.steps, (step) => [
            step.worker.says,
            step.sent.length,
          ]),
          [
            ['flushed: false', 1],
            ['flushed: false', 1],
          ],
        );
      }),
    );
  });

  it.effect('sends through a service binding', () =>
    Effect.gen(function* () {
      const fixture = yield* load('service-binding');
      assert.strictEqual(bodies(fixture).length, 1);
      assert.include(fixture.steps[0]?.sent[0]?.url ?? '', '/api/1/envelope/');
    }),
  );

  it.effect('sends its key in the address, or in a tunnel’s body', () =>
    Effect.gen(function* () {
      const plain = yield* load('thrown');
      assert.include(plain.steps[0]?.sent[0]?.url ?? '', 'sentry_key=');
      const tunnel = yield* load('tunnel');
      assert.notInclude(tunnel.steps[0]?.sent[0]?.url ?? '', 'sentry_key=');
      assert.include(bodies(tunnel)[0] ?? '', '"dsn":"https://');
    }),
  );

  it.effect('continues its own trace header and not traceparent', () =>
    Effect.gen(function* () {
      const id = '0af7651916cd43dd8448eb211c80319c';
      const own = yield* load('trace-sentry');
      assert.include(bodies(own)[0] ?? '', `"trace_id":"${id}"`);
      const w3c = yield* load('trace-traceparent');
      assert.notInclude(bodies(w3c)[0] ?? '', `"trace_id":"${id}"`);
    }),
  );

  it.effect('drops an error that repeats the one before it', () =>
    Effect.gen(function* () {
      const dropped = yield* load('repeated');
      const kept = yield* load('repeated-kept');
      assert.strictEqual(bodies(dropped).length, 1);
      assert.strictEqual(bodies(kept).length, 6);
    }),
  );
});
