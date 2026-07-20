# Browser Agent

A BYOK Chrome extension that acts on the web like a user — with any connectable LLM provider, permissions you control, and optional remote MCP tools.

**Latest release: [v0.5.0](https://github.com/dhruvbhavsar0612/browser-agent/releases/tag/v0.5.0)** · License: [MIT](LICENSE)

## Install (downloadable build)

1. Open the latest [GitHub Release](https://github.com/dhruvbhavsar0612/browser-agent/releases/latest)
2. Download **`browser-agent-extension-*.zip`**
3. Unzip it
4. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the unzipped folder
5. Open the side panel → gear opens **Settings** (new tab) → enable a provider, connect (API key or OAuth), enable models → return to **Chat**

API keys and OAuth tokens stay in an encrypted local vault. Nothing in the zip contains secrets.

## Status

**v0.5.0** — Settings as a dedicated tab, searchable MCP, thinking effort + compaction, default agent **act**. Sprints 0–5 complete; Sprint 6 polish in progress.

| Capability | Status |
|------------|--------|
| Settings tab (separate browser tab) | ✅ |
| BYOK providers + encrypted vault | ✅ |
| OAuth Connect (ChatGPT / Claude) | ✅ |
| Gemini (Google AI Studio) + OpenRouter + OpenAI-compatible | ✅ |
| Enable models per provider + thinking effort | ✅ |
| Streaming chat + session history + light/dark | ✅ |
| Agents: **act** (default) / **browse** (read-only) | ✅ |
| Browser read tools (tabs, a11y read, grep, navigate, screenshot) | ✅ |
| Browser act tools (click / type / scroll / hover / select) | ✅ |
| Visual indicator / tab groups / clipboard-safe paste | ✅ |
| Permission ask UI (Once / Always / Reject) | ✅ |
| Plan / Ask / Auto execution modes | ✅ |
| Site rules + sensitive path defaults | ✅ |
| Doom-loop pause + continue/stop | ✅ |
| Session compaction | ✅ |
| Remote MCP (presets + manual + Official Registry) | ✅ |
| Keyboard shortcuts / export-import / threat-model onboarding | ⏳ Sprint 6 remaining |

## Quick start (from source)

```bash
pnpm install
pnpm --filter @browser-agent/extension build
# Load packages/extension/dist in chrome://extensions (Developer mode)
```

Pack a release zip locally:

```bash
pnpm --filter @browser-agent/extension build
pnpm pack:extension
# → release/browser-agent-extension-<version>.zip
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for details.

### Try it

1. Open any page (e.g. `https://example.com`)
2. Side panel → agent defaults to **act** (switch to **browse** for read-only)
3. Ask: *“What’s on this page?”* or *“List my tabs”*
4. You should see tools like `page_read`, `tabs_list`, `page_grep` in the chat

OpenAI-compatible endpoints (e.g. OpenCode Zen) work: set **Base URL** + key in Settings; models load from `{baseURL}/models`.

## What’s in the box

### Providers
- Anthropic, OpenAI, Google AI Studio, OpenRouter, OpenAI-compatible
- Encrypted local vault for API keys and OAuth tokens
- ChatGPT / Claude Connect (OAuth) from Settings
- [models.dev](https://models.dev) catalog + remote `/models` for compatible endpoints
- Per-model enable + reasoning effort (`none` / `low` / `medium` / `high`) where supported

### Agent runtime
- Multi-step drain loop (`streamText` + tools + step limit)
- Agents: **act** (ask-gated actions, default), **browse** (read-only)
- Ordered stream segments: text, reasoning, tool-call, tool-result
- Session compaction when context grows large

### Browser tools

| Tool | Purpose |
|------|---------|
| `tabs_list` / `tabs_focus` / `tabs_open` / `tabs_close` | Tab management |
| `page_read` | Accessibility tree with `ref_N` ids |
| `page_grep` | Search page text / labels |
| `navigate` | Go to URL (allowed on **act**; denied on **browse**) |
| `page_screenshot` | Viewport capture (CDP, with `captureVisibleTab` fallback) |
| `click` / `type` / `scroll` / `hover` / `select` | Act tools (permission-gated) |

### MCP
- Remote HTTP/SSE only (no stdio in the extension)
- Curated presets (Context7, GitHub, Linear, Notion, Sentry, …) + manual add
- Official Registry search
- Secrets in local encrypted vault — see [remote-mcp.md](docs/remote-mcp.md)

## CI & releases

| Workflow | Trigger | What it does |
|----------|---------|----------------|
| **CI** | PR + push to `main` | `typecheck` → `test` → `build` → upload extension zip artifact |
| **Release** | Push tag `v*` / semver (or manual dispatch) | Same checks → attach zip to a GitHub Release with install notes |

```bash
git tag v0.5.0
git push origin v0.5.0
```

Do not create a Release from the GitHub UI alone — push a tag (or use **Actions → Release → Run workflow**) so the zip is built. See [RELEASE.md](docs/RELEASE.md).

## Concept

- **BYOK** — Bring your own API keys; providers via Vercel AI SDK + [models.dev](https://models.dev)
- **Browser-native tools** — Tabs, a11y page read, navigate, screenshot, click/type
- **Coding-agent rules** — Permission system (`allow` / `ask` / `deny`), agent modes, session store
- **Remote MCP** — Connect external tool servers without leaving Chrome
- **Open-source patterns** — [OpenCode](https://github.com/sst/opencode)-style loop; browser tools inspired by [Hermes in Chrome](https://github.com/huaqing0/Hermes--in--chrome)

## Docs

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full system design, phases, tech stack |
| [TOOLS.md](docs/TOOLS.md) | Browser tool specification |
| [THREAT-MODEL.md](docs/THREAT-MODEL.md) | Security model and mitigations |
| [remote-mcp.md](docs/remote-mcp.md) | Remote MCP client |
| [MARKETPLACE.md](docs/MARKETPLACE.md) | Marketplace contract |
| [LINEAR.md](docs/LINEAR.md) | Sprints, issues, dependency graph |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Local setup and load-unpacked |
| [RELEASE.md](docs/RELEASE.md) | CI, tagging, downloadable zip |

## Linear

- Project: [Browser Agent Extension](https://linear.app/dhruvsprojects/project/browser-agent-extension-d4eb96c4fb46)
- Dependency graph: [doc](https://linear.app/dhruvsprojects/document/dependency-graph-and-parallel-tracks-ecc2eb16861c)

## Packages

| Package | Role |
|---------|------|
| `@browser-agent/core` | Config, vault, providers, agent loop, tools, permissions, session, MCP |
| `@browser-agent/extension` | MV3 extension (side panel, settings tab, service worker, a11y content script) |
| `@browser-agent/marketplace-contract` | Declarative marketplace / registry contract |

## Roadmap (next)

1. **Sprint 6 remaining** — Keyboard shortcuts, export/import, threat-model onboarding ([DHR-71](https://linear.app/dhruvsprojects/issue/DHR-71) / [72](https://linear.app/dhruvsprojects/issue/DHR-72) / [73](https://linear.app/dhruvsprojects/issue/DHR-73))
2. **Contributor experience** — GitHub templates, CONTRIBUTING guide, labels for external PRs
3. **Polish & distribution** — Chrome Web Store packaging when ready
