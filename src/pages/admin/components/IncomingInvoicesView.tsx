import { useEffect, useState, useMemo, useCallback } from 'react'
import toast from 'react-hot-toast'

interface IncomingInvoice {
  id: string
  filename: string
  invoiceNumber: string
  invoiceDate: string
  sender: string
  senderVat: string
  amount: number
  status: string
  receivedAt: string
  fornitore_id: string | null
  is_tracked: boolean
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtEur(n: number) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n || 0)
}

function fmtDate(iso: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

export default function IncomingInvoicesView() {
  const [month, setMonth] = useState<string>(currentMonth())
  const [mode, setMode] = useState<'tracked' | 'all'>('tracked')
  const [invoices, setInvoices] = useState<IncomingInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/.netlify/functions/get-incoming-invoices?month=${month}&mode=${mode}`)
      const text = await res.text()
      let json: any
      try { json = JSON.parse(text) } catch {
        throw new Error(`HTTP ${res.status} (risposta non JSON, probabile timeout): ${text.slice(0, 200)}`)
      }
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      setInvoices(json.invoices || [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IncomingInvoicesView] error:', err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [month, mode])

  useEffect(() => {
    load()
  }, [load])

  // Progressive per-row enrichment — call detail endpoint for each row that's
  // missing amount/date/number. Sequential w/ small delay to respect Aruba rate
  // limits. Runs after invoices are loaded; cancels if month/mode changes.
  useEffect(() => {
    if (invoices.length === 0) return
    let cancelled = false

    async function enrichOne(filename: string): Promise<{ amount: number | null; invoiceDate: string; invoiceNumber: string } | null> {
      const res = await fetch(`/.netlify/functions/get-incoming-invoice-detail?filename=${encodeURIComponent(filename)}`)
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 1500))
        return null
      }
      if (!res.ok) return null
      try {
        const json = await res.json()
        if (!json.success) return null
        return { amount: json.amount, invoiceDate: json.invoiceDate, invoiceNumber: json.invoiceNumber }
      } catch {
        return null
      }
    }

    ;(async () => {
      for (const inv of invoices) {
        if (cancelled) return
        const needs = inv.filename && (!inv.amount || !inv.invoiceDate || !inv.invoiceNumber)
        if (!needs) continue
        const detail = await enrichOne(inv.filename)
        if (cancelled) return
        if (detail) {
          setInvoices(prev => prev.map(x => x.id === inv.id ? {
            ...x,
            amount: (detail.amount != null && (!x.amount || x.amount === 0)) ? detail.amount : x.amount,
            invoiceDate: x.invoiceDate || detail.invoiceDate || '',
            invoiceNumber: x.invoiceNumber || detail.invoiceNumber || '',
          } : x))
        }
        await new Promise(r => setTimeout(r, 300))
      }
    })()

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, mode, invoices.length])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return invoices
    return invoices.filter(i =>
      i.sender.toLowerCase().includes(q) ||
      (i.senderVat || '').toLowerCase().includes(q) ||
      (i.invoiceNumber || '').toLowerCase().includes(q)
    )
  }, [invoices, search])

  const totals = useMemo(() => {
    const grand = filtered.reduce((s, i) => s + (i.amount || 0), 0)
    const bySupplier: Record<string, { count: number; total: number }> = {}
    for (const i of filtered) {
      const key = i.sender || '—'
      if (!bySupplier[key]) bySupplier[key] = { count: 0, total: 0 }
      bySupplier[key].count++
      bySupplier[key].total += i.amount || 0
    }
    return { grand, bySupplier, count: filtered.length }
  }, [filtered])

  async function downloadInvoice(inv: IncomingInvoice, kind: 'pdf' | 'xml') {
    if (!inv.filename) {
      toast.error('Filename mancante')
      return
    }
    setDownloading(inv.id + ':' + kind)
    try {
      const res = await fetch(`/.netlify/functions/get-incoming-invoices?action=download&filename=${encodeURIComponent(inv.filename)}`)
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
      const data = json.invoice || {}
      const base64 = kind === 'pdf' ? (data.pdf || data.pdfFile) : (data.file || data.xml)
      const mime = kind === 'pdf' ? 'application/pdf' : 'application/xml'
      const ext = kind === 'pdf' ? 'pdf' : 'xml'
      if (!base64) {
        toast.error(`${kind.toUpperCase()} non disponibile per questa fattura`)
        return
      }
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${inv.sender.replace(/[^a-zA-Z0-9]/g, '_')}_${inv.invoiceNumber || inv.filename}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Download fallito: ${msg}`)
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 bg-theme-bg-secondary p-4 rounded-lg border border-theme-border">
        <div>
          <label className="block text-xs text-theme-text-muted uppercase tracking-wider mb-1">Mese</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
          />
        </div>
        <div>
          <label className="block text-xs text-theme-text-muted uppercase tracking-wider mb-1">Filtro fornitori</label>
          <div className="flex bg-theme-bg-tertiary border border-theme-border rounded overflow-hidden">
            <button
              type="button"
              onClick={() => setMode('tracked')}
              className={`px-3 py-2 text-sm ${mode === 'tracked' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}
            >
              Solo Fornitori in anagrafica
            </button>
            <button
              type="button"
              onClick={() => setMode('all')}
              className={`px-3 py-2 text-sm border-l border-theme-border ${mode === 'all' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}
            >
              Tutti
            </button>
          </div>
        </div>
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs text-theme-text-muted uppercase tracking-wider mb-1">Cerca</label>
          <input
            type="text"
            placeholder="Fornitore, P.IVA, numero fattura..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm focus:outline-none focus:border-dr7-gold"
          />
        </div>
        <button
          onClick={load}
          className="px-4 py-2 rounded bg-dr7-gold text-black font-semibold text-sm hover:bg-[#247a6f] hover:text-white transition-colors"
        >
          Aggiorna
        </button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-4">
          <p className="text-theme-text-muted text-xs uppercase tracking-wider">Fatture nel periodo</p>
          <p className="text-2xl font-bold text-theme-text-primary mt-1">{totals.count}</p>
        </div>
        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-4">
          <p className="text-theme-text-muted text-xs uppercase tracking-wider">Totale</p>
          <p className="text-2xl font-bold text-theme-text-primary mt-1">{fmtEur(totals.grand)}</p>
        </div>
        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-4">
          <p className="text-theme-text-muted text-xs uppercase tracking-wider">Fornitori distinti</p>
          <p className="text-2xl font-bold text-theme-text-primary mt-1">{Object.keys(totals.bySupplier).length}</p>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="text-center py-10 text-theme-text-muted">Caricamento da Aruba...</div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-300 text-sm">
          <p className="font-semibold mb-1">Errore Aruba</p>
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">{error}</pre>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-10 text-center text-theme-text-muted">
          Nessuna fattura ricevuta nel periodo {mode === 'tracked' ? 'per i fornitori in anagrafica' : ''}.
          {mode === 'tracked' && ' Prova "Tutti" per vedere ogni fattura ricevuta.'}
        </div>
      ) : (
        <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-theme-bg-tertiary text-theme-text-secondary">
              <tr>
                <th className="text-left px-3 py-2">Data</th>
                <th className="text-left px-3 py-2">Fornitore</th>
                <th className="text-left px-3 py-2">P.IVA</th>
                <th className="text-left px-3 py-2">N. Fattura</th>
                <th className="text-right px-3 py-2">Importo</th>
                <th className="text-left px-3 py-2">Anagrafica</th>
                <th className="text-right px-3 py-2">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-border">
              {filtered.map(inv => (
                <tr key={inv.id} className="hover:bg-theme-bg-tertiary/30">
                  <td className="px-3 py-2 text-theme-text-secondary">{fmtDate(inv.invoiceDate)}</td>
                  <td className="px-3 py-2 text-theme-text-primary font-medium">{inv.sender}</td>
                  <td className="px-3 py-2 font-mono text-theme-text-secondary text-xs">{inv.senderVat || '—'}</td>
                  <td className="px-3 py-2 text-theme-text-secondary">{inv.invoiceNumber || '—'}</td>
                  <td className="px-3 py-2 text-right text-theme-text-primary font-semibold">{fmtEur(inv.amount)}</td>
                  <td className="px-3 py-2">
                    {inv.is_tracked ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-400">In anagrafica</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">Non collegato</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => downloadInvoice(inv, 'pdf')}
                      disabled={downloading === inv.id + ':pdf'}
                      className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary mr-1 disabled:opacity-50"
                    >
                      {downloading === inv.id + ':pdf' ? '...' : 'PDF'}
                    </button>
                    <button
                      onClick={() => downloadInvoice(inv, 'xml')}
                      disabled={downloading === inv.id + ':xml'}
                      className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary disabled:opacity-50"
                    >
                      {downloading === inv.id + ':xml' ? '...' : 'XML'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
