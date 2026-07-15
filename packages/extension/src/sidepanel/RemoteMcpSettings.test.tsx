import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RemoteMcpSettings } from './RemoteMcpSettings.js'

describe('RemoteMcpSettings', () => {
  it('renders direct URL, transport/auth, and canonical marketplace controls', () => {
    const html = renderToStaticMarkup(<RemoteMcpSettings />)
    expect(html).toContain('Remote MCP servers')
    expect(html).toContain('Add direct remote URL')
    expect(html).toContain('Streamable HTTP')
    expect(html).toContain('OAuth 2.1')
    expect(html).toContain('Official MCP Registry')
    expect(html).toContain('Search Official MCP Registry')
  })
})
