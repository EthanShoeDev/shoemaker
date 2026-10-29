import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Builds and packs every publishable @shoe-box-tools package into a directory,
// so generated sample repos can install them before they exist on npm.
// `bun pm pack` resolves catalog:/workspace: specs but does NOT apply
// publishConfig.exports, so each package swaps its exports in prepack/postpack.
//
//   bun scripts/e2e/pack-local.ts <outDir>   -> prints {name: "file:<tgz>"} JSON
import { $ } from 'bun';
import { Array as Arr, Option, String as Str } from 'effect';

import { readJsonObject, stringRecord } from '../lib/json.ts';

export const PUBLISHED = [
  'typescript-config',
  'oxlint-plugins',
  'oxlint-config',
  'oxfmt-config',
  'knip-config',
  'cli',
];

const root = resolve(import.meta.dirname, '../..');

export const packLocal = async (outDir: string) => {
  const dest = resolve(outDir);
  mkdirSync(dest, { recursive: true });
  const overrides: Record<string, string> = {};
  for (const dir of PUBLISHED) {
    const cwd = join(root, 'packages', dir);
    const manifest = await readJsonObject(join(cwd, 'package.json'));
    const name = String(manifest.name);
    if (stringRecord(manifest.scripts).build !== undefined) {
      await $`bun run build`.cwd(cwd).quiet();
    }
    const before = new Set(readdirSync(dest));
    await $`bun pm pack --destination ${dest} --quiet`.cwd(cwd).quiet();
    const tgz = Option.orElse(
      Arr.findFirst(
        readdirSync(dest),
        (f) => !before.has(f) && Str.endsWith('.tgz')(f),
      ),
      () =>
        Arr.findFirst(
          readdirSync(dest),
          Str.startsWith(Str.replace('/', '-')(Str.replace('@', '')(name))),
        ),
    );
    if (Option.isNone(tgz)) {
      throw new Error(`pack produced nothing for ${dir}`);
    }
    overrides[name] = `file:${join(dest, tgz.value)}`;
  }
  return overrides;
};

if (import.meta.main) {
  const outDir = process.argv[2];
  if (outDir === undefined) throw new Error('usage: pack-local.ts <outDir>');
  console.log(JSON.stringify(await packLocal(outDir), null, 2));
}
