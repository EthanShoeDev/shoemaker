import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect } from 'effect';

import { foldkitRendering } from '../../src/doctor/foldkit.ts';
import { failures } from './helpers.ts';

const ssrConfig = {
  'apps/site/vite.config.ts':
    "import { foldkit } from '@foldkit/vite-plugin';\nfoldkit({ ssr: { serverEntry: '/src/entry.server.ts' } });\n",
};

describe('foldkit-rendering doctor check', () => {
  it.effect('passes a server-rendered app with its server entry', () =>
    Effect.gen(function* () {
      const found = yield* failures(foldkitRendering, {
        ...ssrConfig,
        'apps/site/src/entry.server.ts': 'export {};\n',
      });
      assert.deepStrictEqual(found, []);
    }),
  );

  it.effect('flags a SPA that sync turned into an SSR build', () =>
    Effect.gen(function* () {
      const found = yield* failures(foldkitRendering, {
        ...ssrConfig,
        'apps/site/index.html': '<!doctype html>\n',
      });
      assert.deepStrictEqual(
        Arr.map(found, (f) => f.path),
        ['apps/site/index.html'],
      );
      const missing = yield* failures(foldkitRendering, ssrConfig);
      assert.deepStrictEqual(
        Arr.map(missing, (f) => f.path),
        ['apps/site'],
      );
    }),
  );

  it.effect('ignores a SPA config', () =>
    Effect.gen(function* () {
      const found = yield* failures(foldkitRendering, {
        'apps/site/vite.config.ts':
          "import { foldkit } from '@foldkit/vite-plugin';\nfoldkit();\n",
        'apps/site/index.html': '<!doctype html>\n',
      });
      assert.deepStrictEqual(found, []);
    }),
  );
});
