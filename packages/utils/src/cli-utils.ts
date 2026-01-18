import { Command, Path } from '@effect/platform';
import { Effect, Option, pipe, Stream, String } from 'effect';

export const CommandUtils = {
  withLog: <A, E, R>(
    cmd: Command.Command,
    runner: (cmd: Command.Command) => Effect.Effect<A, E, R>,
  ) =>
    Effect.gen(function* () {
      const flattenedCmd = Command.flatten(cmd);
      const [firstCmd] = flattenedCmd;
      yield* Effect.logDebug(
        `Running: '${flattenedCmd
          .map((c) => `${c.command} ${c.args.join(' ')}`)
          .join(' | ')}' in ${Option.getOrElse(firstCmd.cwd, () => '.')}`,
      );
      return yield* runner(cmd);
    }),

  /**
   * Sets working directory for a command.
   * Also sets PWD env var since some tools read from it.
   */
  withCwd: (cwd: string) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const absoluteCwd = path.resolve(path.join(process.cwd(), cwd));
      return (cmd: Command.Command) =>
        cmd.pipe(
          Command.workingDirectory(absoluteCwd),
          Command.env({ PWD: absoluteCwd }),
        );
    }),

  bufferStringStream: <E, R, TapE = never, TapR = never>(
    stream: Stream.Stream<Uint8Array, E, R>,
    tap?: (value: string) => Effect.Effect<void, TapE, TapR>,
  ): Effect.Effect<string, E | TapE, R | TapR> =>
    stream.pipe(
      Stream.decodeText(),
      Stream.tap(tap ?? Effect.succeed),
      Stream.runFold(String.empty, String.concat),
    ),

  /**
   * Runs a command and returns stdout as string. Fails on non-zero exit.
   */
  runString: (command: Command.Command) => Command.string(command),

  /**
   * Runs a command and returns exit code.
   */
  runExitCode: (command: Command.Command) => Command.exitCode(command),

  /**
   * Runs a command and streams output to inherit (shows in terminal).
   * Returns exit code.
   */
  runCommandInherit: (command: Command.Command) =>
    pipe(
      Command.start(
        command.pipe(Command.stdout('inherit'), Command.stderr('inherit')),
      ),
      Effect.flatMap((process) => process.exitCode),
      Effect.scoped,
    ),

  /**
   * Runs a command with inherited output and logs the command being run.
   */
  runCommandInheritWithLog: (command: Command.Command) =>
    CommandUtils.withLog(command, CommandUtils.runCommandInherit),
};
