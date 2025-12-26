import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'

interface Invoice {
  id: string
  invoice_number: string
  invoice_date: string
  customer_name: string
  customer_email?: string
  customer_phone?: string
  customer_address?: string
  customer_tax_code?: string
  customer_vat?: string
  booking_id?: string
  booking_type?: string
  total_amount: number
  payment_status: string
  invoice_html?: string
  items?: InvoiceItem[]
  subtotal?: number
  vat_amount?: number
  exempt_amount?: number
  total?: number
  payment_method?: string
  payment_date?: string
  status?: 'paid' | 'pending' | 'overdue'
  notes?: string
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
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sendingToSDI, setSendingToSDI] = useState(false)
  const [checkingStatus, setCheckingStatus] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    invoice_number: '',
    invoice_date: new Date().toISOString().split('T')[0],
    customer_name: '',
    customer_address: '',
    customer_tax_code: '',
    customer_vat: '',
    items: [{ description: '', unit_price: 0, quantity: 1, vat_rate: 0 }],
    payment_method: 'Carta di credito / bancomat',
    payment_date: new Date().toISOString().split('T')[0],
    status: 'paid' as 'paid' | 'pending' | 'overdue',
    notes: ''
  })

  useEffect(() => {
    loadInvoices()
  }, [])

  async function loadInvoices() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('fatture')
        .select('*')
        .order('invoice_date', { ascending: false })

      if (error) throw error
      setInvoices(data || [])
    } catch (error) {
      console.error('Failed to load invoices:', error)
    } finally {
      setLoading(false)
    }
  }

  function calculateTotals() {
    let subtotal = 0
    let vatAmount = 0
    let exemptAmount = 0

    formData.items.forEach(item => {
      const itemTotal = item.unit_price * item.quantity
      if (item.vat_rate === 0) {
        exemptAmount += itemTotal
      } else {
        subtotal += itemTotal
        vatAmount += itemTotal * (item.vat_rate / 100)
      }
    })

    const total = subtotal + vatAmount + exemptAmount

    return { subtotal, vatAmount, exemptAmount, total }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSendingToSDI(true)
    try {
      const { subtotal, vatAmount, exemptAmount, total } = calculateTotals()

      const invoiceData = {
        ...formData,
        subtotal,
        vat_amount: vatAmount,
        exempt_amount: exemptAmount,
        total,
        items: formData.items,
        sdi_status: 'draft' // Initial status
      }

      let invoiceId = editingId

      if (editingId) {
        const { error } = await supabase
          .from('fatture')
          .update(invoiceData)
          .eq('id', editingId)

        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from('fatture')
          .insert([invoiceData])
          .select()
          .single()

        if (error) throw error
        invoiceId = data.id
      }

      // Automatically send to SDI
      if (invoiceId) {
        try {
          const response = await fetch('/.netlify/functions/send-invoice-to-sdi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceId })
          })

          const result = await response.json()

          if (response.ok) {
            alert(`✅ Fattura salvata e inviata a SDI con successo!\n\nID SDI: ${result.sdi_id || 'N/A'}`)
          } else {
            alert(`⚠️ Fattura salvata, ma invio a SDI fallito:\n\n${result.error || 'Errore sconosciuto'}\n\nPuoi riprovare cliccando "Verifica Stato".`)
          }
        } catch (sdiError) {
          console.error('SDI error:', sdiError)
          alert('⚠️ Fattura salvata, ma errore durante invio a SDI. Verifica la connessione.')
        }
      }

      setShowForm(false)
      setEditingId(null)
      resetForm()
      loadInvoices()
    } catch (error) {
      console.error('Failed to save invoice:', error)
      alert('Impossibile salvare la fattura')
    } finally {
      setSendingToSDI(false)
    }
  }

  function resetForm() {
    setFormData({
      invoice_number: '',
      invoice_date: new Date().toISOString().split('T')[0],
      customer_name: '',
      customer_address: '',
      customer_tax_code: '',
      customer_vat: '',
      items: [{ description: '', unit_price: 0, quantity: 1, vat_rate: 0 }],
      payment_method: 'Carta di credito / bancomat',
      payment_date: new Date().toISOString().split('T')[0],
      status: 'paid',
      notes: ''
    })
  }

  function addItem() {
    setFormData({
      ...formData,
      items: [...formData.items, { description: '', unit_price: 0, quantity: 1, vat_rate: 0 }]
    })
  }

  function removeItem(index: number) {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index)
    })
  }

  function updateItem(index: number, field: keyof InvoiceItem, value: any) {
    const newItems = [...formData.items]
    newItems[index] = { ...newItems[index], [field]: value }
    setFormData({ ...formData, items: newItems })
  }

  function downloadPDF(invoice: Invoice) {
    // Open invoice HTML in new window for printing/saving as PDF
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      alert('Impossibile aprire la finestra. Verifica le impostazioni del browser.')
      return
    }

    // Use the stored HTML from the database if available
    if (invoice.invoice_html) {
      printWindow.document.write(invoice.invoice_html)
      printWindow.document.close()
      setTimeout(() => printWindow.print(), 250)
    } else {
      alert('HTML fattura non disponibile')
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

  const { subtotal, vatAmount, exemptAmount, total } = calculateTotals()

  if (loading) {
    return <div className="text-center py-8 text-gray-400">Caricamento...</div>
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">Fatture</h2>
        <Button onClick={() => { resetForm(); setEditingId(null); setShowForm(true) }}>
          + Nuova Fattura
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-gray-900 p-6 rounded-lg mb-6 border border-gray-700">
          <h3 className="text-xl font-semibold text-white mb-4">
            {editingId ? 'Modifica Fattura' : 'Nuova Fattura'}
          </h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Numero Fattura *</label>
              <input
                type="text"
                value={formData.invoice_number}
                onChange={(e) => setFormData({ ...formData, invoice_number: e.target.value })}
                className="w-full bg-gray-800 border-gray-700 rounded-md px-3 py-2 text-white"
                placeholder="1448/FE"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Data Fattura *</label>
              <input
                type="date"
                value={formData.invoice_date}
                onChange={(e) => setFormData({ ...formData, invoice_date: e.target.value })}
                className="w-full bg-gray-800 border-gray-700 rounded-md px-3 py-2 text-white"
                required
              />
            </div>
          </div>

          <div className="space-y-4 mb-6">
            <h4 className="text-lg font-semibold text-white">Destinatario</h4>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Nome / Ragione Sociale *</label>
              <input
                type="text"
                value={formData.customer_name}
                onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                className="w-full bg-gray-800 border-gray-700 rounded-md px-3 py-2 text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Indirizzo *</label>
              <input
                type="text"
                value={formData.customer_address}
                onChange={(e) => setFormData({ ...formData, customer_address: e.target.value })}
                className="w-full bg-gray-800 border-gray-700 rounded-md px-3 py-2 text-white"
                placeholder="Via Roma 43, 09070 Cagliari (CA)"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Codice Fiscale *</label>
                <input
                  type="text"
                  value={formData.customer_tax_code}
                  onChange={(e) => setFormData({ ...formData, customer_tax_code: e.target.value })}
                  className="w-full bg-gray-800 border-gray-700 rounded-md px-3 py-2 text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">P. IVA (opzionale)</label>
                <input
                  type="text"
                  value={formData.customer_vat}
                  onChange={(e) => setFormData({ ...formData, customer_vat: e.target.value })}
                  className="w-full bg-gray-800 border-gray-700 rounded-md px-3 py-2 text-white"
                />
              </div>
            </div>
          </div>

          <div className="mb-6">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-lg font-semibold text-white">Articoli</h4>
              <Button type="button" onClick={addItem} variant="secondary">+ Aggiungi Articolo</Button>
            </div>

            {formData.items.map((item, index) => (
              <div key={index} className="bg-gray-800 p-4 rounded-lg mb-3">
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-12 md:col-span-5">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateItem(index, 'description', e.target.value)}
                      className="w-full bg-gray-900 border-gray-700 rounded-md px-3 py-2 text-white text-sm"
                      placeholder="Descrizione"
                      required
                    />
                  </div>
                  <div className="col-span-3 md:col-span-2">
                    <input
                      type="number"
                      step="0.01"
                      value={item.unit_price}
                      onChange={(e) => updateItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      className="w-full bg-gray-900 border-gray-700 rounded-md px-3 py-2 text-white text-sm"
                      placeholder="Prezzo"
                      required
                    />
                  </div>
                  <div className="col-span-3 md:col-span-2">
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 1)}
                      className="w-full bg-gray-900 border-gray-700 rounded-md px-3 py-2 text-white text-sm"
                      placeholder="Q.tà"
                      min="1"
                      required
                    />
                  </div>
                  <div className="col-span-3 md:col-span-2">
                    <input
                      type="number"
                      value={item.vat_rate}
                      onChange={(e) => updateItem(index, 'vat_rate', parseFloat(e.target.value) || 0)}
                      className="w-full bg-gray-900 border-gray-700 rounded-md px-3 py-2 text-white text-sm"
                      placeholder="IVA %"
                      required
                    />
                  </div>
                  <div className="col-span-3 md:col-span-1 flex items-center justify-end">
                    {formData.items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="text-red-400 hover:text-red-300 text-sm"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            <div className="bg-gray-800 p-4 rounded-lg mt-4">
              <div className="space-y-2 text-sm">
                {subtotal > 0 && <div className="flex justify-between"><span className="text-gray-400">Imponibile:</span><span className="text-white">€{subtotal.toFixed(2)}</span></div>}
                {vatAmount > 0 && <div className="flex justify-between"><span className="text-gray-400">IVA:</span><span className="text-white">€{vatAmount.toFixed(2)}</span></div>}
                {exemptAmount > 0 && <div className="flex justify-between"><span className="text-gray-400">Esente IVA:</span><span className="text-white">€{exemptAmount.toFixed(2)}</span></div>}
                <div className="flex justify-between font-bold text-lg pt-2 border-t border-gray-700"><span className="text-white">Totale:</span><span className="text-dr7-gold">€{total.toFixed(2)}</span></div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Metodo Pagamento</label>
              <select
                value={formData.payment_method}
                onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                className="w-full bg-gray-800 border-gray-700 rounded-md px-3 py-2 text-white"
              >
                <option value="Carta di credito / bancomat">Carta di credito / bancomat</option>
                <option value="Bonifico bancario">Bonifico bancario</option>
                <option value="Contanti">Contanti</option>
                <option value="Assegno">Assegno</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Data Scadenza</label>
              <input
                type="date"
                value={formData.payment_date}
                onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                className="w-full bg-gray-800 border-gray-700 rounded-md px-3 py-2 text-white"
                required
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-1">Stato</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
              className="w-full bg-gray-800 border-gray-700 rounded-md px-3 py-2 text-white"
            >
              <option value="paid">Pagata</option>
              <option value="pending">In attesa</option>
              <option value="overdue">Scaduta</option>
            </select>
          </div>

          <div className="flex gap-3">
            <Button type="submit" disabled={sendingToSDI}>
              {sendingToSDI ? '⏳ Invio a SDI in corso...' : 'Salva e Invia a SDI'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => { setShowForm(false); setEditingId(null); resetForm() }}>
              Annulla
            </Button>
          </div>
        </form>
      )}

      <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-black">
              <tr>
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
                <tr key={invoice.id} className="border-t border-gray-700 hover:bg-gray-800">
                  <td className="px-4 py-3 text-sm text-white">{invoice.invoice_number}</td>
                  <td className="px-4 py-3 text-sm text-white">{new Date(invoice.invoice_date).toLocaleDateString('it-IT')}</td>
                  <td className="px-4 py-3 text-sm text-white">{invoice.customer_name}</td>
                  <td className="px-4 py-3 text-sm text-white text-right">€{(invoice.total || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${invoice.payment_status === 'paid' ? 'bg-green-500/20 text-green-400' :
                        invoice.payment_status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-red-500/20 text-red-400'
                      }`}>
                      {invoice.payment_status === 'paid' ? 'Pagata' : invoice.payment_status === 'pending' ? 'In attesa' : 'Non pagata'}
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
                    </div>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
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
