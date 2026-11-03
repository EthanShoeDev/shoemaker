import {
  Array as Arr,
  type Data,
  Effect,
  type Schema,
  String as Str,
} from 'effect';
import { type FormatConfig, format } from 'oxfmt';
import { shoemakerFormat } from 'shoemaker-oxfmt-config';

import { printJsonc } from '../generators/task-runner/jsonc.ts';
import { matchesAny } from './glob.ts';
import { renderJson } from './json.ts';
import { GeneratedFile, type RenderedFile } from './types.ts';

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

const asText = (
  file: Data.TaggedEnum.Value<GeneratedFile, 'Json' | 'Jsonc'>,
  content: string,
) =>
  GeneratedFile.Text({
    path: file.path,
    strategy: file.strategy,
    content,
    ...(file.verbatim === undefined ? {} : { verbatim: file.verbatim }),
  });

// Whole JSON files become text here, inside Effect, so a value the codec
// cannot encode fails the plan instead of throwing in a generator.
export const renderFile = GeneratedFile.$match({
  Text: (file): Effect.Effect<RenderedFile, Schema.SchemaError> =>
    Effect.succeed(file),
  Merge: (file) => Effect.succeed(file),
  Json: (file) =>
    Effect.map(renderJson(file.json), (content) => asText(file, content)),
  Jsonc: (file) =>
    Effect.map(printJsonc(file.jsonc, file.trailingCommas), (content) =>
      asText(file, content),
    ),
});

// A json-merge fragment is merged with the file on disk before formatting, and
// a verbatim file is one the repo's formatter ignores, so both are left alone.
export const formatFiles = (files: ReadonlyArray<GeneratedFile>) =>
  Effect.forEach(
    files,
    Effect.fnUntraced(function* (file) {
      const rendered = yield* renderFile(file);
      if (GeneratedFile.$is('Merge')(rendered) || rendered.verbatim === true) {
        return rendered;
      }
      const content = yield* formatContent(rendered.path, rendered.content);
      return GeneratedFile.Text({ ...rendered, content });
    }),
    { concurrency: 16 },
  );
