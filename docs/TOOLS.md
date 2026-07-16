# Browser Tool Specification (v1)

Tools follow the OpenCode pattern: Zod-validated input, permission-gated execution, truncated output.

## Tool Definition Template

```typescript
interface BrowserTool<T extends z.ZodType> {
  id: string;
  description: string;
  parameters: T;
  permission: string;           // e.g. "click", "page_read"
  permissionPatterns: (args) => string[];  // e.g. [url] for site-level rules
  execute: (args, ctx: ToolContext) => Promise<ToolResult>;
}

interface ToolContext {
  sessionId: string;
  tabId: number;
  ask: (input: PermissionAsk) => Promise<void>;
  signal: AbortSignal;
}
```

## Read Tools

### `tabs_list`
List all open tabs. Permission: `tabs` / `allow`.

### `tabs_focus`
Switch to a tab by id. Permission: `tab_focus` / `ask` on non-agent tabs.

### `page_read`
Return a11y tree of current session tab. Params: `{ tabId?, filter?: "interactive" | "all", maxChars? }`. Permission: `page_read`.

### `page_grep`
Search visible text and labels. Params: `{ pattern, tabId? }`. Permission: `grep_page`.

### `page_screenshot`
Capture viewport. Params: `{ tabId?, format?: "jpeg" | "png" }`. Permission: `screenshot`.
Uses CDP `Page.captureScreenshot` first, then `chrome.tabs.captureVisibleTab` fallback (requires
`<all_urls>` host permission for agent-driven captures without an `activeTab` gesture).
Requires a vision model or auxiliary vision call to interpret the image.

### `console_log`
Recent console output from tab. Params: `{ tabId?, limit? }`. Permission: `console`.

### `network_log`
Recent network requests via CDP. Params: `{ tabId?, limit?, filter? }`. Permission: `network`.

## Write Tools

### `navigate`
Go to URL. Params: `{ url, tabId? }`. Permission: `navigate` / pattern = url.

### `click`
Click element by ref_id or coordinates. Params: `{ ref_id? , x?, y? }`. Permission: `click` / pattern = current url.

### `type`
Type text into editable element. Params: `{ ref_id, text, submit?: boolean }`. Permission: `type`. Uses clipboard snapshot/restore for rich text.

### `scroll`
Scroll viewport or element. Params: `{ ref_id?, direction, amount? }`. Permission: `scroll`.

### `hover`
Hover at ref or coordinates. Params: `{ ref_id?, x?, y? }`. Permission: `hover`.

### `select`
Select dropdown option. Params: `{ ref_id, value }`. Permission: `select`.

### `tabs_open`
Open new tab. Params: `{ url, background?: boolean }`. Permission: `tab_open`.

### `tabs_close`
Close tab. Params: `{ tabId, force?: boolean }`. Permission: `tab_close` / `ask` unless agent-owned.

## Utility Tools

### `wait`
Wait for condition. Params: `{ ms?, navigation?, text? }`. Permission: `wait`.

### `web_fetch`
Fetch URL from service worker (bypasses page CORS). Params: `{ url }`. Permission: `webfetch` / pattern = url.

### `evaluate`
Run bounded JavaScript in page. Params: `{ expression }`. Permission: `evaluate` / default `deny`.

### `task`
Spawn subagent. Params: `{ agent, prompt, tabId? }`. Permission: `task`.

## Output Limits

| Tool | Max output |
|------|------------|
| `page_read` | 50 KB text |
| `page_screenshot` | 1 MB image (compressed) |
| `network_log` | 20 entries |
| `console_log` | 50 entries |
| All others | 10 KB JSON |
