import { Console, Effect, Schema } from 'effect';
import { CliError, Command, TerminalCapabilities } from 'effect/cli';

import { cliVersion } from '../engine/meta.ts';
import { addCommand } from './add.ts';
import { adoptCommand } from './adopt.ts';
import { checkCommand } from './check.ts';
import { doctorCommand } from './doctor.ts';
import { initCommand } from './init.ts';
import { migrateCommand } from './migrate.ts';
import { CommandFailed, style } from './shared.ts';
import { syncCommand } from './sync.ts';

export const shoebox = Command.make('shoebox').pipe(
  Command.withDescription(
    "Scaffold and keep in sync Effect + bun monorepos with Ethan's preferences",
  ),
  Command.withSubcommands([
    initCommand,
    syncCommand,
    addCommand,
    doctorCommand,
    adoptCommand,
    migrateCommand,
    checkCommand,
  ]),
);

const toFailure = (error: unknown) =>
  CliError.isCliError(error) || Schema.is(CommandFailed)(error)
    ? Effect.fail(error)
    : Effect.gen(function* () {
        const s = yield* style;
        const message = error instanceof Error ? error.message : String(error);
        yield* Console.error(s.red(`error: ${message}`));
        return yield* CommandFailed.make({ message });
      });

// `args` excludes the executable and script path. Fallback prompts run while
// flags are parsed, before any handler, so `--yes` switches prompting off up
// front. Expected failures print one line and exit 1; CLI parse errors are
// already rendered by Command.run.
export const runShoebox = Effect.fnUntraced(function* (
  args: ReadonlyArray<string>,
) {
  const capabilities = yield* TerminalCapabilities.TerminalCapabilities;
  const yes = args.includes('--yes') || args.includes('-y');
  return yield* Command.runWith(shoebox, { version: cliVersion })(args).pipe(
    Effect.provideService(TerminalCapabilities.TerminalCapabilities, {
      canColor: capabilities.canColor,
      canAnimate: capabilities.canAnimate,
      canPrompt: capabilities.canPrompt && !yes,
    }),
    Effect.catch(toFailure),
  );
});
