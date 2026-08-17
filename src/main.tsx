import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { traceSessionStart } from './lib/diagnostics'
import './index.css'

// One record per app load of which engine, browser shell and display mode we are
// actually running in. On iOS every browser is a WebKit shell, so the brand alone
// says nothing about behaviour — and whether this is a home-screen app or a tab
// changes which layout bugs apply.
traceSessionStart()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
