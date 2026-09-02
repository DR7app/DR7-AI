// System Control — PROVA DEI COLLEGAMENTI.
//
// Una sola implementazione, usata sia dal pulsante "Testa connessione" della
// tab sia dal controllo automatico che gira ogni ora. Le credenziali non
// escono mai da qui: si verifica la loro PRESENZA e si contatta il servizio
// lato server, ma nessun valore viene restituito ne scritto nei log.
import { createClient } from '@supabase/supabase-js'
import { INTEGRAZIONE_BY_CHIAVE } from './systemControlCatalog'
import { mascheraTesto } from './systemControl'

export interface EsitoTest { ok: boolean; messaggio: string; latenzaMs: number }

/** Chiavi attese in `service_secrets`. Il suffisso `:` vuol dire "che inizia per". */
const SEGRETI_ATTESI: Record<string, string[]> = {
  pec: ['pec_password:'],
  openapi_targhe: ['openapi_automotive_token'],
}

/** Vecchio posto delle stesse credenziali: si accetta ancora. */
const SEGRETI_ENV: Record<string, string[]> = {
  pec: ['PEC_PASSWORD'],
  openapi_targhe: ['OPENAPI_AUTOMOTIVE_TOKEN'],
}

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

/** Prova davvero il collegamento. Non restituisce mai valori di credenziali. */
export async function testaConnessione(chiave: string): Promise<EsitoTest> {
  const meta = INTEGRAZIONE_BY_CHIAVE[chiave]
  const t0 = Date.now()
  const durata = () => Date.now() - t0

  if (!meta) return { ok: false, messaggio: 'Integrazione sconosciuta.', latenzaMs: 0 }

  try {
    switch (meta.test) {
      case 'supabase': {
        const { error } = await supabase.from('admins').select('id', { head: true, count: 'exact' }).limit(1)
        return { ok: !error, messaggio: error ? mascheraTesto(error.message) : 'Il database risponde alle letture.', latenzaMs: durata() }
      }
      case 'auth': {
        const { error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 })
        return { ok: !error, messaggio: error ? mascheraTesto(error.message) : 'Il servizio di accesso risponde.', latenzaMs: durata() }
      }
      case 'storage': {
        const { data, error } = await supabase.storage.listBuckets()
        return { ok: !error, messaggio: error ? mascheraTesto(error.message) : `Archivio raggiungibile (${data?.length || 0} contenitori).`, latenzaMs: durata() }
      }
      case 'http': {
        // Firma elettronica: si controlla che l app di firma risponda.
        if (chiave === 'trustera') {
          const base = process.env.SIGNING_BASE_URL || 'https://dr7trust.com'
          const res = await fetch(base, { method: 'GET' })
          return {
            ok: res.ok || res.status === 401 || res.status === 403,
            messaggio: res.ok ? 'L app di firma risponde.' : `L app di firma ha risposto ${res.status}.`,
            latenzaMs: durata(),
          }
        }
        // WhatsApp: la prova ufficiale di Green API e' getStateInstance.
        // L'URL contiene il token, quindi non viene MAI restituito ne loggato.
        if (chiave === 'green_api') {
          const id = process.env.GREEN_API_INSTANCE_ID
          const token = process.env.GREEN_API_TOKEN
          if (!id || !token) return { ok: false, messaggio: 'Credenziali WhatsApp non configurate.', latenzaMs: durata() }
          const res = await fetch(`https://api.green-api.com/waInstance${id}/getStateInstance/${token}`)
          const stato = res.ok ? ((await res.json()) as { stateInstance?: string })?.stateInstance : null
          return {
            ok: res.ok && stato === 'authorized',
            messaggio: res.ok ? `Stato dell istanza: ${stato || 'sconosciuto'}.` : `Il servizio ha risposto ${res.status}.`,
            latenzaMs: durata(),
          }
        }
        if (!meta.testUrl) return { ok: false, messaggio: 'Nessuna prova disponibile.', latenzaMs: durata() }
        const res = await fetch(meta.testUrl)
        return { ok: res.ok, messaggio: res.ok ? 'Il servizio risponde.' : `Il servizio ha risposto ${res.status}.`, latenzaMs: durata() }
      }
      // Credenziali che stanno nel database (service_secrets), non fra le
      // variabili d'ambiente: si verifica solo che la riga esista.
      case 'segreto': {
        const chiavi = SEGRETI_ATTESI[chiave] || []
        if (!chiavi.length) return { ok: true, messaggio: 'Nessun segreto previsto.', latenzaMs: durata() }
        const { data, error } = await supabase.from('service_secrets').select('key')
        if (error) return { ok: false, messaggio: mascheraTesto(error.message), latenzaMs: durata() }
        const presenti = ((data || []) as { key: string }[]).map(r => r.key)
        const trovate = chiavi.filter(c => presenti.some(k => (c.endsWith(':') ? k.startsWith(c) : k === c)))
        // Ripiego sulle variabili d'ambiente: alcune installazioni le usano ancora.
        const daEnv = (SEGRETI_ENV[chiave] || []).filter(v => process.env[v])
        const ok = trovate.length > 0 || daEnv.length > 0
        return {
          ok,
          messaggio: ok
            ? 'Credenziali presenti. Il servizio non espone una prova sicura: il primo utilizzo reale confermera il collegamento.'
            : `Nessuna credenziale salvata: manca ${chiavi.join(' o ')} in service_secrets.`,
          latenzaMs: durata(),
        }
      }
      case 'env': {
        const mancanti = meta.variabili.filter(v => !process.env[v])
        return {
          ok: mancanti.length === 0,
          messaggio: mancanti.length
            ? `Impostazioni mancanti: ${mancanti.join(', ')}.`
            : 'Credenziali presenti. Il servizio non espone una prova sicura: il primo utilizzo reale confermera il collegamento.',
          latenzaMs: durata(),
        }
      }
      default:
        return { ok: true, messaggio: 'Nessuna prova prevista per questo collegamento.', latenzaMs: durata() }
    }
  } catch (err) {
    return { ok: false, messaggio: mascheraTesto((err as Error)?.message || String(err)), latenzaMs: durata() }
  }
}
