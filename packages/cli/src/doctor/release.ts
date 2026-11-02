import { Array as Arr, Effect, Option, Schema, String as Str } from 'effect';

import { decodeJsonc } from '../checks/workspace.ts';
import { fail, pass } from './shared.ts';
import type { DoctorCheck, Finding } from './types.ts';

const ChangesetConfig = Schema.Struct({
  privatePackages: Schema.optionalKey(
    Schema.Struct({ tag: Schema.optionalKey(Schema.Boolean) }),
  ),
});

// `sync` renders android-release.ts but never touches the seeds it depends
// on, so an app that opted in after its repo was made can be missing them.
export const androidRelease: DoctorCheck = {
  id: 'android-release',
  description:
    'Expo apps that ship Android releases wrap app.config.ts in withAndroidRelease and get changesets tags',
  run: Effect.fnUntraced(function* (repo) {
    const helpers = yield* repo.glob('apps/*/android-release.ts');
    if (helpers.length === 0) return [];
    const findings: Array<Finding> = [];
    for (const helper of helpers) {
      const dir = Str.replace(/\/android-release\.ts$/u, '')(helper);
      const configPath = `${dir}/app.config.ts`;
      const appConfig = yield* repo.read(configPath);
      if (
        appConfig === undefined ||
        !Str.includes('withAndroidRelease(')(appConfig)
      ) {
        findings.push(
          fail(`${configPath} does not use withAndroidRelease`, {
            path: configPath,
            fix: `import { withAndroidRelease } from './android-release.ts', drop the config's \`version\`, and \`export default withAndroidRelease(config)\``,
          }),
        );
      }
    }
    const tagged = Option.match(
      decodeJsonc(ChangesetConfig, yield* repo.read('.changeset/config.json')),
      {
        onNone: () => false,
        onSome: (config) => config.privatePackages?.tag === true,
      },
    );
    if (!tagged) {
      findings.push(
        fail(
          'changesets does not tag private packages, so no app release starts',
          {
            path: '.changeset/config.json',
            fix: '"privatePackages": { "version": true, "tag": true }',
          },
        ),
      );
    }
    return findings.length > 0
      ? findings
      : [
          pass(
            `Android releases set up for ${Arr.join(
              Arr.map(helpers, (helper) => Str.split(helper, '/')[1] ?? helper),
              ', ',
            )}`,
          ),
        ];
  }),
};

// flake.nix is managed by regions, so sync cannot add the input and the shell
// that import nix/android.nix to a flake written before it existed.
export const androidDevShell: DoctorCheck = {
  id: 'android-dev-shell',
  description: 'flake.nix exposes nix/android.nix as the `android` dev shell',
  run: Effect.fnUntraced(function* (repo) {
    if (!(yield* repo.exists('nix/android.nix'))) return [];
    const flake = (yield* repo.read('flake.nix')) ?? '';
    return Str.includes('./nix/android.nix')(flake) &&
      Str.includes('android-nixpkgs.overlays.default')(flake)
      ? [pass('flake.nix has the android dev shell')]
      : [
          fail('flake.nix does not expose nix/android.nix', {
            path: 'flake.nix',
            fix: 'add the android-nixpkgs input and nixConfig cache, its overlay, `config.allowUnfree = true` and `android = import ./nix/android.nix {inherit pkgs default;};`, as a new repo with an Expo app has them',
          }),
        ];
  }),
};

export const releaseChecks = [androidRelease, androidDevShell];
