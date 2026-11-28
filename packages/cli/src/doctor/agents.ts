import {
  Array as Arr,
  Effect,
  Option,
  Predicate,
  Record as Rec,
  Result,
  Schema,
  String as Str,
} from 'effect';
import { Yaml } from 'effect/encoding';

import {
  allDeps,
  hasDep,
  isNewerVersion,
  readWorkspace,
} from '../checks/workspace.ts';
import { parseJsonc } from '../engine/json.ts';
import {
  OPENSPEC_PACKAGE,
  openspecSkillFiles,
} from '../generators/openspec/index.ts';
import { OPENSPEC_SKILLS_VERSION } from '../generators/openspec/skills.gen.ts';
import { CLOUDFLARE_OBSERVABILITY_MCP } from '../generators/root/mcp.ts';
import { fail, listSome, manifestsOf, pass } from './shared.ts';
import type { DoctorCheck, Finding } from './types.ts';

export const agentsMd: DoctorCheck = {
  id: 'agents-md',
  description: 'AGENTS.md is canonical, CLAUDE.md is `@AGENTS.md`',
  run: Effect.fnUntraced(function* (repo) {
    const findings: Array<Finding> = [];
    const agents = yield* repo.read('AGENTS.md');
    const claude = yield* repo.read('CLAUDE.md');
    if (agents === undefined) {
      findings.push(
        fail('no AGENTS.md', {
          fix:
            claude === undefined
              ? 'add AGENTS.md (shoemaker sync renders it with the agents feature) and CLAUDE.md containing `@AGENTS.md`'
              : 'move CLAUDE.md to AGENTS.md, then make CLAUDE.md contain only `@AGENTS.md`',
        }),
      );
    }
    if (claude === undefined || Str.trim(claude) !== '@AGENTS.md') {
      findings.push(
        fail(
          claude === undefined
            ? 'no CLAUDE.md'
            : 'CLAUDE.md is not `@AGENTS.md`',
          {
            path: 'CLAUDE.md',
            fix: 'merge its content into AGENTS.md and replace it with the single line `@AGENTS.md`',
          },
        ),
      );
    }
    return findings.length > 0
      ? findings
      : [pass('AGENTS.md + CLAUDE.md -> @AGENTS.md')];
  }),
};

// Packages that mean the repo deploys Workers.
const CLOUDFLARE_DEPS = ['@alchemy.run/cloudflare', 'wrangler'];

const mcpUrls = (text: string | undefined) => {
  const config = parseJsonc(text ?? '');
  const servers = Predicate.isObject(config) ? config.mcpServers : undefined;
  return Predicate.isObject(servers)
    ? Arr.filterMap(Rec.values(servers), (server) =>
        Predicate.isObject(server) && Predicate.isString(server.url)
          ? Result.succeed(server.url)
          : Result.failVoid,
      )
    : [];
};

export const cloudflareObservabilityMcp: DoctorCheck = {
  id: 'cloudflare-observability-mcp',
  description:
    'A repo that deploys to Cloudflare gives agents the Cloudflare observability MCP server',
  run: Effect.fnUntraced(function* (repo) {
    const manifests = yield* manifestsOf(repo);
    const cloudflare = Arr.some(manifests, (manifest) =>
      Arr.some(CLOUDFLARE_DEPS, (dep) => hasDep(manifest.pkg, dep)),
    );
    if (!cloudflare) return [];
    const mcpJson = yield* repo.read('.mcp.json');
    return mcpUrls(mcpJson).includes(CLOUDFLARE_OBSERVABILITY_MCP)
      ? [pass('.mcp.json has the Cloudflare observability MCP server')]
      : [
          fail('.mcp.json lacks the Cloudflare observability MCP server', {
            path: '.mcp.json',
            fix: `shoemaker sync adds it (agents feature, Cloudflare provider), or add "cloudflare-observability": { "type": "http", "url": "${CLOUDFLARE_OBSERVABILITY_MCP}" } under mcpServers`,
          }),
        ];
  }),
};

const parseYaml = Option.liftThrowable(Yaml.parse);
const decodeProjectScope = Schema.decodeUnknownOption(
  Schema.Struct({ skillsScope: Schema.Literal('project') }),
);

// Only repos that use OpenSpec: one that doesn't should carry none of it.
export const openspec: DoctorCheck = {
  id: 'openspec',
  description:
    'A repo that uses OpenSpec pins its CLI and keeps its current skills in the repo, not the home directory',
  run: Effect.fnUntraced(function* (repo) {
    const config = yield* repo.read('openspec/config.yaml');
    if (config === undefined) return [];
    const findings: Array<Finding> = [];
    if (Option.isNone(Option.flatMap(parseYaml(config), decodeProjectScope))) {
      findings.push(
        fail('openspec/config.yaml lacks `skillsScope: project`', {
          path: 'openspec/config.yaml',
          fix: 'add `skillsScope: project`, so openspec update keeps the skills in the repo',
        }),
      );
    }
    // The dev shell runs the root's CLI. The skills sync writes may call what
    // their version added, so the CLI is at least that; one raised past it
    // stays, as any dependency does.
    const workspace = yield* readWorkspace(repo);
    const spec =
      workspace === undefined
        ? undefined
        : allDeps(workspace.root.pkg)[OPENSPEC_PACKAGE];
    const pinned =
      spec === 'catalog:' ? workspace?.catalog[OPENSPEC_PACKAGE] : spec;
    if (spec === undefined) {
      findings.push(
        fail(`${OPENSPEC_PACKAGE} is not a root dependency`, {
          path: 'package.json',
          fix: 'set features.openspec in shoemaker.config.ts and run shoemaker sync, or add it as a root devDependency',
        }),
      );
    } else if (isNewerVersion(OPENSPEC_SKILLS_VERSION, pinned ?? spec)) {
      findings.push(
        fail(
          `${OPENSPEC_PACKAGE} is ${pinned ?? spec}, older than the skills sync writes (${OPENSPEC_SKILLS_VERSION})`,
          {
            path: 'package.json',
            fix: `raise it to ${OPENSPEC_SKILLS_VERSION}; shoemaker sync does`,
          },
        ),
      );
    }
    const stale = yield* Effect.filter(
      Rec.toEntries(openspecSkillFiles),
      ([path, content]) =>
        Effect.map(
          repo.read(path),
          (text) =>
            text === undefined ||
            Str.replaceAll('\r\n', '\n')(text) !== content,
        ),
      { concurrency: 16 },
    );
    if (stale.length > 0) {
      findings.push(
        fail(
          `missing or outdated skill file(s): ${listSome(
            Arr.map(stale, ([path]) => path),
            3,
          )}`,
          {
            fix: 'set features.openspec in shoemaker.config.ts and run shoemaker sync',
          },
        ),
      );
    }
    return findings.length > 0
      ? findings
      : [pass('OpenSpec is pinned, with its skills in the repo')];
  }),
};

export const agentChecks = [agentsMd, cloudflareObservabilityMcp, openspec];
