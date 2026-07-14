# browser-agent

A BYOK browser AI agent extension — act on the web like a user, with any connectable LLM provider.

## Status

**Sprint 0 in progress.** Monorepo + MV3 shell scaffolding.

## Quick start

```bash
pnpm install
pnpm --filter @browser-agent/extension build
# Load packages/extension/dist in chrome://extensions (Developer mode)
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for details.

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

## Linear

- Project: [Browser Agent Extension](https://linear.app/dhruvsprojects/project/browser-agent-extension-d4eb96c4fb46)
- Dependency graph: [doc](https://linear.app/dhruvsprojects/document/dependency-graph-and-parallel-tracks-ecc2eb16861c)

## Packages

| Package | Role |
|---------|------|
| `@browser-agent/core` | Config, permission, messaging, provider/agent/session stubs |
| `@browser-agent/extension` | MV3 Chrome extension (side panel + service worker) |

## Reference repos (cloned locally for study)

- `opencode-ref/` — [sst/opencode](https://github.com/sst/opencode) provider + agent architecture
- `hermes-ref/` — [huaqing0/Hermes--in--chrome](https://github.com/huaqing0/Hermes--in--chrome) browser automation tools
- `hermes-ext-ref/` — [abundantbeing/hermes-browser-extension](https://github.com/abundantbeing/hermes-browser-extension) side panel UX
