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
  credentials, OAuth, resources, and marketplace messages. It prefers
  `chrome.identity.launchWebAuthFlow`, with a persisted, watched authorization-tab callback fallback
  only after Chrome cannot capture a callback that the provider already accepted. The existing
  remote-MCP panel exposes a minimal manual completion control only for that capture-failure case
  or for an explicitly configured provider-registered redirect.
- `packages/extension/src/sidepanel/RemoteMcpSettings.tsx` provides direct URL configuration,
  authentication, status, discovery/tool filtering, and Official MCP Registry import.

Server configuration and non-secret headers sync through normal configuration. Bearer/API secrets,
OAuth tokens, PKCE verifiers, registered client data, and OAuth discovery state are AES-GCM
encrypted in the dedicated `mcp/` vault namespace in local storage. They are never written to
synced configuration. An authorization state and PKCE verifier are fresh for every attempt,
bound to an opaque attempt generation, expire after five minutes, require the registered callback
origin/path and matching state, and are consumed after a completion, cancellation, mismatch,
expiry, or replay attempt. Completion/cancellation and callback watchers are serialized per server,
so a stale callback cannot consume a newer attempt.

Discovery snapshots are local cache entries with server/version/protocol timestamps. They allow a
restarted service worker to expose known tools immediately. Missing caches trigger on-demand
discovery. Connections are lazy, closed after idle, and all run connections close when an agent
run finishes or the worker suspends. A remote transport close is forgotten immediately, so the next
request creates a fresh connection. OAuth providers and manual credentials are reloaded from the
vault; the MCP SDK refreshes OAuth access tokens after an authorization challenge. Idle or service
worker shutdown never deletes vault entries.

## Preset authentication matrix

The preset `authMode` is the creation default. `authStrategy` is additive metadata for callers that
need to explain the supported choices; it contains no credential values.

| Preset | Default / preferred mode | Allowed alternative | Operational guidance |
| --- | --- | --- | --- |
| Context7 Docs | `none` | `api-key` | Start anonymously. If Context7 supplies a higher-limit credential, store it only as a vault API-key secret. |
| GitHub | `bearer` | `oauth` | Preferred: a least-privilege GitHub fine-grained PAT saved as a bearer vault credential. OAuth requires a deployment that accepts dynamic registration or a provider-registered public client/redirect. |
| Linear | `oauth` | — | OAuth works only when Linear accepts the extension callback, or when the user configures a Linear-registered public client ID and redirect. |
| Notion | `oauth` | — | OAuth works only when Notion accepts the extension callback, or when the user configures a Notion-registered public client ID and redirect. |
| Sentry | `oauth` | `bearer`, `api-key` | Prefer OAuth; for a provider-documented token deployment, save the credential in the vault. |
| Custom Remote MCP | `none` | `bearer`, `api-key`, `oauth` | Select only the provider-documented mode and keep manual credentials in the vault. |

## Health and transport behavior

`McpHealth.error.code` is a stable category and `error.action` gives the next corrective step.
`error.detail`, when present, is sanitized before it is returned.

| Code | Meaning | Corrective action |
| --- | --- | --- |
| `auth` | Credential missing, expired, or unauthorized | Save a valid bearer/API credential or reconnect OAuth. |
| `cors` | The browser explicitly reported a CORS failure | Allow the extension origin and MCP request headers. This code is not inferred from opaque fetch failures. |
| `network` | DNS, TLS, connection, host-policy, or opaque browser-fetch failure | Verify the HTTPS endpoint, DNS/TLS/network path, extension host permission, and provider CORS policy. Browsers do not reveal which one caused `Failed to fetch`. |
| `transport` | The selected protocol is unsupported by the endpoint | Use the provider's protocol; use Auto only for possible legacy SSE endpoints. |
| `protocol` | The endpoint did not complete an MCP handshake | Use the provider's MCP endpoint, not its web page or API root. |
| `oauth-redirect` | The provider rejected dynamic registration or the Chrome extension callback | Use provider-supported token auth, or configure a provider-registered public client ID and HTTPS/localhost redirect. Browser Agent cannot host or bypass a callback. |

Auto transport starts with Streamable HTTP and tries legacy SSE only after an explicit
Streamable-HTTP negotiation rejection (`404`, `405`, `406`, `415`, or `501`). It never retries
authentication, CORS, DNS/network, or generic server failures as SSE.

## Live smoke test

The Node smoke test is supplemental only; the extension service-worker smoke below is authoritative
for MV3 behavior. It skips unless a URL is configured and only calls a tool explicitly annotated as
read-only, non-destructive, and closed-world. Its SSE fallback matches production: only explicit
Streamable-HTTP negotiation rejections (`404`, `405`, `406`, `415`, or `501`) retry as SSE. It never
retries auth, CORS, or opaque fetch failures as SSE.

```sh
MCP_TEST_URL=https://example.com/mcp \
MCP_TEST_TOKEN=optional-bearer-token \
MCP_TEST_TOOL=optional-safe-tool \
MCP_TEST_ARGS='{"query":"hello"}' \
pnpm smoke:mcp
```

Review server annotations before selecting `MCP_TEST_TOOL`. The script refuses tools that are not
explicitly safe read-only. A reviewed tool that is read-only and non-destructive but marked
`openWorldHint` can be called only with the explicit `MCP_TEST_ALLOW_OPEN_WORLD=1` opt-in.

## Extension service-worker live smoke

The following checks are authoritative because they exercise the MV3 background service worker, not
the supplemental standalone smoke script.
Do not put a credential in a shell command, source file, devtools snippet, or issue comment.

1. Build the extension, open `chrome://extensions`, enable Developer mode, and load unpacked
   `packages/extension/dist`.

   ```sh
   pnpm --filter @browser-agent/extension build
   ```

2. Click the extension's **service worker** link on `chrome://extensions`. In that worker's
   DevTools Console, define this message helper:

   ```js
   const mcp = (type, payload) =>
     chrome.runtime.sendMessage({ id: crypto.randomUUID(), type, payload })
   ```

### Context7 anonymous smoke

Create a temporary anonymous server through the real background message handler, then test and
discover it. Do not call a remote tool in this smoke.

```js
await mcp('mcp.server.create', {
  id: 'context7-sw-smoke',
  server: {
    type: 'remote',
    name: 'Context7 service-worker smoke',
    url: 'https://mcp.context7.com/mcp',
    transport: 'streamable-http',
    enabled: true,
    headers: {},
    auth: { mode: 'none' },
    tools: {},
  },
})
await mcp('mcp.server.test', { id: 'context7-sw-smoke' })
await mcp('mcp.server.discover', { id: 'context7-sw-smoke' })
```

Expect `ok: true`, `transport: 'streamable-http'`, and a discovery response. The CDP-pipe MV3
smoke on this branch produced Context7 `3.2.5`, protocol `2025-11-25`, and two tools through the
real service worker. Then stop the service worker from `chrome://extensions` and repeat
`mcp.server.test`; it should wake a fresh worker and reconnect. Remove the temporary server when
finished:

```js
await mcp('mcp.server.delete', { id: 'context7-sw-smoke' })
```

### GitHub bearer/PAT smoke

1. Add the GitHub preset in the existing Remote MCP settings. It defaults to **Bearer**.
2. In its password field, enter a least-privilege fine-grained PAT manually and save it. Never
   paste the PAT into DevTools or the commands below.
3. In the service-worker Console, run only non-secret background requests:

   ```js
   await mcp('mcp.server.test', { id: 'github-official' })
   await mcp('mcp.server.discover', { id: 'github-official' })
   ```

Expect a successful health response and discovery. Stop the service worker in
`chrome://extensions`, reopen its Console, redefine `mcp`, and repeat `mcp.server.test`. The
saved bearer credential must still be listed only as an `api` vault entry by
`mcp.server.list`, never in response data. Remove the temporary GitHub server or use the explicit
credential removal control when the test is complete.

## OAuth callback and platform constraints

`*.chromiumapp.org` is an extension callback, not a hosted callback that can be made acceptable by
pasting it into a provider error page. If dynamic registration or the Chrome callback is rejected,
the extension returns the stable `oauth-redirect` result. It does not open a tab or imply that
manual completion can bypass the provider's allowlist.

The viable paths are:

- **GitHub:** use the preset's preferred least-privilege fine-grained PAT as a vaulted bearer
  credential. Its external E2E remains intentionally gated on a user-supplied credential.
- **OAuth providers accepting the extension callback:** use the normal identity flow.
- **Providers requiring a registered callback:** in the existing server editor, enter a
  provider-registered **public** client ID and its exact HTTPS (or localhost) redirect URL, then
  save before connecting. Client secrets are intentionally unsupported and never stored. Browser
  Agent opens and watches that registered redirect in a tab; it does not invent a hosted callback.

When Chrome fails to capture a callback after the provider has accepted a valid registered redirect,
the editor offers **Complete OAuth**. Paste only the final callback URL before the five-minute
expiry; the UI sends `mcp.oauth.complete` with the current attempt generation and shows a sanitized
result. **Cancel authorization** likewise binds to that generation. Callback URLs can contain an
authorization code, so they are held only in transient page state and are never logged, returned in
responses, or saved to configuration.
