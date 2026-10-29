import type { App } from '../../config/schema.ts';
import type { Contribution, GenContext } from '../../engine/types.ts';
import {
  owned,
  packageTsconfig,
  seed,
  workspacePackageJson,
} from '../shared.ts';
import {
  appDir,
  catalogOf,
  effectTestDevDependencies,
  forApps,
  vitestConfig,
} from './common.ts';

const dependencies = ['@effect/platform-bun', 'effect'];
const devDependencies = [...effectTestDevDependencies, 'tsdown'];

const cliSource = (app: App) => `import { Console } from 'effect';
import { Argument, Command } from 'effect/cli';

export const greeting = (name: string) => \`Hello, \${name}!\`;

const greet = Command.make(
  'greet',
  {
    name: Argument.String('name').pipe(
      Argument.withDescription('Who to greet'),
    ),
  },
  // Console (stdout) is the CLI's output; Effect.log is for diagnostics.
  ({ name }) => Console.log(greeting(name)),
).pipe(Command.withDescription('Print a greeting'));

export const cli = Command.make('${app.name}').pipe(
  Command.withDescription('${app.name} command-line tool'),
  Command.withSubcommands([greet]),
);

export const version = '0.0.0';
`;

const binSource = `#!/usr/bin/env bun
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';
import { Command } from 'effect/cli';

import { cli, version } from './cli.ts';

Command.run(cli, { version }).pipe(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- this is the entry point
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
`;

const testSource = `import { BunServices } from '@effect/platform-bun';
import { assert, it } from '@effect/vitest';
import { Effect } from 'effect';
import { Command } from 'effect/cli';
import { TestConsole } from 'effect/testing';

import { cli, greeting, version } from '../src/cli.ts';

it.effect('greet prints a greeting for the given name', () =>
  Effect.gen(function* () {
    yield* Command.runWith(cli, { version })(['greet', 'Ada']);
    const lines = yield* TestConsole.logLines;
    assert.deepStrictEqual(lines, [greeting('Ada')]);
  }).pipe(Effect.provide([BunServices.layer, TestConsole.layer])),
);
`;

const tsdownConfig = `import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/bin.ts'],
  platform: 'node',
  dts: false,
});
`;

export const effectCli = (ctx: GenContext, app: App): Contribution => {
  const dir = appDir(app);
  return {
    files: [
      workspacePackageJson(ctx, {
        dir,
        name: app.name,
        scripts: {
          dev: 'bun src/bin.ts',
          build: 'tsdown',
        },
        dependencies,
        devDependencies,
        extra: { bin: { [app.name]: './src/bin.ts' } },
      }),
      packageTsconfig(dir),
      vitestConfig(dir),
      owned(`${dir}/tsdown.config.ts`, tsdownConfig),
      seed(`${dir}/src/cli.ts`, cliSource(app)),
      seed(`${dir}/src/bin.ts`, binSource),
      seed(`${dir}/test/cli.test.ts`, testSource),
      seed(
        `${dir}/README.md`,
        `# ${ctx.pkg(app.name)}\n\nRun it with \`bun run dev -- greet Ada\`.\n`,
      ),
    ],
    catalog: catalogOf(dependencies, devDependencies),
  };
};

export const effectCliGenerator = forApps('effect-cli', effectCli);
