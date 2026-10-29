import type { Package } from '../../config/schema.ts';
import type { Contribution, GenContext } from '../../engine/types.ts';
import { packageTsconfig, seed, workspacePackageJson } from '../shared.ts';
import {
  catalogOf,
  effectTestDevDependencies,
  forPackages,
  packageDir,
  pascalCase,
  vitestConfig,
} from './common.ts';

const dependencies = ['effect'];
const devDependencies = [...effectTestDevDependencies];

const indexSource = (ctx: GenContext, pkg: Package) => {
  const service = `${pascalCase(pkg.name)}Greeter`;
  return `import { Context, Effect, Layer } from 'effect';

// A starter service: swap the shape and layer for the package's real API.
export class ${service} extends Context.Service<
  ${service},
  { readonly greet: (name: string) => Effect.Effect<string> }
>()('${ctx.pkg(pkg.name)}/${service}') {
  static readonly layer = Layer.succeed(${service}, {
    greet: (name) => Effect.succeed(\`Hello, \${name}!\`),
  });
}
`;
};

const testSource = (pkg: Package) => {
  const service = `${pascalCase(pkg.name)}Greeter`;
  return `import { assert, it } from '@effect/vitest';
import { Effect } from 'effect';

import { ${service} } from '../src/index.ts';

it.effect('greets by name', () =>
  Effect.gen(function* () {
    const greeter = yield* ${service};
    assert.strictEqual(yield* greeter.greet('Ada'), 'Hello, Ada!');
  }).pipe(Effect.provide(${service}.layer)),
);
`;
};

export const library = (ctx: GenContext, pkg: Package): Contribution => {
  const dir = packageDir(pkg);
  return {
    files: [
      workspacePackageJson(ctx, {
        dir,
        name: pkg.name,
        exports: { '.': './src/index.ts' },
        scripts: { test: 'vitest run' },
        dependencies,
        devDependencies,
      }),
      packageTsconfig(dir),
      vitestConfig(dir, pkg.name),
      seed(`${dir}/src/index.ts`, indexSource(ctx, pkg)),
      seed(`${dir}/test/index.test.ts`, testSource(pkg)),
      seed(
        `${dir}/README.md`,
        `# ${ctx.pkg(pkg.name)}\n\nShared library for ${ctx.config.name}.\n`,
      ),
    ],
    catalog: catalogOf(dependencies, devDependencies),
  };
};

export const libraryGenerator = forPackages('library', library);
