// Publishes every publishable package whose version is not on npm yet, then
// tags the release. Used by .github/workflows/release.yml as the changesets
// `publish` step (`changeset publish` runs npm on the package directory, which
// cannot resolve bun's catalog: and workspace: specs; publish-package.ts packs
// with bun first).
//
// Turbo runs each package's `release:publish` (scripts/publish-package.ts)
// after its build and its dependencies' publishes, so no order is kept here.
//
//   bun scripts/release.ts [--dry-run]
import { Array as Arr, Console, Effect } from 'effect';
import { Command, Flag } from 'effect/cli';

import {
  publishStatus,
  publishablePackages,
  repoRoot,
} from './lib/packages.ts';
import { runInherit, runScript } from './lib/run.ts';

const release = Command.make(
  'release',
  {
    dryRun: Flag.Boolean('dry-run').pipe(
      Flag.withDescription('Pack and list each tarball; publish nothing'),
      Flag.withDefault(false),
    ),
  },
  Effect.fnUntraced(function* ({ dryRun }) {
    const packages = yield* publishablePackages;
    const pending = yield* Effect.filter(packages, (pkg) =>
      Effect.map(publishStatus(pkg), (status) => status === 'pending'),
    );
    if (pending.length === 0) return yield* Console.log('Nothing to publish.');

    const root = yield* repoRoot;
    yield* runInherit('bunx', ['turbo', 'run', 'release:publish'], {
      cwd: root,
      env: dryRun ? { SHOEMAKER_RELEASE_DRY_RUN: 'true' } : {},
    });
    if (!dryRun) yield* runInherit('bunx', ['changeset', 'tag'], { cwd: root });
    const names = Arr.join(
      Arr.map(pending, (pkg) => `${pkg.name}@${pkg.version}`),
      ', ',
    );
    yield* Console.log(`${dryRun ? 'Would publish' : 'Published'}: ${names}`);
  }),
).pipe(Command.withDescription('Publish packages that are not on npm yet'));

runScript(Command.run(release, { version: '0.0.0' }));
