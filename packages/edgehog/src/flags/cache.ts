import {
  Array as Arr,
  Clock,
  Duration,
  Effect,
  Exit,
  Fiber,
  Ref,
} from 'effect';

import { FlagDefinitions, type FlagDefinitionMap } from '../core/flag-store.ts';

// While storage answers, nothing older is served, so a change takes effect
// within this time. Loads start at least this far apart, so it is also how
// often storage is read.
const FRESH = Duration.toMillis('1 minute');
const LOAD_TIMEOUT = Duration.toMillis('5 seconds');
// How soon another load may follow one that failed, or that never ended because
// the request it belonged to was stopped.
const RETRY = Duration.toMillis('10 seconds');
const POLL = Duration.millis(20);

export type FlagCacheEvent =
  // `first` is the first load, and not a recovery.
  | { readonly kind: 'ready'; readonly first: boolean }
  // What is held is older than it should be.
  | { readonly kind: 'stale' }
  // Nothing was ever loaded.
  | { readonly kind: 'error' }
  | { readonly kind: 'changed'; readonly keys: ReadonlyArray<string> };

// Elapsed time is the longer of the two: the wall clock can be set back, and
// the monotonic one can stop while a machine is paused.
interface Instant {
  readonly wall: number;
  readonly monotonic: number;
}

const instant = Effect.gen(function* () {
  const wall = yield* Clock.currentTimeMillis;
  const monotonic = yield* Clock.monotonicTimeNanos;
  return { wall, monotonic: Number(monotonic / 1_000_000n) };
});

const elapsed = (since: Instant, now: Instant) =>
  Math.max(now.wall - since.wall, now.monotonic - since.monotonic);

interface Attempt {
  readonly id: number;
  readonly startedAt: Instant;
  readonly state: 'done' | 'failed' | 'running';
}

interface State {
  // Null until the first load.
  readonly definitions: FlagDefinitionMap | null;
  // What is held, and when it was asked for.
  readonly loadedBy: number;
  readonly loadedAt: Instant;
  readonly health: 'error' | 'ready' | 'stale' | 'unknown';
  readonly attempt: Attempt;
}

const START: Instant = { wall: 0, monotonic: 0 };

const initial: State = {
  definitions: null,
  loadedBy: 0,
  loadedAt: START,
  health: 'unknown',
  attempt: { id: 0, startedAt: START, state: 'done' },
};

type Events = ReadonlyArray<FlagCacheEvent>;

const changedKeys = (before: FlagDefinitionMap, after: FlagDefinitionMap) =>
  Arr.filter(
    Arr.dedupe([...before.keys(), ...after.keys()]),
    (key) =>
      before.get(key)?.id !== after.get(key)?.id ||
      before.get(key)?.version !== after.get(key)?.version,
  );

const toLoaded = (
  state: State,
  { id, startedAt }: Attempt,
  definitions: FlagDefinitionMap,
): readonly [Events, State] => {
  // A load given up on, that ended after a later one.
  if (id < state.loadedBy) return [[], state];
  const keys =
    state.definitions === null
      ? []
      : changedKeys(state.definitions, definitions);
  const events: Events = [
    ...(state.health === 'ready'
      ? []
      : [{ kind: 'ready' as const, first: state.health === 'unknown' }]),
    ...(Arr.isReadonlyArrayNonEmpty(keys)
      ? [{ kind: 'changed' as const, keys }]
      : []),
  ];
  return [
    events,
    {
      definitions,
      loadedBy: id,
      loadedAt: startedAt,
      health: 'ready',
      attempt:
        id === state.attempt.id
          ? { id, startedAt, state: 'done' }
          : state.attempt,
    },
  ];
};

const toFailed = (
  state: State,
  { id, startedAt }: Attempt,
): readonly [Events, State] => {
  if (id !== state.attempt.id) return [[], state];
  const kind = state.definitions === null ? 'error' : 'stale';
  return [
    state.health === kind ? [] : [{ kind }],
    {
      ...state,
      health: kind,
      attempt: { id, startedAt, state: 'failed' },
    },
  ];
};

type Step =
  | { readonly kind: 'load'; readonly attempt: Attempt }
  | { readonly kind: 'use'; readonly events: Events }
  | { readonly kind: 'wait' };

const decide = (state: State, now: Instant): readonly [Step, State] => {
  const { attempt, definitions } = state;
  const use = (events: Events = []): Step => ({ kind: 'use', events });
  if (definitions !== null && elapsed(state.loadedAt, now) < FRESH) {
    return [use(), state];
  }
  const running = elapsed(attempt.startedAt, now);
  if (attempt.state === 'running' && running < RETRY) {
    // It is already known to be late, or there is nothing else to answer with.
    if (state.health === 'stale') return [use(), state];
    if (definitions === null || running < LOAD_TIMEOUT) {
      return [{ kind: 'wait' }, state];
    }
    // Whoever was loading is gone, or it would have timed out.
    const [events, failed] = toFailed(state, attempt);
    return [use(events), failed];
  }
  if (attempt.state === 'failed' && running < RETRY) return [use(), state];
  const next: Attempt = {
    id: attempt.id + 1,
    startedAt: now,
    state: 'running',
  };
  return [
    { kind: 'load', attempt: next },
    { ...state, attempt: next },
  ];
};

// Holds one project's definitions and refreshes them when read, since Workers
// have no background timers. However often it is read, it loads at most once a
// minute, and once every ten seconds while that fails.
//
// One caller loads. The others never wait for its promise, which on Workers
// belongs to another request: they look again on their own timer, for at most
// the time a load may take, and then use what is held.
export const makeFlagCache = (options: {
  readonly projectId: number;
  readonly onEvent?: (event: FlagCacheEvent) => Effect.Effect<void>;
}) => {
  const ref = Ref.makeUnsafe(initial);

  const emit = (events: Events) =>
    Effect.forEach(events, options.onEvent ?? (() => Effect.void), {
      concurrency: 1,
      discard: true,
    });

  const load = (attempt: Attempt) =>
    Effect.flatMap(FlagDefinitions, (definitions) =>
      definitions.load(options.projectId),
    ).pipe(
      Effect.timeout(LOAD_TIMEOUT),
      Effect.tapCause((cause) =>
        Effect.logWarning('Flag definitions could not be loaded', cause),
      ),
      Effect.onExit((exit) =>
        Ref.modify(ref, (state) =>
          Exit.isSuccess(exit)
            ? toLoaded(state, attempt, exit.value)
            : toFailed(state, attempt),
        ).pipe(Effect.flatMap(emit)),
      ),
      Effect.withSpan('FlagCache.load'),
      Effect.exit,
    );

  // The definitions, or null when none were ever loaded. All of one answer come
  // from one load.
  const read: Effect.Effect<FlagDefinitionMap | null, never, FlagDefinitions> =
    Effect.gen(function* () {
      for (;;) {
        const now = yield* instant;
        const [step, held] = yield* Ref.modify(ref, (state) => {
          const [taken, after] = decide(state, now);
          return [[taken, after.definitions] as const, after];
        });
        switch (step.kind) {
          case 'use': {
            yield* emit(step.events);
            return held;
          }
          case 'load': {
            // Detached, so a caller that gives up does not fail it for others.
            const fiber = yield* Effect.forkDetach(load(step.attempt));
            yield* Fiber.join(fiber);
            break;
          }
          case 'wait': {
            yield* Effect.sleep(POLL);
            break;
          }
        }
      }
    });

  return {
    read,
    // Forgets everything, and what is still loading.
    reset: Ref.update(ref, ({ attempt }) => {
      const id = attempt.id + 1;
      return { ...initial, loadedBy: id, attempt: { ...initial.attempt, id } };
    }),
  };
};
