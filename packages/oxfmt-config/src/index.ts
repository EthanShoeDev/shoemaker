import type { OxfmtConfig } from 'oxfmt';

/** Ignored by every repo's formatter. */
export const sharedIgnorePatterns = [
  // oxfmt's Markdown printer (prettier's) is not a fixed point on nested lists
  // and fenced blocks: a second run reformats its own output. Markdown is
  // left as written.
  '**/*.md',
  // Generated code is regenerated wholesale; formatting it is churn.
  '**/*.gen.*',
  '**/generated/**',
  // Vendored upstream code stays a clean diff against upstream.
  '**/vendor/**',
  '**/*.vendored.*',
  // Lockfiles and tool output.
  'bun.lock',
  'shoebox.lock.jsonc',
  '**/dist/**',
  '**/.turbo/**',
  '**/.output/**',
  '**/.nitro/**',
  '**/.alchemy/**',
  // Dependency docs cloned for agents to read.
  'docs/cloned-repos-as-docs/**',
  // Agent skill bundles are not project code.
  '.agents/**',
  '.claude/**',
  '.cursor/**',
  '.opencode/**',
  '.github/skills/**',
];

/** Class-merging helpers whose string arguments are Tailwind class lists. */
export const tailwindFunctions = ['cn', 'clsx', 'cva'];

/** The shared formatter options. oxfmt has no `extends`, so spread this. */
export const shoeboxFormat = {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  singleQuote: true,
  jsxSingleQuote: true,
  trailingComma: 'all',
  bracketSpacing: true,
  bracketSameLine: false,
  // oxlint's `sort-imports` is off so the formatter owns import order; this
  // is what turns that on (oxfmt leaves imports unsorted by default).
  sortImports: true,
  ignorePatterns: sharedIgnorePatterns,
} satisfies OxfmtConfig;

export type ShoeboxFormatOptions = {
  /**
   * Tailwind v4 entry stylesheet, relative to oxfmt.config.ts. Setting it
   * turns on class sorting for `class`/`className` and `cn`/`clsx`/`cva`.
   */
  tailwindStylesheet?: string;
  /** Appended to the shared ignore patterns. */
  ignorePatterns?: Array<string>;
};

/** The oxfmt.config.ts default export. */
export const defineShoeboxFormat = ({
  tailwindStylesheet,
  ignorePatterns = [],
}: ShoeboxFormatOptions = {}): OxfmtConfig => ({
  ...shoeboxFormat,
  ignorePatterns: [...sharedIgnorePatterns, ...ignorePatterns],
  ...(tailwindStylesheet === undefined
    ? {}
    : {
        sortTailwindcss: {
          stylesheet: tailwindStylesheet,
          functions: tailwindFunctions,
        },
      }),
});
