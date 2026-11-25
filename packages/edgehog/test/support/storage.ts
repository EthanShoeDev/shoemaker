import { Effect, Layer, Ref } from 'effect';

import {
  type FlagDefinition,
  type FlagDefinitionMap,
  FlagDefinitions,
  FlagsUnavailable,
} from '../../src/index.ts';

const SLOW = '2 seconds';

// Storage a test can change, break and hold up, and that counts its reads.
export const makeStorage = (initial: FlagDefinitionMap, project = 1) => {
  const held = Ref.makeUnsafe(initial);
  const outage = Ref.makeUnsafe<'down' | 'hanging' | 'slow' | 'up'>('up');
  const reads = Ref.makeUnsafe(0);
  const load = Effect.fnUntraced(function* (projectId: number) {
    yield* Ref.update(reads, (count) => count + 1);
    // Never within the call that asked, like any storage.
    yield* Effect.promise(() => Promise.resolve());
    const state = yield* Ref.get(outage);
    if (state === 'slow') yield* Effect.sleep(SLOW);
    if (state === 'hanging') return yield* Effect.never;
    if (state === 'down') {
      return yield* FlagsUnavailable.make({ cause: 'down' });
    }
    return projectId === project
      ? yield* Ref.get(held)
      : new Map<string, FlagDefinition>();
  });
  return {
    held,
    outage,
    reads: Ref.get(reads),
    layer: Layer.succeed(FlagDefinitions, { load }),
    load,
  };
};
