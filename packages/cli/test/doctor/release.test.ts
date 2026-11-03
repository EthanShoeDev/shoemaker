import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect } from 'effect';

import { androidDevShell, androidRelease } from '../../src/doctor/release.ts';
import { failures, jsonFiles, runCheck } from './helpers.ts';

const helper = { 'apps/mobile/android-release.ts': 'export {};\n' };
const wrapped = {
  'apps/mobile/app.config.ts': 'export default withAndroidRelease(config);\n',
};
const tagging = jsonFiles({
  '.changeset/config.json': { privatePackages: { version: true, tag: true } },
});

describe('android-release doctor check', () => {
  it.effect('says nothing for a repo without Android releases', () =>
    Effect.gen(function* () {
      const androidReleaseFailures = yield* runCheck(androidRelease, {});
      assert.deepStrictEqual(androidReleaseFailures, []);
    }),
  );

  it.effect('passes when the seeds are wired up', () =>
    Effect.gen(function* () {
      const tagged = yield* tagging;
      const findings = yield* runCheck(androidRelease, {
        ...helper,
        ...wrapped,
        ...tagged,
      });
      assert.deepStrictEqual(
        Arr.map(findings, (f) => [f.ok, f.message]),
        [[true, 'Android releases set up for mobile']],
      );
    }),
  );

  it.effect('flags stale seeds', () =>
    Effect.gen(function* () {
      const restricted = yield* jsonFiles({
        '.changeset/config.json': { access: 'restricted' },
      });
      const found = yield* failures(androidRelease, {
        ...helper,
        'apps/mobile/app.config.ts': 'export default config;\n',
        ...restricted,
      });
      assert.deepStrictEqual(
        Arr.map(found, (f) => f.path),
        ['apps/mobile/app.config.ts', '.changeset/config.json'],
      );
    }),
  );
});

describe('android-dev-shell doctor check', () => {
  it.effect('flags a flake that does not import nix/android.nix', () =>
    Effect.gen(function* () {
      const files = { 'nix/android.nix': '{pkgs, default}: {}\n' };
      const stale = yield* failures(androidDevShell, {
        ...files,
        'flake.nix': '{ outputs = _: {}; }\n',
      });
      assert.deepStrictEqual(
        Arr.map(stale, (f) => f.path),
        ['flake.nix'],
      );
      const wired = yield* failures(androidDevShell, {
        ...files,
        'flake.nix':
          'overlays = [bunOverlay android-nixpkgs.overlays.default];\nandroid = import ./nix/android.nix {inherit pkgs default;};\n',
      });
      assert.deepStrictEqual(wired, []);
      const androidDevShellFailures = yield* runCheck(androidDevShell, {});
      assert.deepStrictEqual(androidDevShellFailures, []);
    }),
  );
});
