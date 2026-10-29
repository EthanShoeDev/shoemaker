import type { KnipConfiguration } from 'knip';

/** Binaries the nix dev shell or CI puts on PATH; none is an npm package. */
export const sharedIgnoreBinaries = [
  'nix',
  'gh',
  'secretspec',
  'varlock',
  'alejandra',
  'direnv',
  'nlx',
  'nr',
  'uv',
];

/** Files knip should not analyse in any repo. */
export const sharedIgnore = [
  // Vendored upstream code; its unused exports are upstream's.
  '**/vendor/**',
  '**/*.vendored.*',
  // Generated code is regenerated wholesale.
  '**/*.gen.*',
  '**/generated/**',
  // Dependency docs cloned for agents to read.
  'docs/cloned-repos-as-docs/**',
  // Agent skill bundles are not project code.
  '.agents/**',
  '.claude/**',
];

const asArray = (value: string | Array<string> | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/**
 * knip.ts with the shared ignores merged in front of the repo's own. The repo's
 * scalar options win; its list options are appended.
 */
export const defineKnipConfig = (
  config: KnipConfiguration = {},
): KnipConfiguration => ({
  // Exported types and values also used in their own file (Effect service
  // interfaces, schema-derived types) are part of the module's surface.
  ignoreExportsUsedInFile: true,
  ...config,
  ignore: [...sharedIgnore, ...asArray(config.ignore)],
  ignoreBinaries: [...sharedIgnoreBinaries, ...(config.ignoreBinaries ?? [])],
});
