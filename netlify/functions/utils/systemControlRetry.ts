// System Control — esecuzione di un ritentativo.
//
// Regole anti-doppione (fatture, pagamenti, contratti, prenotazioni):
//  1. Un'operazione gia' 'riuscita' non viene MAI rieseguita.
//  2. Si passa a 'in_corso' con una scrittura condizionata: se due processi
//     ci provano insieme, solo uno vince e l'altro si ferma.
//  3. Si chiama solo un endpoint della whitelist, mai un URL arbitrario.
//  4. La chiave di idempotenza viaggia nel corpo e nell'header, cosi' anche
//     l'endpoint chiamato puo' riconoscere il doppione.
import type { SupabaseClient } from '@supabase/supabase-js'
import { ENDPOINT_RETRY_CONSENTITI } from './systemControlCatalog'
import { prossimoTentativo, mascheraTesto, registraAzione } from './systemControl'

export interface EsitoRitentativo {
  ok: boolean
  messaggio: string
  saltata?: boolean
}

export async function eseguiRitentativo(
  sb: SupabaseClient,
  operazioneId: string,
  opts: { attoreEmail?: string | null; automatico?: boolean } = {}
): Promise<EsitoRitentativo> {
  const { data } = await sb.from('sc_operations').select('*').eq('id', operazioneId).maybeSingle()
  if (!data) return { ok: false, messaggio: 'Operazione non trovata.' }
  const op = data as {
    id: string; tipo: string; stato: string; endpoint: string | null; payload: Record<string, unknown>
    chiave_idempotenza: string; tentativi: number; max_tentativi: number; descrizione: string
    integrazione: string | null; business: string | null
  }

  if (op.stato === 'riuscita') {
    return { ok: true, saltata: true, messaggio: 'Operazione gia completata: nessun nuovo invio (protezione anti-doppione).' }
  }
  if (op.stato === 'in_corso') {
    return { ok: false, saltata: true, messaggio: 'Operazione gia in esecuzione in questo momento.' }
  }
  if (!op.endpoint) {
    return { ok: false, messaggio: 'Questa operazione non ha un punto di ripresa automatico: va ripresa dalla sua schermata.' }
  }
  if (!ENDPOINT_RETRY_CONSENTITI.has(op.endpoint)) {
    return { ok: false, messaggio: `Ripresa non consentita: ${op.endpoint} non e fra gli endpoint autorizzati.` }
  }

  // Presa in carico condizionata: vince chi arriva primo.
  const { data: preso } = await sb.from('sc_operations')
    .update({ stato: 'in_corso', updated_at: new Date().toISOString() })
    .eq('id', op.id).in('stato', ['in_coda', 'fallita', 'abbandonata'])
    .select('id')
  if (!preso || !preso.length) {
    return { ok: false, saltata: true, messaggio: 'Un altro processo ha gia preso in carico questa operazione.' }
  }

  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || ''
  const url = `${base}/.netlify/functions/${op.endpoint}`
  const tentativi = (op.tentativi || 0) + 1
  const t0 = Date.now()

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': op.chiave_idempotenza,
        ...(process.env.ADMIN_API_TOKEN ? { Authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` } : {}),
      },
      body: JSON.stringify({ ...(op.payload || {}), idempotencyKey: op.chiave_idempotenza, systemControlRetry: true }),
    })
    const testo = (await res.text()).slice(0, 800)

    if (res.ok) {
      await sb.from('sc_operations').update({
        stato: 'riuscita', tentativi,
        risolta_at: new Date().toISOString(),
        risolta_da: opts.automatico ? 'auto-riparazione' : (opts.attoreEmail || 'System Control'),
        ultimo_errore: null, updated_at: new Date().toISOString(),
      }).eq('id', op.id)
      await registraAzione({
        azione: 'riprova', attoreEmail: opts.attoreEmail || null, automatico: !!opts.automatico,
        bersaglioTipo: 'operazione', bersaglioId: op.id, business: op.business || undefined,
        parametri: { tipo: op.tipo, tentativo: tentativi }, esito: 'ok',
        messaggio: `Ripresa riuscita: ${op.descrizione}`, durataMs: Date.now() - t0,
      })
      return { ok: true, messaggio: `Operazione completata: ${op.descrizione}.` }
    }

    const esaurita = tentativi >= (op.max_tentativi || 5)
    await sb.from('sc_operations').update({
      stato: esaurita ? 'abbandonata' : 'in_coda',
      tentativi,
      ultimo_errore: mascheraTesto(`HTTP ${res.status} — ${testo}`).slice(0, 1500),
      ultimo_errore_at: new Date().toISOString(),
      prossimo_tentativo_at: prossimoTentativo(tentativi),
      updated_at: new Date().toISOString(),
    }).eq('id', op.id)
    await registraAzione({
      azione: 'riprova', attoreEmail: opts.attoreEmail || null, automatico: !!opts.automatico,
      bersaglioTipo: 'operazione', bersaglioId: op.id, esito: 'errore',
      messaggio: `Ripresa fallita (HTTP ${res.status})`, durataMs: Date.now() - t0,
    })
    return {
      ok: false,
      messaggio: esaurita
        ? `Non riuscita dopo ${tentativi} tentativi: il gestionale smette di insistere e aspetta te.`
        : `Non riuscita (${res.status}). Prossimo tentativo automatico piu tardi.`,
    }
  } catch (err) {
    const messaggio = mascheraTesto((err as Error)?.message || String(err))
    const esaurita = tentativi >= (op.max_tentativi || 5)
    await sb.from('sc_operations').update({
      stato: esaurita ? 'abbandonata' : 'in_coda',
      tentativi,
      ultimo_errore: messaggio.slice(0, 1500),
      ultimo_errore_at: new Date().toISOString(),
      prossimo_tentativo_at: prossimoTentativo(tentativi),
      updated_at: new Date().toISOString(),
    }).eq('id', op.id)
    return { ok: false, messaggio: `Non riuscita: ${messaggio}` }
  }
}
