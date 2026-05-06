import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { logAdminAction } from '../../../utils/logAdminAction'
import { buildFatturaContext } from '../../../utils/adminLogHelpers'
import { authFetch } from '../../../utils/authFetch'
import IncomingInvoicesView from './IncomingInvoicesView'

interface Invoice {
  id: string
  numero_fattura: string
  data_emissione: string
  data_scadenza?: string | null
  importo_totale: number
  stato: string
  customer_name: string
  customer_email?: string
  customer_phone?: string
  customer_address?: string
  customer_tax_code?: string
  customer_vat?: string
  booking_id?: string
  invoice_html?: string
  items?: InvoiceItem[]
  subtotal?: number
  vat_amount?: number
  exempt_amount?: number
  created_at: string
  updated_at?: string
  // SDI fields
  sdi_status?: 'draft' | 'sending' | 'sent' | 'accepted' | 'rejected' | 'scartata' | 'error'
  sdi_id?: string
  sdi_sent_at?: string
  sdi_notification_seen?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sdi_response?: any
  customer_sdi_code?: string
  customer_pec?: string
  // Nota di credito
  tipo_fattura?: string
  related_invoice_id?: string
}

interface InvoiceItem {
  description: string
  unit_price: number
  quantity: number
  vat_rate: number
  total: number
}

// Solo questi due account possono cambiare lo stato di pagamento delle fatture
const PAYMENT_MANAGERS = ['valerio@dr7.app', 'ilenia@dr7.app']

// Default scadenza fattura quando non e' specificata: 30 giorni dall'emissione
const DEFAULT_PAYMENT_TERM_DAYS = 30

function getInvoiceDueDate(inv: { data_emissione: string; data_scadenza?: string | null }): Date | null {
  if (inv.data_scadenza) {
    const d = new Date(inv.data_scadenza)
    if (!isNaN(d.getTime())) return d
  }
  if (inv.data_emissione) {
    const d = new Date(inv.data_emissione)
    if (!isNaN(d.getTime())) {
      d.setDate(d.getDate() + DEFAULT_PAYMENT_TERM_DAYS)
      return d
    }
  }
  return null
}

function isInvoiceOverdue(inv: { data_emissione: string; data_scadenza?: string | null; stato: string }): boolean {
  if (inv.stato === 'paid' || inv.stato === 'cancelled') return false
  const due = getInvoiceDueDate(inv)
  if (!due) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return due < today
}

function daysOverdue(inv: { data_emissione: string; data_scadenza?: string | null }): number {
  const due = getInvoiceDueDate(inv)
  if (!due) return 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  due.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000))
}

export default function FatturaTab() {
  const [view, setView] = useState<'emesse' | 'ricevute'>('emesse')
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [checkingStatus, setCheckingStatus] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [creatingNdc, setCreatingNdc] = useState<string | null>(null)
  const [currentEmail, setCurrentEmail] = useState<string | null>(null)
  const canManagePayments = !!currentEmail && PAYMENT_MANAGERS.includes(currentEmail.toLowerCase())
  const [updatingStato, setUpdatingStato] = useState<string | null>(null)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [lastSdiRefresh, setLastSdiRefresh] = useState<number | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCurrentEmail(data.session?.user?.email || null)
    })
  }, [])

  // Refresh stati SDI per TUTTE le fatture in 'sending'/'sent' su Aruba e
  // ricarica la lista. Manuale (bottone) o automatico (mount + ogni 60s).
  // Throttle: salta se l'ultima chiamata è < 30s fa, per non sparare richieste
  // ad Aruba a ogni focus.
  async function refreshAllSdi(opts: { silent?: boolean } = {}) {
    const now = Date.now()
    if (lastSdiRefresh && now - lastSdiRefresh < 30_000) {
      if (!opts.silent) toast('Aggiornato di recente, riprova tra qualche secondo')
      return
    }
    setRefreshingAll(true)
    setLastSdiRefresh(now)
    try {
      const res = await authFetch('/.netlify/functions/check-sdi-statuses', { method: 'POST' })
      const json = await res.json()
      if (!opts.silent) {
        if (json.updated > 0) {
          const accepted = (json.transitions || []).filter((t: { to: string }) => t.to === 'accepted').length
          const rejected = (json.transitions || []).filter((t: { to: string }) => t.to === 'rejected').length
          const sent = (json.transitions || []).filter((t: { to: string }) => t.to === 'sent').length
          const parts: string[] = []
          if (accepted) parts.push(`${accepted} accettate`)
          if (rejected) parts.push(`${rejected} scartate`)
          if (sent) parts.push(`${sent} inviate`)
          toast.success(`Stati aggiornati: ${parts.join(', ') || json.updated + ' fatture'}`)
        } else if (json.checked > 0) {
          toast(`Verificate ${json.checked} fatture, nessun cambio di stato.`)
        } else {
          toast('Nessuna fattura in attesa di risposta SDI.')
        }
      }
      await loadInvoices()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!opts.silent) toast.error('Errore aggiornamento: ' + msg)
      else console.warn('[FatturaTab] silent SDI refresh failed:', msg)
    } finally {
      setRefreshingAll(false)
    }
  }

  // Auto-refresh: una volta al mount + ogni 60s mentre la tab è aperta.
  useEffect(() => {
    refreshAllSdi({ silent: true })
    const id = setInterval(() => refreshAllSdi({ silent: true }), 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Riconciliazione bulk con Aruba — utile quando il polling è in ritardo
  // e admin vede stati diversi tra dashboard Aruba e admin (es: 29 scartate
  // su Aruba ma admin badge ne mostra 3). Una sola invocazione scarica
  // la lista outgoing da Aruba (paginata) e allinea tutto.
  async function reconcileWithAruba() {
    setReconciling(true)
    try {
      const res = await authFetch('/.netlify/functions/reconcile-sdi-statuses', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error('Riconciliazione fallita: ' + (json.error || 'errore sconosciuto'))
        return
      }
      const accepted = (json.transitions || []).filter((t: { to: string }) => t.to === 'accepted').length
      const rejected = (json.transitions || []).filter((t: { to: string }) => t.to === 'rejected').length
      const sent = (json.transitions || []).filter((t: { to: string }) => t.to === 'sent').length
      const error = (json.transitions || []).filter((t: { to: string }) => t.to === 'error').length
      const parts: string[] = []
      if (accepted) parts.push(`${accepted} accettate`)
      if (rejected) parts.push(`${rejected} scartate`)
      if (error) parts.push(`${error} errore`)
      if (sent) parts.push(`${sent} inviate`)
      toast.success(
        json.updated > 0
          ? `Riconciliazione: ${parts.join(', ')} su ${json.totalRemote} fatture Aruba`
          : `Già allineato: ${json.totalRemote} fatture Aruba verificate`,
        { duration: 6000 }
      )
      await loadInvoices()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Errore riconciliazione: ' + msg)
    } finally {
      setReconciling(false)
    }
  }

  // Marca la notifica SDI come "vista" — toglie il badge dalla sidebar e
  // dal sub-tab Fattura senza dover risolvere/reinviare la fattura.
  // Si resetta automaticamente al prossimo passaggio in rejected/scartata/error
  // (gestito server-side in _check-sdi-statuses.ts).
  async function markNotificationSeen(invoice: Invoice) {
    const { error } = await supabase
      .from('fatture')
      .update({ sdi_notification_seen: true })
      .eq('id', invoice.id)
    if (error) {
      toast.error('Errore: ' + error.message)
      return
    }
    setInvoices(prev => prev.map(i => i.id === invoice.id ? { ...i, sdi_notification_seen: true } : i))
    toast.success('Notifica segnata come vista')
  }

  async function togglePagato(invoice: Invoice) {
    if (!canManagePayments) {
      toast.error(`Solo ${PAYMENT_MANAGERS.join(' o ')} possono modificare lo stato pagamento.`)
      return
    }
    const newStato = invoice.stato === 'paid' ? 'pending' : 'paid'
    setUpdatingStato(invoice.id)
    try {
      const { error } = await supabase.from('fatture').update({ stato: newStato }).eq('id', invoice.id)
      if (error) throw error
      setInvoices(prev => prev.map(i => i.id === invoice.id ? { ...i, stato: newStato } : i))
      toast.success(newStato === 'paid' ? 'Fattura segnata come PAGATA' : 'Fattura segnata come NON PAGATA')
      logAdminAction('fattura_payment_toggle', 'fattura', invoice.id, {
        ...buildFatturaContext(invoice),
        new_stato: newStato,
      })
    } catch (err: any) {
      toast.error(`Errore: ${err.message}`)
    } finally {
      setUpdatingStato(null)
    }
  }

  useEffect(() => {
    loadInvoices()
  }, [])

  async function loadInvoices() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('fatture')
        .select('*')
        .order('updated_at', { ascending: false })

      if (error) throw error
      setInvoices(data || [])
    } catch (error) {
      console.error('Failed to load invoices:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
  }

  function requireOtpConfirm(label: string): boolean {
    const code = String(Math.floor(1000 + Math.random() * 9000))
    const input = window.prompt(`⚠️ ${label}\n\nDigita il codice ${code} per confermare:`)
    return input === code
  }

  async function handleDelete(id: string) {
    const invoice = invoices.find(i => i.id === id)
    if (!invoice) return

    // Block deletion of fatture already sent to SDI
    if (invoice.sdi_status && ['sending', 'sent', 'accepted'].includes(invoice.sdi_status)) {
      alert(`Impossibile eliminare ${invoice.numero_fattura}: fattura già inviata a SDI (stato: ${invoice.sdi_status}).\n\nSe necessario, crea una Nota di Credito.`)
      return
    }

    if (!requireOtpConfirm(`Eliminare fattura ${invoice.numero_fattura} — ${invoice.customer_name}?`)) return

    try {
      const { error } = await supabase.from('fatture').delete().eq('id', id)
      if (error) throw error
      logAdminAction('delete_fattura', 'fattura', id, buildFatturaContext(invoice))
      loadInvoices()
    } catch (error) {
      console.error('Error deleting invoice:', error)
      alert('Errore durante l\'eliminazione')
    }
  }

  async function handleBulkDelete() {
    // Block if any selected fattura was sent to SDI
    const sentInvoices = invoices.filter(i => selectedIds.includes(i.id) && i.sdi_status && ['sending', 'sent', 'accepted'].includes(i.sdi_status))
    if (sentInvoices.length > 0) {
      alert(`Impossibile eliminare: ${sentInvoices.length} fattura/e già inviate a SDI.\n\n${sentInvoices.map(i => i.numero_fattura).join(', ')}\n\nRimuovile dalla selezione.`)
      return
    }

    if (!requireOtpConfirm(`Eliminare ${selectedIds.length} fatture selezionate?`)) return

    try {
      const { error } = await supabase.from('fatture').delete().in('id', selectedIds)
      if (error) throw error
      setSelectedIds([])
      {
        const deleted = invoices.filter(i => selectedIds.includes(i.id))
        logAdminAction('bulk_delete_fatture', 'fattura', selectedIds.join(','), {
          count: deleted.length,
          fatture: deleted.map(i => i.numero_fattura).join(', '),
          customers: Array.from(new Set(deleted.map(i => i.customer_name).filter(Boolean))).join(', '),
          total: deleted.reduce((sum, i) => sum + (i.importo_totale || 0), 0),
        })
      }
      loadInvoices()
    } catch (error) {
      console.error('Error bulk deleting invoices:', error)
      alert('Errore durante l\'eliminazione multipla')
    }
  }

  async function downloadPDF(invoice: Invoice) {
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <body style="font-family:system-ui,sans-serif;text-align:center;padding:50px;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
            <div>
              <div style="margin-bottom:20px;font-size:30px;">📄</div>
              <div>Generazione anteprima in corso...</div>
            </div>
          </body>
        </html>
      `)
    }

    try {
      const response = await authFetch('/.netlify/functions/generate-invoice-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id })
      })

      if (!response.ok) {
        throw new Error('Failed to generate invoice PDF')
      }

      const html = await response.text()
      loadInvoices()

      if (printWindow) {
        printWindow.document.open()
        printWindow.document.write(html)
        printWindow.document.close()
      } else {
        const blob = new Blob([html], { type: 'text/html' })
        const url = URL.createObjectURL(blob)
        window.open(url, '_blank')
        setTimeout(() => URL.revokeObjectURL(url), 3000)
      }
    } catch (error) {
      console.error('Error downloading PDF:', error)
      if (printWindow) printWindow.close()
      alert('Errore durante la generazione del PDF')
    }
  }

  async function handleCheckStatus(invoiceId: string) {
    setCheckingStatus(invoiceId)
    try {
      const response = await fetch('/.netlify/functions/check-sdi-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId })
      })

      const result = await response.json()

      if (response.ok) {
        alert(`Stato aggiornato: ${result.status}\n\nDettagli: ${JSON.stringify(result.details, null, 2)}`)
        loadInvoices()
      } else {
        alert(`Errore nel controllo stato:\n\n${result.error}`)
      }
    } catch (error) {
      console.error('Error checking status:', error)
      alert('Errore durante il controllo dello stato')
    } finally {
      setCheckingStatus(null)
    }
  }

  async function handleNotaDiCredito(invoice: Invoice) {
    if (!confirm(`Creare Nota di Credito per ${invoice.numero_fattura} (€${(invoice.importo_totale || 0).toFixed(2)})?`)) return
    setCreatingNdc(invoice.id)
    try {
      const response = await authFetch('/.netlify/functions/generate-nota-di-credito', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id })
      })
      const result = await response.json()
      if (!response.ok) {
        alert(`Errore: ${result.error}`)
        return
      }
      alert(`${result.message}`)
      logAdminAction('create_nota_di_credito', 'fattura', invoice.id, buildFatturaContext(invoice))
      loadInvoices()
    } catch (error) {
      console.error('Error creating nota di credito:', error)
      alert('Errore durante la creazione della nota di credito')
    } finally {
      setCreatingNdc(null)
    }
  }

  async function handleSendToSDI(invoice: Invoice) {
    if (!invoice.customer_tax_code) {
      alert('Il Codice Fiscale è obbligatorio per la fatturazione elettronica.')
      return
    }


    try {
      const updatedInvoices = invoices.map(i =>
        i.id === invoice.id ? { ...i, sdi_status: 'sending' as const } : i
      )
      setInvoices(updatedInvoices)

      const response = await fetch('/.netlify/functions/send-invoice-to-sdi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id })
      })

      const result = await response.json()

      if (!response.ok) {
        console.error('SDI send failed:', result.error, result.details)
      } else {
        logAdminAction('send_sdi', 'fattura', invoice.id, buildFatturaContext(invoice))
      }

      loadInvoices()
    } catch (error) {
      console.error('Error sending to SDI:', error)
      loadInvoices()
    }
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento fatture...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-theme-text-primary">Fatture</h2>
          <div className="flex bg-theme-bg-secondary border border-theme-border rounded-full overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setView('emesse')}
              className={`px-4 py-1.5 transition-colors ${view === 'emesse' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}
            >
              Emesse
            </button>
            <button
              type="button"
              onClick={() => setView('ricevute')}
              className={`px-4 py-1.5 transition-colors ${view === 'ricevute' ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}
            >
              Ricevute (Aruba)
            </button>
          </div>
        </div>
        {view === 'emesse' && (
          <div className="flex gap-2 items-center">
            <button
              onClick={() => refreshAllSdi()}
              disabled={refreshingAll}
              className="px-4 py-2 rounded-full font-medium transition-colors bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 flex items-center gap-2"
              title="Interroga Aruba e aggiorna lo stato SDI di tutte le fatture in attesa"
            >
              {refreshingAll ? 'Aggiornamento…' : 'Aggiorna stati SDI'}
            </button>
            <button
              onClick={() => reconcileWithAruba()}
              disabled={reconciling}
              className="px-4 py-2 rounded-full font-medium transition-colors bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-2"
              title="Scarica lista completa da Aruba e allinea TUTTI gli stati (per recuperare disallineamenti)"
            >
              {reconciling ? 'Riconciliazione…' : 'Riconcilia con Aruba'}
            </button>
            <button
              onClick={() => {
                setMultiSelectMode(!multiSelectMode)
                setSelectedIds([])
              }}
              className={`px-4 py-2 rounded-full font-medium transition-colors ${multiSelectMode
                ? 'bg-blue-600 text-white'
                : 'bg-theme-bg-secondary text-theme-text-muted hover:bg-theme-bg-tertiary'
                }`}
            >
              {multiSelectMode ? 'Annulla Selezione' : 'Selezione Multipla'}
            </button>

            {multiSelectMode && selectedIds.length > 0 && (
              <button
                onClick={handleBulkDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-full font-medium transition-colors"
              >
                × Selezionati ({selectedIds.length})
              </button>
            )}
          </div>
        )}
      </div>

      {view === 'ricevute' && <IncomingInvoicesView />}
      {view === 'emesse' && (
      <>
      {/* Empty header replaced above; the rest of Emesse UI follows */}

      {/* Search Bar */}
      <div className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border">
        <input
          type="text"
          placeholder="Cerca cliente..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-4 py-2 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:border-dr7-gold transition-colors"
        />
      </div>

      {/* Invoices List */}
      {invoices.length === 0 ? (
        <div className="bg-theme-bg-secondary rounded-lg p-12 text-center">
          <p className="text-theme-text-muted text-lg mb-4">Nessuna fattura trovata</p>
          <p className="text-theme-text-muted text-sm">Le fatture vengono generate automaticamente dalle prenotazioni</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {invoices.filter(invoice => {
            if (!searchQuery) return true
            const query = searchQuery.toLowerCase()
            return (
              invoice.customer_name.toLowerCase().includes(query) ||
              invoice.numero_fattura.toLowerCase().includes(query) ||
              (invoice.customer_email && invoice.customer_email.toLowerCase().includes(query))
            )
          }).map((invoice) => (
            <div key={invoice.id} className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    {multiSelectMode && (
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(invoice.id)}
                        onChange={() => toggleSelect(invoice.id)}
                        className="rounded-full border-theme-border bg-theme-bg-tertiary text-blue-600 focus:ring-blue-500"
                      />
                    )}
                    <h3 className="text-lg font-bold text-theme-text-primary">{invoice.numero_fattura}</h3>
                    {invoice.tipo_fattura === 'nota_di_credito' && (
                      <span className="px-2 py-1 rounded text-xs font-bold bg-amber-600 text-white">Nota di Credito</span>
                    )}
                    <span className={`px-2 py-1 rounded text-xs font-bold ${invoice.stato === 'paid' ? 'bg-green-600 text-theme-text-primary' :
                      invoice.stato === 'pending' ? 'bg-yellow-600 text-theme-text-primary' :
                        'bg-red-600 text-theme-text-primary'
                      }`}>
                      {invoice.stato === 'paid' ? 'Pagata' : invoice.stato === 'pending' ? 'In attesa' : 'Scaduta'}
                    </span>
                    {isInvoiceOverdue(invoice) && (
                      <span className="px-2 py-1 rounded text-xs font-bold bg-red-700/90 text-white animate-pulse" title={`Scaduta da ${daysOverdue(invoice)} giorni — pagamento non ricevuto`}>
                        ⚠ SCADUTA · {daysOverdue(invoice)}g
                      </span>
                    )}
                    {canManagePayments && (
                      <button
                        type="button"
                        onClick={() => togglePagato(invoice)}
                        disabled={updatingStato === invoice.id}
                        className={`px-2 py-1 rounded text-xs font-semibold border transition-colors ${
                          invoice.stato === 'paid'
                            ? 'border-amber-500/40 text-amber-300 hover:bg-amber-500/15'
                            : 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15'
                        } disabled:opacity-50`}
                        title={invoice.stato === 'paid' ? 'Riporta a NON pagata' : 'Segna come PAGATA'}
                      >
                        {updatingStato === invoice.id
                          ? '...'
                          : invoice.stato === 'paid' ? 'Segna NON pagata' : 'Segna PAGATA'}
                      </button>
                    )}
                    {invoice.sdi_status && (
                      <span className={`px-2 py-1 rounded text-xs font-bold ${invoice.sdi_status === 'accepted' ? 'bg-green-600 text-white' :
                        invoice.sdi_status === 'sent' ? 'bg-blue-600 text-white' :
                          invoice.sdi_status === 'sending' ? 'bg-yellow-600 text-white' :
                            invoice.sdi_status === 'rejected' || invoice.sdi_status === 'error' ? 'bg-red-600 text-white' :
                              'bg-theme-bg-hover text-theme-text-primary'
                        }`}>
                        {invoice.sdi_status === 'accepted' ? 'Accettata SDI' :
                          invoice.sdi_status === 'sent' ? 'Inviata SDI' :
                            invoice.sdi_status === 'sending' ? 'Invio...' :
                              invoice.sdi_status === 'rejected' ? 'Rifiutata' :
                                invoice.sdi_status === 'scartata' ? 'Scartata' :
                                  invoice.sdi_status === 'error' ? 'Errore SDI' :
                                    'Bozza'}
                      </span>
                    )}
                    {/* Vista — dismisses the dashboard notification badge for
                        rejected/scartata/error fatture. Auto-resets on next
                        rejection (server-side in _check-sdi-statuses.ts). */}
                    {invoice.sdi_status && ['rejected', 'scartata', 'error'].includes(invoice.sdi_status) && !invoice.sdi_notification_seen && (
                      <button
                        type="button"
                        onClick={() => markNotificationSeen(invoice)}
                        className="px-2 py-1 rounded text-xs font-semibold border border-theme-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
                        title="Segna la notifica come vista (toglie il badge dalla sidebar)"
                      >
                        Vista
                      </button>
                    )}
                    {invoice.sdi_notification_seen && invoice.sdi_status && ['rejected', 'scartata', 'error'].includes(invoice.sdi_status) && (
                      <span className="px-2 py-1 rounded text-xs text-theme-text-muted italic" title="Notifica già visualizzata">
                        ✓ Vista
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <span className="text-theme-text-muted">Cliente:</span>
                      <p className="text-theme-text-primary font-semibold">{invoice.customer_name}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Data:</span>
                      <p className="text-theme-text-primary font-semibold">
                        {new Date(invoice.data_emissione).toLocaleDateString('it-IT')}
                      </p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Codice Fiscale:</span>
                      <p className="text-theme-text-primary font-semibold">{invoice.customer_tax_code || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Totale:</span>
                      <p className="text-dr7-gold font-bold">€{(invoice.importo_totale || 0).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 ml-4">
                  <button
                    onClick={() => downloadPDF(invoice)}
                    className="bg-green-600 hover:bg-green-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors text-center flex items-center justify-center gap-1"
                  >
                    PDF
                  </button>
                  {(!invoice.sdi_status || invoice.sdi_status === 'draft' || invoice.sdi_status === 'error' || invoice.sdi_status === 'rejected' || invoice.sdi_status === 'scartata') ? (
                    <button
                      onClick={() => handleSendToSDI(invoice)}
                      className={`${invoice.sdi_status === 'rejected' || invoice.sdi_status === 'scartata' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-blue-600 hover:bg-blue-700'} text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1`}
                    >
                      {invoice.sdi_status === 'rejected' || invoice.sdi_status === 'scartata' ? 'Reinvia SDI' : 'Invia SDI'}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => handleCheckStatus(invoice.id)}
                        disabled={checkingStatus === invoice.id}
                        className="bg-purple-600 hover:bg-purple-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {checkingStatus === invoice.id ? 'Controllo...' : 'Stato SDI'}
                      </button>
                      <button
                        onClick={() => handleSendToSDI(invoice)}
                        className="bg-orange-600 hover:bg-orange-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1"
                      >
                        Reinvia SDI
                      </button>
                    </>
                  )}
                  {invoice.tipo_fattura !== 'nota_di_credito' && (
                    <button
                      onClick={() => handleNotaDiCredito(invoice)}
                      disabled={creatingNdc === invoice.id}
                      className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded-full text-sm transition-colors disabled:opacity-50"
                    >
                      {creatingNdc === invoice.id ? 'Creazione...' : 'N. Credito'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(invoice.id)}
                    className="bg-red-600 hover:bg-red-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  )
}

// Badge counter — fatture con stato SDI problematico (rejected/scartata/error)
// che richiedono intervento (reinvio o nota di credito) E non ancora
// dismissate dall'admin via bottone "Vista".
// Polling ogni 60s + realtime sul cambio sdi_status.
// eslint-disable-next-line react-refresh/only-export-components
export function useFatturaScartataCount() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { count: n } = await supabase
        .from('fatture')
        .select('id', { count: 'exact', head: true })
        .in('sdi_status', ['rejected', 'scartata', 'error'])
        .eq('sdi_notification_seen', false)
      if (!cancelled && typeof n === 'number') setCount(n)
    }
    load()
    const id = setInterval(load, 60_000)
    const channel = supabase
      .channel('fattura-scartata-count')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fatture' }, load)
      .subscribe()
    return () => {
      cancelled = true
      clearInterval(id)
      supabase.removeChannel(channel)
    }
  }, [])

  return count
}
