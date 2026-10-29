import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Generates a sample repo from a preset with locally packed @shoe-box-tools
// packages, writing files directly (no lockfile, no sync engine), then
// installs it. Use it to prove generator output builds and lints.
//
//   bun scripts/e2e/generate-sample.ts <preset> <outDir> [--no-install]
import { $ } from 'bun';
import { Array as Arr, Record as Rec } from 'effect';

import { generate } from '../../packages/cli/src/engine/generate.ts';
import { readJsonObject, stringRecord, writeJson } from '../lib/json.ts';
import { packLocal } from './pack-local.ts';
import { presets } from './presets.ts';

const [presetName, outArg] = process.argv.slice(2);
const preset = presetName === undefined ? undefined : presets[presetName];
if (preset === undefined || outArg === undefined) {
  throw new Error(
    `usage: generate-sample.ts <${Arr.join(Rec.keys(presets), '|')}> <outDir>`,
  );
}
const out = resolve(outArg);
if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });

const versionOverrides = await packLocal(
  join(out, '..', `${presetName}-packs`),
);
const { files } = generate(preset, { versionOverrides });
for (const file of files) {
  const target = join(out, file.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content);
  if (file.executable === true) chmodSync(target, 0o755);
}
// The packed tarballs depend on each other at versions not on npm yet, so pin
// every @shoe-box-tools package to its tarball for the whole install tree.
const rootManifest = join(out, 'package.json');
const manifest = await readJsonObject(rootManifest);
manifest.overrides = {
  ...stringRecord(manifest.overrides),
  ...versionOverrides,
};
await writeJson(rootManifest, manifest);
console.log(`wrote ${files.length} files to ${out}`);

if (!process.argv.includes('--no-install')) {
  await $`git init -q && bun install`.cwd(out);
}
