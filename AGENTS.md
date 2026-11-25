# shoemaker

Shared tooling (`shoemaker-*` config packages) plus the `shoemaker` CLI that
scaffolds new repos and keeps existing ones on Ethan's current preferences.

README.md is the only prose doc outside `openspec/`; keep it current when
behavior changes. The preferences live in code, so a preference change usually
touches two places: the shared package (or generator) that encodes it, and the
doctor check that detects drift from it.

Repos made by an older shoemaker only pick up what `sync` rewrites; it never
touches seed files. When a change can't reach them that way, its changeset
carries numbered steps a coding agent can follow in the existing repo,
instead of a codemod.

## Rules

- Bun only: never npm, npx, pnpm or yarn. `bunx` for binaries.
- Tests: `bun run test` (vitest + `@effect/vitest`). Never `bun test`.
- Verify before a PR, not after every edit:
  `bunx turbo run lint:check --filter=<pkg>` and `bunx turbo run test`.
  `lint` mutates; `lint:check` does not.
- Effect v4 everywhere, at the one exact version `versions.ts` and the root
  catalog pin. `effect/cli` for CLIs, `Effect.fn` for effectful functions,
  tagged errors, `Clock` instead of `Date.now`, `Effect.log` instead of
  `console`.
- Inferred return types. Comments only for a non-obvious *why*.
- Zero warnings: every oxlint rule is `error` or `off`, and every rule change
  carries a one-line reason above it. Every disable directive needs a
  `-- reason`.
- Generated output must be deterministic. Versions come from
  `packages/cli/src/versions.ts` only; never emit `latest`.
  `bun run update:generated-versions` moves them to npm's latest (a weekly
  workflow opens that PR).
- Changesets are `patch` unless Ethan asks for `minor` or `major`.
- Don't `git stash`, reset or commit without being asked.
- Never run `infra:plan`/`deploy`/`destroy` in a generated sample: alchemy
  creates its state bucket even on a plan, and this machine has real cloud
  credentials. Prove infra templates with typecheck and tests only.

## OpenSpec

- Specs live in `openspec/specs`, proposed changes in `openspec/changes`. Use
  the `openspec-*` skills to propose, apply and archive a change. Without the
  dev shell, run the CLI as `bun run openspec`.
- Never run `openspec init` or `openspec update` here. Bump the pin in
  `versions.ts` and the root catalog, then `bun run update:openspec-skills`
  rewrites `skills.gen.ts` and this repo's skills.
- Agent tooling is project-local, here and in generated repos: skills,
  commands and MCP servers go in the repo, never in `~/.claude`, `~/.agents`,
  `~/.codex` or a user/global scope, where they load in every other project. A
  CLI may be global.

## Proving generator changes

`packages/cli/test/e2e.test.ts` (part of `bun run test`) packs the local
packages, generates each preset in `packages/cli/test/presets.ts` through
`shoemaker sync`, installs it, runs every check the sample defines and expects
`sync --check` to report no drift. The samples stay in `.e2e/<preset>`.
`bun run wizard:local` runs the interactive `init` against the same tarballs.

## Reference repos

`.external/` (gitignored) holds Ethan's repos (`repos-I-built/`) and upstream
references (`references/`: effect, foldkit, varlock, secretspec, tsgo,
create-better-t-stack, Better-Fullstack). Read them; never modify them.
