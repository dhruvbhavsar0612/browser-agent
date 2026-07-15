# Sprint 5 acceptance checklist

| ID | Feature | Acceptance (tests) |
|----|---------|-------------------|
| DHR-62 | Permission ask UI | Banner Once/Always/Reject; Chat queues asks; stub auto-allow removed (`PermissionAsk.test.tsx`) |
| DHR-63 | Execution modes | Plan denies writes; Approval asks; Auto allows; persists via `config.executionMode` (`modes.test.ts`) |
| DHR-64 | Site rules + sensitive defaults | User can deny github clicks; checkout/payment/login denied (`modes.test.ts`) |
| DHR-67 | Doom-loop UX | Processor defers to engine ask; UI Continue once / Stop (`PermissionAsk.test.tsx`, processor tests) |
