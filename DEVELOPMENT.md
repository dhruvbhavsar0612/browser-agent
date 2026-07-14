# Browser Agent — Development

## Prerequisites

- Node.js 20+
- pnpm 10+ (`corepack enable && corepack prepare pnpm@10.33.3 --activate`)
- Chrome / Chromium 116+

## Setup

```bash
pnpm install
pnpm typecheck
pnpm test
```

## Extension (load unpacked)

```bash
pnpm --filter @browser-agent/extension dev
# or production build:
pnpm --filter @browser-agent/extension build
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `packages/extension/dist`
4. Click the extension icon (or Alt+B) to open the side panel

## Packages

See [packages/README.md](packages/README.md).

## Linear

Implementation tracked in [Browser Agent Extension](https://linear.app/dhruvsprojects/project/browser-agent-extension-d4eb96c4fb46). Start with Sprint 0 issues in `docs/LINEAR.md`.
