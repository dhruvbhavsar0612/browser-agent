import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '../sidepanel/ThemeProvider.js'
import { SettingsView } from '../sidepanel/Settings.js'
import '../sidepanel/styles.css'
import '../sidepanel/Settings.css'
import './settings-page.css'

function SettingsApp() {
  return (
    <ThemeProvider>
      <div className="settings-page">
        <div className="settings-page-inner">
          <SettingsView />
        </div>
      </div>
    </ThemeProvider>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>,
)
