// Moves every pin in packages/cli/src/versions.ts to npm's `latest`, keeping
// each spec's operator (exact, `^`, `~`) and each family together:
// - a shared constant (`effect`, `alchemy`, ...) follows the first package
//   that uses it;
// - the Effect family moves only when every member exists at the new version;
// - Expo packages take the ranges the new Expo SDK pins
//   (bundledNativeModules.json), as `expo install --fix` would.
// Nothing moves backwards, and specs other than plain versions are left alone.
//
//   bun scripts/update-versions.ts [--dry-run] [--changeset]
//
// The weekly update-versions workflow runs it with --changeset, then lint and
// the tests (e2e included), and opens a PR.
import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  Record as Rec,
  Schema,
  String as Str,
} from 'effect';
import { Command, Flag } from 'effect/cli';
import { HttpClient } from 'effect/http';

import { effectFamily, versions } from '../packages/cli/src/versions.ts';
import { onNpm, repoRoot } from './lib/packages.ts';
import { runScript } from './lib/run.ts';

const VERSIONS_FILE = 'packages/cli/src/versions.ts';

const SPEC = /^([~^]?)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u;

// Shared with web apps, which take npm's latest rather than Expo's pin.
const NOT_FROM_EXPO = new Set(['react', 'react-dom']);

class RegistryError extends Schema.TaggedError<
  RegistryError,
  { readonly brand: unique symbol }
>()('RegistryError', { url: Schema.String, status: Schema.Finite }) {
  override get message() {
    return `${this.url} answered ${this.status}`;
  }
}

const DistTags = Schema.Struct({ latest: Schema.String });
const NativeModules = Schema.Record(Schema.String, Schema.String);

const fetchJson = Effect.fnUntraced(function* <S extends Schema.Top>(
  url: string,
  schema: S,
) {
  const response = yield* HttpClient.get(url);
  if (response.status !== 200) {
    return yield* RegistryError.make({ url, status: response.status });
  }
  return yield* Schema.decodeEffect(schema)(yield* response.json);
});

const latestOf = (name: string) =>
  Effect.map(
    fetchJson(
      `https://registry.npmjs.org/-/package/${name}/dist-tags`,
      DistTags,
    ),
    (tags) => tags.latest,
  );

const escape = Str.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');

// `name` -> the constant its entry names (`effect,` or `'x': tanstackRouter`).
const constantsOf = (source: string) => {
  const literals = new Map(
    Arr.map(
      [...Str.matchAll(/^const (\w+) = '([^']+)';$/gmu)(source)],
      (match) => [match[1] ?? '', match[2] ?? ''] as const,
    ),
  );
  // Every entry that takes a constant's value, and each constant's first.
  const users = new Set<string>();
  const anchors = new Map<string, string>();
  for (const match of Str.matchAll(
    /^ {2}(?:'([^']+)'|([\w-]+))(?:: (\w+))?,$/gmu,
  )(source)) {
    const name = match[1] ?? match[2] ?? '';
    const constant = match[3] ?? match[2] ?? '';
    if (!literals.has(constant)) continue;
    users.add(name);
    if (!anchors.has(constant)) anchors.set(constant, name);
  }
  return { literals, users, anchors };
};

interface Change {
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

const targetSpec = (current: string, latest: string) => {
  const spec = SPEC.exec(current);
  if (spec === null) return undefined;
  const [, operator = '', version = ''] = spec;
  return Bun.semver.order(latest, version) > 0
    ? `${operator}${latest}`
    : undefined;
};

const proposeChanges = Effect.fnUntraced(function* (source: string) {
  const { literals, users, anchors } = constantsOf(source);
  const pinned: Readonly<Record<string, string>> = versions;
  // One lookup per literal entry and per constant (through its first user).
  const lookups = [
    ...Arr.filter(Rec.keys(pinned), (name) => !users.has(name)),
    ...anchors.values(),
  ];
  const latest = new Map(
    yield* Effect.forEach(
      lookups,
      (name) =>
        Effect.map(latestOf(name), (version) => [name, version] as const),
      { concurrency: 8 },
    ),
  );

  const changes: Array<Change> = [];
  const held: Array<string> = [];
  const propose = (name: string, from: string, to: string | undefined) => {
    if (to !== undefined && to !== from) changes.push({ name, from, to });
  };

  for (const [constant, value] of literals) {
    const anchor = anchors.get(constant);
    const version = anchor === undefined ? undefined : latest.get(anchor);
    if (version === undefined) continue;
    const to = targetSpec(value, version);
    if (to !== undefined && constant === 'effect') {
      const missing = yield* Effect.filter(effectFamily, (name) =>
        Effect.map(onNpm(`${name}/${version}`), (found) => !found),
      );
      if (missing.length > 0) {
        held.push(
          `effect ${version}: not yet published for ${Arr.join(missing, ', ')}`,
        );
        continue;
      }
    }
    propose(`const ${constant}`, value, to);
  }

  const expoTo = Option.match(
    Arr.findFirst(changes, (change) => change.name === 'const expoSdk'),
    { onNone: () => pinned.expo, onSome: (change) => change.to },
  );
  const expoVersion = SPEC.exec(expoTo ?? '')?.[2];
  const expoPins =
    expoVersion === undefined
      ? {}
      : yield* fetchJson(
          `https://unpkg.com/expo@${expoVersion}/bundledNativeModules.json`,
          NativeModules,
        );

  for (const [name, current] of Rec.toEntries(pinned)) {
    if (users.has(name)) continue;
    const fromExpo = NOT_FROM_EXPO.has(name) ? undefined : expoPins[name];
    if (fromExpo !== undefined) {
      propose(name, current, fromExpo);
      continue;
    }
    const version = latest.get(name);
    if (version !== undefined)
      propose(name, current, targetSpec(current, version));
  }
  return { changes, held };
});

const applyChanges = (source: string, changes: ReadonlyArray<Change>) =>
  Arr.reduce(changes, source, (text, { name, from, to }) => {
    const pattern = Str.startsWith('const ')(name)
      ? new RegExp(`^(${escape(name)} = )'${escape(from)}';$`, 'mu')
      : new RegExp(
          `^( {2}(?:'${escape(name)}'|${escape(name)}): )'${escape(from)}',$`,
          'mu',
        );
    const end = Str.startsWith('const ')(name) ? ';' : ',';
    return Str.replace(pattern, `$1'${to}'${end}`)(text);
  });

const changesetOf = (changes: ReadonlyArray<Change>) =>
  `---
'shoemaker': patch
---

Generated repos get newer dependency versions:

${Arr.join(
  Arr.map(
    changes,
    ({ name, from, to }) =>
      `- \`${Str.replace('const ', '')(name)}\`: ${from} → ${to}`,
  ),
  '\n',
)}

Existing repos: \`bun run shoemaker:sync\`, then \`bun install\`. A version the
repo already raised past these stays as it is.
`;

const updateVersions = Command.make(
  'update-versions',
  {
    dryRun: Flag.Boolean('dry-run').pipe(
      Flag.withDescription('Print the changes; write nothing'),
      Flag.withDefault(false),
    ),
    changeset: Flag.Boolean('changeset').pipe(
      Flag.withDescription('Also write a patch changeset listing the changes'),
      Flag.withDefault(false),
    ),
  },
  Effect.fnUntraced(function* ({ dryRun, changeset }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* repoRoot;
    const file = path.join(root, VERSIONS_FILE);
    const source = yield* fs.readFileString(file);
    const { changes, held } = yield* proposeChanges(source);
    for (const note of held) yield* Console.log(`held: ${note}`);
    if (changes.length === 0)
      return yield* Console.log('Every pin is on latest.');
    for (const { name, from, to } of changes) {
      yield* Console.log(`${name}: ${from} -> ${to}`);
    }
    if (dryRun) return;
    yield* fs.writeFileString(file, applyChanges(source, changes));
    if (changeset) {
      yield* fs.writeFileString(
        path.join(root, '.changeset/update-versions.md'),
        changesetOf(changes),
      );
    }
  }),
).pipe(Command.withDescription("Move versions.ts pins to npm's latest"));

runScript(Command.run(updateVersions, { version: '0.0.0' }));
