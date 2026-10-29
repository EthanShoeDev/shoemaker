import { Array as Arr } from 'effect';

import type { App } from '../../config/schema.ts';
import type { Contribution, GenContext } from '../../engine/types.ts';
import { json, owned, seed, workspacePackageJson } from '../shared.ts';
import {
  appDir,
  catalogOf,
  forApps,
  toolchainDevDependencies,
  vitestConfig,
} from './common.ts';

// expo-router's required peers for a JS-only app; `expo install --fix` owns
// the exact native versions within the SDK.
const dependencies = [
  'expo',
  'expo-constants',
  'expo-linking',
  'expo-router',
  // Applies `userInterfaceStyle` on Android.
  'expo-system-ui',
  'react',
  'react-native',
  'react-native-safe-area-context',
  'react-native-screens',
];
const devDependencies = [...toolchainDevDependencies, '@types/react'];

const appConfig = (app: App) => `import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: '${app.name}',
  slug: '${app.name}',
  scheme: '${app.name}',
  version: '0.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  // OTA updates need expo-updates and an EAS project; turn this on with both.
  updates: { enabled: false },
  plugins: ['expo-router'],
  experiments: { typedRoutes: true },
};

export default config;
`;

// Expo compiles TS metro configs to CommonJS, so \`__dirname\` (not
// \`import.meta\`) is what exists at load time. The default config already
// handles bun workspaces and package exports.
const metroConfig = `import { getDefaultConfig } from 'expo/metro-config';

// oxlint-disable-next-line unicorn/prefer-module -- Expo compiles this file to CommonJS; import.meta would make Node reload it as ESM and fail
export default getDefaultConfig(__dirname);
`;

const layoutSource = `import { Stack } from 'expo-router';

const RootLayout = () => <Stack />;

export default RootLayout;
`;

const indexSource = `import { Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { greeting } from '../src/greeting.ts';

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '600' },
});

const Home = () => (
  <View style={styles.container}>
    <Stack.Screen options={{ title: 'Home' }} />
    <Text style={styles.title}>{greeting('world')}</Text>
  </View>
);

export default Home;
`;

const greetingSource = `export const greeting = (name: string) => \`Hello, \${name}!\`;
`;

const testSource = `import { describe, expect, it } from 'vitest';

import { greeting } from '../src/greeting.ts';

describe('greeting', () => {
  it('greets by name', () => {
    expect(greeting('Ada')).toBe('Hello, Ada!');
  });
});
`;

// Expo's base config is the one RN type resolution needs (`react-native`
// export condition, `module: preserve`), so it replaces the shared base; the
// strictness flags shoemaker cares about are restated on top of it.
const tsconfig = (dir: string) =>
  owned(
    `${dir}/tsconfig.json`,
    json({
      extends: 'expo/tsconfig.base',
      compilerOptions: {
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
        noUnusedLocals: true,
        noFallthroughCasesInSwitch: true,
        verbatimModuleSyntax: true,
        allowImportingTsExtensions: true,
        types: ['node'],
      },
      include: [
        '**/*.ts',
        '**/*.tsx',
        '*.mts',
        '.expo/types/**/*.ts',
        'expo-env.d.ts',
      ],
    }),
  );

export const expoApp = (ctx: GenContext, app: App): Contribution => {
  const dir = appDir(app);
  return {
    files: [
      workspacePackageJson(ctx, {
        dir,
        name: app.name,
        // Metro and the Expo CLI load this package as CommonJS.
        module: false,
        sharedTsconfig: false,
        scripts: {
          dev: 'expo start',
          ios: 'expo start --ios',
          android: 'expo start --android',
          clean: 'rm -rf .expo .turbo',
        },
        dependencies,
        devDependencies,
        extra: { main: 'expo-router/entry' },
      }),
      tsconfig(dir),
      vitestConfig(dir, { extension: 'mts' }),
      owned(`${dir}/metro.config.ts`, metroConfig),
      seed(`${dir}/app.config.ts`, appConfig(app)),
      seed(`${dir}/app/_layout.tsx`, layoutSource),
      seed(`${dir}/app/index.tsx`, indexSource),
      seed(`${dir}/src/greeting.ts`, greetingSource),
      seed(`${dir}/test/greeting.test.ts`, testSource),
      seed(
        `${dir}/README.md`,
        `# ${ctx.pkg(app.name)}\n\nExpo Router app. \`bun run dev\` starts Metro; \`bun run ios\` / \`bun run android\` open a simulator.\n`,
      ),
    ],
    tasks: Arr.map(['ios', 'android'], (name) => ({
      name,
      package: ctx.pkg(app.name),
      persistent: true,
      cache: false,
    })),
    catalog: catalogOf(dependencies, devDependencies),
    gitignore: ['.expo/', 'expo-env.d.ts'],
  };
};

export const expoGenerator = forApps('expo', expoApp);
