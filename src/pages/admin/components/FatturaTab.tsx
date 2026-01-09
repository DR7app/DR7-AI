import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

interface Invoice {
  id: string
  numero_fattura: string
  data_emissione: string
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
  sdi_status?: 'draft' | 'sending' | 'sent' | 'accepted' | 'rejected' | 'error'
  sdi_id?: string
  sdi_sent_at?: string
  sdi_response?: any
  customer_sdi_code?: string
  customer_pec?: string
}

interface InvoiceItem {
  description: string
  unit_price: number
  quantity: number
  vat_rate: number
  total: number
}

export default function FatturaTab() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [checkingStatus, setCheckingStatus] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

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

  const toggleSelectAll = () => {
    if (selectedIds.length === invoices.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(invoices.map(invoice => invoice.id))
    }
  }

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Sei sicuro di voler eliminare questa fattura?')) return

    try {
      const { error } = await supabase.from('fatture').delete().eq('id', id)
      if (error) throw error
      loadInvoices()
    } catch (error) {
      console.error('Error deleting invoice:', error)
      alert('Errore durante l\\'eliminazione')
    }
  }

  async function handleBulkDelete() {
    if (!confirm(`Sei sicuro di voler eliminare ${selectedIds.length} fatture?`)) return

    try {
      const { error } = await supabase.from('fatture').delete().in('id', selectedIds)
      if (error) throw error
      setSelectedIds([])
      loadInvoices()
    } catch (error) {
      console.error('Error bulk deleting invoices:', error)
      alert('Errore durante l\\'eliminazione multipla')
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
      const response = await fetch('/.netlify/functions/generate-invoice-pdf', {
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
        alert(`✅ Stato aggiornato: ${result.status}\\n\\nDettagli: ${JSON.stringify(result.details, null, 2)}`)
        loadInvoices()
      } else {
        alert(`❌ Errore nel controllo stato:\\n\\n${result.error}`)
      }
    } catch (error) {
      console.error('Error checking status:', error)
      alert('Errore durante il controllo dello stato')
    } finally {
      setCheckingStatus(null)
    }
  }

  async function handleSendToSDI(invoice: Invoice) {
    if (!invoice.customer_tax_code) {
      alert('⚠️ Il Codice Fiscale è obbligatorio per la fatturazione elettronica.')
      return
    }

    if (!confirm('Sei sicuro di voler inviare questa fattura allo SDI?')) return

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

      if (response.ok) {
        alert('✅ Fattura inviata con successo allo SDI')
      } else {
        alert(`❌ Errore durante l'invio:\\n\\n${result.error}\\n${result.details ? JSON.stringify(result.details) : ''}`)
      }

      loadInvoices()
    } catch (error) {
      console.error('Error sending to SDI:', error)
      alert('Errore di comunicazione con il server')
      loadInvoices()
    }
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento fatture...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-theme-text-primary">🧾 Fatture</h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setMultiSelectMode(!multiSelectMode)
              setSelectedIds([])
            }}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${multiSelectMode
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
          >
            {multiSelectMode ? 'Annulla Selezione' : 'Selezione Multipla'}
          </button>

          {multiSelectMode && selectedIds.length > 0 && (
            <button
              onClick={handleBulkDelete}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
            >
              Elimina Selezionati ({selectedIds.length})
            </button>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-theme-bg-secondary rounded-lg p-4 border border-gray-800">
        <input
          type="text"
          placeholder="Cerca cliente..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-4 py-2 text-theme-text-primary placeholder-gray-400 focus:outline-none focus:border-dr7-gold transition-colors"
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
            <div key={invoice.id} className="bg-theme-bg-secondary rounded-lg p-4 border border-gray-800">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    {multiSelectMode && (
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(invoice.id)}
                        onChange={() => toggleSelect(invoice.id)}
                        className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                      />
                    )}
                    <h3 className="text-lg font-bold text-theme-text-primary">{invoice.numero_fattura}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-bold ${invoice.stato === 'paid' ? 'bg-green-600 text-theme-text-primary' :
                      invoice.stato === 'pending' ? 'bg-yellow-600 text-theme-text-primary' :
                        'bg-red-600 text-theme-text-primary'
                      }`}>
                      {invoice.stato === 'paid' ? 'Pagata' : invoice.stato === 'pending' ? 'In attesa' : 'Scaduta'}
                    </span>
                    {invoice.sdi_status && (
                      <span className={`px-2 py-1 rounded text-xs font-bold ${invoice.sdi_status === 'accepted' ? 'bg-green-600 text-white' :
                        invoice.sdi_status === 'sent' ? 'bg-blue-600 text-white' :
                          invoice.sdi_status === 'sending' ? 'bg-yellow-600 text-white' :
                            invoice.sdi_status === 'rejected' || invoice.sdi_status === 'error' ? 'bg-red-600 text-white' :
                              'bg-gray-600 text-white'
                        }`}>
                        {invoice.sdi_status === 'accepted' ? '✅ Accettata SDI' :
                          invoice.sdi_status === 'sent' ? '📤 Inviata SDI' :
                            invoice.sdi_status === 'sending' ? '⏳ Invio...' :
                              invoice.sdi_status === 'rejected' ? '❌ Rifiutata' :
                                invoice.sdi_status === 'error' ? '⚠️ Errore SDI' :
                                  '📝 Bozza'}
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
                    className="bg-green-600 hover:bg-green-700 text-theme-text-primary px-3 py-1 rounded text-sm transition-colors text-center flex items-center justify-center gap-1"
                  >
                    <span>📄</span> PDF
                  </button>
                  {(!invoice.sdi_status || invoice.sdi_status === 'draft' || invoice.sdi_status === 'error') ? (
                    <button
                      onClick={() => handleSendToSDI(invoice)}
                      className="bg-blue-600 hover:bg-blue-700 text-theme-text-primary px-3 py-1 rounded text-sm transition-colors flex items-center justify-center gap-1"
                    >
                      <span>🚀</span> Invia SDI
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCheckStatus(invoice.id)}
                      disabled={checkingStatus === invoice.id}
                      className="bg-purple-600 hover:bg-purple-700 text-theme-text-primary px-3 py-1 rounded text-sm transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      <span>🔄</span> {checkingStatus === invoice.id ? 'Controllo...' : 'Stato SDI'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(invoice.id)}
                    className="bg-red-600 hover:bg-red-700 text-theme-text-primary px-3 py-1 rounded text-sm transition-colors"
                  >
                    Elimina
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
