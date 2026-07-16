import { readFile } from 'node:fs/promises'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import {
  ConnectorManifestSchema,
  MarketplaceItemSchema,
  PluginManifestSchema,
  SkillManifestSchema,
} from './schemas.js'

async function json(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >
}

describe('marketplace schemas', () => {
  it('accepts safe connector, skill, and plugin fixtures', async () => {
    const [connector, skill, plugin] = await Promise.all([
      json('../examples/connectors/example-search.connector.json'),
      json('../examples/skills/research.skill.json'),
      json('../examples/plugins/research.plugin.json'),
    ])

    expect(ConnectorManifestSchema.parse(connector).kind).toBe('connector')
    expect(SkillManifestSchema.parse(skill).kind).toBe('skill')
    expect(PluginManifestSchema.parse(plugin).kind).toBe('plugin')
  })

  it('compiles the versioned JSON Schemas and validates fixtures', async () => {
    const schemaNames = [
      'common.schema.json',
      'connector.schema.json',
      'skill.schema.json',
      'plugin.schema.json',
      'catalog.schema.json',
    ]
    const schemas = await Promise.all(schemaNames.map((name) => json(`../schemas/v1/${name}`)))
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
    addFormats(ajv)
    for (const schema of schemas) ajv.addSchema(schema)

    const fixtures = await Promise.all([
      json('../examples/connectors/example-search.connector.json'),
      json('../examples/skills/research.skill.json'),
      json('../examples/plugins/research.plugin.json'),
    ])
    for (const fixture of fixtures) {
      const validate = ajv.getSchema(
        `https://schemas.browser-agent.dev/marketplace/v1/${String(fixture.kind)}.schema.json`,
      )
      expect(validate, String(fixture.kind)).toBeDefined()
      expect(validate?.(fixture), JSON.stringify(validate?.errors)).toBe(true)
    }

    const connectorValidator = ajv.getSchema(
      'https://schemas.browser-agent.dev/marketplace/v1/connector.schema.json',
    )
    expect(connectorValidator?.({ ...(fixtures[0] ?? {}), javascript: 'malicious()' })).toBe(false)

    const plugin = fixtures[2] ?? {}
    const pluginValidator = ajv.getSchema(
      'https://schemas.browser-agent.dev/marketplace/v1/plugin.schema.json',
    )
    expect(
      pluginValidator?.({
        ...plugin,
        connector: {
          ...(plugin.connector as Record<string, unknown>),
          command: 'node server.js',
        },
      }),
    ).toBe(false)
  })

  it('rejects executable fields at every declarative boundary', async () => {
    const connector = await json('../examples/connectors/example-search.connector.json')
    const plugin = await json('../examples/plugins/research.plugin.json')

    expect(
      MarketplaceItemSchema.safeParse({ ...connector, javascript: 'fetch("/steal")' }).success,
    ).toBe(false)
    expect(
      MarketplaceItemSchema.safeParse({
        ...plugin,
        connector: {
          ...(plugin.connector as Record<string, unknown>),
          command: 'node server.js',
        },
      }).success,
    ).toBe(false)
    expect(
      MarketplaceItemSchema.safeParse({
        ...plugin,
        skills: [
          {
            ...((plugin.skills as Array<Record<string, unknown>>)[0] ?? {}),
            entrypoint: './run.js',
          },
        ],
      }).success,
    ).toBe(false)
  })
})
