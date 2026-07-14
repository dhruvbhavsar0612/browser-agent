# browser-agent

A BYOK browser AI agent extension — act on the web like a user, with any connectable LLM provider.

## Install (downloadable build)

1. Open the latest [GitHub Release](https://github.com/dhruvbhavsar0612/browser-agent/releases)
2. Download **`browser-agent-extension-*.zip`**
3. Unzip it
4. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the unzipped folder
5. Open the side panel → **Settings** → add an API key and pick a model → **Chat**

## Status

**Sprint 1 demo ready** — Settings (BYOK) + streaming chat. Browser tools land in later sprints.

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

## CI & releases

| Workflow | Trigger | What it does |
|----------|---------|----------------|
| **CI** | PR + push to `main` | `typecheck` → `test` → `build` → upload extension zip artifact |
| **Release** | Push tag `v*` (or manual dispatch) | Same checks → attach zip to a GitHub Release with install notes |

Ship a downloadable build:

```bash
git tag v0.1.0
git push origin v0.1.0
```

That creates a Release whose assets include `browser-agent-extension-0.1.0.zip`.

## Concept

- **BYOK** — Bring your own API keys; support 75+ providers via Vercel AI SDK + [models.dev](https://models.dev)
- **Browser-native tools** — Read tabs, navigate, click, type, screenshot via CDP + accessibility tree
- **Coding-agent rules** — Permission system (`allow` / `ask` / `deny`), agent modes, session persistence
- **Open-source patterns** — Architecture modeled on [OpenCode](https://github.com/sst/opencode); browser tools inspired by [Hermes in Chrome](https://github.com/huaqing0/Hermes--in--chrome)

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
| `@browser-agent/core` | Config, permission, messaging, provider, agent, session |
| `@browser-agent/extension` | MV3 Chrome extension (side panel + service worker) |

## Reference repos (cloned locally for study)

- `opencode-ref/` — [sst/opencode](https://github.com/sst/opencode) provider + agent architecture
- `hermes-ref/` — [huaqing0/Hermes--in--chrome](https://github.com/huaqing0/Hermes--in--chrome) browser automation tools
- `hermes-ext-ref/` — [abundantbeing/hermes-browser-extension](https://github.com/abundantbeing/hermes-browser-extension) side panel UX
