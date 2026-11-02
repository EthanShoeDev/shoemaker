---
'shoemaker': patch
---

An Expo app can opt into Android releases that
[Obtainium](https://obtainium.imranr.dev) installs and updates from:
`{ name: 'mobile', kind: 'expo', androidRelease: { package: 'dev.example.mobile' } }`.
It needs `features.changesets` and `ci: 'github'`. Merging the "chore: version
packages" PR then tags the app (`changeset git-tag`), and
`.github/workflows/release.yml` builds a signed APK with Gradle and publishes
it as that tag's GitHub Release.

Every repo with an Expo app gets an `android` nix dev shell
(`nix develop .#android`): the default shell plus the Android SDK, NDK, CMake
and JDK 17 from [android-nixpkgs](https://github.com/tadfisher/android-nixpkgs),
pinned in `nix/android.nix` (owned) to what the Expo SDK's React Native builds
with. The flake gains the `android-nixpkgs` input, its binary cache and
`allowUnfree` (the SDK is unfree). Gradle uses the SDK's `aapt2` and downloads
no SDK packages, so builds work on NixOS. The new `android-dev-shell` doctor
check flags a flake that does not expose it.

- `apps/<app>/android-release.ts` (owned) exports `withAndroidRelease`. It
  sets `version` and `android.versionCode` (1.2.3 is 1002003) from
  `package.json` and `android.package` from the config. Its config plugin
  signs release builds with an upload key read from
  `<APP>_ANDROID_KEYSTORE_BASE64`, `<APP>_ANDROID_KEYSTORE_PASSWORD` and
  `<APP>_ANDROID_KEY_ALIAS`, and a release build fails if the key is
  missing.
- Those variables are declared in `.env.schema` / `secretspec.toml`. The
  workflow reads them from GitHub Actions secrets. The root `apk:<app>`
  script loads them through the secrets manager and builds the same APK
  locally (`build:apk` in the app). The script and the workflow both build in
  the `android` dev shell.
- The new `android-release` doctor check flags an opted-in app whose
  `app.config.ts` does not use `withAndroidRelease`, or a changesets config
  that does not tag private packages.

`sync` also treats a package's own `version` as a floor, like dependency
versions: it no longer resets a version changesets bumped back to `0.0.0`, and
the bump no longer makes package.json look hand-edited.

Every Expo app's `ios` / `android` scripts are now `expo start -i` /
`expo start -a`. They do the same thing, but `expo prebuild` rewrites the
long forms to `expo run:*`, which made package.json look hand-edited.

Existing repos with an Expo app (for a coding agent). `sync` writes
`nix/android.nix` but leaves the flake outside its regions alone:

1. In `flake.nix`, replace `inputs.nixpkgs.url = ...;` with an `inputs` set
   holding the same `nixpkgs.url` plus
   `android-nixpkgs = { url = "github:tadfisher/android-nixpkgs"; inputs.nixpkgs.follows = "nixpkgs"; };`.
   Add
   `nixConfig = { extra-substituters = ["https://android-nixpkgs.cachix.org"]; extra-trusted-public-keys = ["android-nixpkgs.cachix.org-1:2lZoPmwoyTVGaNDHqa6A32tdn8Gc0aMWBRrfXN1H3dQ="]; };`.
2. Add `android-nixpkgs` to the `outputs` arguments. Where `forAllSystems`
   imports nixpkgs, use
   `overlays = [bunOverlay android-nixpkgs.overlays.default];` and add
   `config.allowUnfree = true;`.
3. Make the `devShells` set `rec` and add
   `android = import ./nix/android.nix {inherit pkgs default;};` after
   `default`.
4. Run `nix flake lock`, `nix fmt`, and `nix develop .#android --command true`,
   then commit `flake.lock`. `bunx shoemaker doctor .` runs the
   `android-dev-shell` check.

Then, for the app that should ship Android releases (`mobile` stands for the
app, `MOBILE` for its name in SCREAMING_SNAKE_CASE, `@scope` for the repo's
scope):

1. Make sure `features.changesets` is `true` and `ci` is `'github'` in
   `shoemaker.config.ts`, add
   `androidRelease: { package: '<application id>' }` to the app's entry, and
   run `bun run shoemaker:sync`. The application id can never change once
   people install the app. If the app already ships to Play, use its
   existing id.
2. In `apps/mobile/app.config.ts`, add
   `import { withAndroidRelease } from './android-release.ts';`, delete
   `version` (and any `android.package` / `android.versionCode`), and change
   the default export to `export default withAndroidRelease(config);`.
3. In `.changeset/config.json`, add
   `"privatePackages": { "version": true, "tag": true }`.
4. If `apps/mobile/android/` is committed (not prebuilt), stop:
   `build:apk` runs `expo prebuild --clean`, which regenerates it. Ask the
   user before going further.
5. Ask the user for the upload keystore, or have them create one with the
   `keytool` command in the app README's "Android releases" section. Have them
   store the three `MOBILE_ANDROID_*` values as GitHub Actions secrets and in
   the secrets manager. Never commit the keystore.
6. Run `bun run shoemaker:sync`, then `bunx shoemaker doctor .` (the
   `android-release` check must pass), `bun install`, and the repo's
   `lint:check`, `typecheck` and `test`.
