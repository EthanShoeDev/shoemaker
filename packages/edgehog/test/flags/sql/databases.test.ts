import { it } from '@effect/vitest';
import { Effect } from 'effect';
import { d1, pglite, sqlite } from 'shoemaker-utils/testing/databases';

import { flagSuite } from './suite.ts';

flagSuite('SQLite', Effect.succeed(sqlite), it);
flagSuite('D1', Effect.succeed(d1()), it);
flagSuite('PGlite', Effect.succeed(pglite), it);
