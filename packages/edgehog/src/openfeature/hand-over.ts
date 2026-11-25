import {
  type Client,
  ErrorCode,
  type EvaluationContext,
  type EvaluationDetails,
  type JsonObject,
  type JsonValue,
  StandardResolutionReasons,
} from '@openfeature/server-sdk';
import { Effect, Predicate, Record as Rec } from 'effect';

import type { EvaluatedFlag, EvaluatedFlags } from '../core/flag-results.ts';
import { PIN, type Pin } from './pin.ts';

const evaluate = (
  client: Client,
  key: string,
  fallback: JsonObject | boolean | number | string,
  context: EvaluationContext,
): Promise<EvaluationDetails<JsonValue>> => {
  if (Predicate.isBoolean(fallback)) {
    return client.getBooleanDetails(key, fallback, context);
  }
  if (Predicate.isNumber(fallback)) {
    return client.getNumberDetails(key, fallback, context);
  }
  return Predicate.isString(fallback)
    ? client.getStringDetails(key, fallback, context)
    : client.getObjectDetails(key, fallback, context);
};

const toResult = (
  details: EvaluationDetails<JsonValue>,
): typeof EvaluatedFlag.Type => ({
  value: details.value,
  ...(details.variant === undefined ? {} : { variant: details.variant }),
  ...(details.reason === undefined ? {} : { reason: details.reason }),
  ...(details.errorCode === undefined ? {} : { errorCode: details.errorCode }),
});

type Fallback = JsonObject | boolean | number | string;

// Evaluates the flags a page needs, for the server to send with it. Holds
// answers only: a client reads them with `readFlag` and never sees a rule. All
// come from one state of the definitions.
export const handOver = Effect.fn('handOver')(function* (
  client: Client,
  // Each flag with the default to use where it has no answer.
  flags: Readonly<Record<string, Fallback>>,
  context: EvaluationContext,
) {
  const pin: Pin = new Map();
  const answer = (fallback: Fallback, key: string) =>
    // The SDK answers the default where a provider fails, and throws where
    // reading the context does.
    Effect.promise(() =>
      Promise.resolve()
        .then(() => evaluate(client, key, fallback, { ...context, [PIN]: pin }))
        .then(toResult)
        .catch(() => ({
          value: fallback,
          reason: StandardResolutionReasons.ERROR,
          errorCode: ErrorCode.GENERAL,
        })),
    );
  const results: EvaluatedFlags = yield* Effect.all(Rec.map(flags, answer), {
    concurrency: 'unbounded',
  });
  return results;
});
