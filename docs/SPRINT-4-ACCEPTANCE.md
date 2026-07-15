# Sprint 4 acceptance checklist

## Released in v0.3.0 (already on main)
| ID | Feature | Acceptance |
|----|---------|------------|
| DHR-61 | CDP debugger | Attach/detach + Input helpers |
| DHR-66 | click/type/scroll/hover/select | Act tools via a11y refs |
| DHR-77–81 | Side panel UX | Markdown, reasoning, tools, theme |
| DHR-82 | Stream reconnect | Idle >2m send works without reload |
| DHR-83 | Session history | Header switcher create/resume/delete |

## Completing Sprint 4 (this PR)
| ID | Feature | Acceptance (covered by tests) |
|----|---------|--------------------------------|
| DHR-68 | Visual indicator | Show on agent bind; hide on stop/finish (`visual-indicator.test.ts`, `indicator.test.ts`) |
| DHR-69 | Clipboard safety | Restore after paste; report failure; dirty lock until navigate (`clipboard-safety.test.ts`) |
| DHR-65 | Tab groups | Agent seed + opened tabs grouped; user tabs unmapped (`tab-group.test.ts`, `tabs/open.test.ts`) |
