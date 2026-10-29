/**
 * Disallows relative imports that resolve outside the importing file's
 * package (the nearest ancestor directory containing a package.json).
 *
 * Cross-package code must be imported through the target package's public
 * specifier (its package.json `name`) with a declared workspace dependency, so
 * the dependency graph that typecheck, knip, and task-runner caching rely on
 * can see the edge. A relative path that climbs out of the package is
 * invisible to all of them, so a deleted or renamed export can keep compiling
 * unnoticed.
 */

import fs from 'node:fs';
import path from 'node:path';

import { definePlugin, defineRule } from '@oxlint/plugins';
import type { Context, ESTree } from '@oxlint/plugins';

import { findPackageRoot, readPackageName } from './internal/package-root.ts';

const targetDirOf = (resolved: string) =>
  fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);

const isStringLiteral = (
  node: ESTree.Expression,
): node is ESTree.StringLiteral =>
  node.type === 'Literal' && typeof node.value === 'string';

const checkSource = (context: Context, source: ESTree.StringLiteral) => {
  const spec = source.value;
  // Only parent-relative specifiers can escape the package.
  if (!spec.startsWith('..')) return;

  const filename = context.physicalFilename;
  if (!path.isAbsolute(filename)) return;
  const fileDir = path.dirname(filename);
  const fileRoot = findPackageRoot(fileDir);
  if (fileRoot === null) return;

  // Strip bundler query suffixes (`?raw`, `?react`, ...).
  const cleanSpec = spec.split('?')[0] ?? spec;
  const targetRoot = findPackageRoot(
    targetDirOf(path.resolve(fileDir, cleanSpec)),
  );
  if (targetRoot === fileRoot) return;

  const targetName = targetRoot === null ? null : readPackageName(targetRoot);
  context.report({
    node: source,
    messageId: 'noCrossPackageRelativeImport',
    data: {
      spec,
      targetPackage:
        targetName ??
        (targetRoot === null
          ? '(no package found)'
          : path.relative(context.cwd, targetRoot) || '.'),
    },
  });
};

const rule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow relative imports that resolve outside the importing package',
    },
    messages: {
      noCrossPackageRelativeImport:
        "Relative import '{{spec}}' resolves outside this package (into {{targetPackage}}). " +
        'Import through the target package’s public specifier and declare a workspace ' +
        'dependency instead — relative cross-package edges are invisible to typecheck, ' +
        'knip, and task-runner caching.',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        checkSource(context, node.source);
      },
      ImportExpression(node) {
        if (isStringLiteral(node.source)) checkSource(context, node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null) checkSource(context, node.source);
      },
      ExportAllDeclaration(node) {
        checkSource(context, node.source);
      },
    };
  },
});

export default definePlugin({
  meta: { name: 'import-boundaries' },
  rules: { 'no-cross-package-relative-imports': rule },
});
