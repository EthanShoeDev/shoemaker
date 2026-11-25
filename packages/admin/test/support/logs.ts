import { Array as Arr, Effect, Logger, Ref } from 'effect';

// What a program logged, and the layer that collects it.
export const captureLogs = Effect.gen(function* () {
  const lines = yield* Ref.make(Arr.empty<string>());
  const context = yield* Effect.context();
  const logger = Logger.make((options) => {
    Effect.runSyncWith(context)(
      Ref.update(lines, Arr.append(Logger.formatLogFmt.log(options))),
    );
  });
  return { lines: Ref.get(lines), layer: Logger.layer([logger]) };
});
