import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Record as Rec } from 'effect';

import type { ShoemakerConfig } from '../../../src/config/schema.ts';
import { parseJson, record, render } from '../root/fixtures.ts';
import { assertSourcesParse, sampleConfig } from './helpers.ts';

const releasing = (overrides: Partial<ShoemakerConfig> = {}) =>
  sampleConfig({
    apps: [
      {
        name: 'mobile',
        kind: 'expo',
        androidRelease: { package: 'dev.sample.mobile' },
      },
      { name: 'my-app', kind: 'expo' },
    ],
    features: { changesets: true, agents: true, vscode: true },
    ...overrides,
  });

describe('expo androidRelease', () => {
  const { files, aggregate, byPath, file } = render(releasing());

  it('renders the release helper and wraps the seed config in it', () => {
    assert.strictEqual(
      file('apps/mobile/android-release.ts').strategy,
      'owned',
    );
    const helper = file('apps/mobile/android-release.ts').content;
    assert.include(helper, "package: 'dev.sample.mobile'");
    assert.include(helper, "System.getenv('MOBILE_ANDROID_KEYSTORE_BASE64')");
    const appConfig = file('apps/mobile/app.config.ts').content;
    assert.include(appConfig, 'export default withAndroidRelease(config);');
    assert.notInclude(appConfig, 'version:');
    // Apps that did not opt in are untouched.
    assert.isFalse(byPath.has('apps/my-app/android-release.ts'));
    assert.include(
      file('apps/my-app/app.config.ts').content,
      "version: '0.0.0'",
    );
  });

  it('builds the APK in the app and loads the key through secrets at the root', () => {
    const app = record(parseJson(file('apps/mobile/package.json')).scripts);
    assert.include(app['build:apk'], './gradlew assembleRelease');
    const root = record(parseJson(file('package.json')).scripts);
    assert.strictEqual(
      root['apk:mobile'],
      'nix develop .#android --command varlock run -- bun run --cwd apps/mobile build:apk',
    );
    assert.isUndefined(root['apk:my-app']);
  });

  it('declares the signing secrets for the secrets manager', () => {
    const keys = Arr.map(
      Arr.filter(aggregate.env, (v) => v.tags?.includes('mobile') === true),
      (v) => [v.key, v.sensitive, v.required] as const,
    );
    assert.deepStrictEqual(keys, [
      ['MOBILE_ANDROID_KEYSTORE_BASE64', true, false],
      ['MOBILE_ANDROID_KEYSTORE_PASSWORD', true, false],
      ['MOBILE_ANDROID_KEY_ALIAS', false, false],
    ]);
    assert.include(
      file('.env.schema').content,
      'MOBILE_ANDROID_KEYSTORE_BASE64=',
    );
    assert.include(file('.gitignore').content, 'apps/mobile/android/');
  });

  it('tags private packages and publishes each app release from one workflow', () => {
    const changesets = parseJson(file('.changeset/config.json'));
    assert.deepStrictEqual(changesets.privatePackages, {
      version: true,
      tag: true,
    });
    const workflow = file('.github/workflows/release.yml');
    assert.strictEqual(workflow.strategy, 'owned');
    assert.include(workflow.content, 'uses: changesets/action@v2');
    assert.include(workflow.content, 'publish-script: bunx changeset git-tag');
    assert.include(workflow.content, 'create-github-releases: false');
    assert.include(workflow.content, 'select(.name == "@sample/mobile")');
    assert.include(workflow.content, '  android-mobile:');
    assert.include(
      workflow.content,
      // oxlint-disable-next-line eslint/no-template-curly-in-string -- a GitHub Actions expression is the expected output
      'MOBILE_ANDROID_KEYSTORE_BASE64: ${{ secrets.MOBILE_ANDROID_KEYSTORE_BASE64 }}',
    );
    assert.include(
      workflow.content,
      'run: nix develop .#android --command bun run --cwd apps/mobile build:apk',
    );
    assert.include(workflow.content, 'gh release create "$TAG" "$apk"');
    assert.notInclude(workflow.content, 'android-my-app');
  });

  it('wraps the local build with secretspec when that is the manager', () => {
    const { file: rendered } = render(releasing({ secrets: 'secretspec' }));
    const root = record(parseJson(rendered('package.json')).scripts);
    assert.strictEqual(
      root['apk:mobile'],
      'nix develop .#android --command secretspec run --profile production -- bun run --cwd apps/mobile build:apk',
    );
    assert.include(
      rendered('secretspec.toml').content,
      'MOBILE_ANDROID_KEYSTORE_BASE64 = {',
    );
  });

  it('adds nothing when no app opts in', () => {
    const { byPath: plain, file: rendered } = render(
      sampleConfig({
        apps: [{ name: 'mobile', kind: 'expo' }],
        features: { changesets: true, agents: true, vscode: true },
      }),
    );
    assert.isFalse(plain.has('.github/workflows/release.yml'));
    assert.isUndefined(
      parseJson(rendered('.changeset/config.json')).privatePackages,
    );
  });

  it.effect('emits TypeScript that parses', () => assertSourcesParse(files));
});

describe('android dev shell', () => {
  it('gives a repo with an Expo app the android shell, its input and its lock', () => {
    const { file } = render(
      sampleConfig({ apps: [{ name: 'mobile', kind: 'expo' }] }),
    );
    const flake = file('flake.nix').content;
    assert.include(flake, 'url = "github:tadfisher/android-nixpkgs";');
    assert.include(
      flake,
      'overlays = [bunOverlay android-nixpkgs.overlays.default];',
    );
    assert.include(
      flake,
      'android = import ./nix/android.nix {inherit pkgs default;};',
    );
    const shell = file('nix/android.nix');
    assert.strictEqual(shell.strategy, 'owned');
    assert.include(shell.content, `platforms-android-37-0`);
    assert.include(
      shell.content,
      // oxlint-disable-next-line eslint/no-template-curly-in-string -- a Nix interpolation is the expected output
      'aapt2FromMavenOverride=${root}/build-tools/37.0.0/aapt2',
    );
    const lock = parseJson(file('flake.lock'));
    assert.deepStrictEqual(Rec.keys(record(lock.nodes)), [
      'android-nixpkgs',
      'devshell',
      'flake-utils',
      'nixpkgs',
      'root',
      'systems',
    ]);
  });

  it('leaves the flake alone without an Expo app', () => {
    const { file, byPath } = render(sampleConfig());
    assert.notInclude(file('flake.nix').content, 'android');
    assert.isFalse(byPath.has('nix/android.nix'));
    assert.deepStrictEqual(
      Rec.keys(record(parseJson(file('flake.lock')).nodes)),
      ['nixpkgs', 'root'],
    );
  });
});
