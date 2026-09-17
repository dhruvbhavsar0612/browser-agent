import { CLIENT_USER_AGENT } from '@browser-agent/core'

const OPENCODE_USER_AGENT_RULE_ID = 31_001

/**
 * Chrome forbids setting User-Agent on fetch Headers. OpenCode Go requires a
 * non-generic User-Agent, so inject it with declarativeNetRequest instead.
 * https://opencode.ai/docs/go/#where-can-i-use-it
 */
export async function installOpenCodeUserAgentRule(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest?.updateDynamicRules) {
    return
  }

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [OPENCODE_USER_AGENT_RULE_ID],
      addRules: [
        {
          id: OPENCODE_USER_AGENT_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
            requestHeaders: [
              {
                header: 'User-Agent',
                operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
                value: CLIENT_USER_AGENT,
              },
            ],
          },
          condition: {
            urlFilter: '||opencode.ai/',
            resourceTypes: [
              'xmlhttprequest',
              'other',
            ] as chrome.declarativeNetRequest.ResourceType[],
          },
        },
      ],
    })
  } catch (error) {
    console.warn('[browser-agent] failed to install OpenCode User-Agent rule', error)
  }
}
