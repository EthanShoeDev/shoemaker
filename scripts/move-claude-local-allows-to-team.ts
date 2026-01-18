#!/usr/bin/env bun
import * as readline from 'node:readline';
import { Command as CliCommand } from '@effect/cli';
import { Command, FileSystem, Path } from '@effect/platform';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Array as Arr, Data, Effect, Logger, LogLevel, pipe } from 'effect';

const COMMAND_NAME = 'move-claude-local-allows-to-team';
const TEAM_SETTINGS_PATH = '.claude/settings.json';
const LOCAL_SETTINGS_PATH = '.claude/settings.local.json';

interface ClaudeSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

class SettingsError extends Data.TaggedError('SettingsError')<{
  message: string;
  cause?: unknown;
}> {}

const command = CliCommand.make(COMMAND_NAME, {}, () =>
  main().pipe(Effect.scoped, Logger.withMinimumLogLevel(LogLevel.Debug)),
);

const run = CliCommand.run(command, {
  name: COMMAND_NAME,
  version: '0.0.1',
});

run(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);

const readJsonFile = <T>(filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(filePath);
    if (!exists) {
      return null;
    }
    const content = yield* fs.readFileString(filePath);
    return JSON.parse(content) as T;
  });

const promptConfirm = (question: string): Effect.Effect<boolean> =>
  Effect.async<boolean>((resume) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      resume(Effect.succeed(answer.trim().toLowerCase() === 'y'));
    });
  });

const main = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const cwd = process.cwd();
    const teamSettingsPath = path.join(cwd, TEAM_SETTINGS_PATH);
    const localSettingsPath = path.join(cwd, LOCAL_SETTINGS_PATH);

    yield* Effect.log('═'.repeat(60));
    yield* Effect.log('Move Claude Local Allows to Team Settings');
    yield* Effect.log('═'.repeat(60));
    yield* Effect.log('');

    // Step 1: Read both settings files
    yield* Effect.log('STEP 1: Reading settings files');
    yield* Effect.log('─'.repeat(60));

    const teamSettings = yield* pipe(
      readJsonFile<ClaudeSettings>(teamSettingsPath),
      Effect.mapError(
        (cause) =>
          new SettingsError({
            message: `Failed to read team settings: ${teamSettingsPath}`,
            cause,
          }),
      ),
    );

    const localSettings = yield* pipe(
      readJsonFile<ClaudeSettings>(localSettingsPath),
      Effect.mapError(
        (cause) =>
          new SettingsError({
            message: `Failed to read local settings: ${localSettingsPath}`,
            cause,
          }),
      ),
    );

    if (!teamSettings) {
      return yield* Effect.fail(
        new SettingsError({
          message: `Team settings file not found: ${teamSettingsPath}`,
        }),
      );
    }

    if (!localSettings) {
      yield* Effect.log('No local settings file found. Nothing to merge.');
      return;
    }

    yield* Effect.log(`Team settings: ${teamSettingsPath}`);
    yield* Effect.log(`Local settings: ${localSettingsPath}`);
    yield* Effect.log('');

    // Step 2: Calculate the superset of allowed commands
    yield* Effect.log('STEP 2: Calculating command differences');
    yield* Effect.log('─'.repeat(60));

    const teamAllows = teamSettings.permissions?.allow ?? [];
    const localAllows = localSettings.permissions?.allow ?? [];

    yield* Effect.log(`Team allows: ${teamAllows.length} commands`);
    yield* Effect.log(`Local allows: ${localAllows.length} commands`);

    // Find commands in local that are not in team
    const newCommands = Arr.differenceWith<string>((a, b) => a === b)(
      localAllows,
      teamAllows,
    );

    if (newCommands.length === 0) {
      yield* Effect.log('');
      yield* Effect.log(
        'No new commands to add. Local allows are already in team settings.',
      );
      return;
    }

    yield* Effect.log('');
    yield* Effect.log(`New commands to add (${newCommands.length}):`);
    for (const cmd of newCommands) {
      yield* Effect.log(`  + ${cmd}`);
    }
    yield* Effect.log('');

    // Step 3: Prompt user for confirmation
    yield* Effect.log('STEP 3: Confirm changes');
    yield* Effect.log('─'.repeat(60));

    const confirmed = yield* promptConfirm(
      'Add these commands to team settings? [y/N] ',
    );

    if (!confirmed) {
      yield* Effect.log('');
      yield* Effect.log('Cancelled. No changes made.');
      return;
    }

    yield* Effect.log('');

    // Step 4: Merge and write settings
    yield* Effect.log('STEP 4: Writing merged settings');
    yield* Effect.log('─'.repeat(60));

    const mergedAllows = Arr.dedupe([...teamAllows, ...newCommands]);
    const mergedSettings: ClaudeSettings = {
      ...teamSettings,
      permissions: {
        ...teamSettings.permissions,
        allow: mergedAllows,
      },
    };

    const jsonContent = `${JSON.stringify(mergedSettings, null, 2)}\n`;
    yield* fs.writeFileString(teamSettingsPath, jsonContent);
    yield* Effect.log(`Written to: ${teamSettingsPath}`);

    // Step 5: Run oxfmt
    yield* Effect.log('');
    yield* Effect.log('STEP 5: Formatting with oxfmt');
    yield* Effect.log('─'.repeat(60));

    yield* pipe(
      Command.make('pnpm', 'exec', 'oxfmt', '--write', teamSettingsPath),
      Command.exitCode,
      Effect.flatMap((code) =>
        code === 0
          ? Effect.void
          : Effect.fail(new Error(`oxfmt failed with exit code ${code}`)),
      ),
    );
    yield* Effect.log('Formatted successfully');

    // Summary
    yield* Effect.log('');
    yield* Effect.log('═'.repeat(60));
    yield* Effect.log('Complete');
    yield* Effect.log('═'.repeat(60));
    yield* Effect.log('');
    yield* Effect.log(
      `Added ${newCommands.length} new command(s) to team settings.`,
    );
    yield* Effect.log('');
  });
