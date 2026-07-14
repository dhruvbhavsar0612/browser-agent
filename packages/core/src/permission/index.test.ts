import { describe, expect, it } from 'vitest'
import { evaluate, fromConfig } from './index.js'

describe('permission evaluate', () => {
  it('defaults to ask when no rules match', () => {
    const rule = evaluate('click', 'https://example.com', [])
    expect(rule.action).toBe('ask')
  })

  it('uses last matching rule', () => {
    const rules = fromConfig({
      click: {
        '*': 'ask',
        'https://github.com/*': 'allow',
      },
    })
    expect(evaluate('click', 'https://github.com/foo', rules).action).toBe('allow')
    expect(evaluate('click', 'https://evil.com', rules).action).toBe('ask')
  })

  it('supports global allow', () => {
    const rules = fromConfig({ '*': 'allow' })
    expect(evaluate('navigate', 'https://x.com', rules).action).toBe('allow')
  })
})
