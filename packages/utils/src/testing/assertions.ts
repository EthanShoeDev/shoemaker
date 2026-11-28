import { assert } from '@effect/vitest';
import { Effect, Exit } from 'effect';

// Runs the effect and compares what it returns.
export const equals = <A, E, R>(effect: Effect.Effect<A, E, R>, expected: A) =>
  Effect.map(effect, (actual) => {
    assert.deepStrictEqual(actual, expected);
  });

export const sameMembers = <A, E, R>(
  effect: Effect.Effect<ReadonlyArray<A>, E, R>,
  expected: ReadonlyArray<A>,
) =>
  Effect.map(effect, (actual) => {
    assert.sameDeepMembers([...actual], [...expected]);
  });

// Ends in an error of its own; a defect or an interruption does not count.
export const fails = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.map(Effect.exit(effect), (exit) => {
    assert.isTrue(Exit.hasFails(exit));
  });

// Ends in a defect: a mistake in the host's code, not something to handle.
export const dies = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.map(Effect.exit(effect), (exit) => {
    assert.isTrue(Exit.hasDies(exit));
  });
