# @shoe-box-tools/oxfmt-config

Shared [oxfmt](https://oxc.rs/docs/guide/usage/formatter) options. oxfmt has no `extends`, so the config is a function you call from `oxfmt.config.ts`:

```ts
// oxfmt.config.ts
import { defineShoeboxFormat } from '@shoe-box-tools/oxfmt-config';

export default defineShoeboxFormat({
  // Tailwind v4 entry stylesheet; turns on class sorting.
  tailwindStylesheet: 'apps/web/src/styles.css',
  ignorePatterns: ['legacy/**'],
});
```

Or spread the plain options object: `export default { ...shoeboxFormat, printWidth: 100 }`.

## Values

- `printWidth: 80`, `tabWidth: 2`, spaces, `singleQuote` and `jsxSingleQuote`, `trailingComma: 'all'`, `bracketSpacing`, `bracketSameLine: false`.
- `sortImports: true`. oxlint's `sort-imports` is off because the formatter owns import order; oxfmt leaves imports unsorted unless this is on.
- With `tailwindStylesheet`: `sortTailwindcss` with that stylesheet and the `cn`, `clsx` and `cva` functions.
- `ignorePatterns` (`sharedIgnorePatterns`): `**/*.md` (oxfmt's Markdown printer is not a fixed point, so a second run reformats its own output), generated and vendored code, build output, cloned docs and agent directories.
