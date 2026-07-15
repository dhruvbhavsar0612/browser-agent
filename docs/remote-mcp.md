# Remote MCP client

Browser Agent supports remote MCP servers from MV3 without a stdio path.

## Architecture

- `packages/core/src/mcp/registry.ts` owns lazy SDK clients, Streamable HTTP with compatible SSE
  fallback, discovery caching, bounded calls/resources, health errors, and idle shutdown.
- `packages/core/src/mcp/oauth.ts` implements the SDK `OAuthClientProvider`. Protected-resource
  metadata, authorization-server metadata, dynamic registration, PKCE, resource indicators,
  refresh tokens, and discovery state use the SDK flow.
- `packages/core/src/mcp/ai-tools.ts` maps enabled remote tools to deterministic
  `server__tool` AI SDK names. Every invocation uses `mcp.<server>.<tool>` plus the server URL in
  `PermissionEngine`; plan mode exposes only explicitly read-only tools.
- `packages/core/src/mcp/result.ts` bounds MCP results before stream delivery, transcript storage,
  or compaction while retaining errors, URLs, text summaries, structured content, and origin
  metadata.
- `packages/extension/src/background/handlers/mcp.ts` provides typed CRUD, health, discovery,
  credentials, OAuth, resources, and marketplace messages.
- `packages/extension/src/sidepanel/RemoteMcpSettings.tsx` provides direct URL configuration,
  authentication, status, discovery/tool filtering, and Official MCP Registry import.

Server configuration and non-secret headers sync through normal configuration. Bearer/API secrets,
OAuth tokens, PKCE verifiers, registered client data, and OAuth discovery state are AES-GCM
encrypted in the dedicated `mcp/` vault namespace in local storage. They are never written to
synced configuration.

Discovery snapshots are local cache entries with server/version/protocol timestamps. They allow a
restarted service worker to expose known tools immediately. Missing caches trigger on-demand
discovery. Connections are lazy, closed after idle, and all run connections close when an agent
run finishes or the worker suspends.

## Live smoke test

The smoke test skips unless a URL is configured. It only calls a tool explicitly annotated as
read-only, non-destructive, and closed-world.

```sh
MCP_TEST_URL=https://example.com/mcp \
MCP_TEST_TOKEN=optional-bearer-token \
MCP_TEST_TOOL=optional-safe-tool \
MCP_TEST_ARGS='{"query":"hello"}' \
pnpm smoke:mcp
```

Review server annotations before selecting `MCP_TEST_TOOL`. The script refuses tools that are not
explicitly safe read-only.
