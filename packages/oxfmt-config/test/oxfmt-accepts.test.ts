import { fileURLToPath } from 'node:url';

import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { expect, layer } from '@effect/vitest';
import { Effect, FileSystem, Layer, Path, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const config =
  `import { defineShoemakerFormat } from ${JSON.stringify(entry)};\n` +
  'export default defineShoemakerFormat();\n';
const oxfmtBin = fileURLToPath(
  new URL('bin/oxfmt', import.meta.resolve('oxfmt/package.json')),
);

// The Bun layers re-export @effect/platform-node-shared, so they run under
// vitest's node host too.
const services = BunChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
);

layer(services)((it) => {
  // oxlint's sort-imports is off on the promise that the formatter sorts; this
  // runs the real oxfmt to prove the shared options keep that promise.
  it.effect('formats with the shared options and sorts imports', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const dir = yield* fs.makeTempDirectoryScoped({
        prefix: 'shoemaker-oxfmt-config-',
      });

      yield* fs.writeFileString(path.join(dir, 'oxfmt.config.ts'), config);
      yield* fs.writeFileString(
        path.join(dir, 'probe.ts'),
        'import { z } from "zeta";\nimport { a } from "alpha";\nexport const v = [a, z]\n',
      );
      yield* fs.writeFileString(path.join(dir, 'notes.md'), '* untouched\n');

      const handle = yield* spawner.spawn(
        ChildProcess.make(
          process.execPath,
          [oxfmtBin, '-c', 'oxfmt.config.ts', '--write', '.'],
          { cwd: dir },
        ),
      );
      const [stdout, stderr, status] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText, Stream.mkString),
          handle.stderr.pipe(Stream.decodeText, Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: 3 },
      );

      expect(Number(status), `${stdout}${stderr}`).toBe(0);
      expect(yield* fs.readFileString(path.join(dir, 'probe.ts'))).toBe(
        "import { a } from 'alpha';\nimport { z } from 'zeta';\nexport const v = [a, z];\n",
      );
      expect(yield* fs.readFileString(path.join(dir, 'notes.md'))).toBe(
        '* untouched\n',
      );
    }),
  );
});
