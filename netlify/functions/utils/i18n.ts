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
  return text.replace(/\[\[(\d+)\]\]/g, (_, i) => tokens[Number(i)] ?? '')
}

async function deeplTranslate(key: string, text: string, target: string, source: string): Promise<string | null> {
  try {
    const params = new URLSearchParams()
    params.append('text', text)
    params.append('target_lang', target.toUpperCase())
    if (source) params.append('source_lang', source.toUpperCase())
    const res = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: { 'Authorization': `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    if (!res.ok) { console.warn('[i18n] DeepL HTTP', res.status); return null }
    const json = await res.json() as { translations?: { text: string }[] }
    return json.translations?.[0]?.text ?? null
  } catch (e) { console.warn('[i18n] DeepL error:', e); return null }
}

// MyMemory: gratis senza key ma ~500 byte per richiesta → traduci per righe.
async function myMemoryTranslate(text: string, target: string, source: string): Promise<string | null> {
  const langpair = `${source || 'it'}|${target}`
  const chunks = text.split('\n')
  const out: string[] = []
  try {
    for (const line of chunks) {
      if (!line.trim()) { out.push(line); continue }
      // Se la riga supera 480 char, spezzala su spazi.
      const pieces = line.length <= 480 ? [line] : (line.match(/.{1,480}(\s|$)/g) || [line])
      const translatedPieces: string[] = []
      for (const p of pieces) {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(p)}&langpair=${encodeURIComponent(langpair)}`
        const res = await fetch(url)
        if (!res.ok) { translatedPieces.push(p); continue }
        const json = await res.json() as { responseData?: { translatedText?: string } }
        translatedPieces.push(json.responseData?.translatedText || p)
      }
      out.push(translatedPieces.join(''))
    }
    return out.join('\n')
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

  let translated: string | null = null
  if (deeplKey) translated = await deeplTranslate(deeplKey, masked, tgt, src)
  if (!translated) translated = await myMemoryTranslate(masked, tgt, src)
  if (!translated) return text // fail-safe: originale

  const final = restore(translated, tokens)

  // 3) salva in cache (best-effort)
  try {
    await supabase.from('translation_cache').upsert({ key, source_lang: src, target_lang: tgt, translated: final, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  } catch { /* ignora */ }

  return final
}
