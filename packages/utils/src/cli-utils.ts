import { Array as Arr, Effect, Path, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

type StandardOptions = ChildProcess.StandardCommand['options'];

/** Rebuilds every command of a (possibly piped) command with new options. */
const mapOptions = (
  command: ChildProcess.Command,
  update: (options: StandardOptions, isLast: boolean) => StandardOptions,
  isLast = true,
): ChildProcess.Command =>
  ChildProcess.isStandardCommand(command)
    ? ChildProcess.make(
        command.command,
        command.args,
        update(command.options, isLast),
      )
    : ChildProcess.pipeTo(
        mapOptions(command.left, update, false),
        mapOptions(command.right, update, isLast),
        command.options,
      );

const flatten = (
  command: ChildProcess.Command,
): Array<ChildProcess.StandardCommand> =>
  ChildProcess.isStandardCommand(command)
    ? [command]
    : [...flatten(command.left), ...flatten(command.right)];

/** `cmd a | cmd b`, for logs. */
export const describeCommand = (command: ChildProcess.Command) =>
  Arr.join(
    Arr.map(flatten(command), (part) =>
      Arr.join([part.command, ...part.args], ' '),
    ),
    ' | ',
  );

/** Outputs to the terminal; inside a pipe only the last stdout is inherited. */
const inheritOutput = (command: ChildProcess.Command) =>
  mapOptions(command, (options, isLast) => ({
    ...options,
    ...(isLast ? { stdout: 'inherit' as const } : {}),
    stderr: 'inherit',
  }));

const withLog = <A, E, R>(
  command: ChildProcess.Command,
  runner: (command: ChildProcess.Command) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const [first] = flatten(command);
    yield* Effect.logDebug(
      `Running: '${describeCommand(command)}' in ${first?.options.cwd ?? '.'}`,
    );
    return yield* runner(command);
  });

const runCommandInherit = (command: ChildProcess.Command) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return yield* spawner.exitCode(inheritOutput(command));
  });

export const CommandUtils = {
  withLog,

  /**
   * Sets the working directory for a command, resolved against the current
   * one. Also sets PWD, which some tools read instead of their real cwd.
   */
  withCwd: (cwd: string) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const absoluteCwd = path.resolve(cwd);
      return (command: ChildProcess.Command) =>
        mapOptions(command, (options) => ({
          ...options,
          cwd: absoluteCwd,
          env: { ...options.env, PWD: absoluteCwd },
          // Without it a custom env replaces the inherited one, PATH included.
          extendEnv: true,
        }));
    }),

  /** Decodes a byte stream to one string, optionally tapping each chunk. */
  bufferStringStream: <E, R, TapE = never, TapR = never>(
    stream: Stream.Stream<Uint8Array, E, R>,
    tap?: (value: string) => Effect.Effect<void, TapE, TapR>,
  ): Effect.Effect<string, E | TapE, R | TapR> =>
    stream.pipe(
      Stream.decodeText(),
      Stream.tap(tap ?? (() => Effect.void)),
      Stream.mkString,
    ),

  /** Runs a command and returns its stdout. */
  runString: (command: ChildProcess.Command) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      return yield* spawner.string(command);
    }),

  /** Runs a command and returns its exit code. */
  runExitCode: (command: ChildProcess.Command) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      return yield* spawner.exitCode(command);
    }),

  /** Runs a command with its output on the terminal; returns the exit code. */
  runCommandInherit,

  /** runCommandInherit, logging the command first. */
  runCommandInheritWithLog: (command: ChildProcess.Command) =>
    withLog(command, runCommandInherit),
};
