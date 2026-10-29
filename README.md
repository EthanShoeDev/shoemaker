# shoe-box

My repo tooling in one place: shared config packages, plus `shoe-box`, a CLI
that scaffolds new monorepos with my current preferences and keeps existing
repos up to date as those preferences change.

## Packages

| Package | Use it as |
|---|---|
| `shoe-box-oxlint-config` | `oxlint.config.ts`: `export default defineShoeboxConfig({ scope, react, ... })` |
| `shoe-box-oxlint-plugins` | Custom rules + vendored anti-slop (loaded by oxlint-config) |
| `shoe-box-oxfmt-config` | `oxfmt.config.ts`: `export default defineShoeboxFormat({ ... })` |
| `shoe-box-typescript-config` | `"extends": "shoe-box-typescript-config/tsconfig.base.json"` |
| `shoe-box-knip-config` | `knip.ts`: `export default defineKnipConfig({ ... })` |
| `shoe-box` | `shoe-box` binary + `defineConfig` for `shoebox.config.ts` |

Lint rules, format options and tsconfig strictness live in these packages, so
changing a preference means publishing a new version and bumping it in each
repo.

## shoe-box

```sh
shoe-box init my-app            # wizard; every question is also a flag
shoe-box init my-app --yes --apps tanstack-start,effect-api --secrets varlock

shoe-box sync --dry-run         # re-render from shoebox.config.ts, show the diff
shoe-box sync                   # apply safe changes; hand edits become conflicts
shoe-box add app expo mobile    # add to shoebox.config.ts, then sync

shoe-box doctor ../some-repo    # audit any repo against current preferences
shoe-box adopt ../some-repo     # infer shoebox.config.ts for an existing repo
shoe-box check catalog --fix    # repo checkers used by package scripts
```

What the wizard asks: apps (tanstack-start, foldkit, expo, effect-api,
effect-cli), libraries, task runner (turbo/nx), secrets (varlock/secretspec),
infra (alchemy: where apps deploy and where state lives), CI, and extras
(changesets, agents files, vscode).

With alchemy, the repo gets one Stack in a root `alchemy.run.ts` (alchemy's
single-stack monorepo layout): it deploys the scaffolded apps to Cloudflare or
AWS (or nothing, for resources added by hand), with paths anchored to the file
so `alchemy dev` and `alchemy deploy` work from anywhere. `bun run infra:dev`
runs every deployed app locally (Workers in workerd, sites on their own dev
servers; AWS needs Docker). State defaults to the gitignored `.alchemy/`;
the Cloudflare and AWS stores are created on first use, even by a plan.
Credentials come from alchemy profiles (`alchemy profile edit`,
`ALCHEMY_PROFILE`), not env vars. The file is typechecked and linted with the
other root files.

Env is read through Effect `Config` (never `process.env`); shoebox declares the
variables in the secrets manager's schema but generates no env package, since
how apps split server, client and secret config is project-specific.

What it never asks, because every repo gets it: bun, Effect 4, oxlint with
every rule at error, oxfmt, jscpd, knip, a Nix flake dev shell with direnv,
the bun catalog, and AGENTS.md.

Under turbo, the leaf commands every package runs (`typecheck`, `test`,
`oxlint:check`, `oxlint:fix`, `clean`) are defined once as task `command`s in
`turbo.jsonc` (turbo's experimental `experimentalTaskCommand` flag), not copied
into each `package.json`. A package script of the same name overrides one.

### How sync stays safe

`shoebox.lock.jsonc` stores a hash of every file shoebox wrote. Each file is
handled one of four ways:

- **owned**: re-rendered on every sync, unless it was edited by hand (then it is
  reported as a conflict).
- **managed**: only the `shoebox:begin/end` regions are rewritten.
- **json-merge**: only the keys shoebox owns are updated.
- **seed**: written once and never touched again.

`--force <glob>` takes the generated version of a conflicting file. Sync refuses
to run on a dirty git tree, so git is the undo.

## Develop

```sh
direnv allow                   # nix dev shell (bun 1.4.4, node 24)
bun install
bun run test
bunx turbo run lint:check '//#lint:check:root'
bun scripts/e2e/generate-sample.ts web /tmp/sample-web   # prove generated repos build
bun run wizard:local           # run the init wizard into tmp/wizard against local packages
```

## Release

```sh
bun run changeset              # describe the change (all shoe-box-* move together)
bun run release:dry-run        # build + show each tarball's contents, no npm auth needed
```

On `main`, `.github/workflows/release.yml` opens a "version packages" PR from
pending changesets. Merging it publishes every package whose version is not on
npm yet (`scripts/release.ts`, via `bun publish`, which understands `catalog:`).
It needs an `NPM_TOKEN` repo secret. Nothing is on npm yet; to publish the
current 0.1.0 by hand, log in to npm and run `bun run release`. Until then,
`scripts/e2e/pack-local.ts` installs generated repos from local tarballs.
