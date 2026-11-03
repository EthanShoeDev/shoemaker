import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Record as Rec } from 'effect';

import type { ShoemakerConfig } from '../../../src/config/schema.ts';
import { record } from '../files.ts';
import { render } from '../root/fixtures.ts';
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
  const { files, aggregate, byPath, file, text, json } = render(releasing());

  it('renders the release helper and wraps the seed config in it', () => {
    assert.strictEqual(
      file('apps/mobile/android-release.ts').strategy,
      'owned',
    );
    const helper = text('apps/mobile/android-release.ts');
    assert.include(helper, "package: 'dev.sample.mobile'");
    assert.include(helper, "System.getenv('MOBILE_ANDROID_KEYSTORE_BASE64')");
    const appConfig = text('apps/mobile/app.config.ts');
    assert.include(appConfig, 'export default withAndroidRelease(config);');
    assert.notInclude(appConfig, 'version:');
    // Apps that did not opt in are untouched.
    assert.isFalse(byPath.has('apps/my-app/android-release.ts'));
    assert.include(text('apps/my-app/app.config.ts'), "version: '0.0.0'");
  });

  it('builds the APK in the app and loads the key through secrets at the root', () => {
    const app = record(json('apps/mobile/package.json').scripts);
    assert.include(app['build:apk'], './gradlew assembleRelease');
    const root = record(json('package.json').scripts);
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
    assert.include(text('.env.schema'), 'MOBILE_ANDROID_KEYSTORE_BASE64=');
    assert.include(text('.gitignore'), 'apps/mobile/android/');
  });

  it('tags private packages and publishes each app release from one workflow', () => {
    const changesets = json('.changeset/config.json');
    assert.deepStrictEqual(changesets.privatePackages, {
      version: true,
      tag: true,
    });
    assert.strictEqual(file('.github/workflows/release.yml').strategy, 'owned');
    const workflow = text('.github/workflows/release.yml');
    assert.include(workflow, 'uses: changesets/action@v2');
    assert.include(workflow, 'publish-script: bunx changeset git-tag');
    assert.include(workflow, 'create-github-releases: false');
    assert.include(workflow, 'select(.name == "@sample/mobile")');
    assert.include(workflow, '  android-mobile:');
    assert.include(
      workflow,
      // oxlint-disable-next-line eslint/no-template-curly-in-string -- a GitHub Actions expression is the expected output
      'MOBILE_ANDROID_KEYSTORE_BASE64: ${{ secrets.MOBILE_ANDROID_KEYSTORE_BASE64 }}',
    );
    assert.include(
      workflow,
      'run: nix develop .#android --command bun run --cwd apps/mobile build:apk',
    );
    assert.include(workflow, 'gh release create "$TAG" "$apk"');
    assert.notInclude(workflow, 'android-my-app');
  });

  it('wraps the local build with secretspec when that is the manager', () => {
    const rendered = render(releasing({ secrets: 'secretspec' }));
    const root = record(rendered.json('package.json').scripts);
    assert.strictEqual(
      root['apk:mobile'],
      'nix develop .#android --command secretspec run --profile production -- bun run --cwd apps/mobile build:apk',
    );
    assert.include(
      rendered.text('secretspec.toml'),
      'MOBILE_ANDROID_KEYSTORE_BASE64 = {',
    );
  });

  it('adds nothing when no app opts in', () => {
    const plain = render(
      sampleConfig({
        apps: [{ name: 'mobile', kind: 'expo' }],
        features: { changesets: true, agents: true, vscode: true },
      }),
    );
    assert.isFalse(plain.byPath.has('.github/workflows/release.yml'));
    assert.isUndefined(plain.json('.changeset/config.json').privatePackages);
  });

  it.effect('emits TypeScript that parses', () => assertSourcesParse(files));
});

describe('android dev shell', () => {
  it('gives a repo with an Expo app the android shell, its input and its lock', () => {
    const { file, text, json } = render(
      sampleConfig({ apps: [{ name: 'mobile', kind: 'expo' }] }),
    );
    const flake = text('flake.nix');
    assert.include(flake, 'url = "github:tadfisher/android-nixpkgs";');
    assert.include(
      flake,
      'overlays = [bunOverlay android-nixpkgs.overlays.default];',
    );
    assert.include(
      flake,
      'android = import ./nix/android.nix {inherit pkgs default;};',
    );
    assert.strictEqual(file('nix/android.nix').strategy, 'owned');
    const shell = text('nix/android.nix');
    assert.include(shell, `platforms-android-37-0`);
    assert.include(
      shell,
      // oxlint-disable-next-line eslint/no-template-curly-in-string -- a Nix interpolation is the expected output
      'aapt2FromMavenOverride=${root}/build-tools/37.0.0/aapt2',
    );
    const lock = json('flake.lock');
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
    const { text, json, byPath } = render(sampleConfig());
    assert.notInclude(text('flake.nix'), 'android');
    assert.isFalse(byPath.has('nix/android.nix'));
    assert.deepStrictEqual(Rec.keys(record(json('flake.lock').nodes)), [
      'nixpkgs',
      'root',
    ]);
  });
});
