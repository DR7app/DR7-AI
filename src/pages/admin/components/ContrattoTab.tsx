import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'

interface Contract {
  id: string
  contract_number: string
  contract_date: string
  customer_name: string
  customer_email: string
  customer_phone: string
  customer_address: string
  customer_tax_code: string
  customer_license_number?: string
  vehicle_name: string
  rental_start_date: string
  rental_end_date: string
  daily_rate: number
  total_days: number
  total_amount: number
  deposit_amount?: number
  status: 'active' | 'completed' | 'cancelled'
  notes?: string
  created_at: string
  pdf_url?: string
  booking_id: string
  signed_pdf_url?: string
}

export default function ContrattoTab() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Master contract template — Supabase Storage bucket 'templates' /
  // file 'master_contract.pdf'. Generate-contract.ts lo scarica con
  // cache-busting (?t=Date.now()) ad ogni generazione, quindi un nuovo
  // upload e\' subito attivo senza redeploy.
  const [tmplInfo, setTmplInfo] = useState<{ size: number; updated_at: string | null } | null>(null)
  const [tmplLoading, setTmplLoading] = useState(true)
  const [tmplUploading, setTmplUploading] = useState(false)

  async function loadMasterTemplateInfo() {
    setTmplLoading(true)
    try {
      const { data, error } = await supabase.storage.from('templates').list('', { limit: 100 })
      if (error) throw error
      const f = (data || []).find(x => x.name === 'master_contract.pdf')
      setTmplInfo(f ? {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        size: (f.metadata as any)?.size || 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        updated_at: (f as any).updated_at || (f.metadata as any)?.lastModified || null,
      } : null)
    } catch (e) {
      console.error('master template info load failed', e)
      setTmplInfo(null)
    } finally {
      setTmplLoading(false)
    }
  }

  useEffect(() => { loadMasterTemplateInfo() }, [])

  async function handleUploadMasterTemplate(file: File) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Carica un file PDF (.pdf)')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('File troppo grande (max 20 MB)')
      return
    }
    const ok = window.confirm(
      `Sostituire il master contract attuale con "${file.name}" (${(file.size / 1024).toFixed(0)} KB)?\n\n` +
      'Tutti i nuovi contratti generati useranno subito questa versione. ' +
      'Il file precedente non sara\' recuperabile.'
    )
    if (!ok) return
    setTmplUploading(true)
    try {
      const { error } = await supabase.storage
        .from('templates')
        .upload('master_contract.pdf', file, {
          contentType: 'application/pdf',
          upsert: true,
          cacheControl: '0',
        })
      if (error) throw error
      toast.success('Master contract aggiornato')
      await loadMasterTemplateInfo()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error('Upload fallito: ' + msg)
    } finally {
      setTmplUploading(false)
    }
  }

  function fmtSize(bytes: number): string {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }

  const [formData, setFormData] = useState({
    contract_number: '',
    contract_date: new Date().toISOString().split('T')[0],
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    customer_address: '',
    customer_tax_code: '',
    customer_license_number: '',
    vehicle_name: '',
    rental_start_date: new Date().toISOString().split('T')[0],
    rental_end_date: new Date().toISOString().split('T')[0],
    daily_rate: 0,
    deposit_amount: 0,
    status: 'active' as 'active' | 'completed' | 'cancelled',
    notes: ''
  })

  useEffect(() => {
    loadContracts()
  }, [])

  async function loadContracts() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('contracts')
        .select('*, bookings:booking_id(customer_name, customer_email, customer_phone, booking_details)')
        .order('updated_at', { ascending: false })

      if (error) throw error
      // Resolve customer_name from booking if contract's customer_name is empty
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resolved = (data || []).map((c: any) => {
        const b = c.bookings
        if (!c.customer_name && b) {
          c.customer_name = b.customer_name || b.booking_details?.customer?.fullName || ''
        }
        if (!c.customer_email && b) {
          c.customer_email = b.customer_email || b.booking_details?.customer?.email || ''
        }
        if (!c.customer_phone && b) {
          c.customer_phone = b.customer_phone || b.booking_details?.customer?.phone || ''
        }
        return c
      })
      setContracts(resolved)
    } catch (error) {
      console.error('Failed to load contracts:', error)
    } finally {
      setLoading(false)
    }
  }

  function calculateTotalDays(): number {
    const start = new Date(formData.rental_start_date)
    const end = new Date(formData.rental_end_date)
    const diffTime = Math.abs(end.getTime() - start.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays || 1
  }

  function calculateTotalAmount(): number {
    return calculateTotalDays() * formData.daily_rate
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const totalDays = calculateTotalDays()
      const totalAmount = calculateTotalAmount()

      const contractData = {
        ...formData,
        total_days: totalDays,
        total_amount: totalAmount
      }

      if (editingId) {
        const { error } = await supabase
          .from('contracts')
          .update(contractData)
          .eq('id', editingId)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('contracts')
          .insert([contractData])

        if (error) throw error
      }

      setShowForm(false)
      setEditingId(null)
      resetForm()
      loadContracts()
    } catch (error) {
      console.error('Failed to save contract:', error)
      alert('Impossibile salvare il contratto. Assicurati che la tabella "contracts" esista nel database.')
    }
  }

  function resetForm() {
    setFormData({
      contract_number: '',
      contract_date: new Date().toISOString().split('T')[0],
      customer_name: '',
      customer_email: '',
      customer_phone: '',
      customer_address: '',
      customer_tax_code: '',
      customer_license_number: '',
      vehicle_name: '',
      rental_start_date: new Date().toISOString().split('T')[0],
      rental_end_date: new Date().toISOString().split('T')[0],
      daily_rate: 0,
      deposit_amount: 0,
      status: 'active',
      notes: ''
    })
  }

  function handleEdit(contract: Contract) {
    setFormData({
      contract_number: contract.contract_number,
      contract_date: contract.contract_date,
      customer_name: contract.customer_name,
      customer_email: contract.customer_email,
      customer_phone: contract.customer_phone,
      customer_address: contract.customer_address,
      customer_tax_code: contract.customer_tax_code,
      customer_license_number: contract.customer_license_number || '',
      vehicle_name: contract.vehicle_name,
      rental_start_date: contract.rental_start_date,
      rental_end_date: contract.rental_end_date,
      daily_rate: contract.daily_rate,
      deposit_amount: contract.deposit_amount || 0,
      status: contract.status,
      notes: contract.notes || ''
    })
    setEditingId(contract.id)
    setShowForm(true)
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase
        .from('contracts')
        .delete()
        .eq('id', id)

      if (error) throw error
      loadContracts()
    } catch (error) {
      console.error('Failed to delete contract:', error)
      alert('Impossibile eliminare il contratto')
    }
  }


  const [sendingSignature, setSendingSignature] = useState<string | null>(null)

  async function handleSendSignatureEmail(contract: Contract) {
    if (!contract.pdf_url) {
      toast.error('Il contratto non ha un PDF generato.')
      return
    }
    // BUG FIX 2026-05-21: il bottone si chiama "Firma via WhatsApp" e il
    // backend (signature-init) invia il link via WhatsApp usando il
    // telefono. L'email serve solo come fallback se il telefono manca.
    // Prima qui bloccavamo su email mancante anche con telefono presente
    // → "EMAIL MANCANTE" pure su clienti con telefono valido.
    if (!contract.customer_phone && !contract.customer_email) {
      toast.error('Cliente senza telefono nè email: impossibile inviare il contratto.')
      return
    }

    setSendingSignature(contract.id)
    try {
      const res = await fetch('/.netlify/functions/signature-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: contract.id, bookingId: contract.booking_id })
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(data.message || `Link di firma inviato via WhatsApp a ${contract.customer_phone || contract.customer_name}`)
        loadContracts()
      } else {
        toast.error(data.error || 'Errore nell\'invio')
      }
    } catch (error: unknown) {
      console.error('Signature init error:', error)
      toast.error('Errore nell\'invio della richiesta di firma')
    } finally {
      setSendingSignature(null)
    }
  }

  function handleViewAuditTrail(contract: Contract) {
    const url = `/.netlify/functions/signature-audit?contractId=${contract.id}&format=html`
    window.open(url, '_blank')
  }


  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento contratti...</p>
      </div>
    )
  }

  if (showForm) {
    return (
      <div className="bg-theme-bg-secondary rounded-lg p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-theme-text-primary">
            {editingId ? 'Modifica Contratto' : 'Nuovo Contratto'}
          </h2>
          <button
            onClick={() => {
              setShowForm(false)
              setEditingId(null)
              resetForm()
            }}
            className="text-theme-text-muted hover:text-theme-text-primary"
          >
            ✕ Chiudi
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Contract Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">Numero Contratto *</label>
              <input
                type="text"
                value={formData.contract_number}
                onChange={(e) => setFormData({ ...formData, contract_number: e.target.value })}
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">Data Contratto *</label>
              <input
                type="date"
                value={formData.contract_date}
                onChange={(e) => setFormData({ ...formData, contract_date: e.target.value })}
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                required
              />
            </div>
          </div>

          {/* Customer Info */}
          <div className="border-t border-theme-border pt-4">
            <h3 className="text-lg font-bold text-theme-text-primary mb-4">Informazioni Cliente</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Nome Cliente *</label>
                <input
                  type="text"
                  value={formData.customer_name}
                  onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Email</label>
                <input
                  type="email"
                  value={formData.customer_email}
                  onChange={(e) => setFormData({ ...formData, customer_email: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Telefono</label>
                <input
                  type="tel"
                  value={formData.customer_phone}
                  onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Codice Fiscale</label>
                <input
                  type="text"
                  value={formData.customer_tax_code}
                  onChange={(e) => setFormData({ ...formData, customer_tax_code: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Indirizzo</label>
                <input
                  type="text"
                  value={formData.customer_address}
                  onChange={(e) => setFormData({ ...formData, customer_address: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Patente N.</label>
                <input
                  type="text"
                  value={formData.customer_license_number}
                  onChange={(e) => setFormData({ ...formData, customer_license_number: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                />
              </div>
            </div>
          </div>

          {/* Rental Info */}
          <div className="border-t border-theme-border pt-4">
            <h3 className="text-lg font-bold text-theme-text-primary mb-4">Dettagli Noleggio</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Veicolo *</label>
                <input
                  type="text"
                  value={formData.vehicle_name}
                  onChange={(e) => setFormData({ ...formData, vehicle_name: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Data Inizio *</label>
                <input
                  type="date"
                  value={formData.rental_start_date}
                  onChange={(e) => setFormData({ ...formData, rental_start_date: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Data Fine *</label>
                <input
                  type="date"
                  value={formData.rental_end_date}
                  onChange={(e) => setFormData({ ...formData, rental_end_date: e.target.value })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Tariffa Giornaliera (€) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.daily_rate}
                  onChange={(e) => setFormData({ ...formData, daily_rate: parseFloat(e.target.value) })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Cauzione (€)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.deposit_amount}
                  onChange={(e) => setFormData({ ...formData, deposit_amount: parseFloat(e.target.value) })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-2">Stato</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as typeof formData.status })}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                >
                  <option value="active">Attivo</option>
                  <option value="completed">Completato</option>
                  <option value="cancelled">Cancellato</option>
                </select>
              </div>
            </div>

            {/* Calculated Totals */}
            <div className="mt-4 p-4 bg-theme-bg-tertiary rounded">
              <div className="flex justify-between text-theme-text-primary mb-2">
                <span>Giorni Totali:</span>
                <span className="font-bold">{calculateTotalDays()}</span>
              </div>
              <div className="flex justify-between text-theme-text-primary text-lg">
                <span>Totale:</span>
                <span className="font-bold text-dr7-gold">€{calculateTotalAmount().toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-2">Note</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="submit"
              className="flex-1 bg-dr7-gold hover:bg-[#0A8FA3] text-white font-bold py-3 px-4 rounded-full transition-colors"
            >
              {editingId ? 'Aggiorna Contratto' : 'Crea Contratto'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                setEditingId(null)
                resetForm()
              }}
              className="px-6 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary font-bold py-3 rounded-full transition-colors"
            >
              Annulla
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-theme-text-primary">📄 Contratti</h2>
        <button
          onClick={() => setShowForm(true)}
          className="bg-dr7-gold hover:bg-[#0A8FA3] text-white font-bold py-2 px-4 rounded-full transition-colors"
        >
          + Nuovo Contratto
        </button>
      </div>

      {/* Master Contract Template — bucket templates/master_contract.pdf.
          L'upload sostituisce il file (upsert) e tutti i contratti generati
          dopo il caricamento usano subito la nuova versione (cache-bust). */}
      <div className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-theme-text-primary">Master Contract (modello PDF)</h3>
            <p className="text-xs text-theme-text-muted mt-1">
              Modello base usato da tutti i contratti generati. Carica un nuovo PDF per aggiornarlo: la nuova versione e\' attiva immediatamente, senza redeploy.
            </p>
            <div className="text-[11px] text-theme-text-muted mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <span>Bucket: <span className="font-mono text-theme-text-secondary">templates/master_contract.pdf</span></span>
              {tmplLoading ? (
                <span>Caricamento info...</span>
              ) : tmplInfo ? (
                <>
                  <span>Dimensione: <span className="text-theme-text-secondary">{fmtSize(tmplInfo.size)}</span></span>
                  {tmplInfo.updated_at && (
                    <span>Ultimo aggiornamento: <span className="text-theme-text-secondary">{new Date(tmplInfo.updated_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</span></span>
                  )}
                </>
              ) : (
                <span className="text-red-400">File mancante nel bucket.</span>
              )}
            </div>
          </div>
          <div className="flex flex-col sm:items-end gap-2 flex-shrink-0">
            <label className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-medium cursor-pointer whitespace-nowrap ${tmplUploading ? 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed' : 'bg-dr7-gold text-black hover:opacity-90'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5m0 0l5 5m-5-5v12"/>
              </svg>
              {tmplUploading ? 'Caricamento...' : 'Carica nuova versione'}
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={tmplUploading}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleUploadMasterTemplate(f)
                  e.target.value = '' // reset cosi\' selezionare lo stesso file rifa l'upload
                }}
              />
            </label>
            {tmplInfo && (
              <a
                href={`${supabase.storage.from('templates').getPublicUrl('master_contract.pdf').data.publicUrl}?t=${Date.now()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-theme-text-secondary hover:text-theme-text-primary underline"
              >
                Apri versione attuale
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Legenda campi PDF — elenco esatto dei nomi accettati da
          generate-contract.ts/dataMap. Quando rinomini un AcroForm nel PDF
          master, usa uno di questi nomi (o un alias italiano) per essere
          riconosciuto automaticamente. Senza match il campo resta vuoto. */}
      <details className="bg-theme-bg-secondary rounded-lg border border-theme-border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-theme-text-primary select-none">
          Legenda campi PDF — nomi accettati dal generatore
        </summary>
        <div className="px-4 pb-4 pt-1 text-xs text-theme-text-secondary space-y-4">
          <p className="text-theme-text-muted">
            Ogni campo del PDF (AcroForm) viene riempito se il suo nome
            coincide con uno dei seguenti. Le coppie EN/IT sono sinonimi:
            puoi usarne uno qualsiasi. Campi non presenti in elenco vengono
            ignorati silenziosamente.
          </p>

          {([
            {
              title: 'Contratto',
              rows: [
                ['Numero contratto', 'ContractNumber', 'NumeroContratto'],
                ['Data', 'Date', 'Data'],
                ['Luogo stipula', 'PlaceOfIssue', 'LuogoStipula'],
                ['Orario stipula', 'TimeOfIssue', 'OrarioStipula'],
              ],
            },
            {
              title: 'Cliente — anagrafica',
              rows: [
                ['Nome e cognome', 'CustomerName', 'NomeCognome'],
                ['Codice fiscale / P.IVA', 'CustomerVAT / CodiceFiscale', 'PartitaIVA'],
                ['Telefono', 'CustomerPhone', 'Telefono'],
                ['Email', 'CustomerEmail', 'Email'],
                ['Indirizzo residenza', 'CustomerAddress', 'Indirizzo'],
                ['Città residenza', 'CustomerCity', 'Citta'],
                ['Provincia residenza', 'CustomerProvince', 'Provincia'],
                ['CAP', 'CustomerZipCode / DriverZipCode', 'CAP'],
                ['Data di nascita', 'CustomerBirthDate', 'DataNascita'],
                ['Luogo di nascita', 'CustomerBirthPlace', 'LuogoNascita / CittaNascita'],
                ['Provincia di nascita', 'CustomerBirthProvince', 'ProvinciaNascita'],
                ['Sesso', 'CustomerSex / DriverSex', 'Sesso'],
              ],
            },
            {
              title: 'Patente guidatore',
              rows: [
                ['Numero patente', 'DriverLicense', 'NumeroPatente'],
                ['Tipo patente', 'DriverLicenseType', 'TipoPatente'],
                ['Emessa da', 'DriverLicenseIssuedBy', 'PatenteEmessaDa / EmessaDa'],
                ['Data rilascio', 'DriverLicenseIssueDate', 'DataRilascioPatente / DataRilascio'],
                ['Data scadenza', 'DriverLicenseExpiryDate', 'DataScadenzaPatente / ScadenzaPatente / Scadenza'],
              ],
            },
            {
              title: 'Veicolo',
              rows: [
                ['Marca', 'VehicleBrand', 'Marca'],
                ['Modello', 'VehicleModel', 'Modello'],
                ['Targa', 'VehiclePlate', 'Targa'],
                ['Colore', 'VehicleColor', 'Colore'],
                ['Alimentazione', 'VehicleFuel', 'Alimentazione'],
                ['Posti', 'VehicleSeats', 'Posti'],
                ['Livello carburante', 'VehicleFuelLevel', 'LivelloCarburante'],
                ['Range KM', 'VehicleKMRange', 'KMRange'],
                ['Sforo per KM', 'KMOverageFee', 'SforoPerKM'],
              ],
            },
            {
              title: 'Noleggio — periodo e luoghi',
              rows: [
                ['Sede ritiro', 'PickupLocation', 'SedeRitiro'],
                ['Sede riconsegna', 'DropoffLocation', 'SedeRiconsegna'],
                ['Data inizio', 'PickupDate', 'DataInizio'],
                ['Ora inizio', 'PickupTime', 'OraInizio'],
                ['Data fine', 'DropoffDate', 'DataFine'],
                ['Ora fine', 'DropoffTime', 'OraFine'],
                ['Giorni totali', 'TotalDays', 'Giorni'],
                ['Ore totali', 'TotalHours', 'Ore'],
              ],
            },
            {
              title: 'Importi e clausole',
              rows: [
                ['Assicurazione', 'Insurance', 'Assicurazione'],
                ['Cauzione', 'Deposit', 'Cauzione'],
                ['KM inclusi nel noleggio', 'TotalKM', 'KMTotaliNoleggio'],
                ['Clausola penale (auto-generata)', 'PenaltyClause', '—'],
                ['Termini aggiuntivi (auto-generati)', 'AdditionalTerms', '—'],
              ],
            },
            {
              title: 'Secondo guidatore (opzionale)',
              rows: [
                ['Nome e cognome', 'SecondDriverName', 'SecondoGuidatore'],
                ['Codice fiscale', 'SecondDriverTaxCode / SecondDriverStatsCode / SecondDriverVAT', 'CodiceFiscaleSecondoGuidatore'],
                ['Indirizzo', 'SecondDriverAddress', 'IndirizzoSecondoGuidatore'],
                ['Città', 'SecondDriverCity', 'CittaSecondoGuidatore'],
                ['Provincia', 'SecondDriverProvince', 'ProvinciaSecondoGuidatore'],
                ['CAP', 'SecondDriverZipCode', 'CapSecondoGuidatore'],
                ['Data nascita', 'SecondDriverBirthDate', 'DataNascitaSecondoGuidatore'],
                ['Luogo nascita', 'SecondDriverBirthPlace / SecondDriverPlaceOfBirth', 'LuogoNascitaSecondoGuidatore'],
                ['Provincia nascita', 'SecondDriverBirthProvince', '—'],
                ['Sesso', 'SecondDriverSex / SecondDriverGender', 'SessoSecondoGuidatore'],
                ['Numero patente', 'SecondDriverLicenseNumber', 'PatenteSecondoGuidatore'],
                ['Tipo patente', 'SecondDriverLicenseType', '—'],
                ['Emessa da', 'SecondDriverLicenseIssuedBy', '—'],
                ['Data rilascio patente', 'SecondDriverLicenseIssueDate', '—'],
                ['Data scadenza patente', 'SecondDriverLicenseExpiryDate', 'ScadenzaPatenteSecondoGuidatore'],
                ['Telefono', 'SecondDriverPhone', 'TelefonoSecondoGuidatore'],
                ['Email', 'SecondDriverEmail', 'EmailSecondoGuidatore'],
              ],
            },
            {
              title: 'Cliente azienda (solo se P.IVA)',
              rows: [
                ['Ragione sociale', 'CompanyName', 'Denominazione / RagioneSociale'],
                ['Email azienda', 'CompanyEmail', 'EmailAzienda'],
                ['Telefono azienda', 'CompanyPhone', 'TelefonoAzienda'],
                ['Sede legale', 'CompanyAddress', 'IndirizzoAzienda / SedeLegale'],
                ['Città azienda', 'CompanyCity', 'CittaAzienda'],
                ['Provincia azienda', 'CompanyProvince', 'ProvinciaAzienda'],
                ['CAP azienda', 'CompanyZipCode', 'CAPAzienda'],
                ['Partita IVA azienda', 'CompanyVAT', 'PartitaIVAAzienda'],
                ['Codice fiscale azienda', 'CompanyFiscalCode', 'CodiceFiscaleAzienda'],
                ['PEC', 'CompanyPEC', 'PECAzienda'],
                ['Codice SDI', 'CompanySDI', 'CodiceSDI'],
                ['Rappresentante legale (nome)', 'CompanyRepresentativeName', 'RappresentanteLegale'],
                ['Documento rappresentante (tipo)', 'CompanyRepresentativeID', 'TipoDocumentoRappresentante'],
                ['Documento rappresentante (numero)', 'CompanyRepresentativeIDNumber', 'NumeroDocumentoRappresentante'],
                ['Documento rappresentante (data rilascio)', 'CompanyRepresentativeIDIssueDate', 'DataRilascioDocumentoRappresentante'],
                ['Documento rappresentante (luogo rilascio)', 'CompanyRepresentativeIDIssuePlace', 'LuogoRilascioDocumentoRappresentante'],
                ['Documento rappresentante (data scadenza)', 'CompanyRepresentativeIDExpiryDate', 'DataScadenzaDocumentoRappresentante'],
                ['Documento rappresentante (combo)', 'CompanyRepresentativeDocCombined', 'DocumentoRappresentante'],
                ['Rilascio documento (combo)', 'CompanyRepresentativeIssueCombined', 'RilascioDocumentoRappresentante'],
              ],
            },
            {
              title: 'Garante / proprietario veicolo cauzione (solo se cauzione su altra auto)',
              rows: [
                ['Nome e cognome', '—', 'GaranteNomeCognome'],
                ['Codice fiscale', '—', 'GaranteCodiceFiscale'],
                ['Sesso', '—', 'GaranteSesso'],
                ['Indirizzo', '—', 'GaranteIndirizzo'],
                ['Città', '—', 'GaranteCitta'],
                ['Provincia', '—', 'GaranteProvincia'],
                ['CAP', '—', 'GaranteCAP'],
                ['Data nascita', '—', 'GaranteDataNascita'],
                ['Luogo nascita', '—', 'GaranteLuogoNascita'],
                ['Provincia nascita', '—', 'GaranteProvinciaNascita'],
                ['Telefono', '—', 'GaranteTelefono'],
                ['Email', '—', 'GaranteEmail'],
                ['Veicolo cauzione (combo)', '—', 'CauzioneVeicolo'],
                ['Targa cauzione', '—', 'TargaCauzione'],
              ],
            },
          ] as { title: string; rows: [string, string, string][] }[]).map(section => (
            <div key={section.title}>
              <h4 className="text-[11px] uppercase tracking-wider font-bold text-theme-text-primary mb-1.5">{section.title}</h4>
              <div className="overflow-x-auto rounded border border-theme-border">
                <table className="w-full text-[11px]">
                  <thead className="bg-theme-bg-tertiary">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-semibold text-theme-text-secondary">Descrizione</th>
                      <th className="text-left px-2 py-1.5 font-semibold text-theme-text-secondary">Nome inglese</th>
                      <th className="text-left px-2 py-1.5 font-semibold text-theme-text-secondary">Alias italiano</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((r, i) => (
                      <tr key={i} className="border-t border-theme-border">
                        <td className="px-2 py-1 text-theme-text-secondary">{r[0]}</td>
                        <td className="px-2 py-1 font-mono text-theme-text-primary">{r[1]}</td>
                        <td className="px-2 py-1 font-mono text-theme-text-primary">{r[2]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </details>

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

      {/* Contracts List */}
      {contracts.length === 0 ? (
        <div className="bg-theme-bg-secondary rounded-lg p-12 text-center">
          <p className="text-theme-text-muted text-lg mb-4">Nessun contratto trovato</p>
          <button
            onClick={() => setShowForm(true)}
            className="bg-dr7-gold hover:bg-[#0A8FA3] text-white font-bold py-2 px-6 rounded-full transition-colors"
          >
            Crea il primo contratto
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {contracts.filter(contract => {
            if (!searchQuery) return true
            const query = searchQuery.toLowerCase()
            return (
              contract.customer_name.toLowerCase().includes(query) ||
              contract.contract_number.toLowerCase().includes(query) ||
              contract.customer_email.toLowerCase().includes(query)
            )
          }).map((contract) => (
            <div key={contract.id} className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-theme-text-primary">{contract.contract_number}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-bold ${contract.status === 'active' ? 'bg-green-600 text-theme-text-primary' :
                      contract.status === 'completed' ? 'bg-blue-600 text-theme-text-primary' :
                        'bg-red-600 text-theme-text-primary'
                      }`}>
                      {contract.status === 'active' ? 'Attivo' :
                        contract.status === 'completed' ? 'Completato' : 'Cancellato'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <span className="text-theme-text-muted">Cliente:</span>
                      <p className="text-theme-text-primary font-semibold">{contract.customer_name}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Veicolo:</span>
                      <p className="text-theme-text-primary font-semibold">{contract.vehicle_name}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Periodo:</span>
                      <p className="text-theme-text-primary font-semibold">
                        {new Date(contract.rental_start_date).toLocaleDateString('it-IT')} - {new Date(contract.rental_end_date).toLocaleDateString('it-IT')}
                      </p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted">Totale:</span>
                      <p className="text-dr7-gold font-bold">€{contract.total_amount.toFixed(2)}</p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 ml-4">
                  {contract.pdf_url && (
                    <div className="flex gap-2 w-full">
                      <a
                        href={contract.pdf_url}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-green-600 hover:bg-green-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors text-center flex-1 flex items-center justify-center gap-1"
                      >
                        <span>📄</span> PDF
                      </a>
                      <a
                        href={`mailto:${contract.customer_email}?subject=Contratto Noleggio ${contract.contract_number}&body=Gentile Cliente,%0D%0A%0D%0AEcco il link al tuo contratto di noleggio:%0D%0A${encodeURIComponent(contract.pdf_url)}%0D%0A%0D%0AGrazie per aver scelto DR7 Empire.`}
                        className="bg-blue-600 hover:bg-blue-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors text-center flex-1 flex items-center justify-center gap-1"
                      >
                        <span>✉️</span> Email
                      </a>
                    </div>
                  )}
                  {contract.signed_pdf_url ? (
                    <>
                      <button
                        onClick={() => window.open(contract.signed_pdf_url, '_blank')}
                        className="w-full bg-purple-600 hover:bg-purple-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1"
                      >
                        Contratto Firmato
                      </button>
                      <button
                        onClick={() => handleSendSignatureEmail(contract)}
                        disabled={sendingSignature === contract.id}
                        className="w-full bg-dr7-gold hover:bg-[#0A8FA3] text-white px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1 font-bold disabled:opacity-50"
                      >
                        {sendingSignature === contract.id ? 'Invio...' : 'Reinvia Contratto'}
                      </button>
                      <button
                        onClick={() => handleViewAuditTrail(contract)}
                        className="w-full bg-gray-600 hover:bg-gray-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1"
                      >
                        Audit Trail
                      </button>
                    </>
                  ) : contract.pdf_url ? (
                    <button
                      onClick={() => handleSendSignatureEmail(contract)}
                      disabled={sendingSignature === contract.id}
                      className="w-full bg-dr7-gold hover:bg-[#0A8FA3] text-white px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1 font-bold disabled:opacity-50"
                    >
                      {sendingSignature === contract.id ? 'Invio...' : 'Firma via WhatsApp'}
                    </button>
                  ) : null}
                  {contract.booking_id && (
                    <button
                      onClick={async () => {
                        try {
                          toast.loading('Rigenerazione contratto...', { id: 'regen' })
                          const res = await authFetch('/.netlify/functions/generate-contract', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ bookingId: contract.booking_id })
                          })
                          const data = await res.json().catch(() => ({}))
                          if (!res.ok) {
                            throw new Error(data.error || data.message || res.statusText)
                          }
                          toast.success('Contratto rigenerato!', { id: 'regen' })
                          if (data.url) {
                            window.open(data.url, '_blank', 'noopener,noreferrer')
                          }
                          loadContracts()
                        } catch (err: unknown) {
                          const _errMsg = err instanceof Error ? err.message : String(err)
                          toast.error('Errore: ' + _errMsg, { id: 'regen' })
                        }
                      }}
                      className="w-full bg-orange-600/30 hover:bg-orange-600/50 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1"
                    >
                      Rigenera Contratto
                    </button>
                  )}
                  <div className="flex gap-2 w-full">
                    <button
                      onClick={() => handleEdit(contract)}
                      className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex-1"
                    >
                      Modifica
                    </button>
                    <button
                      onClick={() => handleDelete(contract.id)}
                      className="bg-red-600 hover:bg-red-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex-1"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
