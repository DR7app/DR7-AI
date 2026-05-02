import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { searchIncomingInvoices, getIncomingInvoice } from './aruba-utils'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

function normalizeVat(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/\D/g, '')
}

// Normalizza un nome per matching tollerante: lowercase, rimuove forme
// societarie comuni (s.r.l., s.p.a., snc, sas, srl, spa, soc., societa', ecc.),
// punteggiatura, accenti, e collassa spazi multipli. Cosi' "AGENZIA GOFFI SRL"
// e "Agenzia Goffi S.r.l." vengono trattati come uguali.
function normalizeName(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')        // rimuovi accenti
    .replace(/\b(s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|soc(?:ieta')?|srls|s\.r\.l\.s\.?)\b/gi, '')
    .replace(/\b(a socio unico|succursale italiana|italia|italy|italiana|italiano)\b/gi, '')
    .replace(/['".,&\-_/\\()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Restituisce true se due nomi normalizzati combaciano abbastanza:
// - uguali, oppure
// - uno contiene l'altro (per ragioni sociali abbreviate)
// - condividono >= 2 token significativi
function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a.length >= 4 && b.includes(a)) return true
  if (b.length >= 4 && a.includes(b)) return true
  const at = a.split(' ').filter(t => t.length >= 3)
  const bt = b.split(' ').filter(t => t.length >= 3)
  if (at.length === 0 || bt.length === 0) return false
  const shared = at.filter(t => bt.includes(t)).length
  return shared >= Math.min(2, Math.min(at.length, bt.length))
}

function isoMonthRange(year: number, monthIdxOneBased: number) {
  const daysInMonth = new Date(year, monthIdxOneBased, 0).getDate()
  const monthMid = new Date(Date.UTC(year, monthIdxOneBased - 1, 15, 12, 0, 0))
  const romeStr = monthMid.toLocaleString('en-US', { timeZone: 'Europe/Rome', hour12: false })
  const utcStr = monthMid.toLocaleString('en-US', { timeZone: 'UTC', hour12: false })
  const offsetHours = Math.round((new Date(romeStr).getTime() - new Date(utcStr).getTime()) / 3600000)
  const tz = `${offsetHours >= 0 ? '+' : '-'}${String(Math.abs(offsetHours)).padStart(2, '0')}:00`
  const mo = String(monthIdxOneBased).padStart(2, '0')
  return {
    startDate: `${year}-${mo}-01T00:00:00.000${tz}`,
    endDate: `${year}-${mo}-${String(daysInMonth).padStart(2, '0')}T23:59:59.999${tz}`,
  }
}

function extractFromXml(b64: string): { amount: number | null; date: string; number: string } {
  let amount: number | null = null
  let date = ''
  let number = ''
  try {
    const xml = Buffer.from(b64, 'base64').toString('utf-8')
    const flat = xml.replace(/<\/?[a-zA-Z0-9_-]+:/g, m => m.replace(/[a-zA-Z0-9_-]+:/, ''))
    const ma = flat.match(/<ImportoTotaleDocumento>\s*([0-9.,-]+)\s*<\/ImportoTotaleDocumento>/i)
    if (ma) {
      const p = parseFloat(ma[1].replace(',', '.'))
      if (!isNaN(p)) amount = p
    }
    const md = flat.match(/<Data>\s*([0-9T:.+\-]+)\s*<\/Data>/)
    if (md) {
      let d = md[1]
      if (d.includes('T')) d = d.split('T')[0]
      date = d
    }
    const mn = flat.match(/<Numero>\s*([^<]+?)\s*<\/Numero>/)
    if (mn) number = mn[1].trim()
  } catch { /* ignore */ }
  return { amount, date, number }
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) }

  try {
    const body = JSON.parse(event.body || '{}')
    const fornitoreId: string = body.fornitore_id
    const monthsBack: number = Math.min(Math.max(parseInt(body.months) || 12, 1), 24)
    if (!fornitoreId) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'fornitore_id required' }) }
    }

    const { data: fornitore, error: fornErr } = await supabase
      .from('fornitori')
      .select('id, nome, piva')
      .eq('id', fornitoreId)
      .single()
    if (fornErr || !fornitore) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Fornitore non trovato' }) }
    }

    const piva = normalizeVat(fornitore.piva)
    const nameNorm = normalizeName(fornitore.nome)

    // Aggregate Aruba invoices for last N months that match this fornitore
    const matched: { filename: string; sender: string; senderVat: string }[] = []
    const now = new Date()
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const range = isoMonthRange(d.getFullYear(), d.getMonth() + 1)
      let page = 0
      const PAGE_SIZE = 100
      const MAX_PAGES = 20
      while (page < MAX_PAGES) {
        const result = await searchIncomingInvoices({ startDate: range.startDate, endDate: range.endDate, page, pageSize: PAGE_SIZE })
        const list: any[] = result.invoices || result.content || result.data || []
        for (const inv of list) {
          const sender = inv.senderDescription || inv.sender?.description || ''
          const senderVatRaw = inv.senderCountryCode && inv.senderId ? `${inv.senderCountryCode}${inv.senderId}` : (inv.sender?.vatCode || '')
          const v = normalizeVat(senderVatRaw)
          let isMatch = false
          // 1) match per P.IVA (entrambi normalizzati a sole cifre)
          if (piva && v === piva) isMatch = true
          // 2) fallback: match per nome — sempre tentato anche se la P.IVA esiste,
          //    perche' a volte Aruba scrive la P.IVA in modo non comparabile
          //    (es. country code mancante o esteso). namesMatch tollera maiusc/
          //    minusc, suffissi societari, punteggiatura e accenti.
          if (!isMatch && nameNorm && namesMatch(nameNorm, normalizeName(sender))) {
            isMatch = true
          }
          if (isMatch) {
            const filename = inv.filename || inv.uploadFileName
            if (filename) matched.push({ filename, sender, senderVat: v })
          }
        }
        if (list.length < PAGE_SIZE) break
        if (result.last === true) break
        if (typeof result.totalPages === 'number' && page + 1 >= result.totalPages) break
        page++
      }
    }

    // Fetch existing fornitore_documents to dedupe and to backfill aruba_filename
    const { data: existingDocs } = await supabase
      .from('fornitore_documents')
      .select('id, numero_documento, data_documento, file_url, aruba_filename')
      .eq('fornitore_id', fornitoreId)
      .eq('tipo', 'fattura')
    const existingKey = new Map<string, { id: string; aruba_filename: string | null }>()
    for (const d of existingDocs || []) {
      existingKey.set(`${d.numero_documento}|${d.data_documento}`, { id: d.id, aruba_filename: d.aruba_filename })
    }

    let inserted = 0
    let skipped = 0
    let failed = 0

    for (const m of matched) {
      try {
        const detail = await getIncomingInvoice(m.filename, false)
        const fileBase64: string | undefined = detail?.file || detail?.xml || detail?.fileBytes || detail?.invoiceFile
        let amount: number | null = null
        let date = ''
        let number = ''

        // Try JSON fields first
        const candidates = [detail, detail?.metadata, detail?.invoice, detail?.fattura].filter(Boolean)
        for (const src of candidates) {
          const amt = src.totalDocument ?? src.documentTotal ?? src.importoTotaleDocumento ?? src.importoTotale ?? src.totalAmount ?? src.amount ?? src.total
          if (amt != null && amount == null) {
            const p = parseFloat(String(amt).replace(',', '.'))
            if (!isNaN(p)) amount = p
          }
          const dt = src.documentDate || src.invoiceDate || src.dataDocumento || src.dataEmissione
          if (dt && !date) {
            let d = String(dt)
            if (d.includes('T')) d = d.split('T')[0]
            date = d
          }
          const num = src.documentNumber || src.invoiceNumber || src.numeroDocumento || src.numero
          if (num && !number) number = String(num)
        }
        // Fallback: parse XML
        if ((amount == null || !date || !number) && fileBase64) {
          const x = extractFromXml(fileBase64)
          if (amount == null) amount = x.amount
          if (!date) date = x.date
          if (!number) number = x.number
        }

        if (!number || !date || amount == null) {
          failed++
          continue
        }

        const dedupeKey = `${number}|${date}`
        const existing = existingKey.get(dedupeKey)
        if (existing) {
          // Backfill aruba_filename if missing on the existing row
          if (!existing.aruba_filename) {
            await supabase
              .from('fornitore_documents')
              .update({ aruba_filename: m.filename })
              .eq('id', existing.id)
          }
          skipped++
          continue
        }

        const { error: insErr } = await supabase
          .from('fornitore_documents')
          .insert({
            fornitore_id: fornitoreId,
            tipo: 'fattura',
            numero_documento: number,
            data_documento: date,
            importo_totale: amount,
            note: `Sincronizzata da Aruba`,
            stato: 'caricato',
            aruba_filename: m.filename,
          })
        if (insErr) {
          // Unique violation (already inserted by another sync) — count as skipped
          if (insErr.code === '23505') {
            skipped++
          } else {
            failed++
            console.warn('[sync-fornitore-invoices] insert err:', insErr.message)
          }
        } else {
          inserted++
          existingKey.set(dedupeKey, { id: '', aruba_filename: m.filename })
        }
      } catch (e: any) {
        failed++
        console.warn(`[sync-fornitore-invoices] enrich/insert failed for ${m.filename}:`, e?.message)
      }
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        fornitore: fornitore.nome,
        matched: matched.length,
        inserted,
        skipped,
        failed,
        months_scanned: monthsBack,
      })
    }
  } catch (err: any) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ success: false, error: err?.message || String(err) })
    }
  }
}
