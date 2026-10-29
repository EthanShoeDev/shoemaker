import { shoeboxFormat } from '@shoe-box-tools/oxfmt-config';
import { Effect } from 'effect';
import { format } from 'oxfmt';

import { matchesAny } from './glob.ts';
import type { GeneratedFile } from './types.ts';

// The options generated repos format with, so the bytes shoebox writes are
// what `oxfmt --write` produces there and a formatter run is never drift.
// Tailwind class sorting is per repo (it needs the stylesheet) and left out.
const { ignorePatterns, ...oxfmtOptions } = shoeboxFormat;

// Formats with oxfmt's JS API. Paths the repo's oxfmt ignores, and files oxfmt
// cannot parse or does not support (nix, sh, .gitignore, ...), pass through.
export const formatContent = (path: string, content: string) =>
  matchesAny(path, ignorePatterns)
    ? Effect.succeed(content)
    : Effect.promise(() =>
        format(path, content, oxfmtOptions).then(
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
