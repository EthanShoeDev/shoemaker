import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Order,
  Path,
  RegExp as Regex,
  Schema,
  String as Str,
} from 'effect';

import { SKILL_ROOTS } from '../../packages/cli/src/generators/openspec/roots.ts';
import { writeJson } from './json.ts';
import { repoRoot } from './packages.ts';
import { run } from './run.ts';

const MODULE = 'packages/cli/src/generators/openspec/skills.gen.ts';
const PACKAGE = '@fission-ai/openspec';
// The root catalog's pin: this repo runs the CLI whose skills it holds.
const CATALOG_PIN = new RegExp(`("${Regex.escape(PACKAGE)}": ")\\d[^"]*"`, 'u');

const Line = Schema.fromJsonString(Schema.String);
const literal = Schema.encodeEffect(Line);

// OpenSpec 2 puts skills in the home directory unless told otherwise, and
// reads which workflows to install from there. Every home it could resolve
// points into the scratch directory, so neither can happen.
const isolated = (home: string) => ({
  HOME: home,
  USERPROFILE: home,
  CODEX_HOME: home,
  XDG_CONFIG_HOME: home,
  XDG_DATA_HOME: home,
  XDG_STATE_HOME: home,
  CI: '1',
  OPENSPEC_SKILLS_SCOPE: 'project',
  OPENSPEC_NO_UPDATE_CHECK: '1',
  OPENSPEC_TELEMETRY: '0',
});

// Skill file (relative to a skills folder) -> contents, as `openspec init`
// writes them for `version`.
const renderSkills = Effect.fnUntraced(function* (version: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const scratch = yield* fs.makeTempDirectoryScoped();
  const at = (name: string) => path.join(scratch, name);
  yield* fs.makeDirectory(at('home'));
  yield* fs.makeDirectory(at('repo'));
  yield* fs.makeDirectory(at('cli'));
  yield* writeJson(path.join(at('cli'), 'package.json'), {
    private: true,
    dependencies: { [PACKAGE]: version },
  });
  yield* run('bun', ['install'], { cwd: at('cli') });
  yield* run(
    path.join(at('cli'), 'node_modules/.bin/openspec'),
    ['init', '.', '--tools=claude', '--scope=project', '--profile=core'],
    { cwd: at('repo'), env: isolated(at('home')) },
  );
  const skills = path.join(at('repo'), '.agents/skills');
  const found = yield* fs.glob('*/**/*', { root: skills });
  const files = yield* Effect.filter(found, (file) =>
    Effect.map(
      fs.stat(path.join(skills, file)),
      (info) => info.type === 'File',
    ),
  );
  return yield* Effect.forEach(
    Arr.sort(files, Order.String),
    (file) =>
      Effect.map(
        fs.readFileString(path.join(skills, file)),
        (text) => [file, text] as const,
      ),
    { concurrency: 1 },
  );
}, Effect.scoped);

// One array entry per line, so a version bump diffs line by line.
const renderModule = Effect.fnUntraced(function* (
  version: string,
  skills: ReadonlyArray<readonly [string, string]>,
) {
  const entries = yield* Effect.forEach(
    skills,
    Effect.fnUntraced(function* ([file, text]) {
      const key = yield* literal(file);
      const lines = yield* Effect.forEach(
        Str.split(text, '\n'),
        (line) => literal(line),
        { concurrency: 1 },
      );
      const body = Arr.join(
        Arr.map(lines, (line) => `    ${line},`),
        '\n',
      );
      return `  ${key}: [\n${body}\n  ],`;
    }),
    { concurrency: 1 },
  );
  const pinned = yield* literal(version);
  return `// Written by scripts/update-openspec-skills.ts; do not edit.
// The agent skills @fission-ai/openspec installs (MIT, Fission AI Inc), by
// path inside a skills folder.
export const OPENSPEC_SKILLS_VERSION = ${pinned};

export const openspecSkills: Readonly<Record<string, ReadonlyArray<string>>> = {
${Arr.join(entries, '\n')}
};
`;
});

export const vendorOpenspecSkills = Effect.fnUntraced(function* (
  version: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* repoRoot;
  const skills = yield* renderSkills(version);
  const module = yield* renderModule(version, skills);
  yield* fs.writeFileString(path.join(root, MODULE), module);
  // This repo has no shoemaker.config.ts for `sync` to render it from.
  for (const skillRoot of SKILL_ROOTS) {
    for (const [file, text] of skills) {
      const target = path.join(root, skillRoot, file);
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      yield* fs.writeFileString(target, text);
    }
  }
  const manifest = path.join(root, 'package.json');
  const text = yield* fs.readFileString(manifest);
  yield* fs.writeFileString(
    manifest,
    Str.replace(CATALOG_PIN, `$1${version}"`)(text),
  );
  yield* run('bun', ['install', '--lockfile-only'], { cwd: root });
  yield* Console.log(`OpenSpec ${version}: ${skills.length} skill files`);
});
