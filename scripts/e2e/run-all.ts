import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// End-to-end proof that generated repos work, through the real CLI path:
// write shoebox.config.ts -> `shoebox sync` -> bun install -> every check the
// generated repo defines -> `shoebox sync --dry-run` must report no drift.
//
//   bun scripts/e2e/run-all.ts [preset...] [--out <dir>]
//
// Never runs infra:plan/deploy: alchemy creates state stores even on a plan.
import { $ } from 'bun';
import { Array as Arr, Record as Rec, String as Str } from 'effect';

import { renderConfigFile } from '../../packages/cli/src/config/render.ts';
import { readJsonObject, stringRecord, writeJson } from '../lib/json.ts';
import { packLocal } from './pack-local.ts';
import { presets } from './presets.ts';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outRoot = resolve(
  outIndex === -1
    ? join(import.meta.dirname, '../../.e2e')
    : (args[outIndex + 1] ?? '.e2e'),
);
const chosen = Arr.filter(
  args,
  (a, i) => !Str.startsWith('--')(a) && args[i - 1] !== '--out',
);
const names = chosen.length > 0 ? chosen : Rec.keys(presets);
const cli = resolve(import.meta.dirname, '../../packages/cli/src/bin.ts');

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });
const overrides = await packLocal(join(outRoot, 'packs'));
const overridesFile = join(outRoot, 'version-overrides.json');
writeFileSync(overridesFile, JSON.stringify(overrides, null, 2));
const env = { ...process.env, SHOEBOX_VERSION_OVERRIDES: overridesFile };

const failures: Array<string> = [];
const step = async (
  preset: string,
  label: string,
  run: () => Promise<unknown>,
) => {
  const started = performance.now();
  try {
    await run();
    console.log(
      `  ok   ${label} (${Math.round(performance.now() - started)}ms)`,
    );
  } catch (error) {
    failures.push(`${preset}: ${label}`);
    const output =
      error instanceof $.ShellError
        ? `${error.stdout.toString()}${error.stderr.toString()}`
        : String(error);
    const tail = Arr.join(Str.split('\n')(output).slice(-40), '\n');
    console.log(`  FAIL ${label}\n${tail}`);
  }
};

for (const name of names) {
  const config = presets[name];
  if (config === undefined) throw new Error(`unknown preset ${name}`);
  const dir = join(outRoot, name);
  mkdirSync(dir, { recursive: true });
  console.log(
    `\n== ${name} (${config.taskRunner}, secrets: ${config.secrets}) ==`,
  );
  writeFileSync(join(dir, 'shoebox.config.ts'), renderConfigFile(config));

  await step(name, 'shoebox sync', () =>
    $`bun ${cli} sync --allow-dirty`.cwd(dir).env(env).quiet(),
  );
  // Tarballs depend on each other at versions not on npm yet.
  const manifest = await readJsonObject(join(dir, 'package.json'));
  manifest.overrides = Rec.fromEntries(
    Arr.sort(
      Rec.toEntries({ ...stringRecord(manifest.overrides), ...overrides }),
      ([a]: [string, string], [b]: [string, string]) => Str.localeCompare(b)(a),
    ),
  );
  await writeJson(join(dir, 'package.json'), manifest);
  await step(name, 'bun install', () =>
    $`git init -q && bun install && git add -A`.cwd(dir).env(env).quiet(),
  );

  if (config.taskRunner === 'turbo') {
    await step(name, 'turbo lint:check typecheck test build', () =>
      $`bunx turbo run lint:check '//#lint:check:root' typecheck test build --continue`
        .cwd(dir)
        .env({ ...env, TURBO_TELEMETRY_DISABLED: '1' })
        .quiet(),
    );
  } else {
    await step(name, 'nx lint:check typecheck test build', () =>
      $`bunx nx run-many -t lint:check typecheck test build --outputStyle=static`
        .cwd(dir)
        .env({ ...env, NX_DAEMON: 'false', NX_NO_CLOUD: 'true' })
        .quiet(),
    );
  }
  await step(name, 'root test', () =>
    $`bun run test`.cwd(dir).env(env).quiet(),
  );
  await step(name, 'sync is idempotent', () =>
    $`bun ${cli} sync --check --allow-dirty`.cwd(dir).env(env).quiet(),
  );
}

console.log(
  failures.length === 0
    ? '\nAll presets passed.'
    : `\nFailed:\n${Arr.join(
        Arr.map(failures, (f) => `  ${f}`),
        '\n',
      )}`,
);
process.exit(failures.length === 0 ? 0 : 1);
