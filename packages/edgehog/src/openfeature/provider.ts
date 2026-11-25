import {
  ErrorCode,
  type EvaluationContext,
  GeneralError,
  type JsonValue,
  OpenFeatureEventEmitter,
  type Provider,
  ProviderEvents,
  type ResolutionDetails,
  StandardResolutionReasons,
} from '@openfeature/server-sdk';
import { Effect, Match } from 'effect';

import type { FlagType, FlagValue } from '../core/flag-config.ts';
import type { FlagErrorCode, FlagResolution } from '../core/flag-resolution.ts';
import type { FlagDefinitions } from '../core/flag-store.ts';
import { type FlagCacheEvent, makeFlagCache } from '../flags/cache.ts';
import { resolveFlag } from '../flags/evaluate.ts';
import { PIN, type Pinned } from './pin.ts';

export interface EdgehogProviderOptions {
  readonly projectId: number;
  // Runs an effect for the caller of an evaluation, such as
  // `runtime.runPromise`. On Workers it belongs to the current request, like
  // the storage it reaches.
  readonly run: <A>(
    effect: Effect.Effect<A, never, FlagDefinitions>,
  ) => Promise<A>;
  // Loads on the first evaluation and not when it is registered.
  readonly lazy?: boolean;
}

const CODES: Readonly<Record<FlagErrorCode, ErrorCode>> = {
  FLAG_NOT_FOUND: ErrorCode.FLAG_NOT_FOUND,
  GENERAL: ErrorCode.GENERAL,
  INVALID_CONTEXT: ErrorCode.INVALID_CONTEXT,
  PARSE_ERROR: ErrorCode.PARSE_ERROR,
  TARGETING_KEY_MISSING: ErrorCode.TARGETING_KEY_MISSING,
  TYPE_MISMATCH: ErrorCode.TYPE_MISMATCH,
};

const NOT_LOADED = 'Flag definitions could not be loaded.';

const NEVER_LOADED: FlagResolution = {
  kind: 'error',
  errorCode: 'GENERAL',
  errorMessage: 'Flag definitions were never loaded.',
};

const toDetails = <T>(
  resolution: FlagResolution,
  fallback: T,
): ResolutionDetails<T> => {
  switch (resolution.kind) {
    case 'value': {
      return {
        // The evaluator has checked it against the type asked for.
        value: resolution.value as FlagValue & T,
        variant: resolution.variant,
        reason: resolution.reason,
        flagMetadata: { ...resolution.flagMetadata },
      };
    }
    case 'disabled': {
      return {
        value: fallback,
        reason: StandardResolutionReasons.DISABLED,
        flagMetadata: { ...resolution.flagMetadata },
      };
    }
    case 'error': {
      return {
        value: fallback,
        reason: StandardResolutionReasons.ERROR,
        errorCode: CODES[resolution.errorCode],
        errorMessage: resolution.errorMessage,
      };
    }
  }
};

// Evaluates a project's flags in process, for the official OpenFeature server
// SDK.
//
// Registering it loads the definitions, so a provider that cannot is in error.
// It answers the application's defaults then, and recovers by itself.
//
// A Worker may stop a request for good while it loads, and the SDK would wait
// for that load for as long as the isolate lives. There, and wherever nothing
// may be read outside a request, use `lazy`: nothing is loaded before the first
// evaluation, so it can be registered anywhere and has nothing to wait for.
export const edgehogProvider = (options: EdgehogProviderOptions): Provider => {
  const events = new OpenFeatureEventEmitter();
  let initializing = false;

  const onEvent = (event: FlagCacheEvent) =>
    Effect.sync(() => {
      Match.value(event).pipe(
        Match.discriminatorsExhaustive('kind')({
          // The SDK announces a provider it has registered.
          ready: ({ first }) => {
            if (!first && !initializing) events.emit(ProviderEvents.Ready);
          },
          stale: () => {
            events.emit(ProviderEvents.Stale);
          },
          error: () => {
            // So does it one that failed to initialize.
            if (!initializing) {
              events.emit(ProviderEvents.Error, { message: NOT_LOADED });
            }
          },
          changed: ({ keys }) => {
            events.emit(ProviderEvents.ConfigurationChanged, {
              flagsChanged: [...keys],
            });
          },
        }),
      );
    });

  const cache = makeFlagCache({ projectId: options.projectId, onEvent });

  const read = (context: EvaluationContext & Pinned) => {
    const pin = context[PIN];
    const pinned = pin?.get(cache);
    if (pinned !== undefined) return pinned;
    const reading = options.run(cache.read);
    pin?.set(cache, reading);
    return reading;
  };

  const resolve =
    <T>(type: FlagType) =>
    (key: string, fallback: T, context: EvaluationContext) =>
      read(context).then((definitions) =>
        toDetails(
          definitions === null
            ? NEVER_LOADED
            : resolveFlag(definitions, key, type, context),
          fallback,
        ),
      );

  const initialize = () => {
    initializing = true;
    return options
      .run(cache.read)
      .then((definitions) => {
        if (definitions === null) throw new GeneralError(NOT_LOADED);
      })
      .finally(() => {
        initializing = false;
      });
  };

  return {
    metadata: { name: 'edgehog' },
    runsOn: 'server',
    events,
    ...(options.lazy === true ? {} : { initialize }),
    onClose: () => options.run(cache.reset),
    resolveBooleanEvaluation: resolve<boolean>('boolean'),
    resolveStringEvaluation: resolve<string>('string'),
    resolveNumberEvaluation: resolve<number>('number'),
    resolveObjectEvaluation: <T extends JsonValue>(
      key: string,
      fallback: T,
      context: EvaluationContext,
    ) => resolve<T>('object')(key, fallback, context),
  };
};
