#!/usr/bin/env bun
/**
 * Prints all package.json scripts and their names
 */
import * as Command from '@effect/cli/Command';
import { FileSystem } from '@effect/platform';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Array as A, Console, Effect } from 'effect';
import { join } from 'node:path';

const COMMAND_NAME = 'pkg-scripts';

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  workspaces?: {
    packages?: string[];
  };
}

interface PackageEntry {
  path: string;
  pkg: PackageJson;
}

const readPackageJson = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs.readFileString(path);
    return JSON.parse(content) as PackageJson;
  });

const getWorkspacePackagePaths = (rootDir: string, patterns: string[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths: string[] = [];

    for (const pattern of patterns) {
      const baseDir = pattern.replace('/*', '');
      const fullBaseDir = join(rootDir, baseDir);

      const entries = yield* fs.readDirectory(fullBaseDir);

      for (const entry of entries) {
        const entryPath = join(fullBaseDir, entry);
        const stat = yield* fs.stat(entryPath);
        if (stat.type === 'Directory') {
          paths.push(join(entryPath, 'package.json'));
        }
      }
    }

    return paths;
  });

const printPackageScripts = (pkg: PackageJson, isRoot = false) =>
  Effect.gen(function* () {
    const label = isRoot
      ? `${pkg.name ?? 'root'} (root)`
      : (pkg.name ?? 'unknown');
    const scripts = pkg.scripts ?? {};
    const scriptEntries = Object.entries(scripts);

    yield* Console.log(`\n┌─ 📦 ${label}`);

    if (scriptEntries.length === 0) {
      yield* Console.log('│  (no scripts)');
    } else {
      const maxNameLen = Math.max(
        ...scriptEntries.map(([name]) => name.length),
      );

      for (const [name, cmd] of scriptEntries) {
        const paddedName = name.padEnd(maxNameLen);
        // Truncate long commands for readability
        const displayCmd = cmd.length > 60 ? `${cmd.slice(0, 57)}...` : cmd;
        yield* Console.log(`│  ${paddedName}  →  ${displayCmd}`);
      }
    }

    yield* Console.log(`└─ ${scriptEntries.length} script(s)`);
  });

const main = Effect.gen(function* () {
  const rootDir = process.cwd();
  const rootPkgPath = join(rootDir, 'package.json');

  yield* Console.log(
    '╔════════════════════════════════════════════════════════════╗',
  );
  yield* Console.log(
    '║              📋 Monorepo Package Scripts                   ║',
  );
  yield* Console.log(
    '╚════════════════════════════════════════════════════════════╝',
  );

  const rootPkg = yield* readPackageJson(rootPkgPath);
  const workspacePatterns = rootPkg.workspaces?.packages ?? [];

  // Print root package scripts
  yield* printPackageScripts(rootPkg, true);

  // Get workspace package paths
  const packagePaths = yield* getWorkspacePackagePaths(
    rootDir,
    workspacePatterns,
  );

  // Read and print each workspace package
  const packages = yield* Effect.all(
    packagePaths.map((path: string) =>
      readPackageJson(path).pipe(
        Effect.map((pkg: PackageJson): PackageEntry => ({ path, pkg })),
        Effect.catchAll(() => Effect.succeed(null)),
      ),
    ),
  );

  const validPackages = A.filter(
    packages,
    (p): p is PackageEntry => p !== null,
  );

  // Sort packages by name for consistent output
  const sortedPackages = [...validPackages].toSorted((a, b) =>
    (a.pkg.name ?? '').localeCompare(b.pkg.name ?? ''),
  );

  for (const { pkg } of sortedPackages) {
    yield* printPackageScripts(pkg);
  }

  // Summary
  const totalScripts = sortedPackages.reduce(
    (acc, { pkg }) => acc + Object.keys(pkg.scripts ?? {}).length,
    Object.keys(rootPkg.scripts ?? {}).length,
  );

  yield* Console.log(
    '\n════════════════════════════════════════════════════════════',
  );
  yield* Console.log(
    `  ✅ ${sortedPackages.length + 1} packages | ${totalScripts} total scripts`,
  );
  yield* Console.log(
    '════════════════════════════════════════════════════════════\n',
  );
});

const command = Command.make(COMMAND_NAME, {}, () => main);

const run = Command.run(command, {
  name: COMMAND_NAME,
  version: '0.0.1',
});

run(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
