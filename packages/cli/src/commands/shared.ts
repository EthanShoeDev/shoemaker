import { Console, Effect, Path, Runtime, Schema } from 'effect';
import { Flag, TerminalCapabilities } from 'effect/cli';

import { removeFile, writeFile } from '../engine/apply.ts';
import type { FileChange } from '../engine/repo.ts';
import { makeStyle } from '../engine/report.ts';

// A failure whose explanation is already on the terminal: exit non-zero
// without runMain logging the error again.
export class CommandFailed extends Schema.TaggedError<
  CommandFailed,
  { readonly brand: unique symbol }
>()('CommandFailed', { message: Schema.String }) {
  override readonly [Runtime.errorReported]: boolean = false;
}

export const fail = (message: string) =>
  Effect.fail(CommandFailed.make({ message }));

export const style = Effect.gen(function* () {
  const { canColor } = yield* TerminalCapabilities.TerminalCapabilities;
  return makeStyle(canColor);
});

export const cwdFlag = Flag.Directory('cwd').pipe(
  Flag.withDescription('Repo root (defaults to the current directory)'),
  Flag.withDefault('.'),
);

export const resolveRoot = Effect.fnUntraced(function* (dir: string) {
  const path = yield* Path.Path;
  return path.resolve(dir);
});

export const applyChanges = Effect.fnUntraced(function* (
  root: string,
  changes: ReadonlyArray<FileChange>,
) {
  const s = yield* style;
  for (const change of changes) {
    if (change.content === undefined) {
      yield* removeFile(root, change.path);
      yield* Console.log(`  ${s.red('delete')} ${change.path}`);
    } else {
      yield* writeFile(root, change.path, change.content);
      yield* Console.log(`  ${s.green('write ')} ${change.path}`);
    }
  }
});
