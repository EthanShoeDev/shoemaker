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
4. If `oxlint.config.ts` sets `no-restricted-imports` in `rules`, move its
   entries to `bannedImports`: the rule replaces the shared list.
