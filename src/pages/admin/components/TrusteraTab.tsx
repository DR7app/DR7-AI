import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { logAdminAction } from '../../../utils/logAdminAction'
import { logger } from '../../../utils/logger'

type SubTab = 'documenti' | 'marketing'

interface SignatureRequest {
  id: string
  contract_id: string | null
  signer_name: string
  signer_email: string
  status: string
  document_name: string | null
  document_url: string | null
  signed_pdf_url: string | null
  signed_at: string | null
  created_at: string
  token_expires_at: string
  contract?: {
    contract_number: string
    customer_name: string
  }
}

interface CustomerConsent {
  id: string
  nome: string | null
  cognome: string | null
  denominazione: string | null
  email: string
  telefono: string | null
  marketing_consent: boolean | null
  marketing_consent_date: string | null
}

export default function TrusteraTab() {
  const [subTab, setSubTab] = useState<SubTab>('documenti')

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex gap-2 border-b border-theme-border pb-2">
        <button
          onClick={() => setSubTab('documenti')}
          className={`px-4 py-2 rounded-t-lg font-bold text-sm transition-colors ${subTab === 'documenti' ? 'bg-dr7-gold text-white' : 'bg-theme-bg-secondary text-theme-text-muted hover:text-theme-text-primary'}`}
        >
          Documenti
        </button>
        <button
          onClick={() => setSubTab('marketing')}
          className={`px-4 py-2 rounded-t-lg font-bold text-sm transition-colors ${subTab === 'marketing' ? 'bg-dr7-gold text-white' : 'bg-theme-bg-secondary text-theme-text-muted hover:text-theme-text-primary'}`}
        >
          Marketing Consent
        </button>
      </div>

      {subTab === 'documenti' ? <DocumentiSubTab /> : <MarketingConsentSubTab />}
    </div>
  )
}

// ==================== DOCUMENTI SUB-TAB ====================
function DocumentiSubTab() {
  const [requests, setRequests] = useState<SignatureRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [formData, setFormData] = useState({
    documentName: '',
    signerName: '',
    signerEmail: '',
    signerPhone: '',
  })
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)

  // Customer search
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<any[]>([])
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)

  useEffect(() => {
    loadRequests()
  }, [])

  async function loadRequests() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('signature_requests')
        .select('id, contract_id, signer_name, signer_email, status, document_name, document_url, signed_pdf_url, signed_at, created_at, token_expires_at')
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw error
      setRequests(data || [])
    } catch (err: any) {
      console.error('Failed to load signature requests:', err)
      toast.error('Errore caricamento richieste')
    } finally {
      setLoading(false)
    }
  }

  async function searchCustomers(query: string) {
    setCustomerSearch(query)
    if (query.length < 2) {
      setCustomerResults([])
      setShowCustomerDropdown(false)
      return
    }

    const { data } = await supabase
      .from('customers_extended')
      .select('id, nome, cognome, email, telefono, denominazione')
      .or(`nome.ilike.%${query}%,cognome.ilike.%${query}%,denominazione.ilike.%${query}%,email.ilike.%${query}%`)
      .limit(10)

    setCustomerResults(data || [])
    setShowCustomerDropdown(true)
  }

  function selectCustomer(customer: any) {
    const name = customer.denominazione || [customer.nome, customer.cognome].filter(Boolean).join(' ')
    setFormData({
      ...formData,
      signerName: name,
      signerEmail: customer.email || '',
      signerPhone: customer.telefono || '',
    })
    setCustomerSearch(name)
    setShowCustomerDropdown(false)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.type !== 'application/pdf') {
      toast.error('Solo file PDF sono accettati')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File troppo grande (max 10MB)')
      return
    }

    setUploading(true)
    try {
      // Convert file to base64 and upload via Netlify function (service role)
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string
          resolve(result.split(',')[1]) // Remove data:...;base64, prefix
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const res = await fetch('/.netlify/functions/upload-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64: base64,
          fileName: file.name,
          contentType: 'application/pdf'
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload fallito')

      setUploadedUrl(data.url)
      setUploadedFileName(file.name)

      if (!formData.documentName) {
        setFormData(prev => ({ ...prev, documentName: file.name.replace('.pdf', '') }))
      }

      toast.success('Documento caricato')
    } catch (err: any) {
      console.error('Upload error:', err)
      toast.error('Errore caricamento: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleSend() {
    if (!uploadedUrl) {
      toast.error('Carica un documento PDF prima')
      return
    }
    if (!formData.signerName || !formData.signerEmail || !formData.signerPhone) {
      toast.error('Compila tutti i campi del firmatario')
      return
    }

    setSending(true)
    try {
      const res = await fetch('/.netlify/functions/document-sign-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentUrl: uploadedUrl,
          documentName: formData.documentName || 'Documento',
          signerName: formData.signerName,
          signerEmail: formData.signerEmail,
          signerPhone: formData.signerPhone,
        })
      })

      const data = await res.json()
      logger.log('[TRUSTERA] Response:', res.status, res.ok, data)
      if (res.ok) {
        toast.success(data.message || 'Link di firma inviato via WhatsApp')
        logger.log('[TRUSTERA] About to log action, requestId:', data.requestId)
        logAdminAction('send_trustera_document', 'signature', data.requestId, { document: formData.documentName, signer: formData.signerName })
          .then(() => logger.log('[TRUSTERA] logAdminAction completed'))
          .catch((err: any) => console.error('[TRUSTERA] logAdminAction FAILED:', err))
        setShowUpload(false)
        resetForm()
        loadRequests()
      } else {
        toast.error(data.error || 'Errore nell\'invio')
      }
    } catch (err: any) {
      console.error('Send error:', err)
      toast.error('Errore: ' + err.message)
    } finally {
      setSending(false)
    }
  }

  function resetForm() {
    setFormData({ documentName: '', signerName: '', signerEmail: '', signerPhone: '' })
    setUploadedUrl(null)
    setUploadedFileName(null)
    setCustomerSearch('')
    setCustomerResults([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleDelete(id: string) {
    if (!confirm('Eliminare questa richiesta di firma?')) return
    try {
      // Delete audit trail first (FK constraint)
      await supabase.from('signature_audit_trail').delete().eq('signature_request_id', id)
      const { error } = await supabase.from('signature_requests').delete().eq('id', id)
      if (error) throw error
      toast.success('Richiesta eliminata')
      logAdminAction('delete_trustera_document', 'signature', id)
      loadRequests()
    } catch (err: any) {
      toast.error('Errore eliminazione: ' + err.message)
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'signed': return { label: 'Firmato', color: 'bg-green-600 text-white' }
      case 'pending': return { label: 'In attesa', color: 'bg-yellow-600 text-white' }
      case 'otp_sent': return { label: 'OTP inviato', color: 'bg-blue-600 text-white' }
      case 'otp_verified': return { label: 'OTP verificato', color: 'bg-blue-400 text-white' }
      case 'expired': return { label: 'Scaduto', color: 'bg-red-600 text-white' }
      case 'cancelled': return { label: 'Annullato', color: 'bg-gray-600 text-white' }
      default: return { label: status, color: 'bg-gray-600 text-white' }
    }
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-theme-text-primary">Trustera - Firma Documenti</h2>
        <button
          onClick={() => { setShowUpload(!showUpload); if (showUpload) resetForm() }}
          className="bg-dr7-gold hover:bg-[#247a6f] text-white font-bold py-2 px-4 rounded-full transition-colors"
        >
          {showUpload ? 'Annulla' : '+ Invia Documento'}
        </button>
      </div>

      {/* Upload & Send Form */}
      {showUpload && (
        <div className="bg-theme-bg-secondary rounded-lg p-6 border border-theme-border space-y-4">
          <h3 className="text-lg font-bold text-theme-text-primary">Carica documento da firmare</h3>

          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-2">Documento PDF *</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleFileUpload}
              className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-sm file:bg-dr7-gold file:text-white file:font-bold file:cursor-pointer"
            />
            {uploading && <p className="text-sm text-theme-text-muted mt-1">Caricamento in corso...</p>}
            {uploadedFileName && !uploading && (
              <p className="text-sm text-green-400 mt-1">Caricato: {uploadedFileName}</p>
            )}
          </div>

          {/* Document Name */}
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-2">Nome Documento</label>
            <input
              type="text"
              value={formData.documentName}
              onChange={(e) => setFormData({ ...formData, documentName: e.target.value })}
              placeholder="es. Accordo, Delega, Procura..."
              className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
            />
          </div>

          {/* Customer Search */}
          <div className="relative">
            <label className="block text-sm font-medium text-theme-text-secondary mb-2">Cerca Cliente</label>
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => searchCustomers(e.target.value)}
              onFocus={() => customerResults.length > 0 && setShowCustomerDropdown(true)}
              placeholder="Cerca per nome, cognome, email..."
              className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
            />
            {showCustomerDropdown && customerResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-theme-bg-tertiary border border-theme-border rounded shadow-lg max-h-48 overflow-y-auto">
                {customerResults.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => selectCustomer(c)}
                    className="w-full text-left px-3 py-2 hover:bg-theme-bg-hover text-theme-text-primary text-sm border-b border-theme-border/30 last:border-0"
                  >
                    <span className="font-semibold">{c.denominazione || [c.nome, c.cognome].filter(Boolean).join(' ')}</span>
                    {c.email && <span className="text-theme-text-muted ml-2">({c.email})</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Signer Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">Nome Firmatario *</label>
              <input
                type="text"
                value={formData.signerName}
                onChange={(e) => setFormData({ ...formData, signerName: e.target.value })}
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">Email *</label>
              <input
                type="email"
                value={formData.signerEmail}
                onChange={(e) => setFormData({ ...formData, signerEmail: e.target.value })}
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">Telefono (WhatsApp) *</label>
              <input
                type="tel"
                value={formData.signerPhone}
                onChange={(e) => setFormData({ ...formData, signerPhone: e.target.value })}
                placeholder="+39 3XX XXX XXXX"
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
              />
            </div>
          </div>

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={sending || !uploadedUrl}
            className="w-full bg-dr7-gold hover:bg-[#247a6f] text-white font-bold py-3 px-4 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? 'Invio in corso...' : 'Invia per Firma via WhatsApp'}
          </button>
        </div>
      )}

      {/* Requests List */}
      <div className="space-y-3">
        {requests.length === 0 ? (
          <div className="bg-theme-bg-secondary rounded-lg p-12 text-center">
            <p className="text-theme-text-muted text-lg">Nessuna richiesta di firma</p>
          </div>
        ) : (
          requests.map((req) => {
            const badge = getStatusBadge(req.status)
            const isDocument = !req.contract_id && req.document_name
            const isExpired = new Date(req.token_expires_at) < new Date() && req.status !== 'signed'
            return (
              <div key={req.id} className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-base font-bold text-theme-text-primary">
                        {isDocument ? req.document_name : (req.contract_id ? 'Contratto' : 'Documento')}
                      </h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${isExpired && req.status !== 'signed' ? 'bg-red-600 text-white' : badge.color}`}>
                        {isExpired && req.status !== 'signed' ? 'Scaduto' : badge.label}
                      </span>
                      {isDocument && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-600/30 text-purple-300">
                          Documento
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
                      <div>
                        <span className="text-theme-text-muted">Firmatario:</span>
                        <p className="text-theme-text-primary font-semibold">{req.signer_name}</p>
                      </div>
                      <div>
                        <span className="text-theme-text-muted">Email:</span>
                        <p className="text-theme-text-primary">{req.signer_email}</p>
                      </div>
                      <div>
                        <span className="text-theme-text-muted">Inviato:</span>
                        <p className="text-theme-text-primary">
                          {new Date(req.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })}
                        </p>
                      </div>
                      {req.signed_at && (
                        <div>
                          <span className="text-theme-text-muted">Firmato:</span>
                          <p className="text-green-400 font-semibold">
                            {new Date(req.signed_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 ml-4">
                    {req.document_url && (
                      <button
                        onClick={() => window.open(req.document_url!, '_blank')}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-full text-sm transition-colors text-center"
                      >
                        Originale
                      </button>
                    )}
                    {req.signed_pdf_url && (
                      <button
                        onClick={() => window.open(req.signed_pdf_url!, '_blank')}
                        className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-full text-sm transition-colors text-center"
                      >
                        Firmato
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(req.id)}
                      className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-full text-sm transition-colors text-center"
                    >
                      Elimina
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ==================== MARKETING CONSENT SUB-TAB ====================
function MarketingConsentSubTab() {
  const [customers, setCustomers] = useState<CustomerConsent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'yes' | 'no' | 'unknown'>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadCustomers()
  }, [])

  async function loadCustomers() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('customers_extended')
        .select('id, nome, cognome, denominazione, email, telefono, marketing_consent, marketing_consent_date')
        .not('email', 'is', null)
        .neq('email', '')
        .order('marketing_consent_date', { ascending: false, nullsFirst: false })

      if (error) throw error

      // Deduplicate by email (case-insensitive) — keep the one with consent data, or the most recent
      const emailMap = new Map<string, CustomerConsent>()
      for (const c of (data || [])) {
        const key = c.email.toLowerCase().trim()
        const existing = emailMap.get(key)
        if (!existing) {
          emailMap.set(key, c)
        } else {
          // Prefer the one with consent answered, or the one with a name
          const existingHasConsent = existing.marketing_consent !== null
          const newHasConsent = c.marketing_consent !== null
          const existingHasName = !!(existing.denominazione || existing.nome || existing.cognome)
          const newHasName = !!(c.denominazione || c.nome || c.cognome)

          if ((!existingHasConsent && newHasConsent) || (!existingHasName && newHasName)) {
            emailMap.set(key, c)
          }
        }
      }

      setCustomers(Array.from(emailMap.values()))
    } catch (err: any) {
      console.error('Failed to load customers:', err)
      toast.error('Errore caricamento clienti')
    } finally {
      setLoading(false)
    }
  }

  const filtered = customers.filter(c => {
    // Filter by consent status
    if (filter === 'yes' && c.marketing_consent !== true) return false
    if (filter === 'no' && c.marketing_consent !== false) return false
    if (filter === 'unknown' && c.marketing_consent !== null) return false

    // Search
    if (search.length >= 2) {
      const q = search.toLowerCase()
      const name = (c.denominazione || [c.nome, c.cognome].filter(Boolean).join(' ')).toLowerCase()
      const email = (c.email || '').toLowerCase()
      if (!name.includes(q) && !email.includes(q)) return false
    }

    return true
  })

  const counts = {
    all: customers.length,
    yes: customers.filter(c => c.marketing_consent === true).length,
    no: customers.filter(c => c.marketing_consent === false).length,
    unknown: customers.filter(c => c.marketing_consent === null).length,
  }

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-theme-text-primary">Marketing Consent</h2>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button onClick={() => setFilter('all')} className={`rounded-lg p-4 border text-center transition-colors ${filter === 'all' ? 'bg-dr7-gold/20 border-dr7-gold' : 'bg-theme-bg-secondary border-theme-border hover:border-theme-text-muted'}`}>
          <p className="text-2xl font-bold text-theme-text-primary">{counts.all}</p>
          <p className="text-sm text-theme-text-muted">Totale</p>
        </button>
        <button onClick={() => setFilter('yes')} className={`rounded-lg p-4 border text-center transition-colors ${filter === 'yes' ? 'bg-dr7-gold/20 border-dr7-gold' : 'bg-theme-bg-secondary border-theme-border hover:border-theme-text-muted'}`}>
          <p className="text-2xl font-bold text-theme-text-primary">{counts.yes}</p>
          <p className="text-sm text-theme-text-muted">Consenso</p>
        </button>
        <button onClick={() => setFilter('no')} className={`rounded-lg p-4 border text-center transition-colors ${filter === 'no' ? 'bg-dr7-gold/20 border-dr7-gold' : 'bg-theme-bg-secondary border-theme-border hover:border-theme-text-muted'}`}>
          <p className="text-2xl font-bold text-theme-text-primary">{counts.no}</p>
          <p className="text-sm text-theme-text-muted">Rifiutato</p>
        </button>
        <button onClick={() => setFilter('unknown')} className={`rounded-lg p-4 border text-center transition-colors ${filter === 'unknown' ? 'bg-dr7-gold/20 border-dr7-gold' : 'bg-theme-bg-secondary border-theme-border hover:border-theme-text-muted'}`}>
          <p className="text-2xl font-bold text-theme-text-primary">{counts.unknown}</p>
          <p className="text-sm text-theme-text-muted">Non risposto</p>
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Cerca per nome o email..."
        className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
      />

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-theme-border text-theme-text-muted text-left">
              <th className="py-3 px-4">Cliente</th>
              <th className="py-3 px-4">Email</th>
              <th className="py-3 px-4">Telefono</th>
              <th className="py-3 px-4 text-center">Consenso</th>
              <th className="py-3 px-4">Data</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-theme-text-muted">Nessun cliente trovato</td>
              </tr>
            ) : (
              filtered.map((c) => {
                const name = c.denominazione || [c.nome, c.cognome].filter(Boolean).join(' ') || 'N/A'
                return (
                  <tr key={c.id} className="border-b border-theme-border/30 hover:bg-theme-bg-hover/50">
                    <td className="py-3 px-4 font-semibold text-theme-text-primary">{name}</td>
                    <td className="py-3 px-4 text-theme-text-secondary">{c.email || '-'}</td>
                    <td className="py-3 px-4 text-theme-text-secondary">{c.telefono || '-'}</td>
                    <td className="py-3 px-4 text-center">
                      {c.marketing_consent === true && (
                        <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-dr7-gold/20 text-dr7-gold">Si</span>
                      )}
                      {c.marketing_consent === false && (
                        <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-theme-bg-tertiary text-theme-text-muted">No</span>
                      )}
                      {c.marketing_consent === null && (
                        <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-theme-bg-tertiary text-theme-text-muted">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-theme-text-muted">
                      {c.marketing_consent_date
                        ? new Date(c.marketing_consent_date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
                        : '-'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-theme-text-muted">
        Mostrando {filtered.length} di {customers.length} clienti
      </p>
    </div>
  )
}
