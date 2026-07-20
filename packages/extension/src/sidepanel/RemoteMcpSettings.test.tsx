import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RemoteMcpSettings } from './RemoteMcpSettings.js'

describe('RemoteMcpSettings', () => {
  it('renders section heading and search bar', () => {
    const html = renderToStaticMarkup(<RemoteMcpSettings />)
    expect(html).toContain('Remote MCP servers')
    expect(html).toContain('Search installed servers, presets, and registry')
    expect(html).toContain('Add server')
  })

  it('renders curated preset cards', () => {
    const html = renderToStaticMarkup(<RemoteMcpSettings />)
    expect(html).toContain('GitHub')
    expect(html).toContain('Context7 Docs')
    expect(html).toContain('Linear')
    expect(html).toContain('Notion')
    expect(html).toContain('Sentry')
    expect(html).toContain('Custom Remote MCP')
  })

  it('renders preset section label', () => {
    const html = renderToStaticMarkup(<RemoteMcpSettings />)
    expect(html).toContain('Presets')
  })

  it('renders OAuth 2.1 auth badge on OAuth presets', () => {
    const html = renderToStaticMarkup(<RemoteMcpSettings />)
    expect(html).toContain('OAuth 2.1')
  })

  it('renders Streamable HTTP in transport hint', () => {
    const html = renderToStaticMarkup(<RemoteMcpSettings />)
    expect(html).toContain('Streamable HTTP')
  })

  it('renders category badges on preset cards', () => {
    const html = renderToStaticMarkup(<RemoteMcpSettings />)
    expect(html).toContain('Projects')
    expect(html).toContain('Docs')
    expect(html).toContain('Dev Tools')
  })

  it('renders HTTPS and secret encryption hint', () => {
    const html = renderToStaticMarkup(<RemoteMcpSettings />)
    expect(html).toContain('HTTPS')
    expect(html).toContain('encrypted')
  })

  it('Add server button is present in the search row', () => {
    const html = renderToStaticMarkup(<RemoteMcpSettings />)
    // Button text
    expect(html).toContain('Add server')
    // aria-label on search input
    expect(html).toContain('Search MCP servers')
  })

  it('does not render the add form panel by default', () => {
    const html = renderToStaticMarkup(<RemoteMcpSettings />)
    // The form panel title only appears when form is open
    expect(html).not.toContain('Add MCP server')
  })

  it('does not render installed servers section when no servers exist', () => {
    const html = renderToStaticMarkup(<RemoteMcpSettings />)
    expect(html).not.toContain('Installed')
  })

  it('does not render Official Registry section when search is empty', () => {
    const html = renderToStaticMarkup(<RemoteMcpSettings />)
    expect(html).not.toContain('Official Registry')
  })
})
