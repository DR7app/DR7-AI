// System Control — raccolta degli errori dal browser.
//
// Il pannello segnala qui gli errori che vede l'operatore (schermate che non
// caricano, salvataggi rifiutati, crash della pagina). Nessun dato sensibile
// viene accettato: il corpo passa dalla sanificazione come tutto il resto.
import type { Handler } from '@netlify/functions'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { registraEvento, registraMetrica } from './utils/systemControl'

const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin || event.headers.Origin)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }

  // Serve un utente autenticato: il canale non e' aperto al mondo.
  const { error: authErr, user } = await requireAuth(event)
  if (authErr) return authErr

  try {
    const b = JSON.parse(event.body || '{}') as {
      messaggio?: string; stack?: string; modulo?: string; funzione?: string
      business?: string; contesto?: Record<string, unknown>; severita?: string
      categoria?: string; integrazione?: string; status?: number; durataMs?: number
      tipoMisura?: 'pagina' | 'query'
    }
    if (b.tipoMisura && b.modulo && typeof b.durataMs === 'number') {
      await registraMetrica(b.tipoMisura, b.modulo, b.durataMs, { errore: !!b.messaggio, business: b.business })
    }
    if (!b.messaggio) return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }

    const esito = await registraEvento({
      messaggio: String(b.messaggio).slice(0, 2000),
      stack: b.stack,
      status: b.status ?? null,
      categoria: b.categoria || 'frontend',
      modulo: b.modulo,
      funzione: b.funzione,
      integrazione: b.integrazione,
      business: b.business,
      utenteEmail: user?.email,
      origine: 'client',
      contesto: b.contesto,
      severita: (['informativo', 'basso', 'medio', 'alto', 'critico'] as const).includes(b.severita as never)
        ? (b.severita as 'informativo' | 'basso' | 'medio' | 'alto' | 'critico') : undefined,
      durataMs: b.durataMs,
    })
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, gruppoId: esito.gruppoId, titolo: esito.titolo }) }
  } catch {
    // Una segnalazione che fallisce non deve generare a sua volta un errore.
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false }) }
  }
}

export { handler }
