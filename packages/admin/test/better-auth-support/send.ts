import { Effect, Layer, Schema } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';

import {
  AuditLog,
  AuditWriteFailed,
  type NewAuditEntry,
} from '../../src/index.ts';
import { BASE, type TestAuth } from './auth.ts';

export const recording = (entries: Array<NewAuditEntry>) =>
  Layer.succeed(AuditLog, {
    record: (entry) => Effect.sync(() => void entries.push(entry)),
    list: () => Effect.die('not read'),
  });

export const failing = Layer.succeed(AuditLog, {
  record: () => AuditWriteFailed.make({ cause: 'down' }),
  list: () => Effect.die('not read'),
});

export interface Sent {
  // Appended as it is, so a test can spell a path any way it likes.
  readonly path: string;
  readonly method?: string;
  readonly cookie?: string;
  readonly body?: Record<string, unknown>;
}

const Body = Schema.fromJsonString(Schema.Unknown);
const encode = Schema.encodeEffect(Body);

export const toRequest = Effect.fnUntraced(function* (sent: Sent) {
  const method = sent.method ?? 'POST';
  const body = yield* Effect.orDie(encode(sent.body ?? {}));
  return new Request(`${BASE}${sent.path}`, {
    method,
    headers: {
      origin: BASE,
      'content-type': 'application/json',
      ...(sent.cookie === undefined ? {} : { cookie: sent.cookie }),
    },
    ...(method === 'POST' ? { body } : {}),
  });
});

// One request through the wrapper, in a scope of its own as a server gives it.
export const send = (auth: TestAuth, sent: Sent) =>
  Effect.gen(function* () {
    const request = yield* toRequest(sent);
    const response = yield* Effect.provideService(
      auth.handler,
      HttpServerRequest.HttpServerRequest,
      HttpServerRequest.fromWeb(request),
    );
    const web = HttpServerResponse.toWeb(response);
    return {
      status: web.status,
      cookies: web.headers.getSetCookie(),
      body: yield* Effect.promise(() => web.text()),
    };
  }).pipe(Effect.scoped);
