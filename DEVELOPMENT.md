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

### Pack a zip (same artifact as GitHub Releases)

```bash
pnpm --filter @browser-agent/extension build
pnpm pack:extension
# → release/browser-agent-extension-<version>.zip
```

Unzip and load the folder unpacked, same as installing from a Release.

## CI / Release

- **CI** (`.github/workflows/ci.yml`) runs on every PR and push to `main`: typecheck, test, build, upload zip artifact.
- **Release** (`.github/workflows/release.yml`) runs on `v*` tags: publishes a GitHub Release with `browser-agent-extension-<version>.zip` attached.

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Packages

See [packages/README.md](packages/README.md).

## Linear

Implementation tracked in [Browser Agent Extension](https://linear.app/dhruvsprojects/project/browser-agent-extension-d4eb96c4fb46). Start with Sprint 0 issues in `docs/LINEAR.md`.
