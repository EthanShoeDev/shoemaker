---
'shoemaker': patch
---

Generated repos get newer dependency versions:

- `effect`: 4.1.1 → 4.1.2
- `@effect/tsgo`: 0.63.0 → 0.64.1
- `@tanstack/eslint-plugin-query`: ^5.105.1 → ^5.105.3
- `eslint-plugin-playwright`: ^2.12.1 → ^2.12.2
- `vitest`: ^5.0.5 → ^5.1.0
- `@vitejs/plugin-react`: ^6.1.2 → ^6.2.1
- `@tanstack/react-query`: ^5.105.1 → ^5.105.3

`@effect/tsgo` 0.64 adds `yield-in-call-argument` and stops reporting
`strict-effect-provide` at an entry point, so the library seed test now yields
into a const and the Effect CLI seed `bin.ts` drops its disable directive.

Existing repos (for a coding agent). Those seeds are not rewritten by `sync`:

1. Run `bun run shoemaker:sync`, then `bun install`. A version the repo
   already raised past these stays as it is.
2. Run the repo's lint check. For each `effecttsgo(yield-in-call-argument)`
   error, move the `yield*` into a `const` on the line before and pass the
   const instead, e.g. `const greeting = yield* greeter.greet('Ada');`.
3. For each "Unused oxlint-disable directive" error on an
   `effecttsgo/strict-effect-provide` line (usually `apps/<cli>/src/bin.ts`),
   delete that comment line.
4. Run the lint check and tests again; both must pass.
