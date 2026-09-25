import { useState, useEffect, useRef } from 'react'
import { ScheletroPagina } from '../../../components/Scheletro'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { logAdminAction } from '../../../utils/logAdminAction'
import NumeroTelefono from '../../../components/NumeroTelefono'
import TelefonoConPrefisso from '../../../components/TelefonoConPrefisso'
import TrusteraExportPdf from './TrusteraExportPdf'
import { authFetch } from '../../../utils/authFetch'
import MissingFieldsModal from '../../../components/MissingFieldsModal'
import { scaricaAuditTrailPdf } from '../../../utils/scaricaAuditTrailPdf'
import { apriAuditFirma } from '../../../utils/apriAuditFirma'
import PulsanteSicurezzaFirma from './SicurezzaFirma'

type SubTab = 'documenti' | 'marketing'

interface SignatureRequest {
  id: string
  contract_id: string | null
  booking_id: string | null
  signer_name: string
  signer_email: string
  signer_phone: string | null
  status: string
  document_name: string | null
  document_url: string | null
  signed_pdf_url: string | null
  signed_at: string | null
  created_at: string
  token_expires_at: string
  sent_by_name?: string | null
  sent_by_email?: string | null
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

  // 2026-05-25: supporto multi-firmatari. Lista di {name, email, phone}.
  // Il backend document-sign-init accetta un firmatario per chiamata,
  // quindi handleSend cicla l'array. Almeno un firmatario richiesto.
  interface Signer { name: string; email: string; phone: string }
  const [formData, setFormData] = useState<{
    documentName: string
    signers: Signer[]
  }>({
    documentName: '',
    signers: [{ name: '', email: '', phone: '' }],
  })
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)

  // Customer search
  const [customerSearch, setCustomerSearch] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        .select('id, contract_id, booking_id, signer_name, signer_email, signer_phone, status, document_name, document_url, signed_pdf_url, signed_at, created_at, token_expires_at')
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) throw error
      const reqs = (data || []) as SignatureRequest[]

      // Look up sender (admin) for each request via admin_activity_log
      if (reqs.length > 0) {
        const ids = reqs.map(r => r.id)
        const { data: logs } = await supabase
          .from('admin_activity_log')
          .select('entity_id, admin_name, admin_email')
          .eq('action', 'send_trustera_document')
          .in('entity_id', ids)

        const senderMap = new Map<string, { name: string | null; email: string | null }>()
        logs?.forEach(l => {
          senderMap.set(l.entity_id, { name: l.admin_name, email: l.admin_email })
        })
        for (const r of reqs) {
          const sender = senderMap.get(r.id)
          if (sender) {
            r.sent_by_name = sender.name
            r.sent_by_email = sender.email
          }
        }
      }

      setRequests(reqs)
    } catch (err: unknown) {
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

  // ── Per-signer customer picker (2026-05-27) ───────────────────────────
  // Picker dedicato per OGNI firmatario: l'admin clicca l'icona 👤 dentro
  // l'input Nome del firmatario X, cerca, e il cliente scelto va in QUELLO
  // specifico slot (non rimpiazza il primo vuoto come fa selectCustomer
  // della search generica in alto).
  const [pickerOpenIdx, setPickerOpenIdx] = useState<number | null>(null)
  const [pickerSearch, setPickerSearch] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pickerResults, setPickerResults] = useState<any[]>([])

  async function searchForPicker(query: string) {
    setPickerSearch(query)
    if (query.length < 2) { setPickerResults([]); return }
    const { data } = await supabase
      .from('customers_extended')
      .select('id, nome, cognome, email, telefono, denominazione')
      .or(`nome.ilike.%${query}%,cognome.ilike.%${query}%,denominazione.ilike.%${query}%,email.ilike.%${query}%`)
      .limit(10)
    setPickerResults(data || [])
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function pickCustomerForSigner(idx: number, customer: any) {
    const name = customer.denominazione || [customer.nome, customer.cognome].filter(Boolean).join(' ')
    setFormData(prev => ({
      ...prev,
      signers: prev.signers.map((s, i) => i === idx
        ? { name, email: customer.email || '', phone: customer.telefono || '' }
        : s),
    }))
    setPickerOpenIdx(null)
    setPickerSearch('')
    setPickerResults([])
  }
  // 2026-05-27: picker pronto ma JSX consumer non ancora collegato.
  // Void refs per evitare TS6133 finche' non viene wired.
  void pickerOpenIdx; void pickerSearch; void pickerResults
  void searchForPicker; void pickCustomerForSigner

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function selectCustomer(customer: any) {
    const name = customer.denominazione || [customer.nome, customer.cognome].filter(Boolean).join(' ')
    const newSigner: Signer = { name, email: customer.email || '', phone: customer.telefono || '' }
    setFormData(prev => {
      // Se il primo firmatario e' vuoto lo riempi, altrimenti aggiungi in coda.
      // Cosi' il primo click su un cliente popola lo slot 1, click successivi
      // aggiungono firmatari 2, 3, ecc.
      const first = prev.signers[0]
      const firstEmpty = !first || (!first.name && !first.email && !first.phone)
      const nextSigners = firstEmpty
        ? [newSigner, ...prev.signers.slice(1)]
        : [...prev.signers, newSigner]
      return { ...prev, signers: nextSigners }
    })
    setCustomerSearch('')
    setShowCustomerDropdown(false)
  }

  function updateSigner(idx: number, patch: Partial<Signer>) {
    setFormData(prev => ({
      ...prev,
      signers: prev.signers.map((s, i) => i === idx ? { ...s, ...patch } : s),
    }))
  }
  function addSigner() {
    setFormData(prev => ({ ...prev, signers: [...prev.signers, { name: '', email: '', phone: '' }] }))
  }
  function removeSigner(idx: number) {
    setFormData(prev => ({
      ...prev,
      signers: prev.signers.length <= 1 ? prev.signers : prev.signers.filter((_, i) => i !== idx),
    }))
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
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      console.error('Upload error:', err)
      toast.error('Errore caricamento: ' + _errMsg)
    } finally {
      setUploading(false)
    }
  }

  async function handleSend() {
    if (!uploadedUrl) {
      toast.error('Carica un documento PDF prima')
      return
    }
    // Filtra firmatari completi (tutti e 3 i campi). Almeno uno richiesto.
    const validSigners = formData.signers.filter(s => s.name.trim() && s.email.trim() && s.phone.trim())
    if (validSigners.length === 0) {
      toast.error('Compila almeno un firmatario completo (nome, email, telefono)')
      return
    }
    if (validSigners.length < formData.signers.length) {
      const incomplete = formData.signers.length - validSigners.length
      const ok = confirm(`${incomplete} firmatari incompleti verranno ignorati. Procedere con ${validSigners.length}?`)
      if (!ok) return
    }

    setSending(true)
    let successCount = 0
    let failCount = 0
    const errors: string[] = []
    try {
      // Cicla un firmatario alla volta — il backend gestisce 1 per chiamata.
      for (let i = 0; i < validSigners.length; i++) {
        const s = validSigners[i]
        try {
          const res = await fetch('/.netlify/functions/document-sign-init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              documentUrl: uploadedUrl,
              documentName: formData.documentName || 'Documento',
              signerName: s.name,
              signerEmail: s.email,
              signerPhone: s.phone,
            })
          })
          const data = await res.json()
          if (res.ok) {
            successCount++
            logAdminAction('send_trustera_document', 'signature', data.requestId, {
              document: formData.documentName,
              signer: s.name,
              email: s.email,
              phone: s.phone,
              of_total: validSigners.length,
            }).catch(() => { /* non-blocking */ })
          } else {
            failCount++
            errors.push(`${s.name}: ${data.error || 'errore sconosciuto'}`)
          }
        } catch (err) {
          failCount++
          errors.push(`${s.name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      if (successCount > 0 && failCount === 0) {
        toast.success(`${successCount} link di firma inviati via WhatsApp`)
        setShowUpload(false)
        resetForm()
        loadRequests()
      } else if (successCount > 0 && failCount > 0) {
        toast.error(`${successCount} inviati, ${failCount} falliti:\n${errors.join('\n')}`, { duration: 12000 })
        loadRequests()
      } else {
        toast.error(`Invio fallito:\n${errors.join('\n')}`, { duration: 12000 })
      }
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      console.error('Send error:', err)
      toast.error('Errore: ' + _errMsg)
    } finally {
      setSending(false)
    }
  }

  function resetForm() {
    setFormData({ documentName: '', signers: [{ name: '', email: '', phone: '' }] })
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
      {
        const req = requests.find(r => r.id === id)
        logAdminAction('delete_trustera_document', 'signature', id, {
          document: req?.document_name,
          signer: req?.signer_name,
          status: req?.status,
        })
      }
      loadRequests()
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      toast.error('Errore eliminazione: ' + _errMsg)
    }
  }

  // 25/09/2026: stessi pulsanti della tab Contratti (PDF, Email, Firmato,
  // Reinvia, Audit Trail, Rigenera, Modifica, Elimina) su ogni riga.
  const [sendingId, setSendingId] = useState<string | null>(null)

  /**
   * Reinvio del link di firma. Contratto: stessa chiamata del pulsante della
   * tab Contratti (signature-init). Documento libero: nuova richiesta con lo
   * stesso PDF e lo stesso firmatario (document-sign-init).
   */
  async function handleResend(req: SignatureRequest) {
    setSendingId(req.id)
    try {
      if (req.contract_id || req.booking_id) {
        const res = await fetch('/.netlify/functions/signature-init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contractId: req.contract_id, bookingId: req.booking_id }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Errore nell\'invio')
        toast.success(data.message || `Link di firma inviato via WhatsApp a ${req.signer_phone || req.signer_name}`)
      } else {
        if (!req.document_url) throw new Error('Il documento non ha un PDF')
        if (!req.signer_phone) throw new Error('Telefono del firmatario mancante: usa Modifica')
        const res = await fetch('/.netlify/functions/document-sign-init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentUrl: req.document_url,
            documentName: req.document_name || 'Documento',
            signerName: req.signer_name,
            signerEmail: req.signer_email,
            signerPhone: req.signer_phone,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Errore nell\'invio')
        logAdminAction('send_trustera_document', 'signature', data.requestId, {
          document: req.document_name,
          signer: req.signer_name,
          email: req.signer_email,
          phone: req.signer_phone,
          resend_of: req.id,
        }).catch(() => { /* non-blocking */ })
        toast.success(`Link di firma inviato via WhatsApp a ${req.signer_phone}`)
      }
      loadRequests()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSendingId(null)
    }
  }

  // Scarica Contratto: salva il file sul computer (non lo apre in una scheda).
  // Se il documento e' firmato scarica la versione firmata.
  async function handleScaricaPdf(req: SignatureRequest) {
    const url = req.signed_pdf_url || req.document_url
    if (!url) return
    const base = (req.contract?.contract_number || req.document_name || 'documento').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_')
    const nome = `${base}${req.signed_pdf_url ? '_firmato' : ''}.pdf`
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(res.statusText)
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = nome
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
    } catch {
      // Download bloccato (CORS o rete): si apre il PDF, da salvare a mano.
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  async function handleScaricaAuditTrail(req: SignatureRequest) {
    const base = (req.contract?.contract_number || req.document_name || 'documento').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_')
    try {
      toast.loading('Preparazione audit trail...', { id: 'audit-pdf' })
      await scaricaAuditTrailPdf({ requestId: req.id }, `${base}_audit_trail.pdf`)
      toast.dismiss('audit-pdf')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err), { id: 'audit-pdf' })
    }
  }

  function handleViewAuditTrail(req: SignatureRequest) {
    apriAuditFirma(req.contract_id ? { contractId: req.contract_id } : { requestId: req.id })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
  }

  // Scheda cliente incompleta: stesso popup della tab Contratti.
  const [datiMancanti, setDatiMancanti] = useState<{ bookingId: string; campi: string[]; cliente: Record<string, unknown> } | null>(null)

  async function apriDatiMancanti(bookingId: string, campi: string[], customerId?: string | null) {
    let cliente: Record<string, unknown> = customerId ? { id: customerId } : {}
    if (customerId) {
      try {
        const resp = await authFetch(`/.netlify/functions/get-customer?id=${customerId}`)
        if (resp.ok) cliente = (await resp.json()).customer || cliente
      } catch { /* si apre lo stesso con il solo id */ }
    }
    setDatiMancanti({ bookingId, campi, cliente })
  }

  async function rigeneraContratto(bookingId: string, ignoraDatiMancanti = false) {
    try {
      toast.loading('Rigenerazione contratto...', { id: 'regen' })
      const res = await authFetch('/.netlify/functions/generate-contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, ...(ignoraDatiMancanti ? {} : { verificaDati: true }) }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 422 && Array.isArray(data.datiMancanti)) {
        toast.dismiss('regen')
        await apriDatiMancanti(bookingId, data.datiMancanti, data.customerId)
        return
      }
      if (!res.ok) throw new Error(data.error || data.message || res.statusText)
      toast.success('Contratto rigenerato!', { id: 'regen' })
      if (data.url) window.open(data.url, '_blank', 'noopener,noreferrer')
      loadRequests()
    } catch (err: unknown) {
      toast.error('Errore: ' + (err instanceof Error ? err.message : String(err)), { id: 'regen' })
    }
  }

  // Modifica: nome documento e dati del firmatario della richiesta.
  const [editing, setEditing] = useState<{ id: string; documentName: string; name: string; email: string; phone: string } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  async function handleSaveEdit() {
    if (!editing) return
    if (!editing.name.trim()) { toast.error('Il nome del firmatario e\' obbligatorio'); return }
    setSavingEdit(true)
    try {
      const { error } = await supabase
        .from('signature_requests')
        .update({
          document_name: editing.documentName.trim() || null,
          signer_name: editing.name.trim(),
          signer_email: editing.email.trim(),
          signer_phone: editing.phone.trim() || null,
        })
        .eq('id', editing.id)
      if (error) throw error
      toast.success('Richiesta aggiornata')
      setEditing(null)
      loadRequests()
    } catch (err: unknown) {
      toast.error('Errore salvataggio: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSavingEdit(false)
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
      <ScheletroPagina righe={6} colonne={5} />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-theme-text-primary">DR7 Trust - Firma Documenti</h2>
        <button
          onClick={() => { setShowUpload(!showUpload); if (showUpload) resetForm() }}
          className="bg-dr7-gold hover:bg-[#0A8FA3] text-white font-bold py-2 px-4 rounded-full transition-colors"
        >
          {showUpload ? 'Annulla' : '+ Invia Documento'}
        </button>
      </div>

      {/* 22/09/2026: PDF di tutte le righe, stesso formato dei Report. */}
      <TrusteraExportPdf />

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
            {uploading && <p className="text-sm text-theme-text-muted mt-1">Invio in corso…</p>}
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

          {/* Signers — 2026-05-25: lista dinamica multi-firmatari.
              Mobile-friendly: card compatta, label inline col counter,
              bottone "+ Aggiungi" piccolo per non distrarre dal CTA. */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium text-theme-text-secondary">
                Firmatari <span className="text-theme-text-muted text-xs">({formData.signers.length})</span>
              </label>
              <button
                type="button"
                onClick={addSigner}
                title="Aggiungi un altro firmatario"
                className="text-[11px] px-2 py-1 rounded-md border border-theme-border text-theme-text-secondary hover:border-dr7-gold hover:text-dr7-gold transition-colors inline-flex items-center gap-1"
              >
                <span className="text-sm leading-none">+</span> Aggiungi
              </button>
            </div>
            {formData.signers.map((s, idx) => (
              <div key={idx} className="bg-theme-bg-tertiary/30 border border-theme-border rounded-lg p-3 sm:p-2.5">
                {formData.signers.length > 1 && (
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">Firmatario {idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeSigner(idx)}
                      title="Rimuovi firmatario"
                      aria-label="Rimuovi firmatario"
                      className="w-5 h-5 rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-300 text-xs leading-none flex items-center justify-center"
                    >
                      ×
                    </button>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {/* Nome field con picker cliente per-signer (icona 👤 a destra) */}
                  <div className="relative">
                    <input
                      type="text"
                      value={s.name}
                      onChange={(e) => updateSigner(idx, { name: e.target.value })}
                      placeholder="Nome *"
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 pr-9 text-theme-text-primary text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setPickerOpenIdx(pickerOpenIdx === idx ? null : idx)
                        setPickerSearch('')
                        setPickerResults([])
                      }}
                      title="Seleziona da clienti esistenti"
                      aria-label="Seleziona da clienti esistenti"
                      className="absolute inset-y-0 right-1.5 my-auto h-7 w-7 flex items-center justify-center rounded text-theme-text-muted hover:text-dr7-gold hover:bg-theme-bg-hover transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <svg className="w-3 h-3 -ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {pickerOpenIdx === idx && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => { setPickerOpenIdx(null); setPickerSearch(''); setPickerResults([]) }} />
                        <div className="absolute z-30 left-0 right-0 mt-1 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg overflow-hidden">
                          <input
                            type="text"
                            autoFocus
                            value={pickerSearch}
                            onChange={(e) => searchForPicker(e.target.value)}
                            placeholder="Cerca cliente..."
                            className="w-full px-3 py-2 bg-theme-bg-tertiary border-b border-theme-border text-theme-text-primary text-sm focus:outline-none"
                          />
                          <div className="max-h-56 overflow-y-auto">
                            {pickerSearch.length < 2 ? (
                              <div className="px-3 py-3 text-xs text-theme-text-muted">Digita almeno 2 caratteri…</div>
                            ) : pickerResults.length === 0 ? (
                              <div className="px-3 py-3 text-xs text-theme-text-muted">Nessun cliente trovato.</div>
                            ) : (
                              pickerResults.map(c => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => pickCustomerForSigner(idx, c)}
                                  className="w-full text-left px-3 py-2 hover:bg-theme-bg-hover text-theme-text-primary text-sm border-b border-theme-border/30 last:border-0"
                                >
                                  <div className="font-semibold">{c.denominazione || [c.nome, c.cognome].filter(Boolean).join(' ') || c.email}</div>
                                  <div className="text-[11px] text-theme-text-muted">
                                    {c.email || '—'}{c.telefono ? ` · ${c.telefono}` : ''}
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <input
                    type="email"
                    value={s.email}
                    onChange={(e) => updateSigner(idx, { email: e.target.value })}
                    placeholder="Email *"
                    className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm"
                  />
                  <TelefonoConPrefisso
                    value={s.phone}
                    onChange={(v) => updateSigner(idx, { phone: v })}
                    className="flex-1 min-w-0 bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm"
                    selectClassName="w-[104px] shrink-0 bg-theme-bg-tertiary border border-theme-border rounded px-2 py-2 text-theme-text-primary text-sm"
                    mostraAnteprima={false}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={sending || !uploadedUrl}
            className="w-full bg-dr7-gold hover:bg-[#0A8FA3] text-white font-bold py-3 px-4 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                      {req.signer_phone && (
                        <div>
                          <span className="text-theme-text-muted">Telefono:</span>
                          <p className="text-theme-text-primary"><NumeroTelefono valore={req.signer_phone} /></p>
                        </div>
                      )}
                      <div>
                        <span className="text-theme-text-muted">Inviato da:</span>
                        <p className="text-theme-text-primary">
                          {req.sent_by_name || req.sent_by_email || <span className="text-theme-text-muted italic">—</span>}
                        </p>
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
                      <div className="flex gap-2 w-full">
                        <a
                          href={`mailto:${req.signer_email}?subject=${encodeURIComponent(req.document_name || 'Contratto')}&body=Gentile Cliente,%0D%0A%0D%0AEcco il link al tuo documento:%0D%0A${encodeURIComponent(req.signed_pdf_url || req.document_url)}%0D%0A%0D%0AGrazie per aver scelto DR7.`}
                          className="bg-blue-600 hover:bg-blue-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors text-center flex-1 flex items-center justify-center gap-1"
                        >
                          <span>✉️</span> Email
                        </a>
                      </div>
                    )}
                    {(req.signed_pdf_url || req.document_url) && (
                      <button
                        onClick={() => handleScaricaPdf(req)}
                        className="w-full bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1"
                      >
                        {isDocument ? 'Scarica Documento' : 'Scarica Contratto'}
                      </button>
                    )}
                    <button
                      onClick={() => handleScaricaAuditTrail(req)}
                      className="w-full bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1"
                    >
                      Scarica Audit Trail
                    </button>
                    <PulsanteSicurezzaFirma
                      contractId={req.contract_id}
                      requestId={req.contract_id ? null : req.id}
                      titolo={req.document_name || req.signer_name}
                      onGeneraNuovoLink={() => handleResend(req)}
                    />
                    {req.signed_pdf_url ? (
                      <>
                        <button
                          onClick={() => window.open(req.signed_pdf_url!, '_blank')}
                          className="w-full bg-purple-600 hover:bg-purple-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1"
                        >
                          {isDocument ? 'Documento Firmato' : 'Contratto Firmato'}
                        </button>
                        <button
                          onClick={() => handleResend(req)}
                          disabled={sendingId === req.id}
                          className="w-full bg-dr7-gold hover:bg-[#0A8FA3] text-white px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1 font-bold disabled:opacity-50"
                        >
                          {sendingId === req.id ? 'Invio...' : (isDocument ? 'Reinvia Documento' : 'Reinvia Contratto')}
                        </button>
                        <button
                          onClick={() => handleViewAuditTrail(req)}
                          className="w-full bg-gray-600 hover:bg-gray-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1"
                        >
                          Audit Trail
                        </button>
                      </>
                    ) : req.document_url ? (
                      <button
                        onClick={() => handleResend(req)}
                        disabled={sendingId === req.id}
                        className="w-full bg-dr7-gold hover:bg-[#0A8FA3] text-white px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1 font-bold disabled:opacity-50"
                      >
                        {sendingId === req.id ? 'Invio...' : 'Firma via WhatsApp'}
                      </button>
                    ) : null}
                    {req.booking_id && (
                      <button
                        onClick={() => rigeneraContratto(req.booking_id!)}
                        className="w-full bg-orange-600/30 hover:bg-orange-600/50 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex items-center justify-center gap-1"
                      >
                        Rigenera Contratto
                      </button>
                    )}
                    <div className="flex gap-2 w-full">
                      <button
                        onClick={() => setEditing({
                          id: req.id,
                          documentName: req.document_name || '',
                          name: req.signer_name || '',
                          email: req.signer_email || '',
                          phone: req.signer_phone || '',
                        })}
                        className="bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex-1"
                      >
                        Modifica
                      </button>
                      <button
                        onClick={() => handleDelete(req.id)}
                        className="bg-red-600 hover:bg-red-700 text-theme-text-primary px-3 py-1 rounded-full text-sm transition-colors flex-1"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Modifica richiesta di firma */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !savingEdit && setEditing(null)}>
          <div className="w-full max-w-lg bg-theme-bg-secondary rounded-lg border border-theme-border p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-theme-text-primary">Modifica Richiesta di Firma</h3>
              <button onClick={() => setEditing(null)} className="text-theme-text-muted hover:text-theme-text-primary">✕ Chiudi</button>
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">Nome Documento</label>
              <input
                type="text"
                value={editing.documentName}
                onChange={(e) => setEditing({ ...editing, documentName: e.target.value })}
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">Firmatario *</label>
              <input
                type="text"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">Email</label>
              <input
                type="email"
                value={editing.email}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                className="w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-text-secondary mb-2">Telefono</label>
              <TelefonoConPrefisso
                value={editing.phone}
                onChange={(v) => setEditing({ ...editing, phone: v })}
                className="flex-1 min-w-0 bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary"
                selectClassName="w-[104px] shrink-0 bg-theme-bg-tertiary border border-theme-border rounded px-2 py-2 text-theme-text-primary"
                mostraAnteprima={false}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSaveEdit}
                disabled={savingEdit}
                className="flex-1 bg-dr7-gold hover:bg-[#0A8FA3] text-white font-bold py-3 px-4 rounded-full transition-colors disabled:opacity-50"
              >
                {savingEdit ? 'Salvataggio...' : 'Salva'}
              </button>
              <button
                onClick={() => setEditing(null)}
                className="px-6 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary font-bold py-3 rounded-full transition-colors"
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scheda cliente incompleta: si completa qui e il contratto riparte. */}
      {datiMancanti && (datiMancanti.cliente.id as string | undefined) && (
        <MissingFieldsModal
          isOpen
          customerId={datiMancanti.cliente.id as string}
          customerData={datiMancanti.cliente}
          missingFields={datiMancanti.campi}
          contesto="contratto"
          onClose={() => setDatiMancanti(null)}
          onProsegui={() => {
            const b = datiMancanti.bookingId
            setDatiMancanti(null)
            rigeneraContratto(b, true)
          }}
          onSave={() => {
            const b = datiMancanti.bookingId
            setDatiMancanti(null)
            rigeneraContratto(b)
          }}
        />
      )}
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
    } catch (err: unknown) {
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
      <ScheletroPagina righe={6} colonne={5} />
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
                    <td className="py-3 px-4 text-theme-text-secondary"><NumeroTelefono valore={c.telefono} vuoto="-" /></td>
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
