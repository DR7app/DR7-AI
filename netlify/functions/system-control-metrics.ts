// System Control — PRESTAZIONI e STORICI (audit, configurazioni, avvisi,
// rilasci, backup). Sola lettura.
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin || event.headers.Origin)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }

  const { error: authErr, user } = await requireAuth(event)
  if (authErr) return authErr
  const email = (user?.email || '').toLowerCase()
  if (!(await userHasRole(email, 'direzione')) && !(await userHasRole(email, 'developer'))) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo direzione o developer.' }) }
  }

  const giorni = Math.min(30, Math.max(1, Number(event.queryStringParameters?.giorni) || 7))
  const da = new Date(Date.now() - giorni * 24 * 3600_000).toISOString()

  const [metriche, audit, configStorico, avvisi, rilasci, backup, risolti] = await Promise.all([
    supabase.from('sc_metrics').select('*').gte('ora', da).limit(5000),
    supabase.from('sc_actions_log').select('*').order('created_at', { ascending: false }).limit(200),
    supabase.from('sc_config_history').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('sc_alerts').select('*').order('inviato_at', { ascending: false }).limit(100),
    supabase.from('sc_releases').select('*').order('rilasciato_at', { ascending: false }).limit(20),
    supabase.from('sc_backups').select('*').order('eseguito_at', { ascending: false }).limit(20),
    supabase.from('sc_error_groups').select('*').in('stato', ['risolto', 'ignorato'])
      .order('risolto_at', { ascending: false, nullsFirst: false }).limit(100),
  ])

  if (metriche.error && (metriche.error.code === '42P01' || metriche.error.code === 'PGRST205')) {
    return { statusCode: 200, headers, body: JSON.stringify({ migrazioneEseguita: false }) }
  }

  type Riga = { tipo: string; nome: string; business: string; chiamate: number; errori: number; durata_totale_ms: number; durata_max_ms: number }
  const righe = (metriche.data || []) as Riga[]

  // Aggregazione per nome: media, massimo, tasso di errore.
  const perNome = new Map<string, { tipo: string; nome: string; chiamate: number; errori: number; totale: number; max: number }>()
  for (const r of righe) {
    const k = `${r.tipo}|${r.nome}`
    const a = perNome.get(k) || { tipo: r.tipo, nome: r.nome, chiamate: 0, errori: 0, totale: 0, max: 0 }
    a.chiamate += r.chiamate
    a.errori += r.errori
    a.totale += Number(r.durata_totale_ms)
    a.max = Math.max(a.max, r.durata_max_ms)
    perNome.set(k, a)
  }
  const aggregate = Array.from(perNome.values()).map(a => ({
    tipo: a.tipo, nome: a.nome, chiamate: a.chiamate, errori: a.errori,
    mediaMs: a.chiamate ? Math.round(a.totale / a.chiamate) : 0,
    massimoMs: a.max,
    tassoErrore: a.chiamate ? Number(((a.errori / a.chiamate) * 100).toFixed(1)) : 0,
  }))

  // Andamento orario complessivo, per vedere quando si e' rotto qualcosa.
  const perOra = new Map<string, { ora: string; chiamate: number; errori: number; totale: number }>()
  for (const r of (metriche.data || []) as (Riga & { ora: string })[]) {
    const a = perOra.get(r.ora) || { ora: r.ora, chiamate: 0, errori: 0, totale: 0 }
    a.chiamate += r.chiamate
    a.errori += r.errori
    a.totale += Number(r.durata_totale_ms)
    perOra.set(r.ora, a)
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      migrazioneEseguita: true,
      giorni,
      piuLente: [...aggregate].sort((a, b) => b.mediaMs - a.mediaMs).slice(0, 20),
      piuErrori: [...aggregate].filter(a => a.errori > 0).sort((a, b) => b.errori - a.errori).slice(0, 20),
      piuChiamate: [...aggregate].sort((a, b) => b.chiamate - a.chiamate).slice(0, 20),
      andamento: Array.from(perOra.values()).sort((a, b) => a.ora.localeCompare(b.ora)).map(a => ({
        ora: a.ora, chiamate: a.chiamate, errori: a.errori,
        mediaMs: a.chiamate ? Math.round(a.totale / a.chiamate) : 0,
      })),
      audit: audit.data || [],
      configStorico: configStorico.data || [],
      avvisi: avvisi.data || [],
      rilasci: rilasci.data || [],
      backup: backup.data || [],
      storicoProblemi: risolti.data || [],
    }),
  }
}

export { handler }
