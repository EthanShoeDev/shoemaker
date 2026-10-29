import { BunServices } from '@effect/platform-bun';
import { Array as Arr, Console, Effect, FileSystem, Path } from 'effect';
import { TestConsole } from 'effect/testing';

import { runShoebox } from '../../src/commands/index.ts';
import { runCapture } from '../../src/engine/process.ts';

// Runs the CLI, appending everything it printed to `output`.
export const run = (args: ReadonlyArray<string>, output: Array<string>) =>
  Effect.gen(function* () {
    const console = yield* TestConsole.make;
    const collect = Effect.gen(function* () {
      const lines = [
        ...(yield* console.logLines),
        ...(yield* console.errorLines),
      ];
      output.push(...Arr.map(lines, String));
    });
    return yield* runShoebox(args).pipe(
      Effect.provideService(Console.Console, console),
      Effect.ensuring(collect),
    );
  });

export const scratch = (name = 'my-repo') =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return path.join(yield* fs.makeTempDirectoryScoped(), name);
  });

export const withBun = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(BunServices.layer));

export const git = (dir: string, ...args: ReadonlyArray<string>) =>
  runCapture(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=test', ...args],
    dir,
  );

export const readText = (dir: string, file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.readFileString(path.join(dir, file));
  });

export const writeText = (dir: string, file: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(path.join(dir, file)), {
      recursive: true,
    });
    yield* fs.writeFileString(path.join(dir, file), content);
  });
