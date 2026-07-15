import { describe, expect, it } from 'vitest'
import { evaluate } from './evaluate.js'
import {
  SENSITIVE_DEFAULT_RULES,
  buildRunRuleset,
  rulesForExecutionMode,
} from './modes.js'
import { fromConfig } from './evaluate.js'

describe('execution modes + sensitive defaults (DHR-63/64)', () => {
  it('AC: plan blocks click/type/navigate', () => {
    const rules = buildRunRuleset({
      executionMode: 'plan',
      agentRules: fromConfig({ click: 'ask', type: 'ask', navigate: 'ask' }),
      userPermission: { '*': 'ask' },
    })
    expect(evaluate('click', 'https://example.com', rules).action).toBe('deny')
    expect(evaluate('type', 'https://example.com', rules).action).toBe('deny')
    expect(evaluate('navigate', 'https://example.com', rules).action).toBe('deny')
    expect(evaluate('page_read', 'https://example.com', rules).action).toBe('allow')
  })

  it('AC: approval keeps write tools as ask', () => {
    const rules = buildRunRuleset({
      executionMode: 'approval',
      agentRules: fromConfig({ click: 'ask', page_read: 'allow' }),
      userPermission: { '*': 'ask', page_read: 'allow' },
    })
    expect(evaluate('click', 'https://example.com/docs', rules).action).toBe('ask')
    expect(evaluate('page_read', 'https://example.com/docs', rules).action).toBe('allow')
  })

  it('AC: auto allows tools unless sensitive deny wins', () => {
    const rules = buildRunRuleset({
      executionMode: 'auto',
      agentRules: fromConfig({ click: 'ask' }),
      userPermission: { '*': 'ask' },
    })
    expect(evaluate('click', 'https://example.com/docs', rules).action).toBe('allow')
    expect(evaluate('click', 'https://shop.example/checkout', rules).action).toBe('deny')
    expect(evaluate('type', 'https://app.example/login', rules).action).toBe('deny')
  })

  it('AC: user can deny github.com clicks via site rules', () => {
    const rules = buildRunRuleset({
      executionMode: 'auto',
      userPermission: {
        click: {
          'https://github.com/*': 'deny',
        },
      },
    })
    expect(evaluate('click', 'https://github.com/foo/bar', rules).action).toBe('deny')
    expect(evaluate('click', 'https://example.com', rules).action).toBe('allow')
  })

  it('AC: sensitive defaults protect checkout/payment/login', () => {
    for (const url of [
      'https://store.com/checkout',
      'https://pay.example/payment/card',
      'https://app.example/login',
    ]) {
      expect(evaluate('click', url, SENSITIVE_DEFAULT_RULES).action).toBe('deny')
    }
  })

  it('plan mode overlay is empty for approval', () => {
    expect(rulesForExecutionMode('approval')).toEqual([])
  })
})
