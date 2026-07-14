# browser-agent

A BYOK browser AI agent extension — act on the web like a user, with any connectable LLM provider.

## Status

**Planning phase.** See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture plan.

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

## Reference repos (cloned locally for study)

- `opencode-ref/` — [sst/opencode](https://github.com/sst/opencode) provider + agent architecture
- `hermes-ref/` — [huaqing0/Hermes--in--chrome](https://github.com/huaqing0/Hermes--in--chrome) browser automation tools
- `hermes-ext-ref/` — [abundantbeing/hermes-browser-extension](https://github.com/abundantbeing/hermes-browser-extension) side panel UX
