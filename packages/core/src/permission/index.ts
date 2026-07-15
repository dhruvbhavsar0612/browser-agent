export {
  evaluate,
  fromConfig,
  mergeRules,
  matchWildcard,
  type PermissionRuleEntry,
} from './evaluate.js'

export {
  PermissionDeniedError,
  PermissionRejectedError,
  PermissionNotFoundError,
} from './errors.js'

export {
  PermissionEngine,
  type PermissionAskInput,
  type PermissionAskHandler,
  type PermissionEngineOptions,
  type PermissionReply,
  type PermissionReplyInput,
  type PermissionRequest,
} from './engine.js'

export {
  SENSITIVE_DEFAULT_RULES,
  buildRunRuleset,
  rulesForExecutionMode,
} from './modes.js'
