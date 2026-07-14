import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    rollupOptions: {
      preserveEntrySignatures: 'exports-only',
    },
  },
  server: {
    cors: {
      origin: [/chrome-extension:\/\//],
    },
  },
})
