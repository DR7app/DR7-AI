// Recensioni Google copiate in google_reviews_cache (26/09/2026).
//
// Due fonti, in quest'ordine:
//   1. Google Business Profile (API v4 reviews.list): TUTTE le recensioni,
//      con le risposte. Serve l'accesso API approvato da Google: finche' la
//      quota e' 0 la chiamata fallisce e si passa alla seconda.
//   2. Google Maps (Places, tramite la funzione pubblica del sito
//      get-google-reviews?ordine=recenti): le 5 piu' recenti a ogni giro. La
//      chiave Places vive solo sul sito, per questo si passa da li'.
// Non si cancella mai niente: giro dopo giro la lista cresce.
//
// La stessa recensione puo' arrivare da tutte e due: la chiave primaria
// (autore normalizzato + giorno + stelle) la riconosce. Stessa regola nel
// sito (utils/recensioniGoogle.ts in Sito).
import type { SupabaseClient } from '@supabase/supabase-js'
import { google } from 'googleapis'

export interface RigaCache {
  id: string
  google_review_id: string | null
  source: 'gbp' | 'places'
  author: string | null
  author_photo: string | null
  rating: number | null
  text: string | null
  lang: string | null
  published_at: string | null
  reply: string | null
  reply_at: string | null
}

export function chiaveRecensione(autore: string | null | undefined, pubblicata: string | Date | null | undefined, stelle: number | null | undefined): string {
  const nome = String(autore || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
  const d = pubblicata ? new Date(pubblicata) : null
  const giorno = d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : 'senza-data'
  return `${nome}|${giorno}|${Math.round(Number(stelle) || 0)}`
}

const STELLE: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }
export function stelleDaGoogle(v: unknown): number | null {
  if (typeof v === 'number') return v >= 1 && v <= 5 ? Math.round(v) : null
  return STELLE[String(v || '').toUpperCase()] ?? null
}

// Google Business aggiunge al testo la traduzione automatica:
// "Testo originale\n\n(Translated by Google)\n..." -> si tiene solo l'originale.
function soloOriginale(testo: string | null | undefined): string | null {
  if (!testo) return null
  const t = String(testo)
  const tradotto = t.indexOf('(Translated by Google)')
  const originale = t.indexOf('(Original)')
  if (originale >= 0) return t.slice(originale + '(Original)'.length).trim() || null
  if (tradotto > 0) return t.slice(0, tradotto).trim() || null
  return t.trim() || null
}

export interface RecensioneGbp {
  reviewId?: string
  reviewer?: { displayName?: string; profilePhotoUrl?: string }
  starRating?: string
  comment?: string
  createTime?: string
  updateTime?: string
  reviewReply?: { comment?: string; updateTime?: string }
}

export function daRecensioneGbp(r: RecensioneGbp): RigaCache | null {
  const rating = stelleDaGoogle(r.starRating)
  const autore = r.reviewer?.displayName?.trim() || null
  if (!rating) return null
  return {
    id: chiaveRecensione(autore, r.createTime, rating),
    google_review_id: r.reviewId || null,
    source: 'gbp',
    author: autore,
    author_photo: r.reviewer?.profilePhotoUrl || null,
    rating,
    text: soloOriginale(r.comment),
    lang: null,
    published_at: r.createTime || null,
    reply: r.reviewReply?.comment?.trim() || null,
    reply_at: r.reviewReply?.updateTime || null,
  }
}

export interface RecensionePlaces {
  author_name?: string
  author?: string
  profile_photo_url?: string | null
  rating?: number
  text?: string
  body?: string
  language?: string | null
  time?: number
  date?: string
}

export function daRecensionePlaces(r: RecensionePlaces): RigaCache | null {
  const rating = stelleDaGoogle(r.rating)
  const autore = (r.author_name || r.author || '').trim() || null
  const quando = typeof r.time === 'number' ? new Date(r.time * 1000).toISOString() : (r.date ? new Date(r.date).toISOString() : null)
  if (!rating) return null
  return {
    id: chiaveRecensione(autore, quando, rating),
    google_review_id: null,
    source: 'places',
    author: autore,
    author_photo: r.profile_photo_url || null,
    rating,
    text: (r.text ?? r.body ?? '').trim() || null,
    lang: r.language || null,
    published_at: quando,
    reply: null,
    reply_at: null,
  }
}

export interface EsitoSincronizzazione {
  ok: boolean
  source: 'gbp' | 'places' | null
  nuove: number
  totale: number | null
  errore?: string
  avviso?: string
}

interface Sintesi { rating: number | null; total: number | null }

async function daGoogleBusiness(sb: SupabaseClient): Promise<{ righe: RigaCache[]; sintesi: Sintesi }> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('OAuth Google non configurato')

  const { data: tok } = await sb.from('app_secrets').select('value').eq('key', 'ga4_oauth_refresh_token').maybeSingle()
  const refreshToken = (tok?.value as { refresh_token?: string } | null)?.refresh_token
  if (!refreshToken) throw new Error('Account Google non collegato (Rendimento Sito)')

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
  oauth2.setCredentials({ refresh_token: refreshToken })

  // accounts/{a}/locations/{l}: la location e' gia' in cache (gbp-report),
  // l'account si scopre una volta e si ricorda.
  const { data: locRow } = await sb.from('app_secrets').select('value').eq('key', 'gbp_location_name').maybeSingle()
  const location = process.env.GBP_LOCATION_NAME || (locRow?.value as { name?: string } | null)?.name
  if (!location) throw new Error('Location Google Business sconosciuta')

  const { data: accRow } = await sb.from('app_secrets').select('value').eq('key', 'gbp_account_name').maybeSingle()
  let account = process.env.GBP_ACCOUNT_NAME || (accRow?.value as { name?: string } | null)?.name
  if (!account) {
    const res = await oauth2.request<{ accounts?: Array<{ name: string }> }>({
      url: 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts', method: 'GET',
    })
    account = res.data.accounts?.[0]?.name
    if (!account) throw new Error('Nessun account Google Business collegato')
    await sb.from('app_secrets').upsert({
      key: 'gbp_account_name', value: { name: account, discovered_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
  }

  const locId = location.replace(/^.*locations\//, '')
  const base = `https://mybusiness.googleapis.com/v4/${account}/locations/${locId}/reviews`
  const righe: RigaCache[] = []
  let sintesi: Sintesi = { rating: null, total: null }
  let pagina: string | undefined
  for (let giro = 0; giro < 10; giro++) {
    const url = `${base}?pageSize=50&orderBy=${encodeURIComponent('updateTime desc')}${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ''}`
    const res = await oauth2.request<{ reviews?: RecensioneGbp[]; averageRating?: number; totalReviewCount?: number; nextPageToken?: string }>({ url, method: 'GET' })
    if (giro === 0) sintesi = { rating: res.data.averageRating ?? null, total: res.data.totalReviewCount ?? null }
    for (const r of res.data.reviews || []) {
      const riga = daRecensioneGbp(r)
      if (riga) righe.push(riga)
    }
    pagina = res.data.nextPageToken
    if (!pagina) break
  }
  return { righe, sintesi }
}

async function daGoogleMaps(): Promise<{ righe: RigaCache[]; sintesi: Sintesi }> {
  const sito = (process.env.SITO_URL || 'https://dr7.app').replace(/\/+$/, '')
  const res = await fetch(`${sito}/.netlify/functions/get-google-reviews?ordine=recenti`, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Google Maps (sito) HTTP ${res.status}`)
  const data = await res.json() as { reviews?: RecensionePlaces[]; ratingSummary?: { ratingValue?: number; reviewCount?: number } }
  const righe = (data.reviews || []).map(daRecensionePlaces).filter((r): r is RigaCache => r !== null)
  return { righe, sintesi: { rating: data.ratingSummary?.ratingValue ?? null, total: data.ratingSummary?.reviewCount ?? null } }
}

function messaggio(e: unknown): string {
  const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string }
  return String(err?.response?.data?.error?.message || err?.message || e).slice(0, 300)
}

/** Aggiorna la copia. Non lancia: l'esito dice cosa e' successo. */
export async function sincronizzaRecensioni(sb: SupabaseClient): Promise<EsitoSincronizzazione> {
  const ora = new Date().toISOString()
  let fonte: 'gbp' | 'places' = 'gbp'
  let dati: { righe: RigaCache[]; sintesi: Sintesi }
  let avviso: string | undefined
  try {
    dati = await daGoogleBusiness(sb)
  } catch (e) {
    avviso = `Google Business non disponibile (${messaggio(e)}): uso Google Maps, 5 recensioni per volta.`
    fonte = 'places'
    try {
      dati = await daGoogleMaps()
    } catch (e2) {
      const errore = `${avviso} Anche Google Maps non risponde: ${messaggio(e2)}`
      await sb.from('google_reviews_summary').upsert({ id: 'main', last_error: errore, fetched_at: ora }, { onConflict: 'id' })
      return { ok: false, source: null, nuove: 0, totale: null, errore }
    }
  }

  // Doppioni nella stessa risposta (stesso autore, giorno e stelle): una riga.
  const perId = new Map<string, RigaCache>()
  for (const r of dati.righe) if (!perId.has(r.id)) perId.set(r.id, r)
  const righe = [...perId.values()]

  let nuove = 0
  if (righe.length) {
    const { data: esistenti, error: errLettura } = await sb.from('google_reviews_cache').select('id').in('id', righe.map(r => r.id))
    if (errLettura) return { ok: false, source: fonte, nuove: 0, totale: null, errore: `Copia non leggibile: ${errLettura.message}` }
    const gia = new Set((esistenti || []).map((r: { id: string }) => r.id))
    nuove = righe.filter(r => !gia.has(r.id)).length
    // `hidden` non si manda mai: una recensione nascosta resta nascosta.
    const { error } = await sb.from('google_reviews_cache')
      .upsert(righe.map(r => ({ ...r, fetched_at: ora })), { onConflict: 'id' })
    if (error) return { ok: false, source: fonte, nuove: 0, totale: null, errore: `Salvataggio non riuscito: ${error.message}` }
  }

  await sb.from('google_reviews_summary').upsert({
    id: 'main',
    ...(dati.sintesi.rating != null ? { rating: dati.sintesi.rating } : {}),
    ...(dati.sintesi.total != null ? { total: dati.sintesi.total } : {}),
    source: fonte, fetched_at: ora, last_success_at: ora, last_error: avviso || null,
  }, { onConflict: 'id' })

  return { ok: true, source: fonte, nuove, totale: dati.sintesi.total, ...(avviso ? { avviso } : {}) }
}
