---
'shoemaker': patch
---

Expo apps style with [Uniwind](https://uniwind.dev): Tailwind `className`s on
React Native components, compiled by Metro. `metro.config.ts` (owned) wraps
the config in `withUniwindConfig`. The app gains `uniwind` and `tailwindcss`,
a seeded `global.css` that the layout imports, and a seeded
`uniwind-types.d.ts`. The seed holds the exact bytes Uniwind writes, so
`className` typechecks before Metro has run, and lint and format skip the
file. The app's tsconfig adds `expo/types`, which declares CSS imports. Expo
otherwise reaches that only through the gitignored `expo-env.d.ts`. The
starter screen uses classes instead of `StyleSheet`.

A repo with more than one UI app (TanStack Start, Foldkit or Expo) gets
`packages/theme`, a CSS-only package:

- `tokens.css` (seed) declares each color in `@theme` and sets it under
  `@variant light` and `@variant dark`, with shadcn/ui's names and neutral
  values, plus the radii.
- `web.css` (owned) imports the tokens and defines the `light` and `dark`
  variants the way Uniwind does on native.
- Web apps import `@<scope>/theme/web.css` and Expo apps import
  `@<scope>/theme/tokens.css`, so `bg-background` is one color everywhere. A
  `.light` or `.dark` class picks the theme; otherwise the system setting
  does.
- The package opts out of `typecheck`, `test` and `oxlint`. A package task
  can now set `command: null`, rendered as `"command": null` in its
  `turbo.jsonc`; under nx the package gets no script or target.
- `theme` is a reserved name in such a repo.

Two new doctor checks:

- `theme-tokens` flags a stylesheet whose theme variants do not all set the
  same variables, which Uniwind reports at bundle time. In
  `packages/theme/tokens.css` it also flags a themed color missing from
  `@theme` (so it has no web utility) and directives Uniwind cannot parse
  (`@plugin`, `@source`, `@custom-variant`, `@config`, `source()`).
- `theme-imports` flags a Tailwind or Uniwind app that does not depend on and
  import the theme package.

Existing repos (for a coding agent). `sync` writes the new files, but never
edits the seeds that already exist:

1. In each Expo app's `app/_layout.tsx`, add `import '../global.css';` as the
   first import. If the app already styled with Uniwind or NativeWind from
   another stylesheet, merge that stylesheet into `global.css` and delete it.
2. With more than one UI app, add `@import '@<scope>/theme/web.css';` after
   `@import 'tailwindcss';` in each web app's `src/styles.css`. Move any
   colors the apps already share into `packages/theme/tokens.css` under the
   same names in both variants, and delete them from the apps.
3. Run `shoemaker doctor` and fix any `theme-tokens` or `theme-imports`
   findings.
