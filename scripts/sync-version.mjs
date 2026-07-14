#!/usr/bin/env node
/**
 * Sync a semver (no leading v) into root + extension package.json and the MV3 manifest.
 * Usage: node scripts/sync-version.mjs 0.1.0
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version)) {
  console.error('Usage: node scripts/sync-version.mjs <semver>  (e.g. 0.1.0)')
  process.exit(1)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function patchJson(relPath, mutator) {
  const path = resolve(root, relPath)
  const data = JSON.parse(readFileSync(path, 'utf8'))
  mutator(data)
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
  console.log(`updated ${relPath} → ${version}`)
}

function patchManifestTs(relPath) {
  const path = resolve(root, relPath)
  const src = readFileSync(path, 'utf8')
  const next = src.replace(/version:\s*'[^']+'/, `version: '${version}'`)
  if (next === src) {
    throw new Error(`Could not find version field in ${relPath}`)
  }
  writeFileSync(path, next)
  console.log(`updated ${relPath} → ${version}`)
}

patchJson('package.json', (pkg) => {
  pkg.version = version
})
patchJson('packages/extension/package.json', (pkg) => {
  pkg.version = version
})
patchJson('packages/core/package.json', (pkg) => {
  pkg.version = version
})
patchManifestTs('packages/extension/manifest.config.ts')
