import { describe, expect, it } from 'vitest'
import { appendBrowserToolSkill, browserToolSkillFor } from './browser-tools.js'

describe('browser tool skills', () => {
  it('returns mode-specific playbooks for browse/act/explore', () => {
    expect(browserToolSkillFor('browse')).toContain('Browse mode')
    expect(browserToolSkillFor('act')).toContain('Act mode')
    expect(browserToolSkillFor('explore')).toContain('Explore mode')
    expect(browserToolSkillFor('title')).toBeUndefined()
  })

  it('appends the skill under the agent system prompt', () => {
    const merged = appendBrowserToolSkill('You are the act agent.', 'act')
    expect(merged).toContain('You are the act agent.')
    expect(merged).toContain('page_read')
    expect(merged).toContain('ref_N')
  })
})
