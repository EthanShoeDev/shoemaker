# shoe-box

Shared tooling (`shoe-box-*` config packages) plus the `shoe-box` CLI that
scaffolds new repos and keeps existing ones on Ethan's current preferences.

README.md is the only prose doc; keep it current when behavior changes. The
preferences live in code, so a preference change usually touches three places:
the shared package (or generator) that encodes it, the doctor check that detects
drift from it, and a migration when old repos need a structural change.

## Rules

- Bun only: never npm, npx, pnpm or yarn. `bunx` for binaries.
- Tests: `bun run test` (vitest + `@effect/vitest`). Never `bun test`.
- Verify before a PR, not after every edit:
  `bunx turbo run lint:check --filter=<pkg>` and `bunx turbo run test`.
  `lint` mutates; `lint:check` does not.
- Effect 4.0.6 everywhere. `effect/cli` for CLIs, `Effect.fn` for effectful
  functions, tagged errors, `Clock` instead of `Date.now`, `Effect.log` instead
  of `console`.
- Inferred return types. Comments only for a non-obvious *why*.
- Zero warnings: every oxlint rule is `error` or `off`, and every rule change
  carries a one-line reason above it. Every disable directive needs a
  `-- reason`.
- Generated output must be deterministic. Versions come from
  `packages/cli/src/versions.ts` only; never emit `latest`.
- Don't `git stash`, reset or commit without being asked.
- Never run `infra:plan`/`deploy`/`destroy` in a generated sample: alchemy
  creates its state bucket even on a plan, and this machine has real cloud
  credentials. Prove infra templates with typecheck and tests only.

## Proving generator changes

`bun scripts/e2e/generate-sample.ts <minimal|web|full> <dir>` packs the local
packages, generates a sample repo and installs it. Then run
`bunx turbo run lint:check '//#lint:check:root'`, `typecheck`, `test` and
`build` inside it.

## Reference repos

`.external/` (gitignored) holds Ethan's repos (`repos-I-built/`) and upstream
references (`references/`: effect, foldkit, varlock, secretspec, tsgo,
create-better-t-stack, Better-Fullstack). Read them; never modify them.
