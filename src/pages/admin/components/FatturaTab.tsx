import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'

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
  // SDI fields
  sdi_status?: 'draft' | 'sending' | 'sent' | 'accepted' | 'rejected' | 'error'
  sdi_id?: string
  sdi_sent_at?: string
  sdi_response?: any
}

interface InvoiceItem {
  description: string
  unit_price: number
  quantity: number
  vat_rate: number
  total: number
}

export default function InvoicesTab() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [checkingStatus, setCheckingStatus] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [multiSelectMode, setMultiSelectMode] = useState(false)

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
      alert('Errore durante l\'eliminazione')
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
      alert('Errore durante l\'eliminazione multipla')
    }
  }

  async function downloadPDF(invoice: Invoice) {
    try {
      // Always generate to ensure latest template/CSS is applied
      const response = await fetch('/.netlify/functions/generate-invoice-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id })
      })

      if (!response.ok) {
        throw new Error('Failed to generate invoice PDF')
      }

      const html = await response.text()
      // Reload to update local cache
      loadInvoices()

      // Create a blob URL and open it - this avoids popup blockers
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const printWindow = window.open(url, '_blank')

      if (!printWindow) {
        alert('Impossibile aprire la finestra. Verifica le impostazioni del browser.')
        URL.revokeObjectURL(url)
        return
      }

      // Clean up the blob URL after a delay
      setTimeout(() => URL.revokeObjectURL(url), 3000)
    } catch (error) {
      console.error('Error downloading PDF:', error)
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
        alert(`✅ Stato aggiornato: ${result.status}\n\nDettagli: ${JSON.stringify(result.details, null, 2)}`)
        loadInvoices()
      } else {
        alert(`❌ Errore nel controllo stato:\n\n${result.error}`)
      }
    } catch (error) {
      console.error('Error checking status:', error)
      alert('Errore durante il controllo dello stato')
    } finally {
      setCheckingStatus(null)
    }
  }

  if (loading) {
    return <div className="text-center py-8 text-gray-400">Caricamento...</div>
  }

  return (
    <div>
      <div className="flex flex-col lg:flex-row justify-between items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Fatture</h2>
        </div>
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

      <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-black">
              <tr>
                {multiSelectMode && (
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === invoices.length && invoices.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Numero</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Data</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-white">Cliente</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-white">Totale</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-white">Pagamento</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-white">SDI</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-white">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className={`border-t border-gray-700 hover:bg-gray-800 ${selectedIds.includes(invoice.id) ? 'bg-blue-900/20' : ''}`}>
                  {multiSelectMode && (
                    <td className="px-4 py-3 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(invoice.id)}
                        onChange={() => toggleSelect(invoice.id)}
                        className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 text-sm text-white">{invoice.numero_fattura}</td>
                  <td className="px-4 py-3 text-sm text-white">{new Date(invoice.data_emissione).toLocaleDateString('it-IT')}</td>
                  <td className="px-4 py-3 text-sm text-white">{invoice.customer_name}</td>
                  <td className="px-4 py-3 text-sm text-white text-right">€{(invoice.importo_totale || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${invoice.stato === 'paid' ? 'bg-green-500/20 text-green-400' :
                      invoice.stato === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                      {invoice.stato === 'paid' ? 'Pagata' : invoice.stato === 'pending' ? 'In attesa' : 'Non pagata'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${invoice.sdi_status === 'accepted' ? 'bg-green-500/20 text-green-400' :
                      invoice.sdi_status === 'sent' ? 'bg-blue-500/20 text-blue-400' :
                        invoice.sdi_status === 'sending' ? 'bg-yellow-500/20 text-yellow-400' :
                          invoice.sdi_status === 'rejected' || invoice.sdi_status === 'error' ? 'bg-red-500/20 text-red-400' :
                            'bg-gray-500/20 text-gray-400'
                      }`}>
                      {invoice.sdi_status === 'accepted' ? '✅ Accettata' :
                        invoice.sdi_status === 'sent' ? '📤 Inviata' :
                          invoice.sdi_status === 'sending' ? '⏳ Invio...' :
                            invoice.sdi_status === 'rejected' ? '❌ Rifiutata' :
                              invoice.sdi_status === 'error' ? '⚠️ Errore' :
                                '📝 Bozza'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2 justify-center">
                      <Button
                        onClick={() => downloadPDF(invoice)}
                        variant="secondary"
                        className="text-xs py-1 px-3 bg-blue-900 hover:bg-blue-800"
                      >
                        📄 PDF
                      </Button>
                      {invoice.sdi_id && (
                        <Button
                          onClick={() => handleCheckStatus(invoice.id)}
                          variant="secondary"
                          className="text-xs py-1 px-3 bg-purple-900 hover:bg-purple-800"
                          disabled={checkingStatus === invoice.id}
                        >
                          {checkingStatus === invoice.id ? '⏳' : '🔄'} Stato
                        </Button>
                      )}
                      <Button
                        onClick={() => handleDelete(invoice.id)}
                        variant="danger"
                        className="text-xs py-1 px-3 bg-red-900 hover:bg-red-800 text-white"
                      >
                        Elimina
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={multiSelectMode ? 8 : 7} className="px-4 py-8 text-center text-gray-500">
                    Nessuna fattura trovata
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
