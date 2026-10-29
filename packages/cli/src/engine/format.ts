import { Array as Arr, Effect, String as Str } from 'effect';
import { type FormatConfig, format } from 'oxfmt';
import { shoemakerFormat } from 'shoemaker-oxfmt-config';

import { matchesAny } from './glob.ts';
import type { GeneratedFile } from './types.ts';

// The options generated repos format with, so the bytes shoemaker writes are
// what `oxfmt --write` produces there and a formatter run is never drift.
// Tailwind class sorting is per repo (it needs the stylesheet) and left out.
const { ignorePatterns, overrides, ...oxfmtOptions } = shoemakerFormat;
const baseOptions: FormatConfig = oxfmtOptions;

// oxfmt's JS API ignores `overrides` (only its config loader applies them), so
// they are resolved here. Like oxfmt, a glob without a slash matches the file
// name at any depth.
const optionsFor = (path: string) =>
  Arr.reduce(overrides, baseOptions, (options, override) =>
    matchesAny(
      path,
      Arr.map(override.files, (glob) =>
        Str.includes('/')(glob) ? glob : `**/${glob}`,
      ),
    )
      ? { ...options, ...override.options }
      : options,
  );

// Formats with oxfmt's JS API. Paths the repo's oxfmt ignores, and files oxfmt
// cannot parse or does not support (nix, sh, .gitignore, ...), pass through.
export const formatContent = (path: string, content: string) =>
  matchesAny(path, ignorePatterns)
    ? Effect.succeed(content)
    : Effect.promise(() =>
        format(path, content, optionsFor(path)).then(
          (result) => (result.errors.length === 0 ? result.code : content),
          () => content,
        ),
      );

// json-merge content is a fragment that is merged before formatting, so it is
// left alone here.
export const formatFiles = (files: ReadonlyArray<GeneratedFile>) =>
  Effect.forEach(
    files,
    (file) =>
      file.strategy === 'json-merge'
        ? Effect.succeed(file)
        : Effect.map(formatContent(file.path, file.content), (content) => ({
            ...file,
            content,
          })),
    { concurrency: 16 },
  );
