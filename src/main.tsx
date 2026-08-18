import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { registerSW } from 'virtual:pwa-register'
import { traceSessionStart } from './lib/diagnostics'
import './index.css'

// One record per app load of which engine, browser shell and display mode we are
// actually running in. On iOS every browser is a WebKit shell, so the brand alone
// says nothing about behaviour — and whether this is a home-screen app or a tab
// changes which layout bugs apply.
traceSessionStart()

// Registering the worker is not the same as ever updating it.
//
// The plugin's injected script called register() on `load` and stopped there. A
// home-screen app on iOS resumed from the app switcher does not re-navigate, so
// `load` never fires again, the registration's update check never runs, and the
// app serves index.html out of the precache — old asset hashes, old build,
// indefinitely. Hours after a deploy the tab bar was still the version it shipped
// with, which is what sent me looking.
//
// So: check when the app comes back to the foreground, and hourly while it is
// open. `autoUpdate` reloads once the new worker takes control.
const updateServiceWorker = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    const check = () => { void registration.update().catch(() => {}) }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
    window.setInterval(check, 60 * 60 * 1000)
  },
})
void updateServiceWorker

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
