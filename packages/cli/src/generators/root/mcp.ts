import { Record as Rec } from 'effect';

import type { ShoemakerConfig } from '../../config/schema.ts';
import type { Generator } from '../../engine/types.ts';
import { alchemyProviders } from '../infra/target.ts';
import { json } from '../shared.ts';

// Workers logs, traces and metrics for the account the Stack deploys to. It
// signs in with OAuth on first use, so the config carries no credential.
// https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/
export const CLOUDFLARE_OBSERVABILITY_MCP =
  'https://observability.mcp.cloudflare.com/mcp';

interface McpServer {
  readonly type: 'http';
  readonly url: string;
}

// The project MCP servers coding agents get, keyed by server name.
const mcpServers = (config: ShoemakerConfig) => {
  const servers: Record<string, McpServer> = {};
  if (alchemyProviders(config).includes('cloudflare')) {
    servers['cloudflare-observability'] = {
      type: 'http',
      url: CLOUDFLARE_OBSERVABILITY_MCP,
    };
  }
  return servers;
};

// json-merge, so servers added by hand sit beside shoemaker's and survive
// sync.
export const mcpConfig: Generator = (ctx) => {
  const servers = mcpServers(ctx.config);
  return ctx.config.features.agents && !Rec.isEmptyRecord(servers)
    ? {
        files: [
          {
            path: '.mcp.json',
            strategy: 'json-merge',
            content: json({ mcpServers: servers }),
          },
        ],
      }
    : {};
};
