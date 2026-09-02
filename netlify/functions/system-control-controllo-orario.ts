// System Control — CONTROLLO ORARIO (pianificato in netlify.toml, ogni ora).
//
// Fa il giro completo della piattaforma e scrive nel System Control cosa non
// va. Non modifica dati, non manda messaggi ai clienti, non tocca il codice.
// Lo stesso giro si puo' lanciare a mano dal pannello (Stato generale >
// "Controlla adesso"), che chiama la stessa funzione senza passare da qui.
import type { Handler } from '@netlify/functions'
import { eseguiControlloOrario } from './utils/systemControlControllo'
import { statoFunzione, mascheraTesto } from './utils/systemControl'

const handler: Handler = async () => {
  // L'interruttore e' lo stesso dell'auto-riparazione: se la direzione
  // spegne la sorveglianza, si ferma tutto, non meta'.
  const attivo = await statoFunzione('auto_riparazione')
  if (!attivo.attiva) {
    return { statusCode: 200, body: JSON.stringify({ saltato: true, motivo: 'Sorveglianza spenta dal System Control.' }) }
  }

  try {
    const esito = await eseguiControlloOrario()
    return { statusCode: 200, body: JSON.stringify(esito) }
  } catch (err) {
    console.error('[system-control-controllo-orario]', err)
    return { statusCode: 500, body: JSON.stringify({ error: mascheraTesto((err as Error)?.message || 'errore') }) }
  }
}

export { handler }
