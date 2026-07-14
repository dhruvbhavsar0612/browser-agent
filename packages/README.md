# Packages

| Package | Role |
|---------|------|
| `@browser-agent/core` | Shared library: config, provider, agent, permission, session, tools, MCP |
| `@browser-agent/extension` | Manifest V3 Chrome extension (Vite + CRXJS) |

## Boundaries

- **core** must stay browser-safe (no Node FS/child_process). Prefer plain TypeScript modules.
- **extension** depends on `core` via `workspace:*` and owns Chrome APIs (`chrome.*`).
- Do not put secrets or UI in `core`.
