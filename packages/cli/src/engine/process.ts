import { Effect, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

// Runs a command with the terminal attached (git init, bun install).
export const runInherit = Effect.fnUntraced(function* (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner.exitCode(
    ChildProcess.make(command, args, {
      cwd,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }),
  );
});

// Exit code, stdout and stderr. A missing binary counts as a failed run
// (code -1). Messages are forced to English so callers can match them.
export const runCapture = Effect.fnUntraced(function* (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(command, args, {
          cwd,
          env: { LC_ALL: 'C' },
          extendEnv: true,
        }),
      );
      const [stdout, stderr, code] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText, Stream.mkString),
          handle.stderr.pipe(Stream.decodeText, Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: 3 },
      );
      return { code: Number(code), stdout, stderr };
    }),
  ).pipe(
    Effect.catchTag('PlatformError', () =>
      Effect.succeed({ code: -1, stdout: '', stderr: '' }),
    ),
  );
});
