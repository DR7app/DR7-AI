import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { searchIncomingInvoices } from './aruba-utils'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

function normalizeVat(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/\D/g, '')
}

function isoMonthRange(year: number, monthIdxOneBased: number) {
  const daysInMonth = new Date(year, monthIdxOneBased, 0).getDate()
  // Compute Europe/Rome offset
  const monthMid = new Date(Date.UTC(year, monthIdxOneBased - 1, 15, 12, 0, 0))
  const romeStr = monthMid.toLocaleString('en-US', { timeZone: 'Europe/Rome', hour12: false })
  const utcStr = monthMid.toLocaleString('en-US', { timeZone: 'UTC', hour12: false })
  const offsetHours = Math.round((new Date(romeStr).getTime() - new Date(utcStr).getTime()) / 3600000)
  const tz = `${offsetHours >= 0 ? '+' : '-'}${String(Math.abs(offsetHours)).padStart(2, '0')}:00`
  const mo = String(monthIdxOneBased).padStart(2, '0')
  return {
    startDate: `${year}-${mo}-01T00:00:00.000${tz}`,
    endDate: `${year}-${mo}-${String(daysInMonth).padStart(2, '0')}T23:59:59.999${tz}`,
    label: `${year}-${mo}`,
  }
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const monthsBack: number = Math.min(Math.max(parseInt(body.months) || 3, 1), 12)

    // Build month list (current month + N-1 previous)
    const now = new Date()
    const months: { startDate: string; endDate: string; label: string }[] = []
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push(isoMonthRange(d.getFullYear(), d.getMonth() + 1))
    }

    // Aggregate unique suppliers across all months (dedup by P.IVA, fallback to name)
    const seen = new Map<string, { nome: string; piva: string | null }>()
    const monthCounts: Record<string, number> = {}

    for (const m of months) {
      let page = 0
      const PAGE_SIZE = 100
      const MAX_PAGES = 20
      let monthSuppliers = 0
      while (page < MAX_PAGES) {
        const result = await searchIncomingInvoices({
          startDate: m.startDate,
          endDate: m.endDate,
          page,
          pageSize: PAGE_SIZE,
        })
        const list: any[] = result.invoices || result.content || result.data || []
        for (const inv of list) {
          const sender = inv.senderDescription || inv.sender?.description || inv.cedentePrestatore?.denominazione || ''
          const senderVatRaw = inv.senderCountryCode && inv.senderId
            ? `${inv.senderCountryCode}${inv.senderId}`
            : inv.sender?.vatCode || inv.cedentePrestatore?.idFiscaleIVA || ''
          const piva = normalizeVat(senderVatRaw)
          const name = (sender || '').trim()
          if (!name && !piva) continue
          const key = piva || `name:${name.toLowerCase()}`
          if (!seen.has(key)) {
            seen.set(key, { nome: name || '(senza nome)', piva: piva || null })
            monthSuppliers++
          }
        }
        if (list.length < PAGE_SIZE) break
        if (result.last === true) break
        if (typeof result.totalPages === 'number' && page + 1 >= result.totalPages) break
        page++
      }
      monthCounts[m.label] = monthSuppliers
    }

    const dedup = Array.from(seen.values())
    if (dedup.length === 0) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, added: 0, skipped: 0, scanned: 0, months: monthCounts })
      }
    }

    // Skip suppliers already present
    const { data: existing } = await supabase.from('fornitori').select('nome, piva')
    const existingVats = new Set<string>()
    const existingNames = new Set<string>()
    for (const e of existing || []) {
      const v = normalizeVat(e.piva)
      if (v) existingVats.add(v)
      if (e.nome) existingNames.add(e.nome.toLowerCase().trim())
    }

    const toInsert = dedup.filter(s => {
      if (s.piva && existingVats.has(s.piva)) return false
      if (!s.piva && existingNames.has(s.nome.toLowerCase().trim())) return false
      return true
    }).map(s => ({
      nome: s.nome,
      piva: s.piva,
      attivo: true,
      note: 'Importato da fatture Aruba',
    }))

    let added = 0
    if (toInsert.length > 0) {
      const { data, error } = await supabase.from('fornitori').insert(toInsert).select('id')
      if (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) }
      }
      added = data?.length || 0
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        added,
        skipped: dedup.length - added,
        scanned: dedup.length,
        months_scanned: months.length,
        months: monthCounts,
      })
    }
  } catch (err: any) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ success: false, error: err?.message || String(err) })
    }
  }
}
