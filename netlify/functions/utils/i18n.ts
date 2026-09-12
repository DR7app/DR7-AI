// i18n.ts — 2026-07-20
// Rilevazione lingua dal prefisso telefonico + traduzione automatica GRATUITA.
// Usato per inviare messaggi/documenti nella lingua del cliente.
//
// Traduttore: DeepL Free (se presente una key in service_secrets 'deepl_api_key'
// o env DEEPL_API_KEY) altrimenti MyMemory (gratis, senza key, con chunking a
// 480 char). Cache in tabella `translation_cache` per non ri-tradurre.
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Prefisso telefonico E.164 (senza +, come normalizzato da Green API) → lingua ──
// Longest-prefix match. Default configurabile dal chiamante (fallback 'en').
const PHONE_LANG: Array<[string, string]> = [
  ['39', 'it'],   // Italia
  ['378', 'it'],  // San Marino
  ['41', 'it'],   // Svizzera (molti clienti IT-parlanti; best guess)
  ['33', 'fr'],   // Francia
  ['32', 'fr'],   // Belgio (fr/nl → fr)
  ['352', 'fr'],  // Lussemburgo
  ['34', 'es'],   // Spagna
  ['351', 'pt'],  // Portogallo
  ['49', 'de'],   // Germania
  ['43', 'de'],   // Austria
  ['31', 'nl'],   // Paesi Bassi
  ['44', 'en'],   // UK
  ['353', 'en'],  // Irlanda
  ['1', 'en'],    // USA/Canada
  ['61', 'en'],   // Australia
  ['7', 'ru'],    // Russia/Kazakhstan
  ['380', 'uk'],  // Ucraina
  ['48', 'pl'],   // Polonia
  ['40', 'ro'],   // Romania
  ['30', 'el'],   // Grecia
]

/** Lingua ISO (it/fr/en/…) dal numero. Default 'en' se sconosciuto. */
export function langFromPhone(rawPhone: string | null | undefined, fallback = 'en'): string {
  const digits = String(rawPhone || '').replace(/\D/g, '').replace(/^00/, '')
  if (!digits) return fallback
  // Prova prefissi più lunghi prima (ordina per lunghezza desc).
  const sorted = [...PHONE_LANG].sort((a, b) => b[0].length - a[0].length)
  for (const [prefix, lang] of sorted) {
    if (digits.startsWith(prefix)) return lang
  }
  return fallback
}

// djb2 hash (stringa breve deterministica per la cache).
function hashKey(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// Protegge URL, email e numeri lunghi dalla traduzione (tokenizza e ripristina).
function protect(text: string): { masked: string; tokens: string[] } {
  const tokens: string[] = []
  const masked = text.replace(/(https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.\w+|\+?\d[\d .\-]{6,}\d)/g, (m) => {
    tokens.push(m)
    return `[[${tokens.length - 1}]]`
  })
  return { masked, tokens }
}
function restore(text: string, tokens: string[]): string {
  // Tollerante: i traduttori spaziano o storpiano le parentesi del segnaposto
  // ([[0]] → [[ 0 ]], [ [0] ], 【0】). Tutte queste forme vanno ripristinate.
  return text
    .replace(/\[\s*\[\s*(\d+)\s*\]\s*\]/g, (_, i) => tokens[Number(i)] ?? '')
    .replace(/【\s*(\d+)\s*】/g, (_, i) => tokens[Number(i)] ?? '')
}

/**
 * Riga senza nulla da tradurre: solo segnaposto, spazi o punteggiatura.
 * 12/09/2026 — QUI SI PERDEVA IL LINK. Una riga fatta del solo segnaposto
 * ("[[1]]", cioe' il link di pagamento da solo sulla sua riga) MyMemory la
 * restituisce come "1": parentesi mangiate, link perso. Righe cosi' non vanno
 * proprio mandate al traduttore — non c'e' niente da tradurre.
 */
function nullaDaTradurre(line: string): boolean {
  return line.replace(/\[\[\d+\]\]/g, '').replace(/[^\p{L}\p{N}]/gu, '').length === 0
}

// Nessuna traduzione deve poter bloccare l'invio: ogni chiamata ha un tetto di
// tempo e l'intera traduzione un budget complessivo. Scaduto il budget si manda
// il testo originale — un messaggio in italiano arriva, un messaggio in ritardo
// no (la function Netlify viene uccisa e il cliente non riceve niente).
const TIMEOUT_SINGOLA_MS = 3500
const BUDGET_TOTALE_MS = 6500

async function fetchConTimeout(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_SINGOLA_MS): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

async function deeplTranslate(key: string, text: string, target: string, source: string): Promise<string | null> {
  try {
    const params = new URLSearchParams()
    params.append('text', text)
    params.append('target_lang', target.toUpperCase())
    if (source) params.append('source_lang', source.toUpperCase())
    const res = await fetchConTimeout('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: { 'Authorization': `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    if (!res.ok) { console.warn('[i18n] DeepL HTTP', res.status); return null }
    const json = await res.json() as { translations?: { text: string }[] }
    return json.translations?.[0]?.text ?? null
  } catch (e) { console.warn('[i18n] DeepL error:', e); return null }
}

// 12/09/2026 — PERCHE' I LINK NON ARRIVAVANO AI CLIENTI STRANIERI.
// MyMemory risponde SEMPRE HTTP 200: quando la quota gratuita giornaliera e'
// finita (o la coppia di lingue non va) mette il messaggio d'errore DENTRO
// `translatedText` e lo segnala solo in `responseStatus`/`quotaFinished`. Qui
// si prendeva quel testo come traduzione: ogni riga del messaggio diventava
// "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY...",
// LINK DI PAGAMENTO COMPRESO. Il cliente italiano riceveva il link (niente
// traduzione), lo straniero riceveva spazzatura senza link.
function rispostaMyMemoryValida(json: RispostaMyMemory, testo: string): string | null {
  const stato = Number(json.responseStatus || 0)
  if (json.quotaFinished === true) return null
  if (stato && stato !== 200) return null
  const t = (json.responseData?.translatedText || '').trim()
  if (!t) return null
  // Rete di sicurezza: gli errori MyMemory sono tutti in MAIUSCOLO e parlano
  // di se stessi. Se il "tradotto" e' uno di quelli, non e' una traduzione.
  const ERRORI = [
    'MYMEMORY WARNING',
    'YOU USED ALL AVAILABLE FREE TRANSLATIONS',
    'INVALID TARGET LANGUAGE',
    'INVALID SOURCE LANGUAGE',
    'PLEASE SELECT TWO DISTINCT LANGUAGES',
    'QUERY LENGTH LIMIT EXCEEDED',
  ]
  const up = t.toUpperCase()
  if (ERRORI.some(e => up.includes(e)) && !testo.toUpperCase().includes('MYMEMORY')) return null
  return t
}

interface RispostaMyMemory {
  responseData?: { translatedText?: string }
  responseStatus?: number | string
  quotaFinished?: boolean | null
  responseDetails?: string
}

/** Promise.all con un tetto di richieste contemporanee, ordine preservato. */
async function mappaConLimite<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let indice = 0
  const worker = async () => {
    while (indice < items.length) {
      const i = indice++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, worker))
  return out
}

// MyMemory: gratis senza key ma ~500 byte per richiesta → traduci per righe.
// Righe in parallelo (prima erano in sequenza: 12 righe = oltre 5 secondi, e
// la function Netlify moriva prima di chiamare Green API).
async function myMemoryTranslate(text: string, target: string, source: string, scadenza: number): Promise<string | null> {
  const langpair = `${source || 'it'}|${target}`
  const chunks = text.split('\n')
  try {
    // Parallelismo limitato: MyMemory gratis non gradisce raffiche.
    const tradotte = await mappaConLimite(chunks, 4, async (line) => {
      if (!line.trim()) return line
      if (nullaDaTradurre(line)) return line
      // Se la riga supera 480 char, spezzala su spazi.
      const pieces = line.length <= 480 ? [line] : (line.match(/.{1,480}(\s|$)/g) || [line])
      const translatedPieces: string[] = []
      for (const p of pieces) {
        if (Date.now() > scadenza) return null // budget finito → traduzione annullata
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(p)}&langpair=${encodeURIComponent(langpair)}`
        const res = await fetchConTimeout(url)
        if (!res.ok) return null
        const json = await res.json() as RispostaMyMemory
        const valido = rispostaMyMemoryValida(json, p)
        if (valido === null) {
          console.warn('[i18n] MyMemory non ha tradotto:', json.responseStatus, String(json.responseDetails || '').substring(0, 120))
          return null
        }
        translatedPieces.push(valido)
      }
      return translatedPieces.join('')
    })
    // Una riga fallita = traduzione fallita: meglio tutto in italiano che un
    // messaggio meta' tradotto e meta' messaggio d'errore.
    if (tradotte.some(r => r === null)) return null
    return (tradotte as string[]).join('\n')
  } catch (e) { console.warn('[i18n] MyMemory error:', e); return null }
}

/**
 * Traduce `text` da `source` a `target`. Se target===source ritorna invariato.
 * Protegge link/email/numeri. Cache in translation_cache. Provider: DeepL free
 * (se key) altrimenti MyMemory. Fail-safe: se la traduzione fallisce ritorna
 * il testo ORIGINALE (meglio in italiano che vuoto).
 */
export async function translateText(
  supabase: SupabaseClient,
  text: string,
  target: string,
  source = 'it',
): Promise<string> {
  const tgt = (target || '').toLowerCase()
  const src = (source || 'it').toLowerCase()
  if (!text || !text.trim() || !tgt || tgt === src) return text

  const key = hashKey(`${src}>${tgt}:${text}`)
  // 1) cache
  try {
    const { data: cached } = await supabase.from('translation_cache').select('translated').eq('key', key).maybeSingle()
    if (cached?.translated) return cached.translated as string
  } catch { /* tabella assente → nessuna cache */ }

  // 2) traduci
  const { masked, tokens } = protect(text)
  let deeplKey = process.env.DEEPL_API_KEY || ''
  try {
    const { data: sec } = await supabase.from('service_secrets').select('value').eq('key', 'deepl_api_key').maybeSingle()
    if ((sec as { value?: string } | null)?.value?.trim()) deeplKey = (sec as { value: string }).value.trim()
  } catch { /* service_secrets opzionale */ }

  const scadenza = Date.now() + BUDGET_TOTALE_MS
  let translated: string | null = null
  if (deeplKey) translated = await deeplTranslate(deeplKey, masked, tgt, src)
  if (!translated && Date.now() < scadenza) translated = await myMemoryTranslate(masked, tgt, src, scadenza)
  if (!translated) return text // fail-safe: originale

  const final = restore(translated, tokens)

  // Il traduttore puo' storpiare i segnaposto ([[0]] → [0], [ [0] ], 【0】…):
  // in quel caso link, email o telefono sparirebbero dal messaggio senza che
  // nessuno se ne accorga. Se anche uno solo non e' tornato al suo posto, si
  // manda il testo originale — con il link dentro.
  const tokenPersi = tokens.filter(tk => !final.includes(tk))
  if (tokenPersi.length > 0) {
    console.warn('[i18n] traduzione scartata: segnaposto persi', tokenPersi.length)
    return text
  }

  // 3) salva in cache (best-effort)
  try {
    await supabase.from('translation_cache').upsert({ key, source_lang: src, target_lang: tgt, translated: final, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  } catch { /* ignora */ }

  return final
}
