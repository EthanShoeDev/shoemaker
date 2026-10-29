import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, expect, it } from 'vitest';

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const oxfmtBin = path.join(
  path.dirname(fileURLToPath(import.meta.resolve('oxfmt/package.json'))),
  'bin',
  'oxfmt',
);
const dir = mkdtempSync(path.join(tmpdir(), 'shoebox-oxfmt-config-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// oxlint's sort-imports is off on the promise that the formatter sorts; this
// runs the real oxfmt to prove the shared options keep that promise.
it('formats with the shared options and sorts imports', () => {
  writeFileSync(
    path.join(dir, 'oxfmt.config.ts'),
    `import { defineShoeboxFormat } from ${JSON.stringify(entry)};\n` +
      'export default defineShoeboxFormat();\n',
  );
  writeFileSync(
    path.join(dir, 'probe.ts'),
    'import { z } from "zeta";\nimport { a } from "alpha";\nexport const v = [a, z]\n',
  );
  writeFileSync(path.join(dir, 'notes.md'), '* untouched\n');

  const result = spawnSync(
    process.execPath,
    [oxfmtBin, '-c', 'oxfmt.config.ts', '--write', '.'],
    { cwd: dir, encoding: 'utf-8' },
  );

  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  expect(readFileSync(path.join(dir, 'probe.ts'), 'utf-8')).toBe(
    "import { a } from 'alpha';\nimport { z } from 'zeta';\nexport const v = [a, z];\n",
  );
  expect(readFileSync(path.join(dir, 'notes.md'), 'utf-8')).toBe(
    '* untouched\n',
  );
});
