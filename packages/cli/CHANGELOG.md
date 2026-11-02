# shoemaker

## 0.2.5

### Patch Changes

- [`c1baaaf`](https://github.com/EthanShoeDev/shoemaker/commit/c1baaaf7a7753bd0dc4bfa5163176fb3fcdab883) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - The formatter and jscpd skip drizzle-kit's migration snapshots
  (`**/migrations/*/snapshot.json`). They are generated, and each repeats most of
  the one before, so a repo's second migration failed `jscpd:check`.

- [`c1baaaf`](https://github.com/EthanShoeDev/shoemaker/commit/c1baaaf7a7753bd0dc4bfa5163176fb3fcdab883) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - `.env.schema` leaves a project-owned spot for varlock plugins. The managed
  `header` region now ends before the `# ---` divider, and the lines between it
  and the divider belong to the project, so root decorators such as
  `@plugin(@varlock/infisical-plugin)` and `@initInfisical(...)` survive `sync`.
  varlock reads every comment block before the first item as header, so they
  take effect there. shoemaker has no plugin option: plugin arguments such as a
  self-hosted Infisical URL can be private, so each repo writes its own and can
  pass them as `$VAR` references that resolve from `.env.local` or CI.
  
  In an existing repo, after `shoemaker sync`:
  
  1. In `.env.schema`, find `# shoemaker:end header`. `sync` removed the `# ---`
     divider that used to sit just above it.
  2. Directly below that marker, with no blank line, add
     `# Project root decorators (plugins) go here; shoemaker never touches them.`
     and then `# ---`, then keep the blank line before `# shoemaker:begin vars`.
  3. Put any plugin decorators between those two new lines. In a public repo,
     don't commit a private value such as a self-hosted URL: pass
     `siteUrl=$INFISICAL_SITE_URL`, and declare that variable (and the plugin's
     credentials) as `@sensitive` in the project-only section at the bottom.
- Updated dependencies [[`c1baaaf`](https://github.com/EthanShoeDev/shoemaker/commit/c1baaaf7a7753bd0dc4bfa5163176fb3fcdab883)]:
  - shoemaker-oxfmt-config@0.2.5

## 0.2.4

### Patch Changes

- [`391ac9d`](https://github.com/EthanShoeDev/shoemaker/commit/391ac9d1cb7005adeef430b0f4d87ea909531cd3) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - An Expo app can opt into Android releases that
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

- [`391ac9d`](https://github.com/EthanShoeDev/shoemaker/commit/391ac9d1cb7005adeef430b0f4d87ea909531cd3) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - `doctor`, `adopt` and `check` skip gitignored files. In a git repo they only
  read what `git ls-files --cached --others --exclude-standard` lists, so cloned
  reference repos (`docs/cloned-repos-as-docs/`, `.external/`) and build output
  no longer produce findings. Outside git they read every file except
  `node_modules`, `.git`, `dist`, `.turbo`, `.external` and `.direnv`, as before.
  Globs go through Effect's `FileSystem.glob`, which skips those directories
  without reading them, in place of `Bun.Glob`, which walked all of
  `node_modules` and filtered afterwards.
  
  `doctor` and `adopt` now work on Windows. `Bun.Glob` returned
  backslash-separated paths there, so every package's folder came out empty,
  `adopt` found no apps or packages, and the doctor printed backslash paths.
  `FileSystem.glob` and git both return `/`-separated paths, and the repo's name
  comes from `Path.basename` instead of splitting the root on `/`.
  
  The `turbo-fix-uncached` check no longer flags a fix task that a package opts
  out of with `"command": null`, since it runs nothing.

- [`c1546c7`](https://github.com/EthanShoeDev/shoemaker/commit/c1546c7e82d04d561a1fce4d5411b01b0f5a007a) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - Expo apps style with [Uniwind](https://uniwind.dev): Tailwind `className`s on
  React Native components, compiled by Metro. `metro.config.ts` (owned) wraps
  the config in `withUniwindConfig`. The app gains `uniwind` and `tailwindcss`,
  a seeded `global.css` that the layout imports, and a seeded
  `uniwind-types.d.ts`. The seed holds the exact bytes Uniwind writes, so
  `className` typechecks before Metro has run, and lint and format skip the
  file. The app's tsconfig adds `expo/types`, which declares CSS imports. Expo
  otherwise reaches that only through the gitignored `expo-env.d.ts`. The
  starter screen uses classes instead of `StyleSheet`.
  
  A repo with more than one UI app (TanStack Start, Foldkit or Expo) gets
  `packages/theme`, a CSS-only package:
  
  - `tokens.css` (seed) declares each color in `@theme` and sets it under
    `@variant light` and `@variant dark`, with shadcn/ui's names and neutral
    values, plus the radii.
  - `web.css` (owned) imports the tokens and defines the `light` and `dark`
    variants the way Uniwind does on native.
  - Web apps import `@<scope>/theme/web.css` and Expo apps import
    `@<scope>/theme/tokens.css`, so `bg-background` is one color everywhere. A
    `.light` or `.dark` class picks the theme; otherwise the system setting
    does.
  - The package opts out of `typecheck`, `test` and `oxlint`. A package task
    can now set `command: null`, rendered as `"command": null` in its
    `turbo.jsonc`; under nx the package gets no script or target.
  - `theme` is a reserved name in such a repo.
  
  Two new doctor checks:
  
  - `theme-tokens` flags a stylesheet whose theme variants do not all set the
    same variables, which Uniwind reports at bundle time. In
    `packages/theme/tokens.css` it also flags a themed color missing from
    `@theme` (so it has no web utility) and directives Uniwind cannot parse
    (`@plugin`, `@source`, `@custom-variant`, `@config`, `source()`).
  - `theme-imports` flags a Tailwind or Uniwind app that does not depend on and
    import the theme package.
  
  Existing repos (for a coding agent). `sync` writes the new files, but never
  edits the seeds that already exist:
  
  1. In each Expo app's `app/_layout.tsx`, add `import '../global.css';` as the
     first import. If the app already styled with Uniwind or NativeWind from
     another stylesheet, merge that stylesheet into `global.css` and delete it.
  2. With more than one UI app, add `@import '@<scope>/theme/web.css';` after
     `@import 'tailwindcss';` in each web app's `src/styles.css`. Move any
     colors the apps already share into `packages/theme/tokens.css` under the
     same names in both variants, and delete them from the apps.
  3. Run `shoemaker doctor` and fix any `theme-tokens` or `theme-imports`
     findings.

- [`391ac9d`](https://github.com/EthanShoeDev/shoemaker/commit/391ac9d1cb7005adeef430b0f4d87ea909531cd3) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - `sync` no longer shortens a list in a file it merges into (`package.json`)
  when it has no baseline for that file, as in a repo being adopted. Every entry
  in such a file is the user's, so instead of replacing the list it reports a
  conflict naming the entries it would drop (`/workspaces: "tools/*"`), and
  `--force` does not override that: remove them by hand first. Adding entries,
  and shortening a list shoemaker wrote itself, work as before. Files shoemaker
  owns whole (`turbo.jsonc`, tsconfigs, `vitest.config.ts`) are still replaced
  by `--force`.
- Updated dependencies []:
  - shoemaker-oxfmt-config@0.2.4

## 0.2.3

### Patch Changes

- [`083eb38`](https://github.com/EthanShoeDev/shoemaker/commit/083eb387a8a13da569c0f25020d32f81b5be1446) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - New package kind `frontend` (`{ name: 'frontend', kind: 'frontend', api: 'api' }`):
  client code the repo's frontends share, with no React and no UI. It holds the
  effect-api app's endpoints as Effect atoms: `ApiClient` (`AtomHttpApi` over the
  contract), `withApiTransport` to seed an atom registry with where requests go,
  and one atom module per resource. `init` adds one when a TanStack Start site
  serves an API (`--no-frontend` to skip).
  
  A site that serves an API with a frontend package reads it through those atoms
  instead of `callApi`: the router owns a raf-effect-atom registry (one per
  server request, one per tab), route loaders start atoms with
  `context.atoms.ensure`, components read them with `useAtomResult`, and the
  server's results stream into the browser's registry. Every TanStack Start
  app's `tsconfig.json` now sets `declaration: false`, since an app emits no
  declarations and raf-effect-atom's router context otherwise fails TS2883.
  
  Existing repos with a site serving an API that want this (for a coding agent;
  `web` stands for the site, `api` for the effect-api app, `@scope` for the
  repo's scope):
  
  1. Add `{ name: 'frontend', kind: 'frontend', api: 'api' }` to `packages` in
     `shoemaker.config.ts`, then run `bun run shoemaker:sync`. It writes
     `packages/frontend/` and updates `apps/web/package.json`
     (`@scope/frontend`, `@effect/atom-react` and `raf-effect-atom` in;
     `@scope/api-contract` out) and `apps/web/tsconfig.json`.
  2. Generate a scratch repo with the same config
     (`bunx shoemaker init /tmp/frontend-ref --yes --no-git --apps tanstack-start,effect-api`)
     and copy its `apps/web/src/api-transport.ts` and
     `apps/web/test/api-transport.test.ts` into the repo, fixing the scope.
  3. Merge the scratch repo's `apps/web/src/router.tsx` (`makeRegistry`,
     `Loader.make`, `setupRouterAtoms`) and `apps/web/src/routes/__root.tsx`
     (`createRootRouteWithContext`, `WaterfallDetection`) into the repo's.
  4. For each `callApi(...)` in a loader, add a query atom to
     `packages/frontend/src/<resource>.ts` (`ApiClient.query` with a
     `serializationKey`), return `context.atoms.ensure(atom, ...args)` from the
     loader, and read it in the component with
     `useAtomResult(atom, Route.useLoaderData())`. Writes become
     `ApiClient.mutation` atoms that pass `reactivityKeys`.
  5. Delete `apps/web/src/api-client.ts` and its test once nothing imports
     `callApi`.
  6. `bun install`, then `bunx turbo run lint:check typecheck test build`.

- [`1c07e69`](https://github.com/EthanShoeDev/shoemaker/commit/1c07e69e919797bd8e9431cfd55aad2f5a3622ff) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - Generated repos get newer dependency versions:
  
  - `effect`: 4.1.0 → 4.1.1
  - `expoSdk`: ~58.0.21 → ~58.0.22
  - `knip`: ^6.43.0 → ^6.44.1
  - `@tanstack/eslint-plugin-query`: ^5.105.0 → ^5.105.1
  - `nx`: ^24.0.2 → ^24.0.3
  - `tsdown`: ^0.23.3 → ^0.23.4
  - `varlock`: ^1.23.0 → ^1.24.0
  - `@varlock/vite-integration`: ^1.5.4 → ^1.5.5
  - `@varlock/cloudflare-integration`: ^1.6.2 → ^1.6.3
  - `@rolldown/plugin-babel`: ^0.2.4 → ^0.3.0
  - `@babel/core`: ^7.29.0 → ^8.0.10
  - `@tanstack/react-query`: ^5.105.0 → ^5.105.1
  - `foldkit`: ~0.169.0 → ~0.170.0
  - `@foldkit/vite-plugin`: ~0.28.0 → ~0.29.0
  - `@foldkit/devtools`: ~0.169.0 → ~0.170.0
  - `expo-router`: ~58.0.28 → ~58.0.29
  - `react-native-screens`: ~4.30.0 → ~4.30.1
  
  Existing repos: `bun run shoemaker:sync`, then `bun install`. A version the
  repo already raised past these stays as it is.
- Updated dependencies []:
  - shoemaker-oxfmt-config@0.2.3

## 0.2.2

### Patch Changes

- [`52a67c8`](https://github.com/EthanShoeDev/shoemaker/commit/52a67c86f3a08ed1929e75dbedc0078a272fc459) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - Generated repos now get `^<this CLI's version>` for shoemaker and the
  `shoemaker-*` config packages. It used to be a hard-coded `^0.1.0`, which on
  0.x never matches 0.2.x, so synced repos installed 0.1.x tooling, and a repo
  that raised the catalog by hand got a root `package.json` conflict on every
  sync. A test now fails if the range stops admitting the released versions,
  and a new `doctor` check, `shoemaker-versions`, reports any shoemaker-* range
  that excludes the running CLI.
  
  Existing repos (for a coding agent):
  
  1. Run `bun run shoemaker:sync`. It writes `^<version>` for every
     shoemaker-* entry in the root catalog. A repo that held the catalog at
     `^0.2.x` by hand no longer sees the root `package.json` conflict.
  2. `bun install`, then run the repo's checks.

- [`f995013`](https://github.com/EthanShoeDev/shoemaker/commit/f995013a8b5da179c52abcd8e7e3e1831e132cd0) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - `sync` treats dependency versions in package.json files as a floor. A repo
  that raises a version past what shoemaker writes keeps it, and that bump no
  longer makes the file look hand-edited, so it is not a conflict. A newer
  version from shoemaker still replaces an older one. Changing a version into
  another kind of spec (`catalog:`, `file:`, a range) is still a hand edit.
  
  Existing repos need nothing: locks written by older versions are still
  recognized.
- Updated dependencies []:
  - shoemaker-oxfmt-config@0.2.2

## 0.2.1

### Patch Changes

- [`d0cbf79`](https://github.com/EthanShoeDev/shoemaker/commit/d0cbf79e6802140a5634403e48d0350244293fe5) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - An effect-api app's HttpApi now lives in its own package,
  `packages/<api>-contract` (`@scope/<api>-contract`), with a test that the
  contract documents every endpoint. The API implements it, and clients (the
  site that serves it, a future mobile app) depend on the contract rather than
  the server. The API app no longer exports `./api`. `adopt` reads an existing
  `packages/<api>-contract` as part of the API, and an app or package can't take
  that name. `shoemaker check package-boundaries` now allows one app dependency:
  a TanStack Start site with an `src/routes/api.$.ts` route may depend on the
  API it mounts there.
  
  Existing repos (for a coding agent; `api` stands for the effect-api app's
  name, `@scope` for the repo's scope):
  
  1. Run `bun run shoemaker:sync`. It writes `packages/api-contract/`
     (`package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`,
     `test/index.test.ts`, `README.md`) and adds `@scope/api-contract` to
     `apps/api/package.json` (and to the serving site's, if any).
  2. Replace the seeded `packages/api-contract/src/index.ts` with the body of
     `apps/api/src/api.ts`, keeping any `.prefix('/api')`, then delete
     `apps/api/src/api.ts`. Update `packages/api-contract/test/index.test.ts`
     to list the API's real paths.
  3. Change every `from './api.ts'`, `from '../src/api.ts'` and
     `from '@scope/api/api'` import to `from '@scope/api-contract'`.
  4. Remove the `./api` export from `apps/api/package.json`.
  5. `bun install`, then `bunx turbo run lint:check typecheck test build`.
- Updated dependencies []:
  - shoemaker-oxfmt-config@0.2.1

## 0.2.0

### Minor Changes

- [`8799d00`](https://github.com/EthanShoeDev/shoemaker/commit/8799d00e71dd531643f87ef153189dfab614a2da) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - `init` no longer runs `bun install` (the `--install` flag is gone); the next
  steps say to run it. Alchemy Stacks can register providers apart from where
  apps deploy, including GitHub (repos, Actions secrets and variables) or none
  at all: the wizard asks which providers to use, `--alchemy-providers` adds
  them from the command line, and `infra.providers` records them in
  `shoemaker.config.ts`.

- [`8799d00`](https://github.com/EthanShoeDev/shoemaker/commit/8799d00e71dd531643f87ef153189dfab614a2da) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - `init` commits the generated files as "init via shoemaker", so the first
  commit shows exactly what shoemaker wrote. `--no-git` still skips git
  entirely; without a git identity the files are left staged.

- [`8799d00`](https://github.com/EthanShoeDev/shoemaker/commit/8799d00e71dd531643f87ef153189dfab614a2da) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - A TanStack Start app can serve an effect-api app at `/api`
  (`{ kind: 'tanstack-start', api: '<api app>' }` in `shoemaker.config.ts`).
  `init` does this by default when both are chosen; `--no-serve-api` keeps them
  apart. The site mounts the API's handlers on an `/api/$` server route and
  calls it through one typed client, `callApi`. While the server renders, the
  client reaches the API in-process; in the browser it uses same-origin
  `fetch`. `createIsomorphicFn` chooses between the two. Import protection
  blocks the API's handlers from the browser bundle, and the site deploys the
  API, so it gets no Worker of its own.
  
  Existing repos (for a coding agent; `web` and `api` stand for the app names):
  
  1. Add `api: 'api'` to the `web` app in `shoemaker.config.ts`, then run
     `bun run shoemaker:sync`. That writes `apps/web/src/api.server.ts`,
     `src/api-client.ts`, `src/routes/api.$.ts` and `test/api-client.test.ts`,
     and updates both apps' `package.json` and `apps/web/vite.config.ts`.
  2. In `apps/api/src/api.ts`, append `.prefix('/api')` to the `HttpApi`
     chain.
  3. If the repo deploys to Cloudflare: in `alchemy.run.ts`, remove the
     `./apps/api/src/worker.ts` import and the API's `yield*` and output.
     Delete `apps/api/src/worker.ts`, the `./worker` export, and the
     `@alchemy.run/cloudflare` and `alchemy` dependencies in
     `apps/api/package.json`.
  4. Optionally load data through the API in `apps/web/src/routes/index.tsx`:
     `loader: ({ abortController }) => callApi((api) => ..., { signal: abortController.signal })`.
  5. `bun install`, then `bunx turbo run lint:check typecheck test build`. The
     build regenerates `src/routeTree.gen.ts` with the `/api/$` route.

### Patch Changes

- [`8799d00`](https://github.com/EthanShoeDev/shoemaker/commit/8799d00e71dd531643f87ef153189dfab614a2da) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - Ignore `.external/` (reference repos cloned for agents to read) instead of
  `docs/cloned-repos-as-docs/`: generated repos gitignore it, and the shared
  oxlint, oxfmt and knip configs, jscpd and VS Code skip it.

- [`8799d00`](https://github.com/EthanShoeDev/shoemaker/commit/8799d00e71dd531643f87ef153189dfab614a2da) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - New repos get a `flake.lock` pinned to a known nixpkgs revision, so the first
  `nix fmt` (run by `lint:check`) or `nix develop` no longer writes one and
  leaves the fresh repo with an uncommitted file. `bun run update:nix-flake`
  moves it forward. Existing repos already have the lock nix wrote: commit it.
- Updated dependencies [[`8799d00`](https://github.com/EthanShoeDev/shoemaker/commit/8799d00e71dd531643f87ef153189dfab614a2da)]:
  - shoemaker-oxfmt-config@0.2.0

## 0.1.1

### Patch Changes

- [`ecdfb45`](https://github.com/EthanShoeDev/shoemaker/commit/ecdfb451f77bc5cfc5ba05d106561c7aea157aa1) Thanks [@EthanShoeDev](https://github.com/EthanShoeDev)! - Move to Effect 4.1.0, and pin `@effect/platform-node-shared` alongside it so
  `bunx shoemaker` no longer crashes with "Cannot find module
  'effect/crypto/Aead'" when `@effect/platform-bun`'s `^` range resolves past
  the pinned `effect`. Generated repos now get Effect 4.1.0; foldkit apps will
  not build until foldkit supports it.
- Updated dependencies []:
  - shoemaker-oxfmt-config@0.1.1
