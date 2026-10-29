import { join } from 'node:path';

// Publishes every public @shoe-box-tools package whose current version is not
// on npm yet, then tags the release. Used by .github/workflows/release.yml as
// the changesets `publish` step.
//
// `changeset publish` shells out to npm, which cannot resolve bun's catalog:
// and workspace: specs, so each package goes through `bun publish` instead
// (it resolves them and runs prepack/postpack, which swap in publishConfig).
//
//   bun scripts/release.ts [--dry-run]
import { $ } from 'bun';
import { Array as Arr, Predicate, String as Str } from 'effect';

import { readJsonObject } from './lib/json.ts';

const dryRun = process.argv.includes('--dry-run');
const root = join(import.meta.dirname, '..');
// Dependency order: a package is published after the packages it depends on.
const order = [
  'typescript-config',
  'oxlint-plugins',
  'oxlint-config',
  'oxfmt-config',
  'knip-config',
  'cli',
];

const published: Array<string> = [];
for (const dir of order) {
  const cwd = join(root, 'packages', dir);
  const manifest = await readJsonObject(join(cwd, 'package.json'));
  const name = String(manifest.name);
  const version = String(manifest.version);
  if (manifest.private === true) continue;
  const onNpm = await $`npm view ${name}@${version} version`.quiet().nothrow();
  if (onNpm.exitCode === 0 && Str.trim(onNpm.stdout.toString()) === version) {
    console.log(`skip ${name}@${version} (already on npm)`);
    continue;
  }
  const scripts = Predicate.isObject(manifest.scripts) ? manifest.scripts : {};
  if (scripts.build !== undefined) await $`bun run build`.cwd(cwd);
  // `bun publish --dry-run` still demands npm auth; packing runs the same
  // prepack/postpack swap and shows the exact tarball contents.
  await (dryRun
    ? $`bun pm pack --dry-run`.cwd(cwd)
    : $`bun publish --access public`.cwd(cwd));
  published.push(`${name}@${version}`);
}

if (published.length > 0 && !dryRun) await $`bunx changeset tag`.cwd(root);
console.log(
  published.length === 0
    ? 'Nothing to publish.'
    : `${dryRun ? 'Would publish' : 'Published'}: ${Arr.join(published, ', ')}`,
);
