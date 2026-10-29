import { Console, Effect } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';

import { inferConfig } from '../adopt/infer.ts';
import { CONFIG_PATH, configExists } from '../config/load.ts';
import { renderConfigFile } from '../config/render.ts';
import { writeFile } from '../engine/apply.ts';
import { makeRepo } from '../engine/repo-live.ts';
import { fail, resolveRoot, style } from './shared.ts';
import { runSync } from './sync.ts';

export const runAdopt = Effect.fnUntraced(function* (input: {
  readonly directory: string;
  readonly force: boolean;
}) {
  const s = yield* style;
  const root = yield* resolveRoot(input.directory);
  if ((yield* configExists(root)) && !input.force) {
    return yield* fail(
      `${root} already has ${CONFIG_PATH}. Run \`shoebox sync\`, or pass --force to re-infer it.`,
    );
  }
  const config = yield* inferConfig(yield* makeRepo(root));
  yield* writeFile(root, CONFIG_PATH, renderConfigFile(config));
  yield* Console.log(
    `${s.green('Wrote')} ${CONFIG_PATH} (inferred). Review it, then sync.\n\n${s.bold('What sync would change:')}`,
  );
  // Untracked files are expected here, so the dry run's conflict exit is not
  // adopt's failure.
  yield* runSync({
    root,
    config,
    dryRun: true,
    force: [],
    allowDirty: true,
  }).pipe(Effect.catchTag('CommandFailed', () => Effect.void));
  yield* Console.log(
    `\nNext: edit ${CONFIG_PATH} until the plan looks right, then \`shoebox sync --force '<glob>'\` to take generated versions of untracked files.`,
  );
});

export const adoptCommand = Command.make(
  'adopt',
  {
    directory: Argument.String('directory').pipe(
      Argument.withDescription('Existing repo to bring under shoebox'),
      Argument.withDefault('.'),
    ),
    force: Flag.Boolean('force').pipe(
      Flag.withDescription(`Overwrite an existing ${CONFIG_PATH}`),
      Flag.withDefault(false),
    ),
  },
  runAdopt,
).pipe(
  Command.withDescription(
    'Infer shoebox.config.ts for an existing repo and preview the sync',
  ),
);
