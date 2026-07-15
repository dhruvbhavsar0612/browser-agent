import {
  CredentialVault,
  MissingApiKeyError,
  PermissionEngine,
  buildRunRuleset,
  createMcpAiSdkTools,
  credentialSecretToApiKey,
  filterToolsByPermission,
  generateText,
  getAgent,
  getModel,
  isModelEnabled,
  listTools,
  parseModelRef,
  prepareSessionPrompt,
  resolveModelRef,
  runAgentLoop,
  toAiSdkTools,
  toModelMessages,
  type ChatMessage,
  type CompactionStatus,
  type ConfigService,
  type Envelope,
  type ModelsDevService,
  type RemoteMcpRegistry,
  type SessionStore,
  COMPACTION_SUMMARY_SYSTEM_PROMPT,
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
  models?: ModelsDevService
  permission?: PermissionEngine
  mcp?: RemoteMcpRegistry
}

const activeRuns = new Map<string, AbortController>()

function systemWithSummary(
  system: string | undefined,
  summary: string | undefined,
): string | undefined {
  return (
    [
      system,
      summary
        ? `Durable summary of earlier conversation turns (original transcript remains stored):\n${summary}`
        : undefined,
    ]
      .filter(Boolean)
      .join('\n\n') || undefined
  )
}

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
      const session =
        payload.sessionId && deps.sessions
          ? await deps.sessions.getSession(payload.sessionId)
          : null
      const modelRef = resolveModelRef(appConfig, agentName, session?.model)

      if (!modelRef) {
        push({
          kind: 'error',
          message: 'No model selected. Choose a default model in Settings.',
        })
        port.postMessage(createResponse(message, 'agent.prompt', { ok: false }))
        return
      }
      if (!isModelEnabled(appConfig, modelRef.providerID, modelRef.modelID)) {
        push({
          kind: 'error',
          message: `The selected model "${modelRef.providerID}/${modelRef.modelID}" is disabled. Enable it in Settings or choose another model for this chat.`,
        })
        port.postMessage(createResponse(message, 'agent.prompt', { ok: false }))
        return
      }

      const messages = payload.messages ?? []
      const newestUserMessage = [...messages]
        .reverse()
        .find((item) => item.role === 'user')
        ?.content.trim()
      if (!newestUserMessage) {
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
          systemPrompt =
            `${systemPrompt ?? ''}\n\nActive tab: "${tab.title}" — ${tab.url} (tabId ${tab.id})`.trim()
        }
      }

      const browserTools = toAiSdkTools(availableTools, {
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
      const remoteTools = deps.mcp
        ? await createMcpAiSdkTools({
            registry: deps.mcp,
            appConfig,
            permission,
            ruleset,
            sessionId,
            signal: controller.signal,
            maxResultChars: appConfig.compaction.maxToolResultChars,
            occupiedNames: Object.keys(browserTools),
          })
        : { tools: {}, metadata: {}, errors: [] }
      const tools = { ...browserTools, ...remoteTools.tools }
      if (remoteTools.errors.length) {
        console.warn('[browser-agent] unavailable MCP servers', remoteTools.errors)
      }

      let promptMessages = toModelMessages(messages)
      let promptSystem = systemPrompt
      const activeModelRef = `${modelRef.providerID}/${modelRef.modelID}`
      let discoveredContext: number | undefined
      try {
        discoveredContext = (
          await deps.models?.getCachedProvider(modelRef.providerID)
        )?.provider.models.find((item) => item.id === modelRef.modelID)?.context
      } catch {
        discoveredContext = undefined
      }

      const summarize = async (input: string): Promise<string> => {
        const compactAgentPrompt =
          getAgent('compact', appConfig)?.prompt ?? COMPACTION_SUMMARY_SYSTEM_PROMPT
        const system = `${COMPACTION_SUMMARY_SYSTEM_PROMPT}\n\n${compactAgentPrompt}`
        let summaryModel = model

        if (appConfig.small_model) {
          try {
            const smallRef = parseModelRef(appConfig.small_model)
            if (!isModelEnabled(appConfig, smallRef.providerID, smallRef.modelID)) {
              throw new Error('Configured small model is not enabled')
            }
            const smallCredential = await deps.vault.get(smallRef.providerID)
            const smallProvider = appConfig.provider[smallRef.providerID]
            summaryModel = await getModel(smallRef.providerID, smallRef.modelID, {
              apiKey: smallCredential
                ? credentialSecretToApiKey(smallCredential.secret, smallCredential.type)
                : undefined,
              baseURL: smallProvider?.api,
              headers: smallProvider?.options?.headers,
              name: smallProvider?.name ?? smallRef.providerID,
            })
          } catch {
            summaryModel = model
          }
        }

        try {
          return (await generateText({ model: summaryModel, system, prompt: input })).text
        } catch (error) {
          if (summaryModel === model) throw error
          return (await generateText({ model, system, prompt: input })).text
        }
      }

      const reportCompaction = (status: CompactionStatus) => {
        push({
          kind: 'compaction',
          status: status.status,
          message:
            status.status === 'started'
              ? 'Compacting earlier conversation turns…'
              : status.status === 'completed'
                ? `Compacted ${status.compactedMessages} older messages.`
                : `Compaction failed; continuing with existing context: ${status.message}`,
          epoch: status.status === 'completed' ? status.epoch : undefined,
        })
      }

      if (payload.sessionId) {
        if (!deps.sessions) {
          throw new Error('Session transcript store is unavailable.')
        }
        const prepared = await prepareSessionPrompt({
          store: deps.sessions,
          sessionId: payload.sessionId,
          newestUserMessage,
          discoveredContext,
          config: appConfig.compaction,
          system: systemPrompt,
          sourceModel: activeModelRef,
          summarize,
          onCompaction: reportCompaction,
        })
        promptMessages = prepared.messages
        promptSystem = systemWithSummary(systemPrompt, prepared.summary)
        await deps.sessions.updateSession(payload.sessionId, { model: activeModelRef })
      }

      await runAgentLoop({
        model,
        messages: promptMessages,
        system: promptSystem,
        tools,
        steps: agentInfo?.steps ?? 5,
        abortSignal: controller.signal,
        onEvent: push,
        session:
          payload.sessionId && deps.sessions
            ? { store: deps.sessions, sessionId: payload.sessionId }
            : undefined,
        onContextOverflow:
          payload.sessionId && deps.sessions
            ? async () => {
                push({
                  kind: 'compaction',
                  status: 'retrying',
                  message: 'Context limit reached. Compacting and retrying once…',
                })
                const retry = await prepareSessionPrompt({
                  store: deps.sessions!,
                  sessionId: payload.sessionId!,
                  discoveredContext,
                  config: appConfig.compaction,
                  system: systemPrompt,
                  sourceModel: activeModelRef,
                  force: true,
                  summarize,
                  onCompaction: reportCompaction,
                })
                if (!retry.compacted) return null
                return {
                  messages: retry.messages,
                  system: systemWithSummary(systemPrompt, retry.summary),
                }
              }
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
      await deps.mcp?.closeAll()
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
