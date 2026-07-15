import {
  CredentialVault,
  MissingApiKeyError,
  PermissionEngine,
  filterToolsByPermission,
  fromConfig,
  getAgent,
  getModel,
  listTools,
  mergeRules,
  resolveModelRef,
  runAgentLoop,
  toAiSdkTools,
  toModelMessages,
  type ChatMessage,
  type ConfigService,
  type Envelope,
  type SessionStore,
  createResponse,
} from '@browser-agent/core'
import { createBrowserBridge } from '../browser/bridge.js'
import { bindSessionTab, getBoundTabId } from '../browser/session-tab.js'
import { startKeepalive, stopKeepalive, type MessageBus } from '../bus.js'

const browserBridge = createBrowserBridge()

export type AgentHandlerDeps = {
  config: ConfigService
  vault: CredentialVault
  sessions?: SessionStore
  permission?: PermissionEngine
}

const activeRuns = new Map<string, AbortController>()

const STUB_AUTO_ALLOW = new Set([
  'echo',
  'get_time',
  'tabs',
  'tab_focus',
  'page_read',
  'grep_page',
])

export function registerAgentHandlers(bus: MessageBus, deps: AgentHandlerDeps): void {
  const permission = deps.permission ?? new PermissionEngine()

  bus.on('agent.stop', (message) => {
    const payload = (message.payload ?? {}) as { id?: string }
    const runId = payload.id ?? message.id
    activeRuns.get(runId)?.abort()
    activeRuns.delete(runId)
    return createResponse(message, 'agent.stop', { ok: true })
  })

  bus.on('permission.reply', (message) => {
    const payload = (message.payload ?? {}) as {
      id?: string
      response?: 'once' | 'always' | 'reject'
    }
    if (!payload.id || !payload.response) {
      return createResponse(message, 'permission.reply', {
        ok: false,
        error: 'Missing permission reply id or response',
      })
    }
    permission.reply({ id: payload.id, response: payload.response })
    return createResponse(message, 'permission.reply', { ok: true })
  })

  bus.onPort('agent.prompt', async (message: Envelope, port) => {
    const payload = (message.payload ?? {}) as {
      messages?: ChatMessage[]
      agent?: string
      sessionId?: string
      tabId?: number
    }
    const requestId = message.id
    const controller = new AbortController()
    activeRuns.set(requestId, controller)

    let seq = 0
    const push = (event: Parameters<MessageBus['pushStreamEvent']>[0]) => {
      bus.pushStreamEvent(event, { port, id: requestId, seq })
      seq += 1
    }

    startKeepalive()
    try {
      const appConfig = await deps.config.get()
      const agentName = payload.agent ?? 'browse'
      const agentInfo = getAgent(agentName, appConfig)
      const modelRef = resolveModelRef(appConfig, agentName)

      if (!modelRef) {
        push({
          kind: 'error',
          message: 'No model selected. Choose a default model in Settings.',
        })
        port.postMessage(createResponse(message, 'agent.prompt', { ok: false }))
        return
      }

      const messages = payload.messages ?? []
      if (messages.length === 0) {
        push({ kind: 'error', message: 'No messages to send.' })
        port.postMessage(createResponse(message, 'agent.prompt', { ok: false }))
        return
      }

      const credential = await deps.vault.get(modelRef.providerID)
      const providerConfig = appConfig.provider[modelRef.providerID]

      const model = await getModel(modelRef.providerID, modelRef.modelID, {
        apiKey: credential?.secret,
        baseURL: providerConfig?.api,
        headers: providerConfig?.options?.headers,
        name: providerConfig?.name ?? modelRef.providerID,
      })

      const ruleset = mergeRules(
        fromConfig(appConfig.permission),
        agentInfo?.permission ?? [],
      )

      permission.onAsk((request) => {
        push({
          kind: 'permission-ask',
          requestId: request.id,
          permission: request.permission,
          patterns: request.patterns,
          metadata: request.metadata,
        })
        if (STUB_AUTO_ALLOW.has(request.permission)) {
          permission.reply({ id: request.id, response: 'once' })
        }
      })

      const sessionId = payload.sessionId ?? requestId
      if (payload.tabId != null) {
        bindSessionTab(sessionId, payload.tabId)
      }
      const boundTabId = payload.tabId ?? getBoundTabId(sessionId)
      const availableTools = filterToolsByPermission(listTools(), ruleset)

      let systemPrompt = agentInfo?.prompt
      if (boundTabId != null) {
        const tab = await browserBridge.tabsGet(boundTabId)
        if (tab) {
          systemPrompt = `${systemPrompt ?? ''}\n\nActive tab: "${tab.title}" — ${tab.url} (tabId ${tab.id})`.trim()
        }
      }

      const tools = toAiSdkTools(availableTools, {
        sessionId,
        tabId: payload.tabId,
        boundTabId,
        browser: browserBridge,
        signal: controller.signal,
        ask: (input) =>
          permission.ask({
            sessionID: sessionId,
            ruleset,
            permission: input.permission,
            patterns: input.patterns,
            metadata: input.metadata,
          }),
      })

      await runAgentLoop({
        model,
        messages: toModelMessages(messages),
        system: systemPrompt,
        tools,
        steps: agentInfo?.steps ?? 5,
        abortSignal: controller.signal,
        onEvent: push,
        session:
          payload.sessionId && deps.sessions
            ? { store: deps.sessions, sessionId: payload.sessionId }
            : undefined,
        doomLoop: {
          threshold: 3,
          onDetect: async () => {
            try {
              await permission.ask({
                sessionID: sessionId,
                ruleset,
                permission: 'doom_loop',
                patterns: ['*'],
              })
              return 'continue'
            } catch {
              return 'stop'
            }
          },
        },
      })

      port.postMessage(createResponse(message, 'agent.prompt', { ok: true }))
    } catch (err) {
      const messageText =
        err instanceof MissingApiKeyError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
      push({ kind: 'error', message: messageText })
      port.postMessage(createResponse(message, 'agent.prompt', { ok: false, error: messageText }))
    } finally {
      activeRuns.delete(requestId)
      stopKeepalive()
    }
  })
}

/** Test helper — clear in-flight abort controllers. */
export function resetAgentRunsForTests(): void {
  for (const controller of activeRuns.values()) {
    controller.abort()
  }
  activeRuns.clear()
}
