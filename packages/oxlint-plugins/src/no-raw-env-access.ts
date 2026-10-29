/**
 * Disallows direct access to `import.meta.env` or `process.env`.
 *
 * App code reads environment variables through Effect `Config`, which
 * validates them and keeps configuration swappable in tests, or through a
 * repo's own env package where it has one. Files inside such a package are
 * exempt: reading the raw environment is its job.
 *
 * Options (all optional):
 * - `envPackage`: an env package to name in the message instead of Effect
 *   `Config`.
 * - `allowedPackages`: package.json names whose files may read the raw
 *   environment (default: any package named `@<anything>/env`).
 */

import path from 'node:path';

import { definePlugin, defineRule } from '@oxlint/plugins';
import type { Context, ESTree } from '@oxlint/plugins';

import { findPackageRoot, readPackageName } from './internal/package-root.ts';

const defaultEnvPackagePattern = /^@[^/]+\/env$/u;

type EnvAccessOptions = {
  envPackage: string | null;
  allowedPackages: ReadonlyArray<string> | null;
};

const readOptions = (context: Context): EnvAccessOptions => {
  const [first] = context.options;
  const options =
    first !== null && typeof first === 'object' && !Array.isArray(first)
      ? first
      : {};
  const { envPackage, allowedPackages } = options;
  return {
    envPackage: typeof envPackage === 'string' ? envPackage : null,
    allowedPackages: Array.isArray(allowedPackages)
      ? allowedPackages.filter((name) => typeof name === 'string')
      : null,
  };
};

const isInAllowedPackage = (context: Context, options: EnvAccessOptions) => {
  const filename = context.physicalFilename;
  if (!path.isAbsolute(filename)) return false;
  const root = findPackageRoot(path.dirname(filename));
  const name = root === null ? null : readPackageName(root);
  if (name === null) return false;
  return options.allowedPackages === null
    ? defaultEnvPackagePattern.test(name)
    : options.allowedPackages.includes(name);
};

const propertyNamed = (node: ESTree.MemberExpression, name: string) =>
  node.computed
    ? node.property.type === 'Literal' && node.property.value === name
    : node.property.type === 'Identifier' && node.property.name === name;

const isProcessEnv = (node: ESTree.MemberExpression) =>
  node.object.type === 'Identifier' &&
  node.object.name === 'process' &&
  propertyNamed(node, 'env');

const isImportMetaEnv = (node: ESTree.MemberExpression) =>
  node.object.type === 'MetaProperty' &&
  node.object.meta.name === 'import' &&
  node.object.property.name === 'meta' &&
  propertyNamed(node, 'env');

const rule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct access to import.meta.env or process.env; read env through Effect Config.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          envPackage: { type: 'string' },
          allowedPackages: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noImportMetaEnv:
        'Direct access to `import.meta.env` is not allowed. Read it through {{via}} instead: ' +
        'it validates every variable and keeps secrets out of client bundles.',
      noProcessEnv:
        'Direct access to `process.env` is not allowed. Read it through {{via}} instead: ' +
        'it validates every variable and keeps configuration in one place.',
    },
  },
  create(context) {
    const options = readOptions(context);
    if (isInAllowedPackage(context, options)) return {};
    const data = {
      via:
        options.envPackage === null
          ? 'Effect `Config`'
          : `\`${options.envPackage}\``,
    };

    return {
      // `process.env.X` and `import.meta.env.X` contain the bare form, so
      // matching only the bare member reports each access exactly once.
      MemberExpression(node) {
        if (isProcessEnv(node)) {
          context.report({ node, messageId: 'noProcessEnv', data });
        } else if (isImportMetaEnv(node)) {
          context.report({ node, messageId: 'noImportMetaEnv', data });
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: 'env-access' },
  rules: { 'no-raw-env-access': rule },
});
