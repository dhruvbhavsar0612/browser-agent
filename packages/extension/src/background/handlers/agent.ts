import {
  CredentialVault,
  MissingApiKeyError,
  resolveModelRef,
  streamChatText,
  type ChatMessage,
  type ConfigService,
  type Envelope,
  createResponse,
} from '@browser-agent/core'
import { startKeepalive, stopKeepalive, type MessageBus } from '../bus.js'

export type AgentHandlerDeps = {
  config: ConfigService
  vault: CredentialVault
}

const activeRuns = new Map<string, AbortController>()

export function registerAgentHandlers(bus: MessageBus, deps: AgentHandlerDeps): void {
  bus.on('agent.stop', (message) => {
    const payload = (message.payload ?? {}) as { id?: string }
    const runId = payload.id ?? message.id
    activeRuns.get(runId)?.abort()
    activeRuns.delete(runId)
    return createResponse(message, 'agent.stop', { ok: true })
  })

  bus.onPort('agent.prompt', async (message: Envelope, port) => {
    const payload = (message.payload ?? {}) as {
      messages?: ChatMessage[]
      agent?: string
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

      const textStream = streamChatText({
        modelRef,
        messages,
        apiKey: credential?.secret,
        getModelOptions: {
          baseURL: providerConfig?.api,
          headers: providerConfig?.options?.headers,
          name: providerConfig?.name ?? modelRef.providerID,
        },
        abortSignal: controller.signal,
        system: appConfig.agent[agentName]?.prompt,
      })

      for await (const text of textStream) {
        if (controller.signal.aborted) {
          break
        }
        push({ kind: 'text-delta', text })
      }

      if (!controller.signal.aborted) {
        push({ kind: 'done' })
      }

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
