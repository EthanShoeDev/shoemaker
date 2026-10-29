#!/usr/bin/env bun
// Moves the `permissions.allow` entries from .claude/settings.local.json that
// are missing from the tracked .claude/settings.json into it, after a prompt.
import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
} from 'effect';
import { Command, Prompt } from 'effect/cli';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

const TEAM_SETTINGS_PATH = '.claude/settings.json';
const LOCAL_SETTINGS_PATH = '.claude/settings.local.json';

const Settings = Schema.fromJsonString(
  Schema.StructWithRest(
    Schema.Struct({
      permissions: Schema.optional(
        Schema.StructWithRest(
          Schema.Struct({
            allow: Schema.optional(Schema.Array(Schema.String)),
          }),
          [Schema.Record(Schema.String, Schema.Unknown)],
        ),
      ),
    }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
);
const decodeSettings = Schema.decodeEffect(Settings);
const encodeSettings = Schema.encodeEffect(Settings);

class SettingsError extends Schema.TaggedError<
  SettingsError,
  { readonly brand: unique symbol }
>()('SettingsError', { message: Schema.String }) {}

const readSettings = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(file))) return Option.none();
  return Option.some(yield* decodeSettings(yield* fs.readFileString(file)));
});

const main = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const teamPath = path.resolve(TEAM_SETTINGS_PATH);
  const localPath = path.resolve(LOCAL_SETTINGS_PATH);

  const team = yield* readSettings(teamPath);
  if (Option.isNone(team)) {
    return yield* SettingsError.make({
      message: `Team settings file not found: ${teamPath}`,
    });
  }
  const local = yield* readSettings(localPath);
  if (Option.isNone(local)) {
    yield* Console.log('No local settings file found. Nothing to merge.');
    return;
  }

  const teamAllows = team.value.permissions?.allow ?? [];
  const localAllows = local.value.permissions?.allow ?? [];
  const newCommands = Arr.difference(localAllows, teamAllows);
  yield* Console.log(
    `Team allows: ${teamAllows.length}, local allows: ${localAllows.length}`,
  );
  if (newCommands.length === 0) {
    yield* Console.log(
      'No new commands to add. Local allows are already in team settings.',
    );
    return;
  }
  yield* Console.log(`New commands to add (${newCommands.length}):`);
  for (const command of newCommands) yield* Console.log(`  + ${command}`);

  const confirmed = yield* Prompt.run(
    Prompt.Confirm({
      message: 'Add these commands to team settings?',
      initial: false,
    }),
  );
  if (!confirmed) {
    yield* Console.log('Cancelled. No changes made.');
    return;
  }

  const merged = {
    ...team.value,
    permissions: {
      ...team.value.permissions,
      allow: Arr.dedupe([...teamAllows, ...newCommands]),
    },
  };
  yield* fs.writeFileString(teamPath, `${yield* encodeSettings(merged)}\n`);
  // The encoder writes compact JSON; oxfmt restores the repo's formatting.
  const exitCode = yield* spawner.exitCode(
    ChildProcess.make(
      'bunx',
      ['oxfmt', '-c', 'oxfmt.config.ts', '--write', teamPath],
      {
        stdout: 'inherit',
        stderr: 'inherit',
      },
    ),
  );
  if (exitCode !== 0) {
    return yield* SettingsError.make({
      message: `oxfmt failed with exit code ${exitCode}`,
    });
  }
  yield* Console.log(
    `Added ${newCommands.length} command(s) to ${TEAM_SETTINGS_PATH}.`,
  );
});

const command = Command.make(
  'move-claude-local-allows-to-team',
  {},
  () => main,
);

Command.run(command, { version: '0.0.1' }).pipe(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- this is the entry point
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
