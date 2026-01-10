import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'

interface Invoice {
  id: string
  invoice_number: string
  invoice_date: string
  customer_name: string
  customer_address: string
  customer_tax_code: string
  customer_vat?: string
  items: InvoiceItem[]
  subtotal: number
  vat_amount: number
  exempt_amount: number
  total: number
  payment_method: string
  payment_date: string
  status: 'paid' | 'pending' | 'overdue'
  notes?: string
  created_at: string
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
        .from('invoices')
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
    try {
      const { subtotal, vatAmount, exemptAmount, total } = calculateTotals()

      const invoiceData = {
        ...formData,
        subtotal,
        vat_amount: vatAmount,
        exempt_amount: exemptAmount,
        total,
        items: formData.items
      }

      if (editingId) {
        const { error } = await supabase
          .from('invoices')
          .update(invoiceData)
          .eq('id', editingId)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('invoices')
          .insert([invoiceData])

        if (error) throw error
      }

      setShowForm(false)
      setEditingId(null)
      resetForm()
      loadInvoices()
    } catch (error) {
      console.error('Failed to save invoice:', error)
      alert('Impossibile salvare la fattura')
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

  function generatePDF(invoice: Invoice) {
    // Open invoice in new window for printing
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const { subtotal, vat_amount, exempt_amount, total } = invoice

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Fattura ${invoice.invoice_number}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
          .header { text-align: center; margin-bottom: 40px; }
          .header h1 { margin: 0; color: #000; font-size: 24px; }
          .company-info, .customer-info { margin-bottom: 30px; }
          .company-info h2, .customer-info h2 { font-size: 14px; font-weight: bold; margin-bottom: 10px; }
          .info-line { font-size: 12px; margin: 3px 0; }
          table { width: 100%; border-collapse: collapse; margin: 30px 0; }
          th { background: #f0f0f0; padding: 10px; text-align: left; font-size: 12px; border: 1px solid #ddd; }
          td { padding: 10px; font-size: 12px; border: 1px solid #ddd; }
          .totals { float: right; width: 300px; margin-top: 20px; }
          .totals div { display: flex; justify-content: space-between; padding: 8px 0; font-size: 13px; }
          .totals .total-line { font-weight: bold; font-size: 16px; border-top: 2px solid #000; margin-top: 10px; padding-top: 10px; }
          .payment-info { margin-top: 40px; padding: 15px; background: #f9f9f9; border-radius: 5px; }
          .footer { margin-top: 60px; font-size: 11px; text-align: center; color: #666; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Fattura ${invoice.invoice_number}</h1>
          <p style="margin: 5px 0;">del ${new Date(invoice.invoice_date).toLocaleDateString('it-IT')}</p>
        </div>

        <div class="company-info">
          <h2>DA</h2>
          <div class="info-line"><strong>Dr7 S.p.A.</strong></div>
          <div class="info-line">Via del Fangario 25, 09122 Cagliari (CA)</div>
          <div class="info-line">P. IVA IT04104640927 – C.F. 04104640927</div>
          <div class="info-line">Telefono: 345 790 5205</div>
          <div class="info-line">📧 info@dr7.app</div>
          <div class="info-line">PEC: dubai.rent7.0srl@legalmail.it</div>
          <div class="info-line">🌐 www.dr7empire.com</div>
        </div>

        <div class="customer-info">
          <h2>DESTINATARIO</h2>
          <div class="info-line"><strong>${invoice.customer_name}</strong></div>
          <div class="info-line">${invoice.customer_address}</div>
          <div class="info-line">C.F. ${invoice.customer_tax_code}</div>
          ${invoice.customer_vat ? `<div class="info-line">P. IVA ${invoice.customer_vat}</div>` : ''}
        </div>

        <table>
          <thead>
            <tr>
              <th>DESCRIZIONE</th>
              <th style="text-align: right;">IMPORTO</th>
              <th style="text-align: center;">Q.TÀ</th>
              <th style="text-align: center;">IVA</th>
              <th style="text-align: right;">TOTALE</th>
            </tr>
          </thead>
          <tbody>
            ${invoice.items.map(item => {
              const itemTotal = item.unit_price * item.quantity
              return `
                <tr>
                  <td>${item.description}</td>
                  <td style="text-align: right;">${item.unit_price.toFixed(2)} €</td>
                  <td style="text-align: center;">${item.quantity} ${item.quantity === 1 ? 'pezzo' : 'pezzi'}</td>
                  <td style="text-align: center;">${item.vat_rate} %</td>
                  <td style="text-align: right;">${itemTotal.toFixed(2)} €</td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>

        <div class="totals">
          ${subtotal > 0 ? `<div><span>Imponibile:</span><span>${subtotal.toFixed(2)} €</span></div>` : ''}
          ${vat_amount > 0 ? `<div><span>IVA:</span><span>${vat_amount.toFixed(2)} €</span></div>` : ''}
          ${exempt_amount > 0 ? `<div><span>Anticipazioni o Spese esenti IVA art. 15:</span><span>${exempt_amount.toFixed(2)} €</span></div>` : ''}
          <div class="total-line"><span>Totale fattura:</span><span>${total.toFixed(2)} €</span></div>
        </div>

        <div style="clear: both;"></div>

        <div class="payment-info">
          <div class="info-line"><strong>Modalità di pagamento:</strong> ${invoice.payment_method}</div>
          <div class="info-line"><strong>Data scadenza:</strong> ${new Date(invoice.payment_date).toLocaleDateString('it-IT')}</div>
          <div class="info-line"><strong>Importo:</strong> ${total.toFixed(2)} €</div>
          <div class="info-line"><strong>Stato:</strong> ${invoice.status === 'paid' ? 'Pagata' : invoice.status === 'pending' ? 'In attesa' : 'Scaduta'}</div>
        </div>

        <div class="footer">
          <p>🧾 Copia di fattura elettronica inviata al Cassetto Fiscale.</p>
          <p>Dr7 S.p.A. – Iscr. reg. imp.: 04104640927 – Socio unico – Non in liquidazione</p>
          <p>Cap. soc. € 50.000,00 – Regime fiscale: Ordinario</p>
        </div>
      </body>
      </html>
    `)

    printWindow.document.close()
    setTimeout(() => printWindow.print(), 250)
  }

  const { subtotal, vatAmount, exemptAmount, total } = calculateTotals()

  if (loading) {
    return <div className="text-center py-8 text-theme-text-muted">Caricamento...</div>
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-theme-text-primary">Fatture</h2>
        <Button onClick={() => { resetForm(); setEditingId(null); setShowForm(true) }}>
          + Nuova Fattura
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-theme-bg-secondary p-6 rounded-lg mb-6 border border-theme-border">
          <h3 className="text-xl font-semibold text-theme-text-primary mb-4">
            {editingId ? 'Modifica Fattura' : 'Nuova Fattura'}
          </h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-theme-text-muted mb-1">Numero Fattura *</label>
              <input
                type="text"
                value={formData.invoice_number}
                onChange={(e) => setFormData({ ...formData, invoice_number: e.target.value })}
                className="w-full bg-theme-bg-tertiary border-theme-border rounded-md px-3 py-2 text-theme-text-primary"
                placeholder="1448/FE"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-theme-text-muted mb-1">Data Fattura *</label>
              <input
                type="date"
                value={formData.invoice_date}
                onChange={(e) => setFormData({ ...formData, invoice_date: e.target.value })}
                className="w-full bg-theme-bg-tertiary border-theme-border rounded-md px-3 py-2 text-theme-text-primary"
                required
              />
            </div>
          </div>

          <div className="space-y-4 mb-6">
            <h4 className="text-lg font-semibold text-theme-text-primary">Destinatario</h4>
            <div>
              <label className="block text-sm text-theme-text-muted mb-1">Nome / Ragione Sociale *</label>
              <input
                type="text"
                value={formData.customer_name}
                onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                className="w-full bg-theme-bg-tertiary border-theme-border rounded-md px-3 py-2 text-theme-text-primary"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-theme-text-muted mb-1">Indirizzo *</label>
              <input
                type="text"
                value={formData.customer_address}
                onChange={(e) => setFormData({ ...formData, customer_address: e.target.value })}
                className="w-full bg-theme-bg-tertiary border-theme-border rounded-md px-3 py-2 text-theme-text-primary"
                placeholder="Via Roma 43, 09070 Cagliari (CA)"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-theme-text-muted mb-1">Codice Fiscale *</label>
                <input
                  type="text"
                  value={formData.customer_tax_code}
                  onChange={(e) => setFormData({ ...formData, customer_tax_code: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border-theme-border rounded-md px-3 py-2 text-theme-text-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-muted mb-1">P. IVA (opzionale)</label>
                <input
                  type="text"
                  value={formData.customer_vat}
                  onChange={(e) => setFormData({ ...formData, customer_vat: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border-theme-border rounded-md px-3 py-2 text-theme-text-primary"
                />
              </div>
            </div>
          </div>

          <div className="mb-6">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-lg font-semibold text-theme-text-primary">Articoli</h4>
              <Button type="button" onClick={addItem} variant="secondary">+ Aggiungi Articolo</Button>
            </div>

            {formData.items.map((item, index) => (
              <div key={index} className="bg-theme-bg-tertiary p-4 rounded-lg mb-3">
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-12 md:col-span-5">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateItem(index, 'description', e.target.value)}
                      className="w-full bg-theme-bg-secondary border-theme-border rounded-md px-3 py-2 text-theme-text-primary text-sm"
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
                      className="w-full bg-theme-bg-secondary border-theme-border rounded-md px-3 py-2 text-theme-text-primary text-sm"
                      placeholder="Prezzo"
                      required
                    />
                  </div>
                  <div className="col-span-3 md:col-span-2">
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 1)}
                      className="w-full bg-theme-bg-secondary border-theme-border rounded-md px-3 py-2 text-theme-text-primary text-sm"
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
                      className="w-full bg-theme-bg-secondary border-theme-border rounded-md px-3 py-2 text-theme-text-primary text-sm"
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

            <div className="bg-theme-bg-tertiary p-4 rounded-lg mt-4">
              <div className="space-y-2 text-sm">
                {subtotal > 0 && <div className="flex justify-between"><span className="text-theme-text-muted">Imponibile:</span><span className="text-theme-text-primary">€{subtotal.toFixed(2)}</span></div>}
                {vatAmount > 0 && <div className="flex justify-between"><span className="text-theme-text-muted">IVA:</span><span className="text-theme-text-primary">€{vatAmount.toFixed(2)}</span></div>}
                {exemptAmount > 0 && <div className="flex justify-between"><span className="text-theme-text-muted">Esente IVA:</span><span className="text-theme-text-primary">€{exemptAmount.toFixed(2)}</span></div>}
                <div className="flex justify-between font-bold text-lg pt-2 border-t border-theme-border"><span className="text-theme-text-primary">Totale:</span><span className="text-dr7-gold">€{total.toFixed(2)}</span></div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-theme-text-muted mb-1">Metodo Pagamento</label>
              <select
                value={formData.payment_method}
                onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                className="w-full bg-theme-bg-tertiary border-theme-border rounded-md px-3 py-2 text-theme-text-primary"
              >
                <option value="Carta di credito / bancomat">Carta di credito / bancomat</option>
                <option value="Bonifico bancario">Bonifico bancario</option>
                <option value="Contanti">Contanti</option>
                <option value="Assegno">Assegno</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-theme-text-muted mb-1">Data Scadenza</label>
              <input
                type="date"
                value={formData.payment_date}
                onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                className="w-full bg-theme-bg-tertiary border-theme-border rounded-md px-3 py-2 text-theme-text-primary"
                required
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm text-theme-text-muted mb-1">Stato</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
              className="w-full bg-theme-bg-tertiary border-theme-border rounded-md px-3 py-2 text-theme-text-primary"
            >
              <option value="paid">Pagata</option>
              <option value="pending">In attesa</option>
              <option value="overdue">Scaduta</option>
            </select>
          </div>

          <div className="flex gap-3">
            <Button type="submit">Salva Fattura</Button>
            <Button type="button" variant="secondary" onClick={() => { setShowForm(false); setEditingId(null); resetForm() }}>
              Annulla
            </Button>
          </div>
        </form>
      )}

      <div className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Numero</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Data</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-theme-text-primary">Cliente</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-theme-text-primary">Totale</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-theme-text-primary">Stato</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-theme-text-primary">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-t border-theme-border hover:bg-theme-bg-tertiary">
                  <td className="px-4 py-3 text-sm text-theme-text-primary">{invoice.invoice_number}</td>
                  <td className="px-4 py-3 text-sm text-theme-text-primary">{new Date(invoice.invoice_date).toLocaleDateString('it-IT')}</td>
                  <td className="px-4 py-3 text-sm text-theme-text-primary">{invoice.customer_name}</td>
                  <td className="px-4 py-3 text-sm text-theme-text-primary text-right">€{invoice.total.toFixed(2)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      invoice.status === 'paid' ? 'bg-green-500/20 text-green-400' :
                      invoice.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {invoice.status === 'paid' ? 'Pagata' : invoice.status === 'pending' ? 'In attesa' : 'Scaduta'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2 justify-center">
                      <Button
                        onClick={() => generatePDF(invoice)}
                        variant="secondary"
                        className="text-xs py-1 px-3 bg-blue-900 hover:bg-blue-800"
                      >
                        PDF
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
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
