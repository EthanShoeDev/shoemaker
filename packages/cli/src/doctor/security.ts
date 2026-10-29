import {
  Array as Arr,
  Effect,
  Option,
  Order,
  pipe,
  Predicate,
  Record as Rec,
  String as Str,
} from 'effect';

import { isGitignored, sourceFiles } from '../checks/sources.ts';
import { isRecord, parseJsonc } from '../checks/workspace.ts';
import type { Repo } from '../engine/repo.ts';
import { fail, globAll, listSome, pass } from './shared.ts';
import type { DoctorCheck, Finding } from './types.ts';

const MCP_FILES = [
  '**/.mcp.json',
  '.cursor/mcp.json',
  '.vscode/mcp.json',
  'opencode.json',
  'opencode.jsonc',
];

// Interpolations (`${VAR}`, `${env:VAR}`, `$VAR`, `{env:VAR}`) are references,
// not secrets.
const REFERENCE = /^\$\{?[\w:.-]+\}?$|\$\{[^}]+\}|\{env:[^}]+\}/u;
// A path to a credentials file is not the credential.
const FILE_PATH = /^(?:~|\.{1,2})?\/|\.(?:json|pem|key|p12)$/u;
const TOKEN_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{20,}/u,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/u,
  /\bgithub_pat_\w{20,}/u,
  /\bxox[abprs]-[\w-]{10,}/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bglpat-[\w-]{20,}/u,
  /\bsntrys_[\w-]{20,}/u,
];
const SECRET_KEY =
  /token|secret|api[-_]?key|password|passwd|auth|credential|bearer/iu;
const SECRET_FLAG = /^--?[\w-]*(?:token|secret|key|password)[\w-]*=(.+)$/iu;

// Returns why a string looks like a literal secret, never the value itself.
export const secretKind = (key: string, value: string) => {
  const bearer = /^(?:Bearer|Basic|Token)\s+(\S+)/iu.exec(value);
  if (bearer?.[1] !== undefined) {
    return REFERENCE.test(bearer[1]) ? undefined : 'a literal bearer token';
  }
  if (Arr.some(TOKEN_SHAPES, (shape) => shape.test(value))) return 'an API key';
  const flag = SECRET_FLAG.exec(value);
  if (
    flag?.[1] !== undefined &&
    !REFERENCE.test(flag[1]) &&
    flag[1].length >= 8
  ) {
    return 'a secret in a CLI argument';
  }
  if (
    SECRET_KEY.test(key) &&
    value.length >= 12 &&
    !REFERENCE.test(value) &&
    !FILE_PATH.test(value) &&
    !/^https?:\/\//u.test(value) &&
    !/\s/u.test(value)
  ) {
    return 'a literal credential';
  }
  return undefined;
};

const findSecrets = (
  value: unknown,
  path: ReadonlyArray<string>,
): Array<string> => {
  if (Predicate.isString(value)) {
    const kind = secretKind(path.at(-1) ?? '', value);
    return kind === undefined
      ? []
      : [`${Arr.join(path, '.')} contains ${kind}`];
  }
  if (Arr.isArray(value))
    return Arr.flatMap(value, (item, index) =>
      findSecrets(item, [...path, String(index)]),
    );
  if (isRecord(value)) {
    return Arr.flatMap(Rec.toEntries(value), ([key, item]) =>
      findSecrets(item, [...path, key]),
    );
  }
  return [];
};

export const mcpSecrets: DoctorCheck = {
  id: 'mcp-secrets',
  description: 'MCP configs contain no literal bearer tokens or API keys',
  run: Effect.fnUntraced(function* (repo) {
    const gitignore = yield* repo.read('.gitignore');
    const findings: Array<Finding> = [];
    for (const path of yield* globAll(repo, MCP_FILES)) {
      const hits = findSecrets(parseJsonc((yield* repo.read(path)) ?? ''), []);
      if (hits.length === 0) continue;
      const name = Arr.lastNonEmpty(Str.split(path, '/'));
      findings.push(
        isGitignored(gitignore, path) || isGitignored(gitignore, name)
          ? pass(
              `${path} has literal secrets but is gitignored (${listSome(hits, 3)})`,
              path,
            )
          : fail(`SECURITY: ${path} is committed with ${listSome(hits, 3)}`, {
              path,
              fix: 'rotate the credential now (it is in git history), then reference an environment variable instead, loaded by the secrets manager',
            }),
      );
    }
    return findings.length > 0
      ? findings
      : [pass('no literal secrets in MCP configs')];
  }),
};

const ENV_USE = /\bprocess\.env\b|\bimport\.meta\.env\b|\bBun\.env\b/u;
const RAW_ENV = /\bprocess\.env\b|\bBun\.env\b/gu;
// The env package is the one place allowed to read the environment; tool
// configs run outside the app and read it legitimately.
// Tests, scripts and lint plugins are not app code either.
const ENV_ALLOWED =
  /(?:^|\/)(?:env|scripts|test|tests|e2e|__tests__|oxlint-plugins|oxlint-config)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)[\w.-]+\.config\.[cm]?[jt]s$|(?:^|\/)alchemy\.run\.ts$/u;
const MAX_FILES = 3000;

const nested = (file: string) => [file, `apps/*/${file}`, `packages/*/${file}`];
export const SECRETS_FILES = [
  ...nested('.env.schema'),
  ...nested('secretspec.toml'),
];
const DOTENV_FILES = Arr.flatMap(
  ['.env', '.env.example', '.env.local'],
  (file) => nested(file),
);

const envUsage = Effect.fnUntraced(function* (repo: Repo) {
  const files = (yield* sourceFiles(repo)).slice(0, MAX_FILES);
  const raw: Array<{ file: string; count: number }> = [];
  let any = false;
  for (const file of files) {
    const source = yield* repo.read(file);
    if (source === undefined || !ENV_USE.test(source)) continue;
    any = true;
    if (ENV_ALLOWED.test(file)) continue;
    const count = pipe(
      Str.match(RAW_ENV)(source),
      Option.map((matches) => matches.length),
      Option.getOrElse(() => 0),
    );
    if (count > 0) raw.push({ file, count });
  }
  return { any, raw, truncated: files.length === MAX_FILES };
});

export const secretsManager: DoctorCheck = {
  id: 'secrets-manager',
  description:
    'A secrets manager (varlock .env.schema or secretspec.toml) when the repo reads env',
  run: Effect.fnUntraced(function* (repo) {
    const managed = yield* globAll(repo, SECRETS_FILES);
    if (managed.length > 0)
      return [pass(`secrets: ${Arr.join(managed, ', ')}`)];
    const { any } = yield* envUsage(repo);
    const dotenv = yield* globAll(repo, DOTENV_FILES);
    return any || dotenv.length > 0
      ? [
          fail('reads env but has no secrets manager', {
            fix: 'adopt varlock (.env.schema + generated @scope/env package) or secretspec.toml',
          }),
        ]
      : [pass('no env usage')];
  }),
};

const SHOWN = 8;

export const rawEnvAccess: DoctorCheck = {
  id: 'raw-env-access',
  description: 'No raw process.env outside the env package (heuristic scan)',
  run: Effect.fnUntraced(function* (repo) {
    const { raw, truncated } = yield* envUsage(repo);
    if (raw.length === 0)
      return [pass('no raw process.env outside env/config files')];
    const total = Arr.reduce(raw, 0, (sum, entry) => sum + entry.count);
    const top = Arr.map(
      Arr.sort(
        raw,
        Order.flip(
          Order.mapInput(Order.Number, (e: { count: number }) => e.count),
        ),
      ).slice(0, SHOWN),
      (e) => `${e.file} (${e.count})`,
    );
    return [
      fail(
        `${total} raw process.env/Bun.env reads in ${raw.length} file(s)${truncated ? ` (first ${MAX_FILES} files scanned)` : ''}: ${listSome(top, SHOWN)}`,
        {
          fix: 'read env through the generated @scope/env package (Effect Config); no-raw-env-access enforces it',
        },
      ),
    ];
  }),
};

export const securityChecks = [mcpSecrets, secretsManager, rawEnvAccess];
