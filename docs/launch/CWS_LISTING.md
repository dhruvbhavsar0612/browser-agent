# Chrome Web Store listing — draft (target: v0.6.0)

> Owner: @dhruvbhavsar0612 · Drafted by agent Session 2 · Refs #31
> Constraints: name ≤ 75 chars, short description ≤ 132 chars, screenshots 1280×800.

## Name

**Browser Agent — Open-source AI for Chrome**

Alternates: `Browser Agent: BYOK AI browser copilot` · `Browser Agent — AI that acts on the web`

## Short description (≤ 132 chars)

Open-source AI agent for Chrome. Bring your own LLM key — it reads pages, fills forms, and acts only with your permission.

## Detailed description

Browser Agent is an open-source AI agent that lives in your browser's side panel. It doesn't just chat about pages — it reads them, opens tabs, fills forms, and clicks, with a permission gate on every step.

🔓 BRING YOUR OWN KEY
Connect any provider: OpenAI, Anthropic (incl. OAuth), Gemini, OpenRouter, or any OpenAI-compatible endpoint — Ollama, LM Studio, groq, together. Your API keys are stored in an encrypted local vault. There is no backend and no account: your keys never leave your device.

🧠 A REAL AGENT, NOT A CHATBOT
Multi-step loop with tool use: list tabs, read pages (accessibility tree), navigate, screenshot, then act — click, type, scroll, hover, select. Session compaction keeps long tasks on track; doom-loop detection pauses the agent when it's stuck instead of burning your tokens.

✋ YOU ARE IN CONTROL
- Every act is permission-gated: Allow once, Always for this site, or Reject.
- Built-in site rules with sensitive-path defaults (banking, auth, admin).
- Read-only "browse" mode when you want research without actions.
- Plan / Ask / Auto execution — choose how much initiative the agent gets.

🔌 EXTENSIBLE
Connect remote MCP servers (presets + official registry) to add tools without leaving Chrome. Marketplace contract is open and declarative.

📦 100% OPEN SOURCE (MIT)
Full architecture docs, tool spec, and a public threat model. Build it yourself or audit ours: github.com/dhruvbhavsar0612/browser-agent

Getting started: add your provider key in Settings → pick a model → open the side panel → "List my tabs and summarize what's open."

## Category / metadata

- Category: Productivity
- Language: English
- Homepage: repo README · Support: repo Issues · Privacy policy: docs/launch/PRIVACY_POLICY.md (to publish)

## Screenshots (1280×800) — shot list

1. Side panel agent mid-task: "List my tabs and summarize what's open" + tool calls streaming.
2. Permission ask close-up: "Agent wants to click Submit on example.com — Allow once / Always / Reject."
3. Settings → Providers: BYOK catalog (models.dev) with key vault.
4. Remote MCP panel: preset servers + registry.
5. Doom-loop pause card with Continue / Stop.

Promo: 440×280 small tile + 1400×560 marquee ("Your browser. Your keys. Your rules.")

## Permission justifications (for CWS review)

- `tabs` — enumerate/switch tabs for multi-page tasks; never reads history.
- `debugger` — attached only to the active tab while performing a user-approved act (click/type/scroll/hover/select); detached immediately after; never on chrome:// pages or denied sites.
- `storage` — local settings, sessions, encrypted vault. No sync of secrets.
- `clipboardWrite` — clipboard-safe paste path for rich-text editors; clipboard snapshot restored after paste.
- Host permissions — broad read needed for cross-tab research; mitigated by per-site allow/deny rules, sensitive-path defaults, and read-only mode.

Reviewer notes: BYOK, no backend server, no telemetry/analytics, MIT-licensed, source + threat model public. Distribution starts unlisted for beta cohort.
