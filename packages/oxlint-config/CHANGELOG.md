# shoemaker-oxlint-config

## 0.2.11

### Patch Changes

- Updated dependencies []:
  - shoemaker-oxlint-plugins@0.2.11

## 0.2.10

### Patch Changes

- [`2485944`](https://github.com/EthanShoeDev/shoemaker/commit/24859442a6d3a873cb78fd860f75d5bacd08128f) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - `no-restricted-imports` now bans packages Effect replaces, and the error says
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
- Updated dependencies []:
  - shoemaker-oxlint-plugins@0.2.10

## 0.2.9

### Patch Changes

- Updated dependencies []:
  - shoemaker-oxlint-plugins@0.2.9

## 0.2.8

### Patch Changes

- Updated dependencies []:
  - shoemaker-oxlint-plugins@0.2.8

## 0.2.7

### Patch Changes

- Updated dependencies []:
  - shoemaker-oxlint-plugins@0.2.7

## 0.2.6

### Patch Changes

- Updated dependencies []:
  - shoemaker-oxlint-plugins@0.2.6

## 0.2.5

### Patch Changes

- Updated dependencies []:
  - shoemaker-oxlint-plugins@0.2.5

## 0.2.4

### Patch Changes

- Updated dependencies []:
  - shoemaker-oxlint-plugins@0.2.4

## 0.2.3

### Patch Changes

- Updated dependencies []:
  - shoemaker-oxlint-plugins@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies []:
  - shoemaker-oxlint-plugins@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - shoemaker-oxlint-plugins@0.2.1

## 0.2.0

### Patch Changes

- [`8799d00`](https://github.com/EthanShoeDev/shoemaker/commit/8799d00e71dd531643f87ef153189dfab614a2da) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - Ignore `.external/` (reference repos cloned for agents to read) instead of
  `docs/cloned-repos-as-docs/`: generated repos gitignore it, and the shared
  oxlint, oxfmt and knip configs, jscpd and VS Code skip it.
- Updated dependencies []:
  - shoemaker-oxlint-plugins@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - shoemaker-oxlint-plugins@0.1.1
