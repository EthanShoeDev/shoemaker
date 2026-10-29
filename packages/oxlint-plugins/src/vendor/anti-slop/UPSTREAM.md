# Vendored anti-slop

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (2026-09-10, package version 0.1.2).

Copied from upstream `src/` → this directory (rules, shared helpers, the `effect/` plugin, the nested `vendor/eslint-stylistic/` copy with its own `LICENSE` and `UPSTREAM.md`, and every `*.test.ts`), plus the root `LICENSE` (MIT). Upstream publishes no npm package and says the plugin is meant to be vendored. This is the same revision (and the same bytes) listening-astro, elden-ring-compass, portfolio and nixos-config vendor; it was taken from portfolio.

## Local deltas

Upstream compiles without `noUncheckedIndexedAccess`; `@shoe-box-tools/typescript-config` enables it, and this package's `tsc` program includes the tree. Re-apply after a refresh:

- `shared/dictionary-types.ts` (TSIntersectionType branch): `? unsafeMembers[0]` → `? (unsafeMembers[0] ?? null)`. Behaviour-neutral: the index is guarded by `unsafeMembers.length > 0`.

## How it is wired

- Entry points: `index.ts` (`anti-slop`) and `effect/index.ts` (`anti-slop-effect`), exported as `@shoe-box-tools/oxlint-plugins/vendor/anti-slop` and `…/vendor/anti-slop/effect`. Only these two are tsdown entries.
- `@oxlint/plugins` is pinned in the root catalog to the same version as `oxlint`; upstream requires the two to match exactly, so bump them together.
- Upstream's `.ts`-suffixed relative imports are kept; the base tsconfig sets `rewriteRelativeImportExtensions` for them.
- The tree is excluded from `oxlint` (`ignorePatterns`), `oxfmt`, `jscpd` and `knip` so a refresh stays a diff against upstream. Do not reformat or lint-fix these files.
- Which rules are on is decided in `@shoe-box-tools/oxlint-config` (every rule at `error`, rejected ones off with a reason), not here.

## Tests

The upstream RuleTester suites run unchanged under this package's vitest config (`bun run test`). `rules/require-readable-spacing-cli.test.ts` is excluded: it shells out to `pnpm exec oxlint`. oxlint's `RuleTester` needs Node; it refuses to run under `bun <file>`.

## Refreshing

Clone upstream at the target revision, copy `src/` over this directory and `LICENSE` beside it, diff against the previous copy, re-apply the local deltas, update the commit above, run `bun run test` and `bun run typecheck` here, then review any new rule in `@shoe-box-tools/oxlint-config` (a new rule lands at `error` through `everyRuleOf`).
