import type { OxlintRules } from '../helpers.ts';

export type BannedImport = {
  /** Package names; their subpaths (`zod/mini`) are banned too. */
  packages: Array<string>;
  /** What to use instead; oxlint prints it as the error's help. */
  message: string;
};

// The replacement must not be an experimental Effect API, which
// effecttsgo/experimental-api-usage rejects: that is why fast-xml-parser
// (`Xml`) and the glob packages (`Glob`) are not here.

/** Packages whose job Effect already does. */
export const effectReplacements: Array<BannedImport> = [
  {
    packages: ['jsonc-parser', 'json5', 'comment-json', 'strip-json-comments'],
    message:
      'Use `Json5.parse` from `effect/encoding`: it reads JSONC, trailing commas included (`Jsonc.parse` rejects those). Effect cannot edit a file and keep its comments; for that, disable this line with the reason.',
  },
  {
    packages: ['yaml', 'js-yaml'],
    message:
      'Use `Yaml.parse` from `effect/encoding`. It reads a single document and does not write YAML; to write, to read a multi-document stream or to keep comments, disable this line with the reason.',
  },
  {
    packages: ['smol-toml', 'toml', '@iarna/toml'],
    message:
      'Use `Toml.parse` from `effect/encoding`. It does not write TOML; for that, disable this line with the reason.',
  },
  {
    packages: ['zod', 'valibot'],
    message:
      'Use `Schema` from `effect`; `Schema.toStandardSchemaV1` makes one for a library that takes a Standard Schema. For a library that only takes this one, disable this line with the reason.',
  },
];

const escaped = (name: string) =>
  name.replaceAll(/[.*+?^${}()|[\]\\/]/gu, '\\$&');

/** One no-restricted-imports entry per ban. */
export const restrictedImports = (
  banned: Array<BannedImport>,
): OxlintRules => ({
  // Effect already does what these packages do. Anchored regexes, because a
  // `group` glob of `toml` would also match `./toml` and `@scope/toml`.
  'no-restricted-imports': [
    'error',
    {
      patterns: banned.map(({ packages, message }) => ({
        regex: `^(?:${packages.map(escaped).join('|')})(?:/|$)`,
        message,
        // A type import runs nothing: it names another library's types.
        allowTypeImports: true,
      })),
    },
  ],
});
