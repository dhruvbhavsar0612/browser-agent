import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CLIENT_USER_AGENT } from '@browser-agent/core'
import { installOpenCodeUserAgentRule } from './opencode-headers.js'

describe('installOpenCodeUserAgentRule', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      declarativeNetRequest: {
        updateDynamicRules: vi.fn(async () => undefined),
      },
    })
  })

  it('injects browser-agent User-Agent for opencode.ai requests', async () => {
    await installOpenCodeUserAgentRule()
    expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith(
      expect.objectContaining({
        addRules: [
          expect.objectContaining({
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                { header: 'User-Agent', operation: 'set', value: CLIENT_USER_AGENT },
              ],
            },
            condition: expect.objectContaining({ urlFilter: '||opencode.ai/' }),
          }),
        ],
      }),
    )
  })
})
