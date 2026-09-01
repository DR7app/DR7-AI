import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installSendDedupe } from './utils/sendDedupe'
import { installaPrefissoChiamate } from './utils/basePath'
import { installaOscuramento } from './utils/oscura'

// Quando il gestionale vive sotto dr7ai.com/NOMEAZIENDA, ogni chiamata alle
// funzioni deve portare quel prefisso. Si installa per primo, cosi' vale
// anche per le chiamate fatte dagli altri strati.
installaPrefissoChiamate()

// Guarantee no duplicate WhatsApp/notification leaves the browser even on a
// fast double/triple-click — patches window.fetch before the app mounts.
installSendDedupe()

// Oscurare: quando e' acceso, i dati dei clienti arrivano gia' mascherati e
// nessuna scrittura esce dal browser. Spento non fa nulla.
installaOscuramento()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
