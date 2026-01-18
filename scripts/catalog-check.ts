#!/usr/bin/env bun
/**
 * This file will check and fix times when monorepo packages are specifying
 * the version number of a dependency in the package.json file instead of using
 * the catalog: keyword.
 */
import { Options } from '@effect/cli';
import * as Command from '@effect/cli/Command';
import { FileSystem } from '@effect/platform';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Array as A, Console, Effect } from 'effect';
import { join } from 'node:path';
import { coerce, gt, type SemVer } from 'semver';

const COMMAND_NAME = 'catalog-check';

interface PackageJson {
  name?: string;
  workspaces?: {
    packages?: string[];
    catalog?: Record<string, string>;
  };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface Violation {
  packagePath: string;
  packageName: string;
  depType: 'dependencies' | 'devDependencies' | 'peerDependencies';
  depName: string;
  currentValue: string;
  expectedValue: string;
}

const readPackageJson = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs.readFileString(path);
    return JSON.parse(content) as PackageJson;
  });

const writePackageJson = (path: string, pkg: PackageJson) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(path, JSON.stringify(pkg, null, 2));
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

const isNewerVersion = (a: string, b: string): boolean => {
  const semverA: SemVer | null = coerce(a);
  const semverB: SemVer | null = coerce(b);
  if (!semverA || !semverB) {
    return false;
  }
  return gt(semverA, semverB);
};

const checkPackage = (
  packagePath: string,
  catalog: Record<string, string>,
  workspacePackages: Set<string>,
) =>
  Effect.gen(function* () {
    const pkg = yield* readPackageJson(packagePath);
    const violations: Violation[] = [];
    const catalogDeps = new Set(Object.keys(catalog));

    const depTypes = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
    ] as const;

    for (const depType of depTypes) {
      const deps = pkg[depType];
      if (!deps) {
        continue;
      }

      for (const [depName, version] of Object.entries(deps)) {
        if (
          workspacePackages.has(depName) &&
          !version.startsWith('workspace:')
        ) {
          violations.push({
            packagePath,
            packageName: pkg.name ?? packagePath,
            depType,
            depName,
            currentValue: version,
            expectedValue: 'workspace:*',
          });
        } else if (catalogDeps.has(depName) && version !== 'catalog:') {
          violations.push({
            packagePath,
            packageName: pkg.name ?? packagePath,
            depType,
            depName,
            currentValue: version,
            expectedValue: 'catalog:',
          });
        }
      }
    }

    return violations;
  });

const fixViolations = (
  violations: Violation[],
  rootPkgPath: string,
  rootPkg: PackageJson,
) =>
  Effect.gen(function* () {
    const catalog = rootPkg.workspaces?.catalog ?? {};
    let catalogUpdated = false;

    // Group violations by package path
    const byPackage = new Map<string, Violation[]>();
    for (const v of violations) {
      const existing = byPackage.get(v.packagePath) ?? [];
      existing.push(v);
      byPackage.set(v.packagePath, existing);
    }

    // Check if any violation has a newer version than catalog
    for (const v of violations) {
      const catalogVersion = catalog[v.depName];
      if (
        v.expectedValue === 'catalog:' &&
        catalogVersion &&
        isNewerVersion(v.currentValue, catalogVersion)
      ) {
        yield* Console.log(
          `  Updating catalog "${v.depName}": "${catalogVersion}" -> "${v.currentValue}" (newer)`,
        );
        catalog[v.depName] = v.currentValue;
        catalogUpdated = true;
      }
    }

    // Fix each package
    for (const [packagePath, pkgViolations] of byPackage) {
      const pkg = yield* readPackageJson(packagePath);

      for (const v of pkgViolations) {
        const deps = pkg[v.depType];
        if (deps) {
          deps[v.depName] = v.expectedValue;
          yield* Console.log(
            `  Fixed ${pkg.name ?? packagePath} (${v.depType}): "${v.depName}" -> "${v.expectedValue}"`,
          );
        }
      }

      yield* writePackageJson(packagePath, pkg);
    }

    // Write updated catalog if needed
    if (catalogUpdated) {
      yield* writePackageJson(rootPkgPath, rootPkg);
      yield* Console.log('  Updated root package.json catalog');
    }
  });

const main = (fix: boolean) =>
  Effect.gen(function* () {
    const rootDir = process.cwd();
    const rootPkgPath = join(rootDir, 'package.json');

    const rootPkg = yield* readPackageJson(rootPkgPath);

    const catalog = rootPkg.workspaces?.catalog ?? {};
    const catalogDeps = new Set(Object.keys(catalog));
    const workspacePatterns = rootPkg.workspaces?.packages ?? [];

    yield* Console.log(`Found ${catalogDeps.size} dependencies in catalog`);
    yield* Console.log(`Workspace patterns: ${workspacePatterns.join(', ')}`);

    const packagePaths = yield* getWorkspacePackagePaths(
      rootDir,
      workspacePatterns,
    );

    yield* Console.log(`Checking ${packagePaths.length} workspace packages...`);

    const workspacePackages = yield* Effect.all(
      packagePaths.map((p) =>
        readPackageJson(p).pipe(
          Effect.map((pkg) => pkg.name),
          Effect.catchAll(() => Effect.succeed(null)),
        ),
      ),
    );
    const workspacePackageNames = new Set(
      workspacePackages.filter(Boolean) as string[],
    );

    const allViolations = yield* Effect.all(
      packagePaths.map((p) => checkPackage(p, catalog, workspacePackageNames)),
    );

    const violations = A.flatten(allViolations);

    if (violations.length === 0) {
      yield* Console.log(
        'All packages correctly use catalog: and workspace:* references',
      );
      return;
    }

    yield* Console.log(`\nFound ${violations.length} violation(s):\n`);

    for (const v of violations) {
      yield* Console.log(
        `  ${v.packageName} (${v.depType}): "${v.depName}" is "${v.currentValue}" but should be "${v.expectedValue}"`,
      );
    }

    if (fix) {
      yield* Console.log('\nFixing violations...\n');
      yield* fixViolations(violations, rootPkgPath, rootPkg);
      yield* Console.log(
        '\nAll violations fixed. Run `bun install` to update lockfile.',
      );
    } else {
      yield* Effect.fail(
        new Error(`Found ${violations.length} catalog/workspace violations`),
      );
    }
  });

const command = Command.make(
  COMMAND_NAME,
  {
    fix: Options.boolean('fix').pipe(
      Options.withDefault(false),
      Options.withDescription('Automatically fix violations'),
    ),
  },
  ({ fix }) => main(fix),
);

const run = Command.run(command, {
  name: COMMAND_NAME,
  version: '0.0.1',
});

run(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
