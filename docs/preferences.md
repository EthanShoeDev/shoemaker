# Ethan's repo preferences

These preferences were distilled on 2026-10-28 from 11 repos. They are ranked by how
recently and how heavily each repo was worked on. **listening-astro** is the canonical
reference (718 commits in the last 30 days). **elden-ring-compass** (2026-10-06) holds
the strictest lint settings. **portfolio** is the cleanest small layout.

The reference clones live in `.external/repos-I-built/<repo>`, which is gitignored and
local only.

## Set in stone (always generated, never asked)

| Area | Preference | Canonical source |
|---|---|---|
| Runtime / package manager | bun (`packageManager: bun@1.4.4`), ESM, `"type": "module"` | listening-astro/package.json |
| Language | Effect-TS v4 everywhere; TS 7 native `tsc --noEmit` | |
| Monorepo | Always a monorepo, even with one app. `apps/*` are leaves, `packages/*` are libraries, `packages/config/*` holds tooling. Scope is `@<project>/*`, never `@repo/*`. The root depends on no internal package except config/tooling. | listening-astro, portfolio |
| Catalog | Every dependency is `catalog:`, from the bun catalog in `workspaces.catalog`. Enforced by `catalog:check`. Per-package opt-out via `catalogSkip`. | listening-astro/scripts/lint/catalog-check.ts |
| Internal packages | Export TS source through an explicit `exports` subpath map plus `"./package.json"`. No build step unless published. | |
| Lint | oxlint with a **TS config** (`oxlint.config.ts`). All 6 categories at `error`; every third-party plugin rule at `error` (`everyRuleOf`); each rejected rule turned `off` **with a one-line reason above it**. `options: { typeAware, typeCheck, reportUnusedDisableDirectives: 'error' }`. **Zero warnings.** Built on [oxlint-flat-config](https://github.com/liangmiQwQ/oxlint-flat-config): the shared preset is named flat config blocks (`shoebox/base`, `shoebox/tests`, …), so a repo adjusts one block with the composer instead of copying the preset. | listening-astro/oxlint.config.ts, elden-ring-compass/oxlint.config.ts |
| Effect lint | `@effect/tsgo` oxlint presets. Every rule from every preset is set to `error`. Wired with `"prepare": "effect-tsgo patch --oxlint"`. The language service plugin has `diagnostics: false`. This includes `prefer-effect-array`/`-record`/`-string` (on since 2026-10-28, by choice): use `import { Array as Arr, Record as Rec, String as Str } from 'effect'`. The four published lint packages carry no effect dependency and turn those three off. | elden-ring-compass (all presets) |
| Custom rules | `disable-comments/require-description`, `dynamic-import/no-unexplained-dynamic-import`, `import-boundaries/no-cross-package-relative-imports`, `env-access/no-raw-env-access`, `route-active/no-render-time-match-route` (TanStack), `backdrop-filter/no-backdrop-filter` (web). Vendored anti-slop (dmmulroy/anti-slop @ c44ef22). | nixos-config / elden-ring-compass oxlint-plugins |
| Format | oxfmt: printWidth 80, 2 spaces, single quotes (JSX too), trailing commas, `sortImports: true`, Tailwind class sorting, `**/*.md` ignored. Fixes the latent bug where `sort-imports` is off "because oxfmt sorts" but sorting was never enabled. | nixos-config/oxfmt.config.ts |
| Config format | TS config when the tool accepts it (oxlint, oxfmt, knip, vitest, tsdown, alchemy, shoebox). Otherwise jsonc (turbo, tsconfig). Plain JSON only when the tool can't read jsonc (`.jscpd.json`, package.json). | |
| Duplication | jscpd: threshold 0, minTokens 50, minLines 33 | `.jscpd.json` everywhere |
| Dead code | knip (`knip.ts`), `--no-config-hints --cache` | |
| Script names | `<tool>:check` / `<tool>:fix` (`oxlint:check`, `oxfmt:fix`, `knip:fix:danger`, `catalog:check`, `nix:fmt:check`, ...). Turbo aggregates `lint` (fixers) and `lint:check` with no package script. | listening-astro/turbo.jsonc |
| Dev env | Nix flake dev shell (`nixpkgs-unstable`, `alejandra` formatter, bun pinned to match `packageManager`) plus direnv `.envrc` = `use flake` | listening-astro/flake.nix |
| Tests | vitest with root `projects` and `@effect/vitest` (`it.effect`). Always `bun run test`, never `bun test`. | |
| Agents | `AGENTS.md` is canonical and `CLAUDE.md` is `@AGENTS.md`. `.claude/settings.json` is tracked. Skills live in `.agents/skills`, symlinked into `.claude/skills`. | listening-astro |
| Editor | `.vscode` with oxc as the default formatter, fixAll on save, `oxc.typeAware`, tsgo | listening-astro/.vscode |
| Git hooks | None. CI and agent instructions are the gates. | |

## Wizard options

| Question | Choices | Default |
|---|---|---|
| Apps | tanstack-start, foldkit, expo, effect-api, effect-cli (multi) | none |
| Libraries | library packages under `packages/` | none |
| Task runner | turbo, nx | turbo |
| Secrets | varlock, secretspec, none | varlock |
| Infra | alchemy (cloudflare and/or aws), none | none |
| CI | GitHub Actions, none | github |
| Extras | changesets, agents files, vscode | agents + vscode |

## Known drift in existing repos

These are the things `shoebox doctor` reports:

- `.oxlintrc.json`: dwarkesh-context-window, effect-speech, wisely. Should be `oxlint.config.ts`.
- `warn` severity: `wisely/.oxlintrc.json` (`unknown-cast/require-comment`).
- Type-aware flags passed on the CLI instead of `options`: every repo except listening-astro.
- `sortImports` not enabled in oxfmt: every repo except nixos-config.
- `.oxfmtrc.json(c)` instead of `oxfmt.config.ts`: every repo except nixos-config.
- `lint:<tool>` script names instead of `<tool>:check`: nixos-config, dwarkesh-context-window.
- Retired custom rules still present: `unknown-cast/*`, `prefer-effect/*` (covered upstream now).
- `tsgo --noEmit` / `@typescript/native-preview` instead of TS 7 `tsc`: clanker, fressh, wisely.
- `scripts/catalog-check.ts` copy-pasted into 7 repos with 7 different hashes. Should be `shoebox check catalog`.
- portfolio: no `.envrc`, no `flake.lock`, and the flake description still says "Elden Ring Compass".
- Old bun versions in `packageManager`.
- **Security:** `backend-server/.mcp.json` is committed with a hard-coded bearer token.
