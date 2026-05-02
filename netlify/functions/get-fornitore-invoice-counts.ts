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

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  try {
    const params = event.queryStringParameters || {}
    const months = Math.min(Math.max(parseInt(params.months || '3') || 3, 1), 12)
    const now = new Date()

    // Aggregate per P.IVA
    const byPiva: Record<string, { count: number; lastDate: string | null }> = {}
    const byName: Record<string, { count: number; lastDate: string | null }> = {}

    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const range = isoMonthRange(d.getFullYear(), d.getMonth() + 1)
      let page = 0
      const PAGE_SIZE = 100
      const MAX_PAGES = 20
      while (page < MAX_PAGES) {
        const result = await searchIncomingInvoices({
          startDate: range.startDate,
          endDate: range.endDate,
          page,
          pageSize: PAGE_SIZE,
        })
        const list: any[] = result.invoices || result.content || result.data || []
        for (const inv of list) {
          const senderVatRaw = inv.senderCountryCode && inv.senderId
            ? `${inv.senderCountryCode}${inv.senderId}`
            : inv.sender?.vatCode || inv.cedentePrestatore?.idFiscaleIVA || ''
          const piva = normalizeVat(senderVatRaw)
          const name = (inv.senderDescription || inv.sender?.description || '').trim().toLowerCase()
          const dateStr = inv.uploadDate || inv.receivedDate || inv.createdAt || inv.dataRicezione || ''
          if (piva) {
            if (!byPiva[piva]) byPiva[piva] = { count: 0, lastDate: null }
            byPiva[piva].count++
            if (dateStr && (!byPiva[piva].lastDate || dateStr > byPiva[piva].lastDate)) {
              byPiva[piva].lastDate = dateStr
            }
          } else if (name) {
            if (!byName[name]) byName[name] = { count: 0, lastDate: null }
            byName[name].count++
            if (dateStr && (!byName[name].lastDate || dateStr > byName[name].lastDate)) {
              byName[name].lastDate = dateStr
            }
          }
        }
        if (list.length < PAGE_SIZE) break
        if (result.last === true) break
        if (typeof result.totalPages === 'number' && page + 1 >= result.totalPages) break
        page++
      }
    }

    // Persist cache onto fornitori rows so the list view renders instantly
    // on subsequent loads without hitting Aruba.
    try {
      const { data: fornitori } = await supabase
        .from('fornitori')
        .select('id, nome, piva')
      const now = new Date().toISOString()
      const updates: Promise<unknown>[] = []
      for (const f of fornitori || []) {
        const v = (f.piva || '').replace(/\D/g, '')
        let count = 0
        let lastDate: string | null = null
        if (v && byPiva[v]) {
          count = byPiva[v].count
          lastDate = byPiva[v].lastDate
        } else if (f.nome && byName[f.nome.toLowerCase().trim()]) {
          count = byName[f.nome.toLowerCase().trim()].count
          lastDate = byName[f.nome.toLowerCase().trim()].lastDate
        }
        updates.push(
          supabase.from('fornitori').update({
            aruba_invoices_count: count,
            aruba_last_invoice_at: lastDate,
            aruba_synced_at: now,
          }).eq('id', f.id)
        )
      }
      // Wait for cache writes (small fornitori list, so this stays fast)
      await Promise.all(updates)
    } catch (cacheErr: any) {
      console.warn('[get-fornitore-invoice-counts] cache update failed:', cacheErr?.message)
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        months_scanned: months,
        byPiva,
        byName,
      })
    }
  } catch (err: any) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ success: false, error: err?.message || String(err) })
    }
  }
}
