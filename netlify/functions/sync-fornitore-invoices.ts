import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { fetchAllIncomingInvoices, getIncomingInvoice } from './aruba-utils'
import { normalizeVat, normalizeName, namesMatch } from './utils/fornitoreMatch'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

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

function extractFromXml(b64: string): { amount: number | null; date: string; number: string; dueDate: string } {
  let amount: number | null = null
  let date = ''
  let number = ''
  let dueDate = ''
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
    // FatturaPA: DataScadenzaPagamento inside DettaglioPagamento. May appear
    // multiple times for installments — pick the latest so the alert fires
    // only after every installment is past due.
    const allDue = [...flat.matchAll(/<DataScadenzaPagamento>\s*([0-9T:.+\-]+)\s*<\/DataScadenzaPagamento>/gi)]
    if (allDue.length > 0) {
      const candidates = allDue.map(m => {
        let d = m[1]
        if (d.includes('T')) d = d.split('T')[0]
        return d
      }).filter(Boolean).sort()
      dueDate = candidates[candidates.length - 1] || ''
    }
  } catch { /* ignore */ }
  return { amount, date, number, dueDate }
}

export interface SyncResult {
  success: boolean
  error?: string
  fornitore?: string
  matched?: number
  inserted?: number
  skipped?: number
  failed?: number
  months_scanned?: number
}

/**
 * Core sync: scarica le fatture Aruba di un fornitore e le inserisce in DB.
 * Esportata cosi' la background function bulk puo' chiamarla inline senza
 * passare per HTTP (e quindi senza incappare nel timeout sync di Netlify).
 */
export async function syncOneFornitore(fornitoreId: string, monthsBack = 12): Promise<SyncResult> {
  monthsBack = Math.min(Math.max(monthsBack || 12, 1), 12)
  const { data: fornitore, error: fornErr } = await supabase
    .from('fornitori')
    .select('id, nome, piva')
    .eq('id', fornitoreId)
    .single()
  if (fornErr || !fornitore) {
    return { success: false, error: 'Fornitore non trovato' }
  }

  const piva = normalizeVat(fornitore.piva)
    const nameNorm = normalizeName(fornitore.nome)

    // Chi possiede quale P.IVA. Serve per non lasciare che due anagrafiche si
    // prendano la stessa fattura: se la P.IVA del mittente appartiene a un
    // altro fornitore, il match per nome non deve nemmeno essere tentato.
    const { data: tuttiFornitori } = await supabase
      .from('fornitori')
      .select('id, piva')
      .eq('attivo', true)
    const proprietarioPiva = new Map<string, string>()
    for (const f of (tuttiFornitori || []) as { id: string; piva: string | null }[]) {
      const v = normalizeVat(f.piva)
      if (!v) continue
      // Se due anagrafiche hanno la stessa P.IVA vince quella che stiamo
      // sincronizzando: cosi' il sync non si blocca in attesa della fusione.
      if (!proprietarioPiva.has(v) || f.id === fornitoreId) proprietarioPiva.set(v, f.id)
    }

    // Aggregate Aruba invoices for last N months that match this fornitore
    const matched: { filename: string; sender: string; senderVat: string }[] = []
    const filenameVisti = new Set<string>()
    const now = new Date()
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const range = isoMonthRange(d.getFullYear(), d.getMonth() + 1)
      // Le pagine di Aruba partono da 1: con page=0 il primo blocco tornava
      // due volte. Qui i doppioni erano gia' fermati da filenameVisti, ma
      // erano comunque una pagina di chiamate sprecate a ogni mese.
      const list = await fetchAllIncomingInvoices({
        startDate: range.startDate,
        endDate: range.endDate,
        pageSize: 100,
        maxPages: 20,
      })
      for (const inv of list) {
        const sender = inv.senderDescription || inv.sender?.description || ''
        const senderVatRaw = inv.senderCountryCode && inv.senderId ? `${inv.senderCountryCode}${inv.senderId}` : (inv.sender?.vatCode || '')
        const v = normalizeVat(senderVatRaw)
        let isMatch = false
        // 1) match per P.IVA (entrambi normalizzati a sole cifre)
        if (piva && v === piva) isMatch = true
        // 2) fallback: match per nome — tentato solo se la P.IVA del mittente
        //    non e' gia' di un altro fornitore. Senza questo controllo la
        //    stessa fattura finiva su piu' anagrafiche simili (es. una
        //    "Hydrochem" inserita a mano e lo stub creato dal sync).
        const pivaDiAltri = v ? proprietarioPiva.get(v) : undefined
        if (!isMatch && !(pivaDiAltri && pivaDiAltri !== fornitoreId)
            && nameNorm && namesMatch(nameNorm, normalizeName(sender))) {
          isMatch = true
        }
        if (isMatch) {
          const filename = inv.filename || inv.uploadFileName
          // Una stessa fattura puo' tornare da piu' pagine Aruba: il
          // filename e' la sua identita', quindi la contiamo una volta sola.
          if (filename && !filenameVisti.has(filename)) {
            filenameVisti.add(filename)
            matched.push({ filename, sender, senderVat: v })
          }
        }
      }
    }

    // Fetch existing fornitore_documents to dedupe and to backfill aruba_filename / data_scadenza
    const { data: existingDocs } = await supabase
      .from('fornitore_documents')
      .select('id, numero_documento, data_documento, data_scadenza, file_url, aruba_filename')
      .eq('fornitore_id', fornitoreId)
      .eq('tipo', 'fattura')
    const existingKey = new Map<string, { id: string; aruba_filename: string | null; data_scadenza: string | null }>()
    const perFilename = new Map<string, { id: string; aruba_filename: string | null; data_scadenza: string | null }>()
    for (const d of existingDocs || []) {
      const riga = { id: d.id, aruba_filename: d.aruba_filename, data_scadenza: d.data_scadenza }
      existingKey.set(`${d.numero_documento}|${d.data_documento}`, riga)
      if (d.aruba_filename) perFilename.set(d.aruba_filename, riga)
    }

    // Fatture gia' assegnate a un ALTRO fornitore: non vanno duplicate qui.
    // L'indice unico copre solo (fornitore, tipo, numero, data), quindi senza
    // questo controllo la stessa fattura Aruba poteva vivere su due schede.
    const diAltroFornitore = new Set<string>()
    const daControllare = matched.map(m => m.filename)
    for (let i = 0; i < daControllare.length; i += 100) {
      const blocco = daControllare.slice(i, i + 100)
      const { data: altrove } = await supabase
        .from('fornitore_documents')
        .select('fornitore_id, aruba_filename')
        .in('aruba_filename', blocco)
      for (const d of (altrove || []) as { fornitore_id: string; aruba_filename: string }[]) {
        if (d.fornitore_id !== fornitoreId) diAltroFornitore.add(d.aruba_filename)
      }
    }

    let inserted = 0
    let skipped = 0
    let failed = 0

    for (const m of matched) {
      try {
        if (diAltroFornitore.has(m.filename)) {
          skipped++
          continue
        }
        // Gia' presente su questo fornitore: nessun download, solo backfill.
        const giaPresente = perFilename.get(m.filename)
        if (giaPresente) {
          if (!giaPresente.aruba_filename) {
            await supabase.from('fornitore_documents')
              .update({ aruba_filename: m.filename }).eq('id', giaPresente.id)
          }
          skipped++
          continue
        }
        const detail = await getIncomingInvoice(m.filename, false)
        const fileBase64: string | undefined = detail?.file || detail?.xml || detail?.fileBytes || detail?.invoiceFile
        let amount: number | null = null
        let date = ''
        let number = ''
        let dueDate = ''

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
          const due = src.dueDate || src.dataScadenza || src.dataScadenzaPagamento || src.scadenza
          if (due && !dueDate) {
            let d = String(due)
            if (d.includes('T')) d = d.split('T')[0]
            dueDate = d
          }
        }
        // Fallback: parse XML
        if ((amount == null || !date || !number || !dueDate) && fileBase64) {
          const x = extractFromXml(fileBase64)
          if (amount == null) amount = x.amount
          if (!date) date = x.date
          if (!number) number = x.number
          if (!dueDate) dueDate = x.dueDate
        }

        if (!number || !date || amount == null) {
          failed++
          continue
        }

        // Skip fatture pre-2026: i clienti DR7 partono 01/26.
        // Aruba scansiona 12 mesi indietro per pagare bene il matching, ma
        // non vogliamo trascinare dati 2025 nelle viste fornitori.
        if (date < '2026-01-01') {
          skipped++
          continue
        }

        const dedupeKey = `${number}|${date}`
        const existing = existingKey.get(dedupeKey)
        if (existing) {
          // Backfill aruba_filename + data_scadenza if missing on the existing row
          const patch: Record<string, unknown> = {}
          if (!existing.aruba_filename) patch.aruba_filename = m.filename
          if (dueDate && !existing.data_scadenza) patch.data_scadenza = dueDate
          if (Object.keys(patch).length > 0) {
            await supabase.from('fornitore_documents').update(patch).eq('id', existing.id)
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
            data_scadenza: dueDate || null,
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
          const riga = { id: '', aruba_filename: m.filename, data_scadenza: dueDate || null }
          existingKey.set(dedupeKey, riga)
          perFilename.set(m.filename, riga)
        }
      } catch (e: any) {
        failed++
        console.warn(`[sync-fornitore-invoices] enrich/insert failed for ${m.filename}:`, e?.message)
      }
    }

  return {
    success: true,
    fornitore: fornitore.nome,
    matched: matched.length,
    inserted,
    skipped,
    failed,
    months_scanned: monthsBack,
  }
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
    const monthsBack: number = parseInt(body.months) || 12
    if (!fornitoreId) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'fornitore_id required' }) }
    }
    const result = await syncOneFornitore(fornitoreId, monthsBack)
    return {
      statusCode: result.success ? 200 : 500,
      headers,
      body: JSON.stringify(result),
    }
  } catch (err: any) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ success: false, error: err?.message || String(err) }),
    }
  }
}
