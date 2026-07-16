import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Browser Agent',
  description: 'BYOK browser AI agent — act on the web like a user',
  version: '0.0.1',
  minimum_chrome_version: '116',
  icons: {
    '16': 'public/icons/icon-16.png',
    '32': 'public/icons/icon-32.png',
    '48': 'public/icons/icon-48.png',
    '128': 'public/icons/icon-128.png',
  },
  action: {
    default_title: 'Open Browser Agent',
    default_icon: {
      '16': 'public/icons/icon-16.png',
      '32': 'public/icons/icon-32.png',
      '48': 'public/icons/icon-48.png',
      '128': 'public/icons/icon-128.png',
    },
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  permissions: [
    'sidePanel',
    'storage',
    'identity',
    'activeTab',
    'scripting',
    'tabs',
    'tabGroups',
    'alarms',
    'debugger',
    'offscreen',
    'clipboardRead',
    'clipboardWrite',
  ],
  // `<all_urls>` is required for chrome.tabs.captureVisibleTab without an
  // activeTab user gesture (agent-driven screenshots). CDP Page.captureScreenshot
  // is preferred; this remains the fallback host grant.
  host_permissions: ['<all_urls>'],
  content_scripts: [
    {
      matches: ['https://*/*', 'http://*/*'],
      js: ['src/content/a11y-tree.ts'],
      run_at: 'document_start',
      all_frames: true,
    },
    {
      matches: ['https://*/*', 'http://*/*'],
      js: ['src/content/visual-indicator.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  commands: {
    'toggle-side-panel': {
      suggested_key: {
        default: 'Alt+B',
        mac: 'Alt+B',
      },
      description: 'Toggle Browser Agent side panel',
    },
  },
})
