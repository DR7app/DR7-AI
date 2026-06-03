import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installSendDedupe } from './utils/sendDedupe'

// Guarantee no duplicate WhatsApp/notification leaves the browser even on a
// fast double/triple-click — patches window.fetch before the app mounts.
installSendDedupe()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
