# Threat Model

## Overview

This extension is a **local-first browser automation agent**. It reads web pages, captures screenshots, drives tabs via Chrome DevTools Protocol, and sends context to user-configured LLM providers. The threat model follows patterns from [Hermes in Chrome](https://github.com/huaqing0/Hermes--in--chrome/blob/main/docs/threat-model.md) and [OpenCode](https://github.com/sst/opencode) permission design.

## Assets

| Asset | Location | Sensitivity |
|-------|----------|-------------|
| Page content, a11y trees, screenshots | Content scripts → Service Worker → LLM | High |
| API keys / OAuth tokens | Encrypted `chrome.storage.local` | Critical |
| Conversation history | IndexedDB | High |
| User config (providers, permissions) | `chrome.storage.sync` | Medium |
| Clipboard contents | During `type` operations | High |
| Browser cookies / sessions | Implicit — agent acts as logged-in user | Critical |

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────┐
│  Web Page (untrusted)                                   │
│  ← prompt injection via DOM, ARIA, hidden text            │
└──────────────────────┬──────────────────────────────────┘
                       │ content scripts (isolated world)
┌──────────────────────▼──────────────────────────────────┐
│  Extension Service Worker (trusted)                     │
│  ← agent loop, tools, permission engine                 │
└──────────┬──────────────────────────┬───────────────────┘
           │                          │
┌──────────▼──────────┐    ┌──────────▼──────────────────┐
│  Side Panel (trusted)│    │  LLM Provider (user-chosen)│
│  ← permission UI     │    │  ← BYOK; user's data policy │
└─────────────────────┘    └────────────────────────────┘
```

## Primary Risks

1. **Prompt injection** — Malicious page text instructs the agent to exfiltrate data or perform harmful actions.
2. **Wrong-target actions** — Model clicks "Delete account" instead of "Cancel".
3. **Over-broad permissions** — `<all_urls>` + `debugger` increases blast radius if extension is compromised.
4. **Credential exposure** — API keys leaked via content script, synced storage, or error logs.
5. **Clipboard disruption** — Failed restore after `type` operation loses user clipboard data.
6. **Authenticated session abuse** — Agent operates with user's logged-in cookies on banking, email, admin panels.

## Mitigations

| Risk | Mitigation |
|------|------------|
| Prompt injection | Separate system context from page content; instruct model to treat page text as untrusted data; visual indicator when agent is active |
| Wrong-target actions | Default to `approval` mode; `plan` mode blocks all write tools; site-level deny rules for sensitive URLs |
| Broad permissions | Offer `activeTab`-only mode; request `debugger` on first automation action; document tradeoffs in onboarding |
| Credential exposure | Keys only in encrypted local storage; never in sync storage, content scripts, or page context; CSP on extension pages |
| Clipboard | Snapshot before paste, restore after; report `clipboard_restore_mode` on failure |
| Session abuse | Deny rules for `*://*/checkout*`, `*://*/payment*`, `*://*/admin*`; always-ask on unknown domains |
| Doom loops | Detect 3 identical consecutive tool calls; pause and ask user |
| Data to LLM | BYOK = user controls provider; show clear data flow in settings; optional local-only models (Ollama) |

## User Controls

- **Plan mode** — Read-only; no click, type, navigate, or evaluate
- **Approval mode** — Explicit consent before every write action
- **Auto mode** — Allow by default; user configures deny rules
- **Per-site rules** — Allow/deny/ask patterns by URL glob
- **Stop button** — Detach debugger, cancel in-flight agent loop
- **Clear credentials** — Remove all stored API keys
- **Export/delete sessions** — Full data control

## Out of Scope

- LLM provider data handling (follows provider's terms)
- Bypassing CAPTCHAs or anti-automation
- Sandboxing third-party MCP servers (user responsibility)
