# shoemaker-oxfmt-config

## 0.2.5

### Patch Changes

- [`c1baaaf`](https://github.com/EthanShoeDev/shoemaker/commit/c1baaaf7a7753bd0dc4bfa5163176fb3fcdab883) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - The formatter and jscpd skip drizzle-kit's migration snapshots
  (`**/migrations/*/snapshot.json`). They are generated, and each repeats most of
  the one before, so a repo's second migration failed `jscpd:check`.

## 0.2.4

No changes in this release.

## 0.2.3

No changes in this release.

## 0.2.2

No changes in this release.

## 0.2.1

No changes in this release.

## 0.2.0

### Patch Changes

- [`8799d00`](https://github.com/EthanShoeDev/shoemaker/commit/8799d00e71dd531643f87ef153189dfab614a2da) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - Ignore `.external/` (reference repos cloned for agents to read) instead of
  `docs/cloned-repos-as-docs/`: generated repos gitignore it, and the shared
  oxlint, oxfmt and knip configs, jscpd and VS Code skip it.

## 0.1.1

No changes in this release.
