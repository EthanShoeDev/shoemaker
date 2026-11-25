# Benchmark

The collector and the atomic write of `add-error-tracking`, with fixed amounts.
`store.ts` and `collector.ts` are prototypes: the real ones start from them.

## Here

```sh
node bench/local.ts                       # D1 (workerd), SQLite, Postgres
node bench/local.ts --database d1
```

It prints what the run could cost on Cloudflare, refuses above 0.25 dollars, and
stops by itself: the counts are fixed and each database has two minutes. Nothing
leaves the machine, so it says nothing about the network. Postgres comes from
the dev shell, with `fsync` off. `measuredRows` is D1's own count of rows
written, `chargedRows` is what `src/limits/costs.ts` says.

## On a scratch stage (task 1.5, Ethan only)

Deploying is Ethan's. Agents only typecheck `scratch/`.

```sh
cd packages/edgehog/bench/scratch
export BENCH_KEY=$(openssl rand -hex 32)
export BENCH_KEY_SHA256=$(printf %s "$BENCH_KEY" | sha256sum | cut -d' ' -f1)

bunx alchemy deploy --stage bench          # prints the url
node drive.ts --url <url>                  # prints the cost first
bunx alchemy destroy --stage bench         # always, also after a failure
```

Only the digest of the key reaches Cloudflare and `.alchemy`. The object counts
its runs in its own storage and refuses after 24 runs and 3,000 collected
requests, whoever calls. Deploying again does not reset them; destroying does.

Keep, for design.md: the lines `drive.ts` prints, and from the dashboard, for
the stage's database, rows written (D1 > Metrics) beside the sum of
`measuredRows`.

### Are blocked requests billed?

This needs a zone, so it is a second, optional step.

1. Give the Worker a host of a zone you own: add `domain: 'bench.example.com'`
   and `workersDev: false` to its props in `worker.ts`, and deploy again.
2. In that zone add a rate-limit rule (Security > Security rules): host equals
   the bench host, 20 requests in 10 seconds by IP address, block for 10 seconds.
3. Note the Worker's request count (Workers & Pages > the Worker > Metrics).
4. `node drive.ts --blocked --url https://bench.example.com` sends 2,000
   requests with no key and counts the answers: 401 reached the Worker, 429 did
   not.
5. After ten minutes, compare the count: if it grew by the 401s alone, blocked
   requests are not invocations. Then check Billing > Billable usage a day later
   for Workers requests, which settles it.
6. Remove the rule, undo the change to `worker.ts`, and destroy the stage.

Afterwards, check that the stage is gone: no `BenchWorker` under Workers, no
`BenchDb` under D1, and no bench rule in the zone.
