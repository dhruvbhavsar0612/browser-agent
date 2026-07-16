# Releases & CI

## How it works

```mermaid
flowchart LR
  PR[Pull request] --> CI[CI workflow]
  Main[Push to main] --> CI
  CI --> Art[Upload zip artifact]
  Tag["git tag v0.4.5 + push"] --> Rel[Release workflow]
  Rel --> GH[GitHub Release + zip asset]
```

| Workflow | File | Trigger | Output |
|----------|------|---------|--------|
| CI | `.github/workflows/ci.yml` | PR / push `main` | Checks + **Actions artifact** zip (14-day retention) |
| Release | `.github/workflows/release.yml` | Tag `v*` / semver tag / manual dispatch | **GitHub Release** with downloadable zip + auto change notes |

Creating a Release from the GitHub UI **without** pushing a matching tag that triggers Actions will not build the extension zip. Prefer the tag flow below.

## Publish a downloadable build

After merging to `main`:

```bash
git checkout main
git pull
git tag v0.4.5
git push origin v0.4.5
```

Or: GitHub → **Actions** → **Release** → **Run workflow** → enter `v0.4.5` (or `0.4.5`).

### Tag naming

- Preferred: **`v0.4.5`** (matches prior releases)
- Also accepted: **`0.4.5`** — the workflow normalizes to `v0.4.5` and attaches the zip there

Avoid drafting a GitHub Release by hand with an empty/mismatched tag. That skips the Release workflow and leaves a release page without `browser-agent-extension-*.zip`.

The release body includes install steps; GitHub also appends auto-generated change notes from commits since the previous tag.

Artifact name: `browser-agent-extension-0.4.5.zip` (manifest version synced from the tag).

## Local pack (same zip)

```bash
pnpm --filter @browser-agent/extension build
pnpm pack:extension
# → release/browser-agent-extension-<version>.zip
```
