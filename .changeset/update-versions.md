---
'shoemaker': patch
---

Generated repos get newer dependency versions:

- `effect`: 4.1.4 → 4.1.5
- `@effect/tsgo`: 0.70.0 → 0.73.4
- `oxlint-tsgolint`: 7.0.2007 → 7.0.2008
- `oxfmt`: 0.79.0 → 0.80.0
- `knip`: ^6.45.1 → ^6.48.0
- `@tanstack/eslint-plugin-query`: ^5.108.0 → ^5.108.4
- `eslint-plugin-testing-library`: ^7.16.2 → ^7.16.3
- `bun-types`: ^1.4.4 → ^1.4.5
- `@tanstack/react-start`: ^1.169.5 → ^1.169.7
- `@tanstack/react-query`: ^5.108.0 → ^5.108.4

Bun moves from 1.4.4 to 1.4.5: `packageManager`, `devEngines`, the flake's
bun overlay and the CI setup action all follow, and doctor's `bun-version`
check expects 1.4.5.

Existing repos: `bun run shoemaker:sync`, then re-enter `nix develop` so the
shell picks up bun 1.4.5, then `bun install`. A version the repo already
raised past these stays as it is. A Dockerfile on `oven/bun:1.4.4` needs its
tag moved by hand; doctor reports it.

`@effect/tsgo` 0.73 widens `effecttsgo/missed-pipeable-opportunity` (already
at `error`) to nested single-argument calls such as
`Schema.optional(Schema.Array(Schema.String))` and
`Effect.forkScoped(Effect.forever(Effect.gen(…)))`. In an existing repo, after
`shoemaker sync` and `bun install`:

1. Run the repo's `lint:check` and list the `missed-pipeable-opportunity`
   errors.
2. Rewrite each flagged `outer(inner(x))` as `x.pipe(inner, outer)`, innermost
   first, e.g. `Schema.String.pipe(Schema.Array, Schema.optional)` or
   `Effect.gen(…).pipe(Effect.forever, Effect.forkScoped)`. A call with more
   than one argument becomes its curried form:
   `Option.getOrUndefined(Option.map(o, f))` →
   `o.pipe(Option.map(f), Option.getOrUndefined)`.
3. Rerun `lint:check` and the tests.
