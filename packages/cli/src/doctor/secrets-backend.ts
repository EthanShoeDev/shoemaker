import {
  Array as Arr,
  Effect,
  Option,
  Order,
  pipe,
  Predicate,
  Record as Rec,
  Result,
  String as Str,
} from 'effect';
import { Toml } from 'effect/encoding';

import type { Repo } from '../engine/repo.ts';
import { SECRETS_FILES } from './security.ts';
import { fail, globAll, listSome, manifestsOf, pass } from './shared.ts';
import type { DoctorCheck, Finding } from './types.ts';

// Secret values live in a remote store. A file on one machine is lost with it,
// shared by copy-paste and readable by anything that runs there, gitignored or
// not. The one exception is the credential that opens the store.

// varlock plugins that read this machine, or store nothing. Any other plugin
// counts as remote.
const LOCAL_PLUGINS = /^@varlock\/(?:keepass|pass|effect|aws-sigv4)-plugin\b/u;
// secretspec providers that keep values on this machine or in the repo.
const LOCAL_PROVIDERS = new Set([
  'age',
  'dotenv',
  'ejson',
  'file',
  'gopass',
  'kdbx',
  'keyring',
  'pass',
  'sops',
  'systemd-credential',
]);
// Neither store anything: `env` is how CI hands secrets in.
const NEUTRAL_PROVIDERS = new Set(['env', 'null']);

const VARLOCK_FIX =
  'load them through a remote varlock plugin; for a private repo that is Infisical, set up as the comment at the top of .env.schema shows';
const SECRETSPEC_FIX =
  'point every profile at a remote provider; for a private repo that is Infisical, set up as the comment at the top of secretspec.toml shows';

const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_]\w*)\s*=(.*)$/u;
// Where a comment starts inside a decorator line: `#` then a space or nothing.
const EXTRA_COMMENT = /(?:^|\s)#(?=\s|$)/u;

interface Item {
  readonly key: string;
  readonly value: string;
  // The decorators attached to it, as varlock attaches them.
  readonly decorators: string;
}

const beforeComment = (text: string) => {
  const found = EXTRA_COMMENT.exec(text);
  return found === null ? text : Str.slice(0, found.index)(text);
};

const count = (text: string, pattern: RegExp) =>
  Arr.fromIterable(Str.matchAll(pattern)(text)).length;

const depth = (text: string) =>
  count(text, /[([{]/gu) - count(text, /[)\]}]/gu);

const commentContent = (line: string) => Str.trimStart(Str.slice(1)(line));

// The env-spec reading of a dotenv file. A comment line counts for its
// decorators only when it starts with one, and a blank line or a `# ---`
// divider ends what attaches to the next item. `header` holds the decorators
// above the first item.
const envSpec = (text: string) => {
  const lines = Arr.map(Str.split(text, '\n'), Str.trim);
  const items: Array<Item> = [];
  const header: Array<string> = [];
  let attached: Array<string> = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const match = ASSIGNMENT.exec(line);
    if (match?.[1] !== undefined) {
      const rest = match[2] ?? '';
      const after = /(?:^|\s)#\s*(@.*)$/u.exec(rest)?.[1];
      items.push({
        key: match[1],
        value: Str.trim(rest),
        decorators: Arr.join(
          after === undefined ? attached : [...attached, beforeComment(after)],
          ' ',
        ),
      });
      attached = [];
      continue;
    }
    if (!Str.startsWith('#')(line)) {
      attached = [];
      continue;
    }
    const content = commentContent(line);
    if (/^(?:---|===)/u.test(content)) {
      attached = [];
      continue;
    }
    if (!Str.startsWith('@')(content)) continue;
    // A call or literal left open goes on over the `#` lines below it.
    let decorator = beforeComment(content);
    let open = depth(decorator);
    while (open > 0 && Str.startsWith('#')(lines[index + 1] ?? '')) {
      index++;
      const next = beforeComment(commentContent(lines[index] ?? ''));
      decorator = `${decorator} ${next}`;
      open += depth(next);
    }
    attached.push(decorator);
    if (items.length === 0) header.push(decorator);
  }
  return { items, header: Arr.join(header, ' ') };
};

const captures = (text: string, pattern: RegExp) =>
  pipe(
    Arr.fromIterable(Str.matchAll(pattern)(text)),
    Arr.map((match) => match[1] ?? ''),
  );

const varlockSchema = (text: string) => {
  const { items, header } = envSpec(text);
  // varlock treats every item as sensitive unless the schema says otherwise.
  const byDefault = !/(?:^|\s)@defaultSensitive=false\b/u.test(header);
  const sensitive = pipe(
    items,
    Arr.filter(({ decorators }) => {
      if (/@public\b|@sensitive=false\b/u.test(decorators)) return false;
      return byDefault || /@sensitive\b/u.test(decorators);
    }),
    Arr.map((item) => item.key),
  );
  return {
    declared: Arr.map(items, (item) => item.key),
    sensitive,
    plugins: captures(header, /@plugin\(\s*["']?([^\s"')]+)/gu),
    // What the plugins are initialised with.
    initialisedWith: captures(
      Arr.join(
        captures(header, /@init\w+\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gu),
        ' ',
      ),
      /\$\{?(\w+)/gu,
    ),
  };
};

const strings = (value: unknown) =>
  Arr.isArray(value) ? Arr.filter(value, Predicate.isString) : [];

const table = (value: unknown): Readonly<Record<string, unknown>> =>
  Predicate.isObject(value) ? value : {};

// `undefined` when the file is not valid TOML.
const secretspecManifest = (text: string) => {
  const parsed = Toml.parse(text);
  if (Result.isFailure(parsed)) return undefined;
  const manifest = parsed.success;
  const aliases = table(manifest.providers);
  const profiles = Rec.map(table(manifest.profiles), table);

  // The provider scheme behind an alias, a provider name or a URI.
  const schemes = (
    entry: string,
    seen: ReadonlyArray<string> = [],
  ): Array<string> => {
    const alias = aliases[entry];
    if (alias === undefined || seen.includes(entry))
      return [Str.split(entry, ':')[0]];
    if (Predicate.isString(alias)) return [Str.split(alias, ':')[0]];
    const { uri, fallback } = table(alias);
    return Arr.flatMap(
      Predicate.isString(uri) ? [uri] : strings(fallback),
      (next) => schemes(next, [...seen, entry]),
    );
  };

  // A profile inherits the default profile's secrets, but not its provider
  // chain: that comes from the secret, the active profile, then the project.
  const project = strings(table(manifest.defaults).providers);
  const shared = Rec.remove(profiles.default ?? {}, 'defaults');
  const secrets = Arr.flatMap(Rec.toEntries(profiles), ([, entries]) => {
    const defaults = table(entries.defaults);
    const declared = Rec.remove(entries, 'defaults');
    const all =
      defaults.inherit === false ? declared : { ...shared, ...declared };
    return pipe(
      Rec.keys(all),
      Arr.map((key) => ({
        key,
        secret: {
          ...(defaults.inherit === false ? {} : table(shared[key])),
          ...table(declared[key]),
        },
      })),
      Arr.filter(({ secret }) => secret.default === undefined),
      Arr.map(({ key, secret }) => ({
        key,
        schemes: pipe(
          [strings(secret.providers), strings(defaults.providers), project],
          Arr.findFirst((chain) => chain.length > 0),
          Option.getOrElse((): Array<string> => []),
          Arr.flatMap((entry) => schemes(entry)),
        ),
      })),
    );
  });
  return { secrets };
};

const named = (keys: ReadonlyArray<string>) => listSome(Arr.dedupe(keys), 5);

const secretspecFindings = (
  path: string,
  manifest: ReturnType<typeof secretspecManifest>,
) => {
  if (manifest === undefined)
    return [fail(`${path} is not valid TOML`, { path })];
  const local = Arr.filter(manifest.secrets, (secret) =>
    Arr.some(secret.schemes, (scheme) => LOCAL_PROVIDERS.has(scheme)),
  );
  const missing = Arr.filter(
    manifest.secrets,
    (secret) =>
      !local.includes(secret) &&
      Arr.every(secret.schemes, (scheme) => NEUTRAL_PROVIDERS.has(scheme)),
  );
  const findings: Array<Finding> = [];
  if (local.length > 0) {
    const used = pipe(
      Arr.flatMap(local, (secret) => secret.schemes),
      Arr.filter((scheme) => LOCAL_PROVIDERS.has(scheme)),
    );
    findings.push(
      fail(
        `${path} keeps secrets in a local provider (${named(used)}): ${named(Arr.map(local, (s) => s.key))}`,
        { path, fix: SECRETSPEC_FIX },
      ),
    );
  }
  if (missing.length > 0)
    findings.push(
      fail(
        `${path} names no remote provider, so each machine's own default decides where these live: ${named(Arr.map(missing, (s) => s.key))}`,
        { path, fix: SECRETSPEC_FIX },
      ),
    );
  return findings;
};

const DOTENV = Arr.flatMap(
  // Not `.env.test`: what tests run with is fake.
  ['', '.development', '.staging', '.production'],
  (stage) => [`.env${stage}`, `.env${stage}.local`],
);

const dirOf = (path: string) =>
  Str.includes('/')(path) ? Str.replace(/\/[^/]*$/u, '')(path) : '';

// Secrets with a value in a dotenv file. Read by path, because `repo.glob`
// skips what git ignores. Findings name keys, never values.
const dotenvFindings = Effect.fnUntraced(function* (
  repo: Repo,
  schemas: ReadonlyArray<string>,
  secrets: ReadonlySet<string>,
  bootstrap: ReadonlySet<string>,
) {
  const manifests = yield* manifestsOf(repo);
  const dirs = Arr.dedupe([
    '',
    ...Arr.map(schemas, dirOf),
    ...Arr.map(manifests, (manifest) => manifest.dir),
  ]);
  const findings: Array<Finding> = [];
  for (const dir of dirs) {
    for (const file of DOTENV) {
      const path = dir === '' || dir === '.' ? file : `${dir}/${file}`;
      const text = yield* repo.read(path);
      if (text === undefined) continue;
      const held = pipe(
        envSpec(text).items,
        Arr.filter(({ key, value }) => {
          if (/^(?:#.*|""|'')?$/u.test(value)) return false;
          const resolver = /^(\w+)\(/u.exec(value)?.[1];
          const onDevice = resolver === 'varlock' || resolver === 'keychain';
          if (bootstrap.has(key)) return resolver === undefined;
          return secrets.has(key) && (resolver === undefined || onDevice);
        }),
        Arr.map((item) => item.key),
      );
      const keys = Arr.filter(held, (key) => !bootstrap.has(key));
      const opening = Arr.filter(held, (key) => bootstrap.has(key));
      if (keys.length > 0)
        findings.push(
          fail(`${path} holds secrets: ${named(keys)}`, {
            path,
            fix: 'move each value to the remote store and delete it from the file; gitignored is not enough',
          }),
        );
      if (opening.length > 0)
        findings.push(
          fail(
            `${path} holds the store's own credential in plaintext: ${named(opening)}`,
            {
              path,
              fix: `set it in the environment, or run \`bunx varlock encrypt --file ${path}\` to bind it to this device`,
            },
          ),
        );
    }
  }
  return findings;
});

export const secretsBackend: DoctorCheck = {
  id: 'secrets-backend',
  description:
    'Secret values live in a remote store, never in a local file, even a gitignored one',
  run: Effect.fnUntraced(function* (repo) {
    const paths = yield* globAll(repo, SECRETS_FILES);
    const files = yield* Effect.forEach(
      paths,
      (path) =>
        Effect.map(repo.read(path), (text) => ({ path, text: text ?? '' })),
      { concurrency: 1 },
    );
    const [schemas, manifests] = Arr.partition(files, ({ path, text }) =>
      Str.endsWith('.env.schema')(path)
        ? Result.succeed({ path, ...varlockSchema(text) })
        : Result.fail({ path, manifest: secretspecManifest(text) }),
    );
    const items = new Set(Arr.flatMap(schemas, (s) => s.declared));
    const sensitiveKeys = new Set(Arr.flatMap(schemas, (s) => s.sensitive));
    // The credential that opens the store: what a plugin is initialised with,
    // unless the schema declares it not sensitive (`APP_ENV`).
    const bootstrap = new Set(
      Arr.filter(
        Arr.flatMap(schemas, (s) => s.initialisedWith),
        (key) => sensitiveKeys.has(key) || !items.has(key),
      ),
    );
    const sensitive = Arr.filter(
      [...sensitiveKeys],
      (key) => !bootstrap.has(key),
    );
    // A nested schema imports the root's, plugins included.
    const remote = Arr.some(schemas, (schema) =>
      Arr.some(schema.plugins, (plugin) => !LOCAL_PLUGINS.test(plugin)),
    );
    const declared = Arr.flatMap(manifests, ({ manifest }) =>
      Arr.map(manifest?.secrets ?? [], (s) => s.key),
    );
    const findings: Array<Finding> = [
      ...(sensitive.length > 0 && !remote
        ? [
            fail(
              `varlock has no remote plugin for ${named(Arr.sort(sensitive, Order.String))}`,
              { fix: VARLOCK_FIX },
            ),
          ]
        : []),
      ...Arr.flatMap(manifests, ({ path, manifest }) =>
        secretspecFindings(path, manifest),
      ),
      ...(yield* dotenvFindings(
        repo,
        paths,
        new Set([...sensitive, ...declared]),
        bootstrap,
      )),
    ];
    if (findings.length > 0) return findings;
    return [
      pass(
        sensitive.length + declared.length === 0
          ? 'declares no secrets'
          : 'secrets come from a remote store',
      ),
    ];
  }),
};
