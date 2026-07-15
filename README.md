# browser-agent

A BYOK browser AI agent extension — act on the web like a user, with any connectable LLM provider.

## Install (downloadable build)

1. Open the latest [GitHub Release](https://github.com/dhruvbhavsar0612/browser-agent/releases)
2. Download **`browser-agent-extension-*.zip`**
3. Unzip it
4. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the unzipped folder
5. Open the side panel → **Settings** → add an API key and pick a model → **Chat**

## Status

**Sprint 5 in progress** — permissions & safety on top of **v0.3.1** (full Sprint 4).

| Capability | Status |
|------------|--------|
| Settings / BYOK keys / model picker | ✅ |
| Streaming chat + session history + light/dark | ✅ |
| CDP + click / type / scroll / hover / select | ✅ |
| Visual indicator / tab groups / clipboard-safe paste | ✅ |
| Permission ask UI (Once / Always / Reject) | ✅ |
| Plan / Ask / Auto execution modes | ✅ |
| Site rules + sensitive path defaults | ✅ |
| Doom-loop pause + continue/stop | ✅ |
| OAuth (OpenAI / Claude) | ⏳ Planned |

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

### Try the read agent

1. Open any page (e.g. `https://example.com`)
2. Side panel → agent **browse** → ask: *“What’s on this page?”* or *“List my tabs”*
3. You should see tools like `page_read`, `tabs_list`, `page_grep` run in the chat

OpenAI-compatible endpoints (e.g. OpenCode Zen) work: set **Base URL** + key in Settings; models load from `{baseURL}/models`.

## What’s in the box

### Providers
- Anthropic, OpenAI, Google, OpenRouter, OpenAI-compatible
- Encrypted local vault for API keys
- [models.dev](https://models.dev) catalog + remote `/models` for compatible endpoints

### Agent runtime
- Multi-step drain loop (`streamText` + tools + step limit)
- Agents: **browse** (read-only), **act** (ask-gated actions)
- Stream events: text, tool-call, tool-result

### Browser read tools (Sprint 3)
| Tool | Purpose |
|------|---------|
| `tabs_list` / `tabs_focus` / `tabs_open` / `tabs_close` | Tab management |
| `page_read` | Accessibility tree with `ref_N` ids |
| `page_grep` | Search page text / labels |
| `navigate` | Go to URL (allowed on **act**; denied on **browse**) |
| `page_screenshot` | Viewport capture (`captureVisibleTab`) |

## CI & releases

| Workflow | Trigger | What it does |
|----------|---------|----------------|
| **CI** | PR + push to `main` | `typecheck` → `test` → `build` → upload extension zip artifact |
| **Release** | Push tag `v*` (or manual dispatch) | Same checks → attach zip to a GitHub Release with install notes |

```bash
git tag v0.2.0
git push origin v0.2.0
```

## Concept

- **BYOK** — Bring your own API keys; providers via Vercel AI SDK + [models.dev](https://models.dev)
- **Browser-native tools** — Tabs, a11y page read, navigate, screenshot (click/type next)
- **Coding-agent rules** — Permission system (`allow` / `ask` / `deny`), agent modes, session store
- **Open-source patterns** — [OpenCode](https://github.com/sst/opencode)-style loop; browser tools inspired by [Hermes in Chrome](https://github.com/huaqing0/Hermes--in--chrome)

## Docs

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full system design, phases, tech stack |
| [TOOLS.md](docs/TOOLS.md) | Browser tool specification |
| [THREAT-MODEL.md](docs/THREAT-MODEL.md) | Security model and mitigations |
| [LINEAR.md](docs/LINEAR.md) | Sprints, issues, dependency graph |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Local setup and load-unpacked |
| [RELEASE.md](docs/RELEASE.md) | CI, tagging, downloadable zip |

## Linear

- Project: [Browser Agent Extension](https://linear.app/dhruvsprojects/project/browser-agent-extension-d4eb96c4fb46)
- Dependency graph: [doc](https://linear.app/dhruvsprojects/document/dependency-graph-and-parallel-tracks-ecc2eb16861c)

## Packages

| Package | Role |
|---------|------|
| `@browser-agent/core` | Config, vault, providers, agent loop, tools, permissions, session |
| `@browser-agent/extension` | MV3 extension (side panel, service worker, a11y content script) |

## Roadmap (next)

1. **Sprint 4** — CDP + click / type / scroll / hover / select  
2. **Sprint 5** — Permission ask UI + execution modes  
3. **OAuth** — OpenAI / Claude via `chrome.identity` (DHR-75 / DHR-76)
