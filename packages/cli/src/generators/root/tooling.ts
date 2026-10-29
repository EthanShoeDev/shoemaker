import {
  Array as Arr,
  Option,
  pipe,
  Record as Rec,
  String as Str,
} from 'effect';

import type { ShoeboxConfig } from '../../config/schema.ts';
import type { Generator, Renderer } from '../../engine/types.ts';
import { quote } from '../secrets/env-package.ts';
import { hasApp, json, managed, owned, region } from '../shared.ts';
import { type Workspace, workspaces } from './workspaces.ts';

// Indents every line of a block (region markers included) by `spaces`.
const indent = (text: string, spaces: number) =>
  pipe(
    text,
    Str.split('\n'),
    Arr.map((line) =>
      line === '' ? line : `${Str.repeat(spaces)(' ')}${line}`,
    ),
    Arr.join('\n'),
  );

// `key: ['a', 'b'],` inline when it fits 80 columns, else one item per line,
// as oxfmt prints it.
const tsArray = (key: string, items: ReadonlyArray<string>, depth: number) => {
  const pad = Str.repeat(depth * 2)(' ');
  const flat = `${pad}${key}: [${Arr.join(Arr.map(items, quote), ', ')}],`;
  if (flat.length <= 80) return flat;
  const lines = Arr.map(items, (item) => `${pad}  ${quote(item)},`);
  return `${pad}${key}: [\n${Arr.join(lines, '\n')}\n${pad}],`;
};

export const lintFlags = (config: ShoeboxConfig) => {
  const start = hasApp(config, 'tanstack-start');
  return {
    react: start || hasApp(config, 'expo'),
    tanstackRouter: start,
    tanstackQuery: start,
    playwright: start,
    testingLibrary: start,
    web: start || hasApp(config, 'foldkit'),
  };
};

// Tailwind v4 entry of the first TanStack Start app; oxfmt sorts classes
// against it.
export const tailwindStylesheet = (config: ShoeboxConfig) =>
  pipe(
    Arr.findFirst(config.apps, (a) => a.kind === 'tanstack-start'),
    Option.map((app) => `./apps/${app.name}/src/styles.css`),
    Option.getOrUndefined,
  );

export const oxlintConfig: Renderer = (ctx, aggregate) => {
  const flags = pipe(
    Rec.toEntries(lintFlags(ctx.config)),
    Arr.filter(([, on]) => on),
    Arr.map(([flag]) => `${flag}: true,`),
  );
  const options = Arr.join(
    [
      `scope: ${quote(ctx.config.scope)},`,
      ...flags,
      ...(aggregate.ignore.length > 0
        ? [tsArray('ignorePatterns', aggregate.ignore, 0)]
        : []),
    ],
    '\n',
  );
  return [
    managed(
      'oxlint.config.ts',
      `import { defineShoeboxConfig } from 'shoe-box-oxlint-config';

export default defineShoeboxConfig({
${indent(region('options', options), 2)}
  // Project rules: every change carries a one-line reason above it.
  rules: {},
});
`,
    ),
  ];
};

export const oxfmtConfig: Renderer = (ctx, aggregate) => {
  const stylesheet = tailwindStylesheet(ctx.config);
  const options = [
    ...(stylesheet === undefined
      ? []
      : [`tailwindStylesheet: ${quote(stylesheet)},`]),
    ...(aggregate.ignore.length > 0
      ? [tsArray('ignorePatterns', aggregate.ignore, 0)]
      : []),
  ];
  return [
    managed(
      'oxfmt.config.ts',
      `import { defineShoeboxFormat } from 'shoe-box-oxfmt-config';

export default defineShoeboxFormat({
${indent(region('options', options.length > 0 ? Arr.join(options, '\n') : '// Shared defaults only.'), 2)}
});
`,
    ),
  ];
};

// knip finds most entries through its plugins (vite, vitest, expo, tanstack)
// and package.json exports/bin; these cover the app entrypoints it can't infer.
const knipEntries = (workspace: Workspace): ReadonlyArray<string> => {
  switch (workspace.kind) {
    case 'tanstack-start': {
      return ['src/router.tsx', 'src/routes/**/*.{ts,tsx}', 'src/server.ts'];
    }
    case 'foldkit': {
      return ['src/main.ts'];
    }
    case 'expo': {
      return ['src/app/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'];
    }
    case 'effect-api': {
      return ['src/main.ts', 'src/server.ts'];
    }
    case 'effect-cli': {
      return ['src/bin.ts', 'src/main.ts'];
    }
    case 'infra': {
      return ['alchemy.run.ts'];
    }
    case 'library':
    case 'env': {
      return [];
    }
  }
};

// Dependencies a workspace uses only through a tool knip has no plugin for,
// each with the comment the generated knip.ts carries above it.
const knipUnseen = (
  workspace: Workspace,
):
  | { readonly why: string; readonly names: ReadonlyArray<string> }
  | undefined =>
  workspace.kind === 'foldkit'
    ? {
        why: "Loaded by @foldkit/vite-plugin's devtools overlay; nothing imports it.",
        names: ['@foldkit/devtools'],
      }
    : undefined;

const knipWorkspace = (workspace: Workspace) => {
  const entry = knipEntries(workspace);
  const unseen = knipUnseen(workspace);
  const lines = [
    ...(entry.length > 0 ? [tsArray('entry', entry, 2)] : []),
    ...(unseen === undefined
      ? []
      : [
          `    // ${unseen.why}`,
          tsArray('ignoreDependencies', unseen.names, 2),
        ]),
  ];
  return lines.length === 0
    ? []
    : [`  ${quote(workspace.dir)}: {\n${Arr.join(lines, '\n')}\n  },`];
};

export const knipConfig: Renderer = (ctx, aggregate) => {
  const unseen = [
    'bun-types',
    ...(ctx.config.taskRunner === 'turbo' ? ['turbo'] : []),
  ];
  const body = Arr.join(
    [
      ...(aggregate.ignore.length > 0
        ? [tsArray('ignore', aggregate.ignore, 0)]
        : []),
      '// Used outside what knip can trace: bun-types only through the shared',
      "// tsconfig's `types`, the task runner only through `bunx`.",
      tsArray('ignoreDependencies', unseen, 0),
      'workspaces: {',
      "  '.': { entry: ['*.ts'] },",
      ...Arr.flatMap(workspaces(ctx, aggregate), knipWorkspace),
      '},',
    ],
    '\n',
  );
  return [
    managed(
      'knip.ts',
      `import { defineKnipConfig } from 'shoe-box-knip-config';

export default defineKnipConfig({
${indent(region('workspaces', body), 2)}
});
`,
    ),
  ];
};

const jscpdIgnore = [
  '**/package.json',
  '**/bun.lock',
  '**/dist/**',
  '**/node_modules/**',
  '**/.turbo/**',
  '**/.nx/**',
  '**/.output/**',
  '**/.nitro/**',
  '**/.vite/**',
  '**/.tanstack/**',
  '**/.expo/**',
  '**/.alchemy/**',
  '**/.direnv/**',
  '**/coverage/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '**/android/**',
  '**/ios/**',
  '**/*.svg',
  '**/*.gen.*',
  '**/generated/**',
  '**/vendor/**',
  '**/.agents/**',
  '**/.claude/**',
  '**/.github/**',
  '**/.changeset/**',
  '**/docs/cloned-repos-as-docs/**',
  '**/README.md',
  '**/AGENTS.md',
  '**/CLAUDE.md',
];

export const jscpdConfig: Renderer = (_ctx, aggregate) => [
  owned(
    '.jscpd.json',
    json({
      pattern: '**/*',
      ignore: [
        ...new Set([
          ...jscpdIgnore,
          ...Arr.map(aggregate.ignore, (glob) =>
            Str.startsWith('**/')(glob) ? glob : `**/${glob}`,
          ),
        ]),
      ],
      threshold: 0,
      minTokens: 50,
      minLines: 33,
      maxLines: 1000,
      maxSize: '100kb',
    }),
  ),
];

export const rootTsconfig: Generator = () => ({
  files: [
    owned(
      'tsconfig.json',
      `{
  "extends": "shoe-box-typescript-config/tsconfig.base.json",
  // Root config files default-export objects typed by tool packages, which
  // declaration emit cannot name; nothing here is published.
  "compilerOptions": {
    "declaration": false,
    "declarationMap": false
  },
  // Every package has its own tsconfig; this one covers the root-level
  // config files only.
  "include": ["*.ts"]
}
`,
    ),
  ],
});

// Every workspace shoebox generates carries a test dir, so each is a project.
export const vitestConfig: Renderer = (ctx, aggregate) => {
  const projects = Arr.map(workspaces(ctx, aggregate), (w) => w.dir);
  return [
    owned(
      'vitest.config.ts',
      `import { defineConfig } from 'vitest/config';

// \`bun run test\` at the root runs every package as one Vitest Projects run;
// CI's per-package \`test\` tasks run the same projects one at a time.
export default defineConfig({
  test: {
${tsArray('projects', projects, 2)}
  },
});
`,
    ),
  ];
};

const BUNFIG = `# Force a hoisted node_modules layout (one physical copy per package version)
# instead of bun's default isolated linker, which installs a package once per
# peer-dependency context under node_modules/.bun/.
#
# Expo needs it: className styling libraries (Uniwind) redirect user-code
# \`react-native\` imports to their own wrapper, whose \`require('react-native')\`
# resolves to a DIFFERENT physical copy under the isolated linker. React
# Native's NativeModules singletons then recurse across the two copies
# (RangeError: Maximum call stack size exceeded) at runtime.
# @see https://github.com/nativewind/react-native-css/issues/256
[install]
linker = "hoisted"
`;

export const bunfig: Generator = (ctx) => ({
  files: hasApp(ctx.config, 'expo') ? [owned('bunfig.toml', BUNFIG)] : [],
});
