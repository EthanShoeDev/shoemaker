import {
  Array as Arr,
  Effect,
  Option,
  Predicate,
  Record as Rec,
  Schema,
  String as Str,
} from 'effect';

import { decodeJsonc, isRecord, readWorkspace } from '../checks/workspace.ts';
import type { Repo } from '../engine/repo.ts';

const TurboJsonc = Schema.Struct({
  tasks: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({ command: Schema.optional(Schema.Unknown) }),
    ),
  ),
});

// A task `command` is an argv, or a per-toolchain map of them.
const argvOf = (command: unknown) => {
  const argv = Arr.isArray(command)
    ? command
    : isRecord(command)
      ? command.javascript
      : undefined;
  return Arr.isArray(argv) && Arr.every(argv, Predicate.isString)
    ? argv
    : undefined;
};

// `bun run tsc --noEmit` (a turbo command) runs what the script `tsc --noEmit`
// runs.
const normalize = (words: ReadonlyArray<string>) =>
  Arr.join(
    words[0] === 'bun' && words[1] === 'run' ? words.slice(2) : words,
    ' ',
  );

const wordsOf = (script: string) =>
  Arr.filter(Str.split(Str.trim(script), /\s+/u), Str.isNonEmpty);

// Package scripts identical to a root turbo.jsonc task `command`. A package
// script overrides the command, so a copy keeps running the old definition
// after the shared one changes.
export const commandCopies = Effect.fnUntraced(function* (repo: Repo) {
  const workspace = yield* readWorkspace(repo);
  const turbo = decodeJsonc(TurboJsonc, yield* repo.read('turbo.jsonc'));
  if (workspace === undefined || Option.isNone(turbo)) return [];
  const commands = new Map(
    Arr.flatMap(Rec.toEntries(turbo.value.tasks ?? {}), ([name, task]) => {
      const argv = argvOf(task.command);
      return Str.includes('#')(name) || argv === undefined
        ? []
        : [[name, normalize(argv)] as const];
    }),
  );
  return Arr.flatMap(workspace.packages, (manifest) =>
    Arr.flatMap(Rec.toEntries(manifest.pkg.scripts ?? {}), ([name, script]) =>
      commands.get(name) === normalize(wordsOf(script))
        ? [{ manifest, name }]
        : [],
    ),
  );
});
