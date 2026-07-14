#!/usr/bin/env node
/**
 * Zip packages/extension/dist for Chrome "Load unpacked" / GitHub Releases.
 * Contents are rooted at the zip (manifest.json at top level).
 *
 * Usage:
 *   node scripts/pack-extension.mjs
 *   node scripts/pack-extension.mjs --version 0.1.0
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = resolve(root, 'packages/extension/dist')
const releaseDir = resolve(root, 'release')

function argValue(flag) {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

function readVersion() {
  const fromArg = argValue('--version')
  if (fromArg) return fromArg.replace(/^v/, '')
  const pkg = JSON.parse(readFileSync(resolve(root, 'packages/extension/package.json'), 'utf8'))
  return pkg.version || '0.0.0'
}

if (!existsSync(distDir)) {
  console.error('Missing packages/extension/dist. Run: pnpm --filter @browser-agent/extension build')
  process.exit(1)
}

if (!existsSync(join(distDir, 'manifest.json'))) {
  console.error('packages/extension/dist/manifest.json not found — build looks incomplete')
  process.exit(1)
}

const version = readVersion()
mkdirSync(releaseDir, { recursive: true })

const zipName = `browser-agent-extension-${version}.zip`
const zipPath = resolve(releaseDir, zipName)

// Prefer system zip so we don't add a dependency; fall back message if missing.
const result = spawnSync(
  'zip',
  ['-r', '-q', zipPath, '.', '-x', '.vite/*', '*/.vite/*'],
  { cwd: distDir, stdio: 'inherit' },
)

if (result.error || result.status !== 0) {
  console.error('Failed to create zip. Ensure `zip` is installed (apt install zip).')
  process.exit(result.status || 1)
}

console.log(`packed ${zipPath}`)
