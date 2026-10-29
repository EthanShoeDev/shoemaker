# shoemaker

My repo tooling in one place: shared config packages, plus `shoemaker`, a CLI
that scaffolds new monorepos with my current preferences and keeps existing
repos up to date as those preferences change.

## Packages

| Package | Use it as |
|---|---|
| `shoemaker-oxlint-config` | `oxlint.config.ts`: `export default defineShoemakerConfig({ scope, react, ... })` |
| `shoemaker-oxlint-plugins` | Custom rules + vendored anti-slop (loaded by oxlint-config) |
| `shoemaker-oxfmt-config` | `oxfmt.config.ts`: `export default defineShoemakerFormat({ ... })` |
| `shoemaker-typescript-config` | `"extends": "shoemaker-typescript-config/tsconfig.base.json"` |
| `shoemaker-knip-config` | `knip.ts`: `export default defineKnipConfig({ ... })` |
| `shoemaker` | `shoemaker` binary + `defineConfig` for `shoemaker.config.ts` |

Lint rules, format options and tsconfig strictness live in these packages, so
changing a preference means publishing a new version and bumping it in each
repo.

## shoemaker

```sh
shoemaker init my-app            # wizard; every question is also a flag
shoemaker init my-app --yes --apps tanstack-start,effect-api --secrets varlock

shoemaker sync --dry-run         # re-render from shoemaker.config.ts, show the diff
shoemaker sync                   # apply safe changes; hand edits become conflicts
shoemaker add app expo mobile    # add to shoemaker.config.ts, then sync

shoemaker doctor ../some-repo    # audit any repo against current preferences
shoemaker adopt ../some-repo     # infer shoemaker.config.ts for an existing repo
shoemaker check catalog --fix    # repo checkers used by package scripts
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

With varlock, env is read through its `ENV` (`import { ENV } from
'varlock/env'`) on client and server, and the `no-raw-env-access` lint rule
rejects raw `process.env` / `import.meta.env`. With secretspec or no secrets
manager that rule is off. shoemaker declares the variables in the manager's
schema but generates no env package, since how apps split server, client and
secret config is project-specific.

What it never asks, because every repo gets it: bun, Effect 4, oxlint with
every rule at error, oxfmt, jscpd, knip, a Nix flake dev shell with direnv,
the bun catalog, and AGENTS.md.

Under turbo, the leaf commands every package runs (`typecheck`, `test`,
`oxlint:check`, `oxlint:fix`, `clean`) are defined once as task `command`s in
`turbo.jsonc` (turbo's experimental `experimentalTaskCommand` flag), not copied
into each `package.json`. A package script of the same name overrides one.

### How sync stays safe

`shoemaker.lock.jsonc` stores a hash of every file shoemaker wrote. Each file is
handled one of four ways:

- **owned**: re-rendered on every sync, unless it was edited by hand (then it is
  reported as a conflict).
- **managed**: only the `shoemaker:begin/end` regions are rewritten.
- **json-merge**: only the keys shoemaker owns are updated.
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
bun run changeset              # describe the change (all shoemaker-* move together)
bun run release:dry-run        # build + show each tarball's contents, no npm auth needed
```

On `main`, `.github/workflows/release.yml` opens a "version packages" PR from
pending changesets. Merging it publishes every package whose version is not on
npm yet (`scripts/release.ts`: `bun pm pack`, which understands `catalog:`, then
`npm publish` of that tarball). CI holds no npm token: it authenticates with
npm trusted publishing (OIDC), so each package must name this repo's
`release.yml` as its trusted publisher.

Trusted publishing can only publish to a package that already exists, so CI
skips a name npm has never seen. A new package goes out once by hand:

```sh
bun run npm login             # browser login; publishes also ask for 2FA
bun run release               # publishes everything not on npm yet
bun run npm trust github <name> --repo EthanShoeDev/shoemaker --file release.yml --allow-publish
```

A trusted publisher that has not published within 2 days expires, so merge the
next "version packages" PR soon after adding one. Then, on npmjs.com, set the
package's Settings → Publishing access to "Require two-factor authentication
and disallow tokens". Until the packages exist, `scripts/e2e/pack-local.ts`
installs generated repos from local tarballs.
