import { Effect, Option } from 'effect';
import { HttpServerRequest } from 'effect/http';

import { AdminSessions } from '../core/ports.ts';

// The admin behind the request, when its session was started by impersonation.
// For a project's own endpoints, which decide what that rules out.
export const impersonatedBy = Effect.gen(function* () {
  const sessions = yield* AdminSessions;
  const { headers } = yield* HttpServerRequest.HttpServerRequest;
  const session = yield* sessions.find(headers);
  return Option.flatMapNullishOr(session, (found) => found.impersonatedBy);
}).pipe(Effect.withSpan('impersonatedBy'));
