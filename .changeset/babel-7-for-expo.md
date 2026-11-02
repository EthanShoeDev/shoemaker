---
'shoemaker': patch
---

TanStack Start apps get `@babel/core` `^7.29.0` again, not `^8`. With bun's
hoisted linker the web app's Babel lands at the root, Metro loads it, and
Expo's Babel 7 presets refuse it, so an Expo app beside a web app could not
bundle (`Requires Babel "^7.0.0-0", but was loaded with "8.0.10"`).
`@rolldown/plugin-babel` and the React Compiler work with either. The weekly
version update holds `@babel/core` there, and the e2e test now bundles every
Expo app with `expo export`.

Existing repos (for a coding agent). `sync` keeps a dependency version a repo
raised, so it leaves `^8` in place:

1. In the root `package.json` `workspaces.catalog`, set `@babel/core` to
   `^7.29.0`.
2. Run `bun install` and confirm `node_modules/@babel/core/package.json` is
   7.x.
3. If the repo has an Expo app, run
   `bunx expo export --platform android --output-dir /tmp/expo-bundle` in it;
   it must bundle without a Babel version error.
