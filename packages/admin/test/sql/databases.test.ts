import { it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  d1,
  deployD1,
  pglite,
  sqlite,
} from 'shoemaker-utils/testing/databases';

import { databaseSuite } from './suite.ts';

databaseSuite('SQLite', Effect.succeed(sqlite), it);
databaseSuite('D1', Effect.succeed(d1()), it);
databaseSuite('D1 through an Alchemy deploy', Effect.succeed(deployD1), it);
databaseSuite('PGlite', Effect.succeed(pglite), it);
