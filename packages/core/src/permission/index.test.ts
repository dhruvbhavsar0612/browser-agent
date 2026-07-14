import { describe, expect, it, vi } from 'vitest'
import {
  evaluate,
  fromConfig,
  PermissionDeniedError,
  PermissionEngine,
  PermissionRejectedError,
} from './index.js'

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

  it('matches URL globs', () => {
    const rules = fromConfig({
      navigate: {
        'https://*.google.com/*': 'allow',
        'https://mail.google.com/*': 'deny',
      },
    })
    expect(evaluate('navigate', 'https://www.google.com/search', rules).action).toBe('allow')
    expect(evaluate('navigate', 'https://mail.google.com/inbox', rules).action).toBe('deny')
  })
})

describe('PermissionEngine', () => {
  const sessionID = 'ses_test'

  it('allow short-circuits without onAsk', async () => {
    const onAsk = vi.fn()
    const engine = new PermissionEngine({
      ruleset: fromConfig({ click: { 'https://github.com/*': 'allow' } }),
      onAsk,
    })

    await expect(
      engine.ask({
        sessionID,
        permission: 'click',
        patterns: ['https://github.com/foo'],
      }),
    ).resolves.toBeUndefined()

    expect(onAsk).not.toHaveBeenCalled()
    expect(engine.listPending()).toHaveLength(0)
  })

  it('deny throws PermissionDeniedError', async () => {
    const engine = new PermissionEngine({
      ruleset: fromConfig({ click: { 'https://evil.com/*': 'deny' } }),
    })

    await expect(
      engine.ask({
        sessionID,
        permission: 'click',
        patterns: ['https://evil.com/phish'],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError)

    expect(engine.listPending()).toHaveLength(0)
  })

  it('deny wins when any pattern is denied', async () => {
    const engine = new PermissionEngine({
      ruleset: fromConfig({
        click: {
          'https://ok.com/*': 'allow',
          'https://evil.com/*': 'deny',
        },
      }),
    })

    await expect(
      engine.ask({
        sessionID,
        permission: 'click',
        patterns: ['https://ok.com/a', 'https://evil.com/b'],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError)
  })

  it('ask waits then once resolves without persisting', async () => {
    const onAsk = vi.fn()
    const engine = new PermissionEngine({
      ruleset: fromConfig({ navigate: { '*': 'ask' } }),
      onAsk,
    })

    const promise = engine.ask({
      sessionID,
      permission: 'navigate',
      patterns: ['https://example.com'],
      metadata: { tool: 'navigate' },
    })

    expect(onAsk).toHaveBeenCalledOnce()
    const request = onAsk.mock.calls[0]![0]!
    expect(request.permission).toBe('navigate')
    expect(request.patterns).toEqual(['https://example.com'])
    expect(engine.listPending()).toHaveLength(1)

    engine.reply({ id: request.id, response: 'once' })
    await expect(promise).resolves.toBeUndefined()
    expect(engine.listPending()).toHaveLength(0)
    expect(engine.getApproved(sessionID)).toHaveLength(0)

    // once does NOT persist — subsequent ask needs another reply
    const onAsk2 = vi.fn()
    engine.onAsk(onAsk2)
    const again = engine.ask({
      sessionID,
      permission: 'navigate',
      patterns: ['https://example.com'],
    })
    expect(onAsk2).toHaveBeenCalledOnce()
    engine.reply({ id: onAsk2.mock.calls[0]![0]!.id, response: 'once' })
    await again
  })

  it('ask waits then always persists for subsequent asks', async () => {
    const onAsk = vi.fn()
    const engine = new PermissionEngine({
      ruleset: fromConfig({ click: { '*': 'ask' } }),
      onAsk,
    })

    const pattern = 'https://github.com/repo'
    const first = engine.ask({
      sessionID,
      permission: 'click',
      patterns: [pattern],
    })

    const request = onAsk.mock.calls[0]![0]!
    engine.reply({ id: request.id, response: 'always' })
    await first

    expect(engine.getApproved(sessionID)).toEqual([
      { permission: 'click', pattern, action: 'allow' },
    ])

    onAsk.mockClear()
    await expect(
      engine.ask({
        sessionID,
        permission: 'click',
        patterns: [pattern],
      }),
    ).resolves.toBeUndefined()
    expect(onAsk).not.toHaveBeenCalled()
  })

  it('ask waits then reject throws PermissionRejectedError', async () => {
    const onAsk = vi.fn()
    const engine = new PermissionEngine({
      ruleset: fromConfig({ type: { '*': 'ask' } }),
      onAsk,
    })

    const promise = engine.ask({
      sessionID,
      permission: 'type',
      patterns: ['https://example.com'],
    })

    engine.reply({ id: onAsk.mock.calls[0]![0]!.id, response: 'reject' })
    await expect(promise).rejects.toBeInstanceOf(PermissionRejectedError)
    expect(engine.listPending()).toHaveLength(0)
    expect(engine.getApproved(sessionID)).toHaveLength(0)
  })

  it('always does not affect other sessions', async () => {
    const onAsk = vi.fn()
    const engine = new PermissionEngine({
      ruleset: fromConfig({ click: { '*': 'ask' } }),
      onAsk,
    })

    const pattern = 'https://github.com/x'
    const a = engine.ask({ sessionID: 'ses_a', permission: 'click', patterns: [pattern] })
    engine.reply({ id: onAsk.mock.calls[0]![0]!.id, response: 'always' })
    await a

    onAsk.mockClear()
    const b = engine.ask({ sessionID: 'ses_b', permission: 'click', patterns: [pattern] })
    expect(onAsk).toHaveBeenCalledOnce()
    engine.reply({ id: onAsk.mock.calls[0]![0]!.id, response: 'once' })
    await b
  })

  it('per-call ruleset overrides base ruleset', async () => {
    const engine = new PermissionEngine({
      ruleset: fromConfig({ click: { '*': 'deny' } }),
    })

    await expect(
      engine.ask({
        sessionID,
        permission: 'click',
        patterns: ['https://x.com'],
        ruleset: fromConfig({ click: { '*': 'allow' } }),
      }),
    ).resolves.toBeUndefined()
  })

  it('always auto-resolves other pending asks now covered', async () => {
    const requests: { id: string }[] = []
    const engine = new PermissionEngine({
      ruleset: fromConfig({ click: { '*': 'ask' } }),
      onAsk: (req) => requests.push(req),
    })

    const pattern = 'https://github.com/same'
    const a = engine.ask({ sessionID, permission: 'click', patterns: [pattern] })
    const b = engine.ask({ sessionID, permission: 'click', patterns: [pattern] })

    expect(engine.listPending()).toHaveLength(2)
    engine.reply({ id: requests[0]!.id, response: 'always' })
    await expect(a).resolves.toBeUndefined()
    await expect(b).resolves.toBeUndefined()
    expect(engine.listPending()).toHaveLength(0)
  })
})
