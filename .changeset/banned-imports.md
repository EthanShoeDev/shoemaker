---
'shoemaker-oxlint-config': patch
---

`no-restricted-imports` now bans packages Effect replaces, and the error says
what to use: `jsonc-parser`, `json5`, `comment-json` and `strip-json-comments`
(`Json5`), `yaml` and `js-yaml` (`Yaml`), `smol-toml`, `toml` and `@iarna/toml`
(`Toml`), `zod` and `valibot` (`Schema`). Type imports and vendored code are
exempt. Add more with the `bannedImports` option.

In an existing repo, for each new error:

1. Follow the error's help to replace the import.
2. Keep the package only for what Effect lacks, such as writing YAML or TOML,
   editing a file without losing comments, or a library that needs Zod. Put
   `// oxlint-disable-next-line no-restricted-imports -- <reason>` above it.
3. Once nothing imports the package, remove it from `package.json` and the
   catalog.
4. If `oxlint.config.ts` sets `no-restricted-imports`, in `rules` or in an
   override, that block's options replace the shared bans for its files. Move
   each `rules` entry to `bannedImports` (`{ packages, importNames?, message }`;
   a `group` glob becomes its package names). In an override, set the rule to
   `restrictedImports([...effectReplacements, ...yours])`; both are exported
   from `shoemaker-oxlint-config`.
