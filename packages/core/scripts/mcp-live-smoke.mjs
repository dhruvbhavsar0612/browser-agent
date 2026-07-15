#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'

const url = process.env.MCP_TEST_URL
if (!url) {
  console.log('SKIP: set MCP_TEST_URL to run the live Remote MCP smoke test')
  process.exit(0)
}

const parsed = new URL(url)
if (
  parsed.protocol !== 'https:' &&
  !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
) {
  throw new Error('MCP_TEST_URL must use HTTPS (HTTP is allowed for localhost only)')
}

const headers = process.env.MCP_TEST_TOKEN
  ? { Authorization: `Bearer ${process.env.MCP_TEST_TOKEN}` }
  : {}
const requestInit = { headers }
let client
let transport
let transportName

try {
  client = new Client({ name: 'browser-agent-live-smoke', version: '0.0.1' })
  transport = new StreamableHTTPClientTransport(parsed, { requestInit })
  await client.connect(transport)
  transportName = 'streamable-http'
} catch (streamableError) {
  await transport?.close().catch(() => undefined)
  client = new Client({ name: 'browser-agent-live-smoke', version: '0.0.1' })
  transport = new SSEClientTransport(parsed, { requestInit })
  try {
    await client.connect(transport)
    transportName = 'sse'
  } catch (sseError) {
    throw new Error(
      `Both MCP transports failed.\nStreamable HTTP: ${String(streamableError)}\nSSE: ${String(sseError)}`,
    )
  }
}

try {
  const listed = await client.listTools()
  console.log(
    JSON.stringify(
      {
        transport: transportName,
        server: client.getServerVersion(),
        protocol: transport.protocolVersion ?? 'negotiated',
        tools: listed.tools.map((item) => ({
          name: item.name,
          description: item.description,
          annotations: item.annotations,
        })),
      },
      null,
      2,
    ),
  )

  const requestedName = process.env.MCP_TEST_TOOL
  const selected = requestedName
    ? listed.tools.find((item) => item.name === requestedName)
    : listed.tools.find(
        (item) =>
          item.annotations?.readOnlyHint === true &&
          item.annotations?.destructiveHint !== true &&
          item.annotations?.openWorldHint !== true,
      )
  if (!selected) {
    throw new Error(
      requestedName
        ? `Configured MCP_TEST_TOOL "${requestedName}" was not discovered`
        : 'No tool explicitly annotated as safe read-only was discovered; set MCP_TEST_TOOL only after reviewing annotations',
    )
  }
  if (
    selected.annotations?.readOnlyHint !== true ||
    selected.annotations?.destructiveHint === true ||
    selected.annotations?.openWorldHint === true
  ) {
    throw new Error(
      `Refusing to call "${selected.name}" because it is not explicitly safe read-only`,
    )
  }

  let args = {}
  if (process.env.MCP_TEST_ARGS) {
    args = JSON.parse(process.env.MCP_TEST_ARGS)
  }
  const result = await client.callTool({ name: selected.name, arguments: args })
  console.log(JSON.stringify({ called: selected.name, result }, null, 2))
  if (result.isError) process.exitCode = 1
} finally {
  await transport.close()
}
