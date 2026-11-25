// The benchmark's scratch stage, for task 1.5. Deploys are Ethan's: no agent
// runs this. See README.md beside it, and destroy the stage when done.
//
// State stays in `.alchemy` here, which git ignores and which holds no secret,
// so the account is left with nothing once the stage is destroyed.
import * as Cloudflare from '@alchemy.run/cloudflare';
import { Stack } from 'alchemy';
import { localState } from 'alchemy/State';
import { Effect } from 'effect';

import BenchWorker, { BenchDb } from './worker.ts';

export default Stack(
  'EdgehogBench',
  { providers: Cloudflare.providers(), state: localState() },
  Effect.gen(function* () {
    const db = yield* BenchDb;
    const worker = yield* BenchWorker;
    return { url: worker.url, database: db.databaseId };
  }),
);
