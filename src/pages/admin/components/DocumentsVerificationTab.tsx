import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'
import { logger } from '../../../utils/logger'
import { authFetch } from '../../../utils/authFetch'

interface UserDocument {
  id: string
  user_id: string
  document_type: string
  file_path: string
  upload_date: string
  status: 'pending_verification' | 'verified' | 'rejected'
  verified_at?: string
  verified_by?: string
  rejection_reason?: string
  user?: {
    id: string
    full_name: string
    email: string
    telefono?: string
    sesso?: string
    codice_fiscale?: string
    data_nascita?: string
    luogo_nascita?: string
    indirizzo?: string
    numero_civico?: string
    citta_residenza?: string
    provincia?: string
    cap?: string
    nazione?: string
    numero_patente?: string
    categoria_patente?: string
    ente_rilascio?: string
    data_rilascio?: string
    data_scadenza?: string
    ragione_sociale?: string
    denominazione?: string
    partita_iva?: string
    codice_destinatario?: string
    pec?: string
    codice_ipa?: string
    codice_univoco?: string
    rappresentante_legale?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: any
    tipo_cliente?: string
    source?: string
    updated_at?: string
  }
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|avif)$/i
const PDF_EXT   = /\.pdf$/i

export default function DocumentsVerificationTab() {
  const [documents, setDocuments] = useState<UserDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending_verification' | 'verified' | 'rejected'>('all')
  const [selectedDoc, setSelectedDoc] = useState<UserDocument | null>(null)
  const [showDocModal, setShowDocModal] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  useEffect(() => {
    loadDocuments()

    // Real-time subscription
    const subscription = supabase
      .channel('documents-verification-updates')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'user_documents' },
        () => loadDocuments()
      )
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Fetch signed URLs for previews — one batch call per user
  useEffect(() => {
    if (documents.length === 0) return

    const userIds = Array.from(new Set(documents.map(d => d.user_id)))
    let cancelled = false

    ;(async () => {
      const next: Record<string, string> = {}
      await Promise.all(userIds.map(async (uid) => {
        try {
          const res = await authFetch('/.netlify/functions/get-customer-documents', {
            method: 'POST',
            body: JSON.stringify({ userId: uid }),
            headers: { 'Content-Type': 'application/json' }
          })
          if (!res.ok) return
          const json = await res.json()
          if (!json?.success) return
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const flat: any[] = [
            ...(json.documents.licenses || []),
            ...(json.documents.ids || []),
            ...(json.documents.codiceFiscale || []),
          ]
          // Map fileName -> url
          const byName = new Map<string, string>()
          flat.forEach(f => { if (f.fileName && f.url) byName.set(f.fileName, f.url) })
          // Match docs of this user to URLs by file_path basename
          documents
            .filter(d => d.user_id === uid)
            .forEach(d => {
              const base = d.file_path.split('/').pop() || ''
              const url = byName.get(base)
              if (url) next[d.id] = url
            })
        } catch (e) {
          logger.log('[DocumentsVerificationTab] preview fetch failed:', e)
        }
      }))
      if (!cancelled) setPreviewUrls(prev => ({ ...prev, ...next }))
    })()

    return () => { cancelled = true }
  }, [documents])

  async function loadDocuments() {
    setLoading(true)
    try {
      logger.log('[DocumentsVerificationTab] Loading documents via Netlify function...')

      let useClientFallback = false

      try {
        const response = await fetch('/.netlify/functions/get-verification-requests')

        if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
          const result = await response.json()

          if (result.success && result.documents) {
            logger.log('[DocumentsVerificationTab] Documents loaded via Netlify function:', result.documents.length)
            setDocuments(result.documents)
            return
          }
        }

        // If we get here, Netlify function didn't return valid data
        useClientFallback = true
      } catch (fetchError) {
        // Netlify function not available or returned invalid response
        logger.log('[DocumentsVerificationTab] Netlify function error:', fetchError)
        useClientFallback = true
      }

      if (!useClientFallback) {
        setDocuments([])
        return
      }

      // Fallback: Netlify function not available (e.g., running with npm run dev)
      // Fetch data directly from Supabase
      logger.log('[DocumentsVerificationTab] Using client-side fallback...')

      // 1. Fetch all documents
      const { data: docs, error: docsError } = await supabase
        .from('user_documents')
        .select('*')
        .order('upload_date', { ascending: false })

      if (docsError) throw docsError

      if (!docs || docs.length === 0) {
        logger.log('[DocumentsVerificationTab] No documents found')
        setDocuments([])
        return
      }

      // 2. Fetch user details for all unique user_ids
      const userIds = Array.from(new Set(docs.map(d => d.user_id)))

      const { data: users, error: usersError } = await supabase
        .from('customers_extended')
        .select(`
          id,
          user_id,
          tipo_cliente,
          nome,
          cognome,
          email,
          telefono,
          codice_fiscale,
          patente,
          indirizzo,
          nazione,
          ragione_sociale,
          partita_iva,
          codice_destinatario,
          pec,
          denominazione,
          codice_ipa,
          codice_univoco,
          source,
          created_at,
          updated_at
        `)
        .in('user_id', userIds)

      if (usersError) console.error('Error fetching users:', usersError)

      const userMap = new Map()
      if (users) {
        users.forEach(u => userMap.set(u.user_id, u))
      }

      // 3. Merge data
      const enrichedDocuments = docs.map(doc => {
        const user = userMap.get(doc.user_id)

        // Determine the best display name
        let fullName = 'Utente sconosciuto'
        if (user) {
          if (user.nome || user.cognome) {
            fullName = `${user.nome || ''} ${user.cognome || ''}`.trim()
          } else if (user.email) {
            fullName = user.email.split('@')[0]
          }
        }

        return {
          ...doc,
          user: {
            id: doc.user_id,
            full_name: fullName,
            email: user?.email || 'Email non disponibile',
            telefono: user?.telefono,
            codice_fiscale: user?.codice_fiscale,
            patente: user?.patente,
            indirizzo: user?.indirizzo,
            nazione: user?.nazione,
            ragione_sociale: user?.ragione_sociale,
            denominazione: user?.denominazione,
            partita_iva: user?.partita_iva,
            codice_destinatario: user?.codice_destinatario,
            pec: user?.pec,
            codice_ipa: user?.codice_ipa,
            codice_univoco: user?.codice_univoco,
            tipo_cliente: user?.tipo_cliente,
            source: user?.source,
            is_new: user?.created_at ? (new Date().getTime() - new Date(user.created_at).getTime()) < (7 * 24 * 60 * 60 * 1000) : false,
            created_at: user?.created_at || doc.upload_date,
            updated_at: user?.updated_at
          }
        }
      })

      logger.log('[DocumentsVerificationTab] Documents loaded via client-side fallback:', enrichedDocuments.length)
      setDocuments(enrichedDocuments)

    } catch (error) {
      console.error('Failed to load documents:', error)
      setDocuments([])
    } finally {
      setLoading(false)
    }
  }

  async function updateDocumentStatus(documentId: string, status: 'verified' | 'rejected', reason?: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {
        status,
        verified_at: new Date().toISOString(),
        verified_by: user?.id
      }

      if (status === 'rejected' && reason) {
        updateData.rejection_reason = reason
      }

      const { error } = await supabase
        .from('user_documents')
        .update(updateData)
        .eq('id', documentId)

      if (error) throw error

      toast.success(`Documento ${status === 'verified' ? 'verificato' : 'rifiutato'} con successo!`)
      setShowDocModal(false)
      setSelectedDoc(null)
      setRejectionReason('')
      loadDocuments()
    } catch (error) {
      console.error('Failed to update document status:', error)
      toast.error('Errore nell\'aggiornamento dello stato del documento')
    }
  }

  async function viewDocument(doc: UserDocument) {
    try {
      // Use secure server-side function to bypass RLS
      const response = await authFetch('/.netlify/functions/get-customer-documents', {
        method: 'POST',
        body: JSON.stringify({ userId: doc.user_id }),
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) throw new Error('Failed to fetch secure URLs')

      const result = await response.json()

      if (result.success && result.documents) {
        // Flatten all docs to find the one we need
        const allDocs = [
          ...result.documents.licenses,
          ...result.documents.ids,
          ...result.documents.codiceFiscale
        ]

        const targetFileName = doc.file_path.split('/').pop()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const match = allDocs.find((d: any) => d.fileName === targetFileName)

        if (match?.url) {
          window.open(match.url, '_blank')
        } else {
          // Fallback: try to find by fuzzy match if exact match fails
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fuzzyMatch = allDocs.find((d: any) =>
            doc.file_path.includes(d.fileName) || d.fileName.includes(targetFileName || '___')
          )

          if (fuzzyMatch?.url) {
            window.open(fuzzyMatch.url, '_blank')
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            console.error('Document mismatch. Targets:', targetFileName, 'Found:', allDocs.map((d: any) => d.fileName))
            toast.error('Impossibile recuperare il file sicuro. Riprova')
          }
        }
      }
    } catch (error) {
      console.error('Failed to get document URL:', error)
      toast.error('Errore nel caricamento del documento')
    }
  }

  const getDocumentLabel = (docType: string) => {
    const labels: { [key: string]: string } = {
      cartaIdentitaFront: 'CI Fronte',
      cartaIdentitaBack: 'CI Retro',
      codiceFiscaleFront: 'CF Fronte',
      codiceFiscaleBack: 'CF Retro',
      patenteFront: 'Patente Fronte',
      patenteBack: 'Patente Retro',
      libretto_front: 'Libretto Fronte',
      libretto_back: 'Libretto Retro'
    }
    return labels[docType] || docType
  }

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { text: string; color: string }> = {
      pending_verification: { text: 'In attesa', color: 'bg-yellow-500/15 text-yellow-500' },
      verified:             { text: 'Verificato', color: 'bg-green-500/15 text-green-500' },
      rejected:             { text: 'Rifiutato', color: 'bg-red-500/15 text-red-500' },
    }
    const config = statusConfig[status] || { text: status, color: 'bg-theme-bg-tertiary text-theme-text-muted' }
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${config.color}`}>
        {config.text}
      </span>
    )
  }

  const filteredDocuments = filterStatus === 'all'
    ? documents
    : documents.filter(d => d.status === filterStatus)

  // Group documents by user
  const documentsByUser = filteredDocuments.reduce((acc, doc) => {
    const userId = doc.user_id
    if (!acc[userId]) {
      acc[userId] = []
    }
    acc[userId].push(doc)
    return acc
  }, {} as { [key: string]: UserDocument[] })

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
        <p className="text-theme-text-primary">Caricamento documenti...</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-theme-bg-secondary border border-theme-border rounded-3xl p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-theme-text-primary tracking-tight">Verifica Documenti</h2>
        <p className="text-sm text-theme-text-muted mt-0.5">
          Anteprima, accetta o rifiuta i documenti caricati dai clienti
        </p>
      </div>

      {/* Summary + Filter (segmented control style) */}
      <div className="bg-theme-bg-secondary border border-theme-border rounded-2xl p-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-1">
          {([
            { key: 'all',                  label: 'Tutti',         count: documents.length, color: 'text-theme-text-primary' },
            { key: 'pending_verification', label: 'Da Verificare', count: documents.filter(d => d.status === 'pending_verification').length, color: 'text-yellow-500' },
            { key: 'verified',             label: 'Verificati',    count: documents.filter(d => d.status === 'verified').length, color: 'text-green-500' },
            { key: 'rejected',             label: 'Rifiutati',     count: documents.filter(d => d.status === 'rejected').length, color: 'text-red-500' },
          ] as const).map(item => {
            const active = filterStatus === item.key
            return (
              <button
                key={item.key}
                onClick={() => setFilterStatus(item.key as typeof filterStatus)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? 'bg-theme-bg-primary text-theme-text-primary shadow-sm'
                    : 'text-theme-text-muted hover:bg-theme-bg-tertiary/50'
                }`}
              >
                <span>{item.label}</span>
                <span className={`text-xs font-semibold ${active ? item.color : 'text-theme-text-muted'}`}>
                  {item.count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Documents by User — Apple-style cards */}
      <div className="space-y-4">
        {Object.entries(documentsByUser).map(([userId, userDocs]) => {
          const user = userDocs[0].user
          const pendingCount = userDocs.filter(d => d.status === 'pending_verification').length
          const initials = (user?.full_name || user?.email || '?')
            .split(/\s+|@/)
            .filter(Boolean)
            .slice(0, 2)
            .map(s => s[0]?.toUpperCase() || '')
            .join('') || '?'
          return (
            <div key={userId} className="bg-theme-bg-secondary border border-theme-border rounded-3xl p-5 shadow-sm">
              {/* Customer header */}
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-dr7-gold to-amber-400 text-theme-bg-primary flex items-center justify-center text-sm font-bold shadow-sm shrink-0">
                    {initials}
                  </div>
                  <div className="leading-tight">
                    <div className="text-base font-semibold text-theme-text-primary tracking-tight">
                      {user?.full_name || user?.email?.split('@')[0] || 'Sconosciuto'}
                    </div>
                    <div className="text-xs text-theme-text-muted flex items-center gap-2 flex-wrap">
                      {user?.email && <span>{user.email}</span>}
                      {user?.telefono && <span>· {user.telefono}</span>}
                    </div>
                  </div>
                </div>
                {pendingCount > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-yellow-500/15 text-yellow-500 text-xs font-semibold">
                    {pendingCount} da verificare
                  </span>
                )}
              </div>

              {/* Photo grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {userDocs.map((doc) => {
                  const isPending = doc.status === 'pending_verification'
                  const accent =
                    doc.status === 'verified' ? 'ring-green-500/40' :
                    doc.status === 'rejected' ? 'ring-red-500/40' :
                    'ring-transparent'
                  const url = previewUrls[doc.id]
                  const isImage = IMAGE_EXT.test(doc.file_path)
                  const isPdf   = PDF_EXT.test(doc.file_path)
                  return (
                    <div key={doc.id} className={`group bg-theme-bg-primary/60 border border-theme-border rounded-2xl overflow-hidden ring-2 ${accent} shadow-sm hover:shadow-md transition-all`}>
                      {/* Thumbnail */}
                      <button
                        onClick={() => url ? setLightboxUrl(url) : viewDocument(doc)}
                        className="relative aspect-[4/3] w-full bg-theme-bg-tertiary/30 flex items-center justify-center overflow-hidden"
                        title="Anteprima"
                      >
                        {url && isImage ? (
                          <img
                            src={url}
                            alt={getDocumentLabel(doc.document_type)}
                            loading="lazy"
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          />
                        ) : url && isPdf ? (
                          <object data={url + '#view=Fit&toolbar=0&navpanes=0&scrollbar=0'} type="application/pdf" className="w-full h-full pointer-events-none">
                            <div className="flex flex-col items-center justify-center w-full h-full text-theme-text-muted">
                              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              <span className="mt-1 text-[10px] uppercase tracking-wider font-semibold">PDF</span>
                            </div>
                          </object>
                        ) : (
                          <div className="flex flex-col items-center justify-center text-theme-text-muted">
                            <div className="w-10 h-10 rounded-2xl bg-theme-bg-tertiary flex items-center justify-center mb-1">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            </div>
                            <span className="text-[10px] font-medium">Anteprima</span>
                          </div>
                        )}
                        {/* Bottom gradient label */}
                        <div className="absolute inset-x-0 bottom-0 px-3 py-2 bg-gradient-to-t from-black/75 via-black/20 to-transparent">
                          <div className="text-[12px] font-semibold text-white tracking-tight">{getDocumentLabel(doc.document_type)}</div>
                        </div>
                      </button>

                      {/* Footer */}
                      <div className="px-3 py-2.5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-theme-text-muted">
                            {new Date(doc.upload_date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
                          </span>
                          {getStatusBadge(doc.status)}
                        </div>
                        {doc.rejection_reason && (
                          <p className="text-[10px] text-red-400 bg-red-500/10 px-2 py-1 rounded-lg line-clamp-2" title={doc.rejection_reason}>
                            {doc.rejection_reason}
                          </p>
                        )}
                        {isPending ? (
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              onClick={() => updateDocumentStatus(doc.id, 'verified')}
                              className="px-3 py-1.5 bg-green-500/90 hover:bg-green-500 active:scale-[0.98] text-white rounded-xl text-[12px] font-semibold transition-all shadow-sm"
                              title="Accetta"
                            >
                              Accetta
                            </button>
                            <button
                              onClick={() => { setSelectedDoc(doc); setShowDocModal(true) }}
                              className="px-3 py-1.5 bg-red-500/90 hover:bg-red-500 active:scale-[0.98] text-white rounded-xl text-[12px] font-semibold transition-all shadow-sm"
                              title="Rifiuta"
                            >
                              Rifiuta
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => url ? setLightboxUrl(url) : viewDocument(doc)}
                            className="w-full px-3 py-1.5 bg-theme-bg-tertiary/70 hover:bg-theme-bg-tertiary text-theme-text-primary rounded-xl text-[12px] font-semibold transition-colors"
                          >
                            Apri
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {Object.keys(documentsByUser).length === 0 && (
          <div className="bg-theme-bg-secondary border border-theme-border rounded-3xl p-12 text-center shadow-sm">
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-theme-bg-tertiary flex items-center justify-center text-theme-text-muted">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <p className="text-sm text-theme-text-muted">
              {filterStatus === 'all'
                ? 'Nessun documento caricato'
                : `Nessun documento ${filterStatus === 'pending_verification' ? 'da verificare' : filterStatus === 'verified' ? 'verificato' : 'rifiutato'}`
              }
            </p>
          </div>
        )}
      </div>

      {/* Lightbox preview */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md text-white flex items-center justify-center transition"
            aria-label="Chiudi"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <div className="max-w-5xl max-h-[90vh] w-full h-full flex items-center justify-center" onClick={e => e.stopPropagation()}>
            {PDF_EXT.test(lightboxUrl) ? (
              <iframe src={lightboxUrl} className="w-full h-full rounded-2xl bg-white" title="Anteprima PDF" />
            ) : (
              <img src={lightboxUrl} alt="Anteprima" className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl" />
            )}
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {showDocModal && selectedDoc && selectedDoc.status === 'pending_verification' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-theme-bg-secondary border border-theme-border rounded-3xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-theme-text-primary tracking-tight">Rifiuta documento</h3>
            <p className="text-sm text-theme-text-muted mt-1 mb-4">
              {getDocumentLabel(selectedDoc.document_type)}
            </p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Motivo del rifiuto..."
              className="w-full px-3 py-2.5 bg-theme-bg-tertiary border border-theme-border rounded-xl text-theme-text-primary text-sm placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500/30"
              rows={4}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setShowDocModal(false); setSelectedDoc(null); setRejectionReason('') }}
                className="flex-1 px-4 py-2.5 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-xl text-sm font-semibold transition"
              >
                Annulla
              </button>
              <button
                onClick={() => updateDocumentStatus(selectedDoc.id, 'rejected', rejectionReason)}
                className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition shadow-sm"
                disabled={!rejectionReason.trim()}
              >
                Rifiuta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
