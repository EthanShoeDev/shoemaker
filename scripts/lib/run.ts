import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  Array as Arr,
  Effect,
  Layer,
  Schema,
  Stream,
  String as Str,
} from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

export class CommandFailed extends Schema.TaggedError<
  CommandFailed,
  { readonly brand: unique symbol }
>()('CommandFailed', {
  command: Schema.String,
  code: Schema.Finite,
  output: Schema.String,
}) {
  override get message() {
    const tail = Arr.join(Str.split(this.output, '\n').slice(-40), '\n');
    return `\`${this.command}\` exited ${this.code}\n${tail}`;
  }
}

export interface RunOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

const make = (
  command: string,
  args: ReadonlyArray<string>,
  options: RunOptions,
) =>
  ChildProcess.make(command, args, {
    cwd: options.cwd,
    env: options.env,
    extendEnv: true,
  });

// Runs a command quietly and returns its exit code and combined output.
export const capture = Effect.fnUntraced(function* (
  command: string,
  args: ReadonlyArray<string>,
  options: RunOptions = {},
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(make(command, args, options));
      const [output, code] = yield* Effect.all(
        [handle.all.pipe(Stream.decodeText, Stream.mkString), handle.exitCode],
        { concurrency: 2 },
      );
      return { code: Number(code), output };
    }),
  );
});

// Runs a command quietly; a non-zero exit fails with its output.
export const run = Effect.fnUntraced(function* (
  command: string,
  args: ReadonlyArray<string>,
  options: RunOptions = {},
) {
  const result = yield* capture(command, args, options);
  if (result.code !== 0) {
    return yield* CommandFailed.make({
      command: Arr.join([command, ...args], ' '),
      code: result.code,
      output: result.output,
    });
  }
  return result.output;
});

// Runs a command with its output on the terminal.
export const runInherit = Effect.fnUntraced(function* (
  command: string,
  args: ReadonlyArray<string>,
  options: RunOptions = {},
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const code = Number(
    yield* spawner.exitCode(
      ChildProcess.make(command, args, {
        cwd: options.cwd,
        env: options.env,
        extendEnv: true,
        stdout: 'inherit',
        stderr: 'inherit',
      }),
    ),
  );
  if (code !== 0) {
    return yield* CommandFailed.make({
      command: Arr.join([command, ...args], ' '),
      code,
      output: '',
    });
  }
});

// Entry point for every script: Bun's platform services plus a fetch-backed
// HttpClient, then runMain.
export const runScript = <A, E>(
  program: Effect.Effect<A, E, BunServices.BunServices | HttpClient.HttpClient>,
) =>
  program.pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- this is the entry point
    Effect.provide(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer)),
    BunRuntime.runMain,
  );
