// System Control — SYSTEM HEALTH: lo stato generale della piattaforma in una
// sola chiamata. Non modifica niente: solo lettura.
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'
import { INTEGRAZIONI } from './utils/systemControlCatalog'
import { AMBIENTE, VERSIONE } from './utils/systemControl'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

type Stato = 'operativo' | 'degradato' | 'problema' | 'critico'

interface Servizio {
  chiave: string
  etichetta: string
  stato: Stato
  dettaglio: string
  latenzaMs?: number
}

/** Vero quando l'errore dice "questa tabella non esiste": migrazione da eseguire. */
function tabellaMancante(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  const c = String(err.code || '')
  return c === '42P01' || c === 'PGRST205' || /does not exist|schema cache/i.test(err.message || '')
}

const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin || event.headers.Origin)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }

  const { error: authErr, user } = await requireAuth(event)
  if (authErr) return authErr
  const email = (user?.email || '').toLowerCase()
  if (!(await userHasRole(email, 'direzione')) && !(await userHasRole(email, 'developer'))) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo direzione o developer.' }) }
  }

  const servizi: Servizio[] = []
  const ora = Date.now()
  const da24h = new Date(ora - 24 * 3600_000).toISOString()
  const da1h = new Date(ora - 3600_000).toISOString()

  // ── Database: una lettura vera, cronometrata ──────────────────────────────
  const t0 = Date.now()
  const { error: dbErr } = await supabase.from('admins').select('id', { count: 'exact', head: true }).limit(1)
  const dbMs = Date.now() - t0
  servizi.push({
    chiave: 'database', etichetta: 'Database',
    stato: dbErr ? 'critico' : dbMs > 2000 ? 'degradato' : 'operativo',
    dettaglio: dbErr ? 'Il database non risponde alle letture.' : dbMs > 2000 ? `Risposta lenta (${dbMs} ms).` : `Risponde in ${dbMs} ms.`,
    latenzaMs: dbMs,
  })

  // ── Migrazione System Control eseguita? ──────────────────────────────────
  const { error: scErr } = await supabase.from('sc_error_groups').select('id', { head: true, count: 'exact' }).limit(1)
  const migrazioneEseguita = !tabellaMancante(scErr as { code?: string; message?: string } | null)
  if (!migrazioneEseguita) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        migrazioneEseguita: false,
        ambiente: AMBIENTE, versione: VERSIONE,
        servizi,
        messaggio: 'Le tabelle del System Control non esistono ancora. Esegui supabase/migrations/20260831_system_control.sql nel SQL editor di Supabase.',
      }),
    }
  }

  // ── Autenticazione ────────────────────────────────────────────────────────
  const t1 = Date.now()
  let authOk = true
  try {
    const { error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 })
    authOk = !error
  } catch { authOk = false }
  const authMs = Date.now() - t1
  servizi.push({
    chiave: 'auth', etichetta: 'Autenticazione',
    stato: authOk ? (authMs > 2500 ? 'degradato' : 'operativo') : 'critico',
    dettaglio: authOk ? `Risponde in ${authMs} ms.` : 'Il servizio di accesso non risponde: gli utenti non riescono a entrare.',
    latenzaMs: authMs,
  })

  // ── Archivio file ────────────────────────────────────────────────────────
  const t2 = Date.now()
  let storageOk = true
  try {
    const { error } = await supabase.storage.listBuckets()
    storageOk = !error
  } catch { storageOk = false }
  servizi.push({
    chiave: 'storage', etichetta: 'Archivio file',
    stato: storageOk ? 'operativo' : 'problema',
    dettaglio: storageOk ? `Risponde in ${Date.now() - t2} ms.` : 'Non si riesce a leggere l elenco degli archivi: caricamenti e download a rischio.',
    latenzaMs: Date.now() - t2,
  })

  // ── Problemi aperti ──────────────────────────────────────────────────────
  const { data: gruppi } = await supabase
    .from('sc_error_groups')
    .select('id, titolo, severita, categoria, integrazione, occorrenze, ultima_comparsa, stato, classe_risoluzione')
    .in('stato', ['aperto', 'in_corso'])
    .order('ultima_comparsa', { ascending: false })
    .limit(200)

  const aperti = (gruppi || []) as { id: string; titolo: string; severita: string; categoria: string; integrazione: string | null; occorrenze: number; ultima_comparsa: string; classe_risoluzione: number }[]
  const perSeverita = { informativo: 0, basso: 0, medio: 0, alto: 0, critico: 0 } as Record<string, number>
  for (const g of aperti) perSeverita[g.severita] = (perSeverita[g.severita] || 0) + 1
  const recenti1h = aperti.filter(g => g.ultima_comparsa >= da1h)

  // ── Operazioni non riuscite ──────────────────────────────────────────────
  const { data: opsData } = await supabase
    .from('sc_operations')
    .select('id, tipo, stato, integrazione, prossimo_tentativo_at')
    .in('stato', ['in_coda', 'fallita', 'abbandonata'])
    .limit(500)
  const ops = (opsData || []) as { stato: string; tipo: string; integrazione: string | null }[]
  const inCoda = ops.filter(o => o.stato === 'in_coda').length
  const abbandonate = ops.filter(o => o.stato === 'abbandonata').length

  servizi.push({
    chiave: 'coda', etichetta: 'Coda operazioni',
    stato: abbandonate > 0 ? 'problema' : inCoda > 50 ? 'degradato' : 'operativo',
    dettaglio: abbandonate > 0
      ? `${abbandonate} operazioni hanno smesso di ritentare e aspettano te.`
      : inCoda > 0 ? `${inCoda} operazioni in attesa di ritentativo.` : 'Nessuna operazione in sospeso.',
  })

  // ── Integrazioni ─────────────────────────────────────────────────────────
  const { data: integrData } = await supabase.from('sc_integrations').select('*')
  const integr = (integrData || []) as { chiave: string; stato: string; abilitata: boolean; circuito: string; ultimo_errore: string | null; ultima_sync_at: string | null; ultimo_test_at: string | null; latenza_media_ms: number }[]
  const rotte = integr.filter(i => i.abilitata && ['errore', 'credenziali_scadute', 'servizio_non_disponibile'].includes(i.stato))
  servizi.push({
    chiave: 'integrazioni', etichetta: 'Integrazioni',
    stato: rotte.some(i => ['nexi', 'aruba_sdi', 'cargos'].includes(i.chiave)) ? 'critico'
      : rotte.length ? 'problema' : 'operativo',
    dettaglio: rotte.length
      ? `${rotte.length} collegamenti con problemi: ${rotte.map(i => INTEGRAZIONI.find(x => x.chiave === i.chiave)?.etichetta || i.chiave).join(', ')}.`
      : `Tutti i ${integr.length || INTEGRAZIONI.length} collegamenti rispondono.`,
  })

  // ── Prestazioni (ultime 24h) ─────────────────────────────────────────────
  const { data: metriche } = await supabase
    .from('sc_metrics')
    .select('tipo, nome, chiamate, errori, durata_totale_ms, durata_max_ms')
    .gte('ora', da24h)
    .limit(1000)
  const met = (metriche || []) as { tipo: string; nome: string; chiamate: number; errori: number; durata_totale_ms: number; durata_max_ms: number }[]
  const chiamateTot = met.reduce((s, m) => s + m.chiamate, 0)
  const erroriTot = met.reduce((s, m) => s + m.errori, 0)
  const durataTot = met.reduce((s, m) => s + Number(m.durata_totale_ms), 0)
  const tassoErrore = chiamateTot ? (erroriTot / chiamateTot) * 100 : 0
  const mediaMs = chiamateTot ? Math.round(durataTot / chiamateTot) : 0
  servizi.push({
    chiave: 'prestazioni', etichetta: 'Prestazioni',
    stato: tassoErrore > 10 ? 'critico' : tassoErrore > 3 ? 'problema' : mediaMs > 3000 ? 'degradato' : 'operativo',
    dettaglio: chiamateTot
      ? `${chiamateTot} chiamate in 24h, ${tassoErrore.toFixed(1)}% con errore, ${mediaMs} ms di media.`
      : 'Nessuna misura nelle ultime 24 ore.',
    latenzaMs: mediaMs,
  })

  // ── Interruttori e manutenzione ──────────────────────────────────────────
  const { data: flagsData } = await supabase.from('sc_flags').select('*')
  const flags = (flagsData || []) as { chiave: string; business: string; attiva: boolean; manutenzione: boolean; messaggio: string | null }[]
  const spente = flags.filter(f => !f.attiva)
  const manutenzione = flags.filter(f => f.manutenzione)

  // ── Backup e ultimo rilascio ─────────────────────────────────────────────
  const { data: backup } = await supabase.from('sc_backups').select('*').order('eseguito_at', { ascending: false }).limit(1)
  const { data: release } = await supabase.from('sc_releases').select('*').order('rilasciato_at', { ascending: false }).limit(1)

  // ── Ultimo controllo orario ──────────────────────────────────────────────
  // Il giro completo gira ogni ora (system-control-controllo-orario) e lascia
  // qui il suo verbale: se manca da troppo, e' il controllo stesso a essersi
  // fermato, e va detto invece di far finta che sia tutto a posto.
  const { data: controlloData } = await supabase.from('sc_actions_log')
    .select('created_at, esito, messaggio, parametri, automatico')
    .eq('azione', 'controllo_orario').order('created_at', { ascending: false }).limit(1)
  const c = controlloData?.[0] as {
    created_at: string; esito: string; messaggio: string | null
    parametri: { statoGenerale?: string; voci?: unknown[] } | null; automatico: boolean
  } | undefined
  const ultimoControllo = c ? {
    eseguitoAt: c.created_at,
    esito: c.esito,
    riepilogo: c.messaggio,
    statoGenerale: c.parametri?.statoGenerale || null,
    voci: c.parametri?.voci || [],
    automatico: c.automatico,
    inRitardo: Date.now() - new Date(c.created_at).getTime() > 3 * 3600_000,
  } : null

  const statoGenerale: Stato = servizi.some(s => s.stato === 'critico') ? 'critico'
    : servizi.some(s => s.stato === 'problema') ? 'problema'
    : servizi.some(s => s.stato === 'degradato') ? 'degradato' : 'operativo'

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      migrazioneEseguita: true,
      ambiente: AMBIENTE,
      versione: VERSIONE,
      statoGenerale,
      servizi,
      problemi: {
        aperti: aperti.length,
        perSeverita,
        ultimaOra: recenti1h.length,
        daSviluppo: aperti.filter(g => g.classe_risoluzione === 3).length,
        piuGravi: aperti
          .sort((a, b) => (['informativo', 'basso', 'medio', 'alto', 'critico'].indexOf(b.severita) - ['informativo', 'basso', 'medio', 'alto', 'critico'].indexOf(a.severita)) || (b.occorrenze - a.occorrenze))
          .slice(0, 6),
      },
      operazioni: { inCoda, abbandonate, totale: ops.length },
      integrazioni: { totale: integr.length, conProblemi: rotte.length },
      prestazioni: { chiamate24h: chiamateTot, tassoErrore: Number(tassoErrore.toFixed(2)), mediaMs },
      interruttori: { spente, manutenzione },
      backup: backup?.[0] || null,
      release: release?.[0] || null,
      ultimoControllo,
    }),
  }
}

export { handler }
