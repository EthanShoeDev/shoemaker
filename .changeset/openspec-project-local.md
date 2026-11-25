---
'shoemaker': patch
---

`features.openspec` sets up [OpenSpec](https://github.com/Fission-AI/OpenSpec):
`openspec/`, the pinned CLI (a root devDependency, and `openspec` in the dev
shell), and its agent skills in `.agents/skills` and `.claude/skills`. Sync
writes the skills, so none go in the home directory, where agents in projects
that don't use OpenSpec would load them. New repos get it unless `openspec` is
left out of `--extras`; a config without the key leaves it off. `doctor` checks
repos that have an `openspec/config.yaml`.

AGENTS.md's tooling region says skills, commands, plugins and MCP servers are
project-local.

To turn it on in an existing repo:

1. Set `openspec: true` under `features` in `shoemaker.config.ts`, and commit.
2. Run `bun run shoemaker:sync`. If the repo already had OpenSpec skills, they
   are reported as untracked: compare them with `--dry-run`, then run
   `bun run shoemaker:sync --force '.agents/skills/openspec*/**' --force '.claude/skills/openspec*/**'`.
   Symlinks `openspec init` made in `.claude/skills` can stay: sync reads
   through them.
3. If `openspec/config.yaml` already existed, make sure it says
   `skillsScope: project`.
4. If `flake.nix` installs OpenSpec another way (a flake input or package),
   remove that and run `nix flake lock`. The dev shell's `openspec` now runs
   the one in `node_modules`.
5. Remove ignore entries for `openspec/**` that repeat the generated ones, then
   `bun install` and run `lint:check`.
6. If `~/.agents/skills` or `~/.claude/skills` has `openspec*` folders, remove
   them once every repo using OpenSpec has its own skills.
