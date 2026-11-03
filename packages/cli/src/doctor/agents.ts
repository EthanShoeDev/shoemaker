import {
  Array as Arr,
  Effect,
  Predicate,
  Record as Rec,
  Result,
  String as Str,
} from 'effect';

import { hasDep, isRecord, parseJsonc } from '../checks/workspace.ts';
import { CLOUDFLARE_OBSERVABILITY_MCP } from '../generators/root/mcp.ts';
import { fail, manifestsOf, pass } from './shared.ts';
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
  const servers = isRecord(config) ? config.mcpServers : undefined;
  return isRecord(servers)
    ? Arr.filterMap(Rec.values(servers), (server) =>
        isRecord(server) && Predicate.isString(server.url)
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

export const agentChecks = [agentsMd, cloudflareObservabilityMcp];
