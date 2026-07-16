/**
 * Built-in browser tool playbook injected into agent system prompts.
 * Marketplace skills can extend this later; these defaults ship with the extension.
 */

export const BROWSER_TOOL_SKILL_ID = 'builtin.browser-tools'

const SHARED_BROWSER_SKILL = `## Browser tool skill

Orientation
- Start with \`tabs_list\` when you need to know what is open.
- Prefer \`page_read\` for text/structure. It returns compact a11y nodes with \`ref_N\` ids.
- Use \`page_grep\` to find labels/text before clicking.
- Use \`page_screenshot\` only when layout/visuals matter or text extraction is insufficient. Prefer JPEG.
- Keep using the active/session tab unless the user asks otherwise.

Acting on the page
- Click/type/hover/select by \`refId\` from the latest \`page_read\` (e.g. \`ref_12\`). Do not invent refs.
- After navigation or major UI changes, call \`page_read\` again before the next action.
- For forms: focus with click/ref, then type. Prefer paste only when rich-text editors need it.
- If a permission ask appears, wait — the user must approve, reject, or allow for the session.

Failure handling
- On wrong-ref / missing element errors: re-read the page, then retry with a fresh ref.
- On screenshot or debugger errors: report the error clearly; try \`page_read\` as a text fallback.
- Stop and summarize if you are blocked by login walls, CAPTCHA, or repeated identical failures.`

const BROWSE_SKILL = `${SHARED_BROWSER_SKILL}

Browse mode
- Read-only: do not click, type, scroll-to-act, or navigate.
- Answer from page content; cite titles/URLs when helpful.
- If the user needs mutation, say so and suggest switching to the Act agent.`

const ACT_SKILL = `${SHARED_BROWSER_SKILL}

Act mode
- Break tasks into short observe → act → verify loops.
- Confirm destructive/irreversible steps when uncertain.
- Prefer stable refs and describe what you are about to do in brief status text.`

const EXPLORE_SKILL = `${SHARED_BROWSER_SKILL}

Explore mode
- Survey tabs quickly; return a compact briefing only.
- Read-only: no click/type/navigate.`

export function browserToolSkillFor(agentName: string): string | undefined {
  switch (agentName) {
    case 'browse':
      return BROWSE_SKILL
    case 'act':
      return ACT_SKILL
    case 'explore':
      return EXPLORE_SKILL
    default:
      return undefined
  }
}

export function appendBrowserToolSkill(
  systemPrompt: string | undefined,
  agentName: string,
): string | undefined {
  const skill = browserToolSkillFor(agentName)
  if (!skill) return systemPrompt
  return [systemPrompt, skill].filter(Boolean).join('\n\n') || undefined
}
