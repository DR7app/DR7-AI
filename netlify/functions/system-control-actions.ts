// System Control — azioni di sistema del Super Admin.
//
// Ogni azione qui dentro:
//  · verifica PRIMA se si puo' fare in sicurezza,
//  · non tocca mai fatture, pagamenti, contratti o prenotazioni,
//  · finisce nell'audit con chi, quando, cosa e risultato.
// Nessun RESET, DELETE TENANT, DROP o operazione distruttiva e' esposta.
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'
import { registraAzione, registraConfig, mascheraTesto } from './utils/systemControl'
import { JOB_RILANCIABILI } from './utils/systemControlCatalog'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Tabelle di CONFIGURAZIONE ripristinabili. Volutamente corta: qui non
// compaiono ne dati contabili ne dati operativi, che hanno bisogno di
// integrita' storica e non si "riportano indietro".
const TABELLE_RIPRISTINABILI: ReadonlySet<string> = new Set([
  'centralina_pro_config', 'site_copy', 'system_messages', 'rental_config', 'sc_flags',
])

const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin || event.headers.Origin)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }

  const { error: authErr, user } = await requireAuth(event)
  if (authErr) return authErr
  const email = (user?.email || '').toLowerCase()
  if (!(await userHasRole(email, 'direzione')) && !(await userHasRole(email, 'developer'))) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo direzione o developer.' }) }
  }

  const body = JSON.parse(event.body || '{}') as {
    azione?: string; bersaglio?: string; id?: string; emailUtente?: string
    conferma?: boolean; motivo?: string
  }
  const azione = body.azione
  const t0 = Date.now()
  let messaggio = ''
  let ok = true
  let extra: Record<string, unknown> = {}

  try {
    switch (azione) {
      // ── Rilancia un automatismo pianificato ────────────────────────────
      case 'riavvia_job': {
        const job = JOB_RILANCIABILI.find(j => j.chiave === body.bersaglio)
        if (!job) { ok = false; messaggio = 'Automatismo sconosciuto.'; break }
        const base = process.env.URL || process.env.DEPLOY_PRIME_URL || ''
        const res = await fetch(`${base}/.netlify/functions/${job.funzione}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.ADMIN_API_TOKEN ? { Authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` } : {}),
          },
          body: JSON.stringify({ manuale: true, richiestoDa: email }),
        })
        ok = res.ok
        messaggio = res.ok
          ? `${job.etichetta}: ciclo lanciato adesso.`
          : `${job.etichetta}: il lancio ha risposto ${res.status}.`
        break
      }

      // ── Svuota le cache (nessun dato viene toccato) ────────────────────
      case 'svuota_cache': {
        const fatte: string[] = []
        // 1. Report Google messi in cache in app_secrets: SOLO le chiavi di
        //    cache, mai le righe che contengono credenziali.
        const { data: rimosse } = await supabase.from('app_secrets')
          .delete().like('key', 'gbp_report_cache_%').select('key')
        if (rimosse?.length) fatte.push(`${rimosse.length} report Google`)
        // NOTA: la cache delle visure targa NON si svuota. Ogni riga e' una
        // visura gia' pagata a OpenAPI: cancellarla significa ricomprarla.
        // 3. Cache CDN di Netlify, se il token e' configurato.
        if ((body.bersaglio === 'cdn' || body.bersaglio === 'tutto') && process.env.NETLIFY_API_TOKEN && process.env.SITE_ID) {
          const res = await fetch('https://api.netlify.com/api/v1/purge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NETLIFY_API_TOKEN}` },
            body: JSON.stringify({ site_id: process.env.SITE_ID }),
          })
          fatte.push(res.ok ? 'cache CDN' : `cache CDN non svuotata (${res.status})`)
        }
        messaggio = fatte.length
          ? `Cache svuotate: ${fatte.join(', ')}. I dati non sono stati toccati.`
          : 'Nessuna cache da svuotare in questo momento.'
        break
      }

      // ── Sblocca un account ─────────────────────────────────────────────
      case 'sblocca_account': {
        const bersaglio = (body.emailUtente || '').toLowerCase().trim()
        if (!bersaglio) { ok = false; messaggio = 'Serve l e-mail dell account.'; break }
        const fatte: string[] = []

        // 1. Richieste OTP rimaste appese: bloccano i nuovi invii.
        const { data: otpAppesi } = await supabase.from('limitation_overrides')
          .update({ status: 'expired' })
          .eq('status', 'pending').ilike('requested_by', bersaglio)
          .select('id')
        if (otpAppesi?.length) fatte.push(`${otpAppesi.length} richieste OTP scadute e liberate`)

        // 2. Blocco lato autenticazione (ban): si toglie solo se c'e'.
        try {
          const { data: lista } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 })
          const u = lista?.users?.find(x => (x.email || '').toLowerCase() === bersaglio)
          if (u) {
            const bannato = (u as unknown as { banned_until?: string | null }).banned_until
            if (bannato && new Date(bannato).getTime() > Date.now()) {
              await supabase.auth.admin.updateUserById(u.id, { ban_duration: 'none' } as never)
              fatte.push('blocco di accesso rimosso')
            }
          } else {
            fatte.push('nessun utente con questa e-mail nel sistema di accesso')
          }
        } catch (e) {
          fatte.push(`controllo accesso non riuscito: ${mascheraTesto((e as Error).message)}`)
        }

        // 3. Operatore archiviato: si SEGNALA, non si riattiva da qui.
        //    Riattivare un operatore e' una decisione della direzione e si fa
        //    dalla tab Operatori, dove resta tracciata.
        const { data: adminRow } = await supabase.from('admins')
          .select('archived_at').ilike('email', bersaglio).maybeSingle()
        if ((adminRow as { archived_at?: string | null } | null)?.archived_at) {
          fatte.push('ATTENZIONE: l operatore risulta archiviato — si riattiva dalla tab Operatori')
        }

        messaggio = fatte.length ? `Sblocco eseguito: ${fatte.join('; ')}.` : 'Nessun blocco trovato su questo account.'
        break
      }

      // ── Ricalcola i permessi effettivi di un operatore ─────────────────
      case 'ricalcola_permessi': {
        const bersaglio = (body.emailUtente || '').toLowerCase().trim()
        if (!bersaglio) { ok = false; messaggio = 'Serve l e-mail dell operatore.'; break }
        const { data } = await supabase.from('admins')
          .select('id, nome, email, role, permissions, archived_at').ilike('email', bersaglio).maybeSingle()
        if (!data) { ok = false; messaggio = 'Nessun operatore con questa e-mail.'; break }
        const a = data as { nome: string; role: string; permissions: string[] | null; archived_at: string | null }
        const ruoli = (a.permissions || []).filter(p => p.startsWith('role:')).map(p => p.slice(5))
        const tab = (a.permissions || []).filter(p => !p.startsWith('role:') && !p.startsWith('hide:'))
        messaggio = a.archived_at
          ? `${a.nome} risulta ARCHIVIATO: nessun accesso, qualunque permesso abbia.`
          : `${a.nome} — ruolo ${a.role}${ruoli.length ? `, tag: ${ruoli.join(', ')}` : ', nessun tag ruolo'}, ${tab.length} tab abilitate.`
        extra = { ruolo: a.role, tagRuolo: ruoli, tab, archiviato: !!a.archived_at }
        break
      }

      // ── Ripristina una configurazione precedente ───────────────────────
      case 'ripristina_configurazione': {
        if (!body.id) { ok = false; messaggio = 'Serve la voce di storico da ripristinare.'; break }
        if (!body.conferma) { ok = false; messaggio = 'Conferma richiesta per ripristinare una configurazione.'; break }
        const { data } = await supabase.from('sc_config_history').select('*').eq('id', body.id).maybeSingle()
        if (!data) { ok = false; messaggio = 'Voce di storico non trovata.'; break }
        const h = data as { tabella: string; riga_id: string; prima: Record<string, unknown> | null; dopo: Record<string, unknown> | null; etichetta: string | null; ripristinabile: boolean }
        if (!h.ripristinabile) { ok = false; messaggio = 'Questa voce non e ripristinabile.'; break }
        if (!TABELLE_RIPRISTINABILI.has(h.tabella)) {
          ok = false
          messaggio = `Ripristino non consentito su ${h.tabella}: si ripristinano solo le configurazioni, mai dati contabili o operativi.`
          break
        }
        if (!h.prima) { ok = false; messaggio = 'Non esiste una versione precedente da rimettere.'; break }

        // Lo stato attuale finisce nello storico PRIMA di essere sostituito,
        // cosi' anche il ripristino e' reversibile.
        const { data: attuale } = await supabase.from(h.tabella).select('*').eq('id', h.riga_id).maybeSingle()
        const { error } = await supabase.from(h.tabella).update(h.prima).eq('id', h.riga_id)
        if (error) { ok = false; messaggio = error.message; break }
        await registraConfig({
          tabella: h.tabella, rigaId: h.riga_id,
          etichetta: `Ripristino della versione del ${h.etichetta || 'storico'}`,
          prima: attuale, dopo: h.prima, modificatoDa: email,
        })
        await supabase.from('sc_config_history')
          .update({ ripristinato_at: new Date().toISOString(), ripristinato_da: email }).eq('id', body.id)
        messaggio = `Configurazione ripristinata su ${h.tabella}. La versione sostituita resta nello storico.`
        break
      }

      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Azione non prevista: ${azione}` }) }
    }
  } catch (err) {
    ok = false
    messaggio = mascheraTesto((err as Error)?.message || String(err))
  }

  await registraAzione({
    azione: azione || 'sconosciuta', attoreEmail: email,
    bersaglioTipo: 'sistema', bersaglioId: body.bersaglio || body.id || body.emailUtente,
    parametri: { motivo: body.motivo || null }, esito: ok ? 'ok' : 'errore',
    messaggio, durataMs: Date.now() - t0,
  })

  return { statusCode: 200, headers, body: JSON.stringify({ ok, messaggio, ...extra }) }
}

export { handler }
