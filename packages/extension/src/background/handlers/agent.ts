import {
  CredentialVault,
  MissingApiKeyError,
  PermissionEngine,
  buildRunRuleset,
  credentialSecretToApiKey,
  filterToolsByPermission,
  getAgent,
  getModel,
  listTools,
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
import { detachAll } from '../browser/debugger.js'
import { hideAllAgentIndicators, showAgentIndicator } from '../browser/indicator.js'
import { bindSessionTab, getBoundTabId } from '../browser/session-tab.js'
import { createGroupForSession } from '../browser/tab-group.js'
import { startKeepalive, stopKeepalive, type MessageBus } from '../bus.js'

const browserBridge = createBrowserBridge()

export type AgentHandlerDeps = {
  config: ConfigService
  vault: CredentialVault
  sessions?: SessionStore
  permission?: PermissionEngine
}

const activeRuns = new Map<string, AbortController>()

export function registerAgentHandlers(bus: MessageBus, deps: AgentHandlerDeps): void {
  const permission = deps.permission ?? new PermissionEngine()

  bus.on('agent.stop', (message) => {
    const payload = (message.payload ?? {}) as { id?: string }
    const runId = payload.id ?? message.id
    activeRuns.get(runId)?.abort()
    activeRuns.delete(runId)
    void detachAll()
    void hideAllAgentIndicators()
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
    try {
      permission.reply({ id: payload.id, response: payload.response })
      return createResponse(message, 'permission.reply', { ok: true })
    } catch (err) {
      return createResponse(message, 'permission.reply', {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
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
        apiKey: credential
          ? credentialSecretToApiKey(credential.secret, credential.type)
          : undefined,
        baseURL: providerConfig?.api,
        headers: providerConfig?.options?.headers,
        name: providerConfig?.name ?? modelRef.providerID,
      })

      const ruleset = buildRunRuleset({
        executionMode: appConfig.executionMode,
        agentRules: agentInfo?.permission,
        userPermission: appConfig.permission,
      })

      permission.onAsk((request) => {
        push({
          kind: 'permission-ask',
          requestId: request.id,
          permission: request.permission,
          patterns: request.patterns,
          metadata: request.metadata,
        })
      })

      const sessionId = payload.sessionId ?? requestId
      if (payload.tabId != null) {
        bindSessionTab(sessionId, payload.tabId)
        void createGroupForSession(sessionId, payload.tabId)
        void showAgentIndicator(payload.tabId)
      }
      const boundTabId = payload.tabId ?? getBoundTabId(sessionId)
      if (boundTabId != null && payload.tabId == null) {
        void showAgentIndicator(boundTabId)
      }
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
          onDetect: async (info) => {
            try {
              await permission.ask({
                sessionID: sessionId,
                ruleset,
                permission: 'doom_loop',
                patterns: ['*'],
                metadata: info,
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
      void hideAllAgentIndicators()
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
