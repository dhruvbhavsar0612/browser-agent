import type { PermissionRuleEntry } from './index.js'

export class PermissionDeniedError extends Error {
  readonly name = 'PermissionDeniedError'

  constructor(
    readonly permission: string,
    readonly patterns: string[],
    readonly ruleset: PermissionRuleEntry[] = [],
  ) {
    super(
      `Permission denied for "${permission}" (${patterns.join(', ')}). Relevant rules: ${JSON.stringify(ruleset)}`,
    )
  }
}

export class PermissionRejectedError extends Error {
  readonly name = 'PermissionRejectedError'

  constructor(message = 'The user rejected permission to use this specific tool call.') {
    super(message)
  }
}

export class PermissionNotFoundError extends Error {
  readonly name = 'PermissionNotFoundError'

  constructor(readonly requestID: string) {
    super(`Permission request not found: ${requestID}`)
  }
}
