---
'shoemaker': patch
---

Repos with the agents feature get a `.mcp.json` of project MCP servers. When
the alchemy Stack registers the Cloudflare provider, it holds Cloudflare's
observability server (`https://observability.mcp.cloudflare.com/mcp`), which
signs in with OAuth, so no credential is committed. Sync merges its servers
into the file, so servers added by hand stay. `doctor` reports a repo that
depends on `@alchemy.run/cloudflare` or `wrangler` without that server.

An existing repo picks it up on the next `sync`. If it already has a
`.mcp.json`, sync reports it as untracked; `bunx shoemaker sync --force
.mcp.json` merges the server in and keeps the others.
