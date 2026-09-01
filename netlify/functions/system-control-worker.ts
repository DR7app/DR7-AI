// System Control — AUTO-HEALING.
//
// Gira ogni 5 minuti (pianificato in netlify.toml) e si puo' lanciare a mano
// dal pannello. Fa quattro cose, tutte non distruttive:
//   1. riprende le operazioni fallite quando e' il momento (ritardo crescente);
//   2. riapre in prova i collegamenti messi in pausa dopo troppi errori;
//   3. chiude da solo i problemi temporanei che non si ripresentano piu';
//   4. prepara gli avvisi, raggruppati per non fare spam.
// In piu' controlla i backup e sorveglia l'ultimo rilascio.
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { registraAzione, statoFunzione, mascheraTesto, VERSIONE, AMBIENTE } from './utils/systemControl'
import { eseguiRitentativo } from './utils/systemControlRetry'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const MAX_PER_CICLO = 10          // quante operazioni al massimo per giro
const FINESTRA_AVVISO_MIN = 60    // stesso problema: al massimo un avviso all ora

async function riprendiOperazioni(): Promise<{ tentate: number; riuscite: number }> {
  const ora = new Date().toISOString()
  const { data } = await supabase.from('sc_operations')
    .select('id, integrazione')
    .eq('stato', 'in_coda').eq('automatica', true)
    .lte('prossimo_tentativo_at', ora)
    .order('prossimo_tentativo_at', { ascending: true })
    .limit(MAX_PER_CICLO)
  const ops = (data || []) as { id: string; integrazione: string | null }[]
  if (!ops.length) return { tentate: 0, riuscite: 0 }

  // Integrazioni ferme: le loro operazioni restano in coda, non si perdono.
  const { data: integrData } = await supabase.from('sc_integrations').select('chiave, abilitata, circuito, circuito_fino_a')
  const ferme = new Set(
    ((integrData || []) as { chiave: string; abilitata: boolean; circuito: string; circuito_fino_a: string | null }[])
      .filter(i => i.abilitata === false || (i.circuito === 'aperto' && i.circuito_fino_a && new Date(i.circuito_fino_a).getTime() > Date.now()))
      .map(i => i.chiave)
  )

  let riuscite = 0
  let tentate = 0
  for (const op of ops) {
    if (op.integrazione && ferme.has(op.integrazione)) continue
    tentate++
    const esito = await eseguiRitentativo(supabase, op.id, { automatico: true })
    if (esito.ok && !esito.saltata) riuscite++
  }
  return { tentate, riuscite }
}

async function riapriCircuiti(): Promise<number> {
  const ora = new Date().toISOString()
  const { data } = await supabase.from('sc_integrations')
    .update({ circuito: 'semiaperto', updated_at: ora })
    .eq('circuito', 'aperto').lt('circuito_fino_a', ora).select('chiave')
  return data?.length || 0
}

/**
 * Problemi temporanei (classe 1) che non si vedono da due ore: il gestionale
 * li chiude da solo e lo scrive. Non spariscono: restano nello storico con
 * "risolto automaticamente".
 */
async function chiudiProblemiRientrati(): Promise<number> {
  const dueOreFa = new Date(Date.now() - 2 * 3600_000).toISOString()
  const { data } = await supabase.from('sc_error_groups')
    .update({
      stato: 'risolto', risolto_at: new Date().toISOString(),
      risolto_auto: true, risolto_da: 'auto-riparazione',
      risolto_come: 'Problema temporaneo rientrato da solo: nessuna nuova occorrenza per due ore.',
    })
    .eq('classe_risoluzione', 1).in('stato', ['aperto', 'in_corso'])
    .lt('ultima_comparsa', dueOreFa).select('id')
  return data?.length || 0
}

/**
 * Avvisi raggruppati: un problema grave genera UN avviso all'ora, non uno per
 * occorrenza. L'invio verso l'esterno parte solo se esplicitamente acceso.
 */
async function preparaAvvisi(): Promise<number> {
  const daUnOra = new Date(Date.now() - FINESTRA_AVVISO_MIN * 60_000).toISOString()
  const { data: gruppiData } = await supabase.from('sc_error_groups')
    .select('id, titolo, severita, occorrenze, ultima_comparsa, causa_probabile, integrazione, classe_risoluzione')
    .in('stato', ['aperto', 'in_corso']).in('severita', ['alto', 'critico'])
    .gte('ultima_comparsa', daUnOra).limit(20)
  const gruppi = (gruppiData || []) as { id: string; titolo: string; severita: string; occorrenze: number; causa_probabile: string | null; integrazione: string | null }[]
  if (!gruppi.length) return 0

  const { data: giaAvvisati } = await supabase.from('sc_alerts')
    .select('gruppo_id').gte('inviato_at', daUnOra)
  const visti = new Set(((giaAvvisati || []) as { gruppo_id: string | null }[]).map(a => a.gruppo_id))

  const nuovi = gruppi.filter(g => !visti.has(g.id))
  if (!nuovi.length) return 0

  const telefoni = (process.env.SYSTEM_CONTROL_ALERT_PHONES || '').split(',').map(s => s.replace(/\D/g, '')).filter(Boolean)
  const invioAcceso = (await statoFunzione('invio_whatsapp')).attiva && telefoni.length > 0

  for (const g of nuovi) {
    const messaggio = `DR7 System Control — ${g.severita.toUpperCase()}\n${g.titolo}\n${g.causa_probabile || ''}\nOccorrenze: ${g.occorrenze}${g.integrazione ? `\nIntegrazione: ${g.integrazione}` : ''}`
    let canale = 'pannello'
    let destinatari = ''

    if (invioAcceso && g.severita === 'critico') {
      // Solo i CRITICI escono dal gestionale, e solo verso i numeri
      // configurati apposta. Tutto il resto resta nel pannello: e' la
      // regola imparata dagli invii massivi non voluti.
      const idInstance = process.env.GREEN_API_ID_INSTANCE
      const token = process.env.GREEN_API_TOKEN
      if (idInstance && token) {
        for (const tel of telefoni) {
          try {
            await fetch(`https://api.green-api.com/waInstance${idInstance}/sendMessage/${token}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chatId: `${tel}@c.us`, message: messaggio }),
            })
          } catch (e) { console.warn('[system-control-worker] avviso non inviato:', mascheraTesto((e as Error).message)) }
        }
        canale = 'whatsapp'
        destinatari = `${telefoni.length} numeri`
      }
    }

    await supabase.from('sc_alerts').insert({
      chiave: `gruppo:${g.id}`, gruppo_id: g.id, severita: g.severita,
      titolo: g.titolo, messaggio, canale, destinatari,
      eventi_raggruppati: g.occorrenze,
    })
  }
  return nuovi.length
}

/** Stato dei backup: letto dall API di gestione Supabase, se configurata. */
async function controllaBackup(): Promise<string> {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const ref = process.env.SUPABASE_PROJECT_REF
  if (!token || !ref) {
    await supabase.from('sc_backups').insert({
      tipo: 'database', esito: 'sconosciuto',
      messaggio: 'Stato non verificabile: mancano SUPABASE_ACCESS_TOKEN e SUPABASE_PROJECT_REF. I backup automatici di Supabase restano attivi lato piattaforma.',
    })
    return 'sconosciuto'
  }
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/backups`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const dati = await res.json() as { backups?: { inserted_at?: string; status?: string }[] }
    const ultimo = dati.backups?.[0]
    await supabase.from('sc_backups').insert({
      tipo: 'database',
      eseguito_at: ultimo?.inserted_at || new Date().toISOString(),
      esito: ultimo ? 'ok' : 'sconosciuto',
      messaggio: ultimo ? `Ultimo backup: ${ultimo.status || 'completato'}.` : 'Nessun backup elencato.',
      verificato_at: new Date().toISOString(),
    })
    return ultimo ? 'ok' : 'sconosciuto'
  } catch (e) {
    await supabase.from('sc_backups').insert({
      tipo: 'database', esito: 'errore', messaggio: mascheraTesto((e as Error).message),
      verificato_at: new Date().toISOString(),
    })
    return 'errore'
  }
}

/**
 * Rilascio nuovo? Netlify espone COMMIT_REF: se e' cambiato rispetto
 * all'ultima riga, si apre una finestra di osservazione registrando quanti
 * errori c'erano nelle due ore PRIMA. Cosi' il confronto e' onesto.
 */
async function registraRilascioNuovo(): Promise<boolean> {
  if (VERSIONE === 'sconosciuta') return false
  const { data } = await supabase.from('sc_releases')
    .select('versione').order('rilasciato_at', { ascending: false }).limit(1)
  const ultima = (data?.[0] as { versione?: string } | undefined)?.versione
  if (ultima === VERSIONE) return false
  const dueOreFa = new Date(Date.now() - 2 * 3600_000).toISOString()
  const { count } = await supabase.from('sc_error_events')
    .select('id', { count: 'exact', head: true }).gte('occorso_at', dueOreFa)
  await supabase.from('sc_releases').insert({
    versione: VERSIONE, commit_sha: VERSIONE, ambiente: AMBIENTE,
    errori_prima: count || 0, esito: 'in_osservazione',
    note: 'Rilascio rilevato automaticamente: sorveglianza degli errori per le prossime due ore.',
  })
  return true
}

/** Dopo un rilascio: gli errori sono aumentati? */
async function sorvegliaRilascio(): Promise<string | null> {
  const { data } = await supabase.from('sc_releases')
    .select('*').eq('esito', 'in_osservazione').order('rilasciato_at', { ascending: false }).limit(1)
  const rel = data?.[0] as { id: string; rilasciato_at: string; errori_prima: number | null } | undefined
  if (!rel) return null
  const trascorse = (Date.now() - new Date(rel.rilasciato_at).getTime()) / 3600_000
  if (trascorse < 2) return null   // troppo presto per giudicare

  const { count: dopo } = await supabase.from('sc_error_events')
    .select('id', { count: 'exact', head: true }).gte('occorso_at', rel.rilasciato_at)
  const prima = rel.errori_prima ?? 0
  const peggiorato = (dopo || 0) > Math.max(5, prima * 1.5)
  await supabase.from('sc_releases').update({
    errori_dopo: dopo || 0,
    esito: peggiorato ? 'peggiorato' : 'stabile',
    note: peggiorato
      ? `Errori passati da ${prima} a ${dopo} nelle due ore dopo il rilascio: controllare.`
      : `Errori stabili dopo il rilascio (${prima} prima, ${dopo} dopo).`,
  }).eq('id', rel.id)
  return peggiorato ? 'peggiorato' : 'stabile'
}

const handler: Handler = async () => {
  const attivo = await statoFunzione('auto_riparazione')
  if (!attivo.attiva) {
    return { statusCode: 200, body: JSON.stringify({ saltato: true, motivo: 'Auto-riparazione spenta dal System Control.' }) }
  }

  const risultato: Record<string, unknown> = {}
  try {
    risultato.rilascioNuovo = await registraRilascioNuovo()
    risultato.circuitiRiaperti = await riapriCircuiti()
    const op = await riprendiOperazioni()
    risultato.operazioniTentate = op.tentate
    risultato.operazioniRiuscite = op.riuscite
    risultato.problemiChiusiDaSoli = await chiudiProblemiRientrati()
    risultato.avvisi = await preparaAvvisi()
    risultato.rilascio = await sorvegliaRilascio()
    // Il backup si controlla una volta al giorno, non a ogni giro.
    const oraRoma = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }))
    if (oraRoma === 6) risultato.backup = await controllaBackup()

    await registraAzione({
      azione: 'ciclo_auto_riparazione', automatico: true, bersaglioTipo: 'sistema',
      parametri: risultato, esito: 'ok',
      messaggio: `Ripresi ${op.riuscite}/${op.tentate}, ${risultato.problemiChiusiDaSoli} problemi chiusi da soli, ${risultato.avvisi} avvisi.`,
    })
    return { statusCode: 200, body: JSON.stringify(risultato) }
  } catch (err) {
    console.error('[system-control-worker]', err)
    return { statusCode: 500, body: JSON.stringify({ error: mascheraTesto((err as Error)?.message || 'errore') }) }
  }
}

export { handler }
