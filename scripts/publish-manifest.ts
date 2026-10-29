// `bun pm pack` / `bun publish` resolve catalog: and workspace: specs but do
// not apply `publishConfig.exports` / `publishConfig.bin`, so workspace
// packages (which export ./src/*.ts for local use) would publish paths that
// are not in the tarball. prepack swaps them in; postpack restores the file.
//
//   bun ../../scripts/publish-manifest.ts swap|restore   (from a package dir)
import { existsSync, renameSync } from 'node:fs';

import { Predicate } from 'effect';

import { readJsonObject, writeJson } from './lib/json.ts';

const mode = process.argv[2];
const backup = 'package.json.prepack';

if (mode === 'swap') {
  const manifest = await readJsonObject('package.json');
  await Bun.write(backup, Bun.file('package.json'));
  const { publishConfig } = manifest;
  const published = Predicate.isObject(publishConfig) ? publishConfig : {};
  for (const key of ['exports', 'bin', 'main', 'types']) {
    if (published[key] !== undefined) manifest[key] = published[key];
  }
  await writeJson('package.json', manifest);
} else if (mode === 'restore') {
  if (existsSync(backup)) renameSync(backup, 'package.json');
} else {
  throw new Error('usage: publish-manifest.ts swap|restore');
}
