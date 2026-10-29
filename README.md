# shoemaker

[![npm](https://img.shields.io/npm/v/shoemaker)](https://www.npmjs.com/package/shoemaker)

Scaffold a Bun + Effect monorepo with strict tooling already wired up, then keep
it current as that tooling evolves.

```sh
bunx shoemaker init my-app
```

A short wizard asks what you're building. Everything else is decided for you,
configured, and passing on the first commit. The defaults are opinionated:
they're the setup I use for my own repos.

## What you get

- **Apps**: TanStack Start, Foldkit, Expo, Effect API and Effect CLI, plus
  library packages. The Effect API's contract is its own package, so any app
  can call it. A TanStack Start app can serve the API at `/api` and deploy it.
- **Tooling**: Effect 4, strict TypeScript, oxlint with every rule at error,
  oxfmt, knip and jscpd
- **Task runner**: turbo or nx
- **Secrets**: varlock or secretspec
- **Infra**: alchemy, deploying to Cloudflare or AWS, plus GitHub for repos
  and Actions secrets
- **Environment**: a Nix dev shell, GitHub Actions CI, and an AGENTS.md for
  coding agents

## Stay up to date

Your choices live in `shoemaker.config.ts`. When shoemaker's defaults change,
bump it and sync:

```sh
bunx shoemaker sync --dry-run   # preview the diff
bunx shoemaker sync
```

Sync never clobbers your work. Files you edited by hand are reported as
conflicts (`--force <glob>` takes the generated version), and it refuses to run
on a dirty git tree, so git is always your undo.

## Commands

| Command | What it does |
|---|---|
| `init [dir]` | Scaffold a new repo. Every wizard question is also a flag; `--yes` takes the defaults. |
| `sync` | Re-render the repo from `shoemaker.config.ts`. |
| `add app expo mobile` | Add an app or package, then sync. |
| `adopt <dir>` | Bring an existing repo under shoemaker. |
| `doctor <dir>` | Audit any repo against the current defaults. |
| `check <name>` | Run a repo checker (`catalog`, `effect-versions`, ...). |

## Just the configs

Don't want the scaffold? The configs are published on their own:

| Package | Usage |
|---|---|
| `shoemaker-oxlint-config` | `oxlint.config.ts`: `export default defineShoemakerConfig({ scope, react })` |
| `shoemaker-oxfmt-config` | `oxfmt.config.ts`: `export default defineShoemakerFormat()` |
| `shoemaker-typescript-config` | `"extends": "shoemaker-typescript-config/tsconfig.base.json"` |
| `shoemaker-knip-config` | `knip.ts`: `export default defineKnipConfig({ ... })` |

## Contributing

```sh
direnv allow                  # nix dev shell (bun, node)
bun install
bun run test                  # includes generating and building sample repos
bunx turbo run lint:check '//#lint:check:root'
```

To release, add a changeset (`bun run changeset`) and merge the "version
packages" PR it opens.
