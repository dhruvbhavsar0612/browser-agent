#!/usr/bin/env node
import { resolve } from 'node:path'
import {
  MarketplaceValidationError,
  validateMarketplaceDirectory,
  writeCatalog,
} from './catalog.js'

export async function runCli(args: string[]): Promise<number> {
  const [command, directoryArg, outputArg] = args
  if (!command || !directoryArg || !['validate', 'generate'].includes(command)) {
    console.error(
      'Usage: browser-agent-marketplace <validate|generate> <marketplace-directory> [catalog.json]',
    )
    return 2
  }

  const directory = resolve(directoryArg)
  try {
    if (command === 'validate') {
      const items = await validateMarketplaceDirectory(directory)
      console.log(`Validated ${items.length} marketplace item(s) in ${directory}`)
      return 0
    }

    const output = resolve(outputArg ?? 'catalog.json')
    const catalog = await writeCatalog(directory, output)
    console.log(`Generated ${output} with ${catalog.items.length} item(s)`)
    return 0
  } catch (error) {
    if (error instanceof MarketplaceValidationError) {
      console.error(error.message)
    } else {
      console.error(error instanceof Error ? error.message : String(error))
    }
    return 1
  }
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) {
  process.exitCode = await runCli(process.argv.slice(2))
}
