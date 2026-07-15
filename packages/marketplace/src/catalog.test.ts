import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MarketplaceValidationError,
  generateCatalog,
  validateMarketplaceDirectory,
  writeCatalog,
} from './catalog.js'

const temporaryDirectories: string[] = []

async function fixtureDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'browser-agent-marketplace-'))
  temporaryDirectories.push(root)
  await cp(new URL('../examples', import.meta.url), root, { recursive: true })
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('catalog generation', () => {
  it('validates references and generates a stable ordered catalog', async () => {
    const root = await fixtureDirectory()
    const catalog = await generateCatalog(root, {
      now: () => new Date('2026-07-15T12:00:00.000Z'),
    })

    expect(catalog.generatedAt).toBe('2026-07-15T12:00:00.000Z')
    expect(catalog.items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'connector:dev.browser-agent/example-search',
      'plugin:dev.browser-agent/research-kit',
      'skill:dev.browser-agent/research',
    ])
  })

  it('writes catalog.json that can be validated again', async () => {
    const root = await fixtureDirectory()
    const output = join(root, 'catalog.json')
    await writeCatalog(root, output, {
      now: () => new Date('2026-07-15T12:00:00.000Z'),
    })

    const written = JSON.parse(await readFile(output, 'utf8')) as { items: unknown[] }
    expect(written.items).toHaveLength(3)
    await expect(validateMarketplaceDirectory(root)).resolves.toHaveLength(3)
  })

  it('reports executable fields and tampered skill content', async () => {
    const root = await fixtureDirectory()
    const connectorPath = join(root, 'connectors/example-search.connector.json')
    const connector = JSON.parse(await readFile(connectorPath, 'utf8')) as Record<string, unknown>
    await writeFile(
      connectorPath,
      JSON.stringify({ ...connector, command: 'node arbitrary.js' }),
      'utf8',
    )
    await writeFile(join(root, 'skills/research.md'), '# tampered\n', 'utf8')

    await expect(validateMarketplaceDirectory(root)).rejects.toEqual(
      expect.objectContaining<Partial<MarketplaceValidationError>>({
        name: 'MarketplaceValidationError',
        issues: expect.arrayContaining([
          expect.stringContaining('Unrecognized key'),
          expect.stringContaining('checksum mismatch'),
        ]),
      }),
    )
  })
})
