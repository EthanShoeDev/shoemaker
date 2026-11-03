---
'shoemaker': patch
---

alchemy and the `@alchemy.run/*` providers move to `2.0.0-beta.85`. In it,
`AWS.state()` keeps state in a DynamoDB table (`alchemy-state`) instead of the
S3 bucket, and refuses to deploy a stage that is still in S3 until
`alchemy state migrate` moves it. `Cloudflare.state()` and
`Alchemy.localState()` are unchanged. The `init` wizard now says a DynamoDB
table is created for AWS state.

Existing repos with `state: AWS.state()` (for a coding agent). `sync` moves
the pin, after which `infra:deploy` stops with "Stage '…' is still in the S3
state store":

1. Run `bunx shoemaker sync`, then `bun install`, and confirm
   `node_modules/alchemy/package.json` is `2.0.0-beta.85`.
2. Run `bun run typecheck`. beta.85 also moved GitHub `Ruleset` rules to
   top-level props, `Test.make` into `@alchemy.run/test`, and
   `Cloudflare.state({ name })` to `Cloudflare.state({ workerName })`; fix any
   hand-written code that uses them.
3. Stop and ask the user before going further: the next step touches the real
   state store. With their permission, they run
   `bunx alchemy state migrate` from the repo root once no deploy is in flight
   (it migrates every stage, copies records to DynamoDB and fences the S3
   copy, never deleting it; rerun it for any stage it reports `blocked`).
   To stay on S3 instead, set `state: AWS.state({ backend: 's3' })` in
   `alchemy.run.ts`.
