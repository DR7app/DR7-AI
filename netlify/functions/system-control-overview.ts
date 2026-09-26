// System Control — SYSTEM HEALTH: lo stato generale della piattaforma in una
// sola chiamata. Non modifica niente: solo lettura.
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'
import { INTEGRAZIONI, PRESA_IN_CARICO_SCADE_MIN } from './utils/systemControlCatalog'
import { scadenzaPresaInCarico } from './utils/systemControlRetry'
import { AMBIENTE, VERSIONE } from './utils/systemControl'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// 'non_verificato' = nessuna prova che funzioni (mai testato, lettura fallita,
// controllo scaduto). Non e' un guasto, ma non si puo' nemmeno dire operativo.
type Stato = 'operativo' | 'non_verificato' | 'degradato' | 'problema' | 'critico'
const GRAVITA: Stato[] = ['operativo', 'non_verificato', 'degradato', 'problema', 'critico']

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
  // Letture non riuscite: finiscono nel pannello invece di diventare zeri.
  const lettureFallite: string[] = []
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
  const { data: gruppi, error: gruppiErr } = await supabase
    .from('sc_error_groups')
    .select('id, titolo, severita, categoria, integrazione, occorrenze, ultima_comparsa, stato, classe_risoluzione')
    .in('stato', ['aperto', 'in_corso'])
    .order('ultima_comparsa', { ascending: false })
    .limit(200)

  if (gruppiErr) lettureFallite.push('problemi aperti')
  const aperti = (gruppi || []) as { id: string; titolo: string; severita: string; categoria: string; integrazione: string | null; occorrenze: number; ultima_comparsa: string; classe_risoluzione: number }[]
  const perSeverita = { informativo: 0, basso: 0, medio: 0, alto: 0, critico: 0 } as Record<string, number>
  for (const g of aperti) perSeverita[g.severita] = (perSeverita[g.severita] || 0) + 1
  const recenti1h = aperti.filter(g => g.ultima_comparsa >= da1h)

  // ── Operazioni non riuscite ──────────────────────────────────────────────
  const { data: opsData, error: opsErr } = await supabase
    .from('sc_operations')
    .select('id, tipo, stato, integrazione, prossimo_tentativo_at, automatica, created_at, updated_at')
    .in('stato', ['in_coda', 'in_corso', 'fallita', 'abbandonata'])
    .limit(500)
  const scadenza = scadenzaPresaInCarico()
  const tutteOps = (opsData || []) as { stato: string; tipo: string; integrazione: string | null; automatica: boolean | null; created_at: string; updated_at: string | null }[]
  // 'in_corso' recente = ripresa in esecuzione adesso; oltre la scadenza e' bloccata.
  const bloccate = tutteOps.filter(o => o.stato === 'in_corso' && (o.updated_at || o.created_at) < scadenza).length
  const ops = tutteOps.filter(o => o.stato !== 'in_corso' || (o.updated_at || o.created_at) < scadenza)
  const inCoda = ops.filter(o => o.stato === 'in_coda').length
  const soloManuali = ops.filter(o => o.stato === 'in_coda' && o.automatica === false).length
  const abbandonate = ops.filter(o => o.stato === 'abbandonata').length

  if (opsErr) {
    lettureFallite.push('coda operazioni')
    servizi.push({
      chiave: 'coda', etichetta: 'Coda operazioni', stato: 'non_verificato',
      dettaglio: 'La coda non si riesce a leggere: non si puo dire se ci sono operazioni ferme.',
    })
  } else {
    servizi.push({
      chiave: 'coda', etichetta: 'Coda operazioni',
      stato: abbandonate > 0 || bloccate > 0 ? 'problema' : inCoda > 50 ? 'degradato' : 'operativo',
      dettaglio: [
        abbandonate ? `${abbandonate} operazioni hanno smesso di ritentare e aspettano te.` : '',
        bloccate ? `${bloccate} bloccate in esecuzione da oltre ${PRESA_IN_CARICO_SCADE_MIN} minuti.` : '',
        inCoda ? `${inCoda} in attesa di ritentativo${soloManuali ? `, di cui ${soloManuali} ripartono solo con Riprova` : ''}.` : '',
      ].filter(Boolean).join(' ') || 'Nessuna operazione in sospeso.',
    })
  }

  // ── Integrazioni ─────────────────────────────────────────────────────────
  const { data: integrData, error: integrErr } = await supabase.from('sc_integrations').select('*')
  const integr = (integrData || []) as { chiave: string; stato: string; abilitata: boolean; circuito: string; ultimo_errore: string | null; ultima_sync_at: string | null; ultimo_test_at: string | null; ultimo_test_ok: boolean | null; ultima_chiamata_ok_at: string | null; latenza_media_ms: number }[]
  const perChiave = new Map(integr.map(i => [i.chiave, i]))
  const nome = (k: string) => INTEGRAZIONI.find(x => x.chiave === k)?.etichetta || k
  const rotte = integr.filter(i => i.abilitata !== false && ['errore', 'credenziali_scadute', 'servizio_non_disponibile'].includes(i.stato))
  // Verificato = almeno un test riuscito o una chiamata vera andata a buon fine.
  const attive = INTEGRAZIONI.filter(m => perChiave.get(m.chiave)?.abilitata !== false)
  const verificate = attive.filter(m => {
    const r = perChiave.get(m.chiave)
    return !!r && (r.ultimo_test_ok === true || !!r.ultima_chiamata_ok_at)
  })
  const nonConfigurate = attive.filter(m => m.variabili.length > 0 && m.variabili.every(v => !process.env[v]))
  const maiVerificate = attive.filter(m => !verificate.includes(m) && !nonConfigurate.includes(m) && !rotte.some(r => r.chiave === m.chiave))
  if (integrErr) {
    lettureFallite.push('integrazioni')
    servizi.push({
      chiave: 'integrazioni', etichetta: 'Integrazioni', stato: 'non_verificato',
      dettaglio: 'Lo stato dei collegamenti non si riesce a leggere: nessuna garanzia che rispondano.',
    })
  } else {
    servizi.push({
      chiave: 'integrazioni', etichetta: 'Integrazioni',
      stato: rotte.some(i => ['nexi', 'aruba_sdi', 'cargos'].includes(i.chiave)) ? 'critico'
        : rotte.length ? 'problema'
        // Un servizio mai configurato non e' un guasto, ma se nessuno e'
        // mai stato verificato non c'e' alcuna prova che qualcosa risponda.
        : maiVerificate.length || !verificate.length ? 'non_verificato'
        : 'operativo',
      dettaglio: [
        rotte.length ? `${rotte.length} collegamenti con problemi: ${rotte.map(i => nome(i.chiave)).join(', ')}.` : '',
        `${verificate.length} su ${attive.length} verificati.`,
        maiVerificate.length ? `Mai verificati: ${maiVerificate.map(m => m.etichetta).join(', ')}. Premi Testa connessione o Controlla adesso.` : '',
        nonConfigurate.length ? `Non configurati: ${nonConfigurate.map(m => m.etichetta).join(', ')}.` : '',
      ].filter(Boolean).join(' '),
    })
  }

  // ── Prestazioni (ultime 24h) ─────────────────────────────────────────────
  const { data: metriche, error: metricheErr } = await supabase
    .from('sc_metrics')
    .select('tipo, nome, chiamate, errori, durata_totale_ms, durata_max_ms')
    .gte('ora', da24h)
    .limit(1000)
  if (metricheErr) lettureFallite.push('prestazioni')
  const met = (metriche || []) as { tipo: string; nome: string; chiamate: number; errori: number; durata_totale_ms: number; durata_max_ms: number }[]
  const chiamateTot = met.reduce((s, m) => s + m.chiamate, 0)
  const erroriTot = met.reduce((s, m) => s + m.errori, 0)
  const durataTot = met.reduce((s, m) => s + Number(m.durata_totale_ms), 0)
  const tassoErrore = chiamateTot ? (erroriTot / chiamateTot) * 100 : 0
  const mediaMs = chiamateTot ? Math.round(durataTot / chiamateTot) : 0
  servizi.push({
    chiave: 'prestazioni', etichetta: 'Prestazioni',
    stato: metricheErr || !chiamateTot ? 'non_verificato'
      : tassoErrore > 10 ? 'critico' : tassoErrore > 3 ? 'problema' : mediaMs > 3000 ? 'degradato' : 'operativo',
    dettaglio: metricheErr ? 'Le misure non si riescono a leggere.' : chiamateTot
      ? `${chiamateTot} chiamate in 24h, ${tassoErrore.toFixed(1)}% con errore, ${mediaMs} ms di media.`
      : 'Nessuna misura nelle ultime 24 ore.',
    latenzaMs: mediaMs,
  })

  // ── Interruttori e manutenzione ──────────────────────────────────────────
  const { data: flagsData, error: flagsErr } = await supabase.from('sc_flags').select('*')
  if (flagsErr) lettureFallite.push('interruttori')
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

  // Il controllo orario e' la prova che qualcuno ha davvero guardato: se
  // manca o e' vecchio, lo stato non e' piu' dimostrato.
  if (!ultimoControllo || ultimoControllo.inRitardo) {
    servizi.push({
      chiave: 'controllo_orario', etichetta: 'Controllo orario',
      stato: 'non_verificato',
      dettaglio: ultimoControllo
        ? `L ultimo giro completo risale a ${Math.round((Date.now() - new Date(ultimoControllo.eseguitoAt).getTime()) / 3600_000)} ore fa: lo stato qui sopra non e piu verificato. Premi Controlla adesso.`
        : 'Nessun giro completo registrato: premi Controlla adesso.',
    })
  }

  if (lettureFallite.length) {
    servizi.push({
      chiave: 'letture', etichetta: 'Letture del pannello', stato: 'problema',
      dettaglio: `Non si riescono a leggere: ${lettureFallite.join(', ')}. I numeri di queste sezioni non sono affidabili.`,
    })
  }

  const statoGenerale: Stato = servizi.reduce<Stato>(
    (peggiore, s) => GRAVITA.indexOf(s.stato) > GRAVITA.indexOf(peggiore) ? s.stato : peggiore, 'operativo')

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
      operazioni: { inCoda, abbandonate, bloccate, soloManuali, totale: ops.length },
      integrazioni: { totale: attive.length, conProblemi: rotte.length, verificate: verificate.length, maiVerificate: maiVerificate.length },
      lettureFallite,
      prestazioni: { chiamate24h: chiamateTot, tassoErrore: Number(tassoErrore.toFixed(2)), mediaMs },
      interruttori: { spente, manutenzione },
      backup: backup?.[0] || null,
      release: release?.[0] || null,
      ultimoControllo,
    }),
  }
}

export { handler }
