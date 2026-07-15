import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import {
  CatalogSchema,
  MARKETPLACE_SCHEMA_VERSION,
  MarketplaceItemSchema,
  type MarketplaceCatalog,
  type MarketplaceItem,
} from './schemas.js'

export interface CatalogBuildOptions {
  now?: () => Date
}

export class MarketplaceValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Marketplace validation failed:\n${issues.map((issue) => `- ${issue}`).join('\n')}`)
    this.name = 'MarketplaceValidationError'
  }
}

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

const manifestFile = /\.(?:connector|skill|plugin)\.json$/

async function listManifestFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'catalog.json')
      .map(async (entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return listManifestFiles(path)
        if (entry.isFile() && manifestFile.test(entry.name)) return [path]
        return []
      }),
  )
  return nested.flat().sort()
}

function displayPath(root: string, path: string): string {
  return relative(root, path) || '.'
}

async function validateSkillContent(
  root: string,
  item: MarketplaceItem,
  sourceFile: string,
): Promise<string[]> {
  if (item.kind !== 'skill') return []

  const contentPath = resolve(root, item.instructions.path)
  const pathWithinRoot = relative(root, contentPath)
  if (pathWithinRoot.startsWith('..') || pathWithinRoot.includes('/../')) {
    return [`${displayPath(root, sourceFile)}: instructions path escapes marketplace root`]
  }

  try {
    const stat = await lstat(contentPath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return [`${item.instructions.path}: skill instructions must be a regular file`]
    }
    const content = await readFile(contentPath)
    const actual = sha256(content)
    if (actual !== item.checksum.digest) {
      return [
        `${item.instructions.path}: checksum mismatch (expected ${item.checksum.digest}, got ${actual})`,
      ]
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [`${item.instructions.path}: cannot read skill instructions (${message})`]
  }

  return []
}

export async function validateMarketplaceDirectory(root: string): Promise<MarketplaceItem[]> {
  const absoluteRoot = resolve(root)
  const files = await listManifestFiles(absoluteRoot)
  const issues: string[] = []
  const parsed: Array<{ item: MarketplaceItem; file: string }> = []

  for (const file of files) {
    let input: unknown
    try {
      input = JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      issues.push(
        `${displayPath(absoluteRoot, file)}: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
      )
      continue
    }

    const result = MarketplaceItemSchema.safeParse(input)
    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.push(
          `${displayPath(absoluteRoot, file)}:${issue.path.join('.') || '<root>'}: ${issue.message}`,
        )
      }
      continue
    }
    parsed.push({ item: result.data, file })
  }

  const identities = new Map<string, string>()
  for (const { item, file } of parsed) {
    const identity = `${item.kind}:${item.id}@${item.version}`
    const previous = identities.get(identity)
    if (previous) {
      issues.push(
        `${displayPath(absoluteRoot, file)}: duplicates ${identity} from ${displayPath(absoluteRoot, previous)}`,
      )
    } else {
      identities.set(identity, file)
    }
    issues.push(...(await validateSkillContent(absoluteRoot, item, file)))
  }

  const connectors = new Map<string, Extract<MarketplaceItem, { kind: 'connector' }>>()
  for (const { item } of parsed) {
    if (item.kind === 'connector') connectors.set(`${item.id}@${item.version}`, item)
  }
  const skills = new Set(
    parsed
      .filter(({ item }) => item.kind === 'skill')
      .map(({ item }) => `${item.id}@${item.version}`),
  )

  for (const { item, file } of parsed) {
    const source = displayPath(absoluteRoot, file)
    if (item.kind === 'skill') {
      for (const connector of item.requiredConnectors) {
        if (!connectors.has(`${connector.id}@${connector.version}`)) {
          issues.push(`${source}: missing required connector ${connector.id}@${connector.version}`)
        }
      }
      for (const tool of item.requiredTools) {
        const requirements = item.requiredConnectors.filter(
          (connector) => connector.id === tool.connectorId,
        )
        if (requirements.length === 0) {
          issues.push(
            `${source}: required tool ${tool.connectorId}/${tool.name} has no connector version requirement`,
          )
        }
        for (const requirement of requirements) {
          const connector = connectors.get(`${requirement.id}@${requirement.version}`)
          if (connector && !connector.capabilities.tools.includes(tool.name)) {
            issues.push(
              `${source}: connector ${requirement.id}@${requirement.version} does not declare tool ${tool.name}`,
            )
          }
        }
      }
    }
    if (item.kind === 'plugin') {
      if (!connectors.has(`${item.connector.id}@${item.connector.version}`)) {
        issues.push(
          `${source}: missing bundled connector ${item.connector.id}@${item.connector.version}`,
        )
      }
      for (const skill of item.skills) {
        if (!skills.has(`${skill.id}@${skill.version}`)) {
          issues.push(`${source}: missing bundled skill ${skill.id}@${skill.version}`)
        }
      }
    }
  }

  if (issues.length > 0) throw new MarketplaceValidationError(issues)
  return parsed.map(({ item }) => item)
}

export async function generateCatalog(
  root: string,
  options: CatalogBuildOptions = {},
): Promise<MarketplaceCatalog> {
  const items = await validateMarketplaceDirectory(root)
  items.sort((left, right) =>
    `${left.kind}:${left.id}@${left.version}`.localeCompare(
      `${right.kind}:${right.id}@${right.version}`,
    ),
  )
  return CatalogSchema.parse({
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    items,
  })
}

export async function writeCatalog(
  root: string,
  output: string,
  options: CatalogBuildOptions = {},
): Promise<MarketplaceCatalog> {
  const catalog = await generateCatalog(root, options)
  const target = resolve(output)
  const temporary = join(dirname(target), `.${target.split('/').at(-1)}.tmp`)
  await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
  return catalog
}
