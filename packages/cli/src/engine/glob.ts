import { Array as Arr, Glob } from 'effect';

// FileSystem.glob's syntax, dotfiles included. Experimental in Effect, so this
// is the one place that uses it.
// oxlint-disable-next-line effecttsgo/experimental-api-usage -- wrapped here only; FileSystem.glob shares its matcher
const compile = (glob: string) => Glob.make(glob, { dot: true });

export const matchesAny = (path: string, globs: ReadonlyArray<string>) =>
  Arr.some(globs, (glob) =>
    // oxlint-disable-next-line effecttsgo/experimental-api-usage -- wrapped here only; FileSystem.glob shares its matcher
    Glob.match(compile(glob), path),
  );
