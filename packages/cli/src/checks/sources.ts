import { Array as Arr, Effect, pipe, String as Str } from 'effect';

import type { Repo } from '../engine/repo.ts';

const SOURCES = '**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,vue,svelte}';

// Not project code: vendored references, generated output, agent bundles.
const NOT_PROJECT =
  /(?:^|\/)(?:node_modules|dist|\.turbo|\.git|docs\/cloned-repos-as-docs|submodules|vendor|\.agents|\.claude|\.cursor|\.opencode|\.output|\.nitro|\.next|\.expo|build|coverage|ios|android)\//u;

// Plain directory entries of .gitignore (`dist`, `/tmp/`), enough to keep
// ignored trees out of a scan without a full gitignore matcher.
export const gitignoredDirs = (gitignore: string | undefined) =>
  pipe(
    Str.split(gitignore ?? '', '\n'),
    Arr.map((line) => Str.trim(line)),
    Arr.filter((line) => /^\/?[\w.@-]+(?:\/[\w.@-]+)*\/?$/u.test(line)),
    Arr.map((line) =>
      pipe(line, Str.replace(/^\//u, ''), Str.replace(/\/$/u, '')),
    ),
  );

export const isGitignored = (gitignore: string | undefined, file: string) =>
  pipe(
    Str.split(gitignore ?? '', '\n'),
    Arr.map((line) => pipe(line, Str.trim, Str.replace(/^\//u, ''))),
    Arr.some((line) => line === file || line === `**/${file}`),
  );

// Project source files (JS/TS family), skipping vendored and ignored trees.
export const sourceFiles = Effect.fnUntraced(function* (repo: Repo) {
  const ignored = gitignoredDirs(yield* repo.read('.gitignore'));
  return Arr.filter(
    yield* repo.glob(SOURCES),
    (file) =>
      !NOT_PROJECT.test(`/${file}`) &&
      !/\.gen\.|\.d\.ts$/u.test(file) &&
      !Arr.some(
        ignored,
        (dir) =>
          Str.startsWith(`${dir}/`)(file) || Str.includes(`/${dir}/`)(file),
      ),
  );
});
