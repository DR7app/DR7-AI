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

export default function DocumentsVerificationTab() {
  const [documents, setDocuments] = useState<UserDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending_verification' | 'verified' | 'rejected'>('all')
  const [selectedDoc, setSelectedDoc] = useState<UserDocument | null>(null)
  const [showDocModal, setShowDocModal] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

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
    const statusConfig = {
      pending_verification: { text: 'Da Verificare', color: 'bg-yellow-600 text-black' },
      verified: { text: 'Verificato', color: 'bg-green-600 text-theme-text-primary' },
      rejected: { text: 'Rifiutato', color: 'bg-red-600 text-theme-text-primary' }
    }
    const config = statusConfig[status as keyof typeof statusConfig] || { text: status, color: 'bg-theme-bg-hover text-theme-text-primary' }
    return (
      <span className={`px-2 py-1 rounded text-xs font-bold ${config.color}`}>
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
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-theme-text-primary">Verifica Documenti Utenti</h2>
            <p className="text-sm text-theme-text-muted mt-1">
              Gestisci e verifica i documenti caricati dagli utenti
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-theme-bg-secondary p-4 rounded-full border border-theme-border">
          <div className="text-sm text-theme-text-muted">Totale Documenti</div>
          <div className="text-2xl font-bold text-theme-text-primary">{documents.length}</div>
        </div>
        <div className="bg-theme-bg-secondary p-4 rounded-full border border-theme-border">
          <div className="text-sm text-theme-text-muted">Da Verificare</div>
          <div className="text-2xl font-bold text-yellow-400">
            {documents.filter(d => d.status === 'pending_verification').length}
          </div>
        </div>
        <div className="bg-theme-bg-secondary p-4 rounded-full border border-theme-border">
          <div className="text-sm text-theme-text-muted">Verificati</div>
          <div className="text-2xl font-bold text-green-400">
            {documents.filter(d => d.status === 'verified').length}
          </div>
        </div>
        <div className="bg-theme-bg-secondary p-4 rounded-full border border-theme-border">
          <div className="text-sm text-theme-text-muted">Rifiutati</div>
          <div className="text-2xl font-bold text-red-400">
            {documents.filter(d => d.status === 'rejected').length}
          </div>
        </div>
      </div>

      {/* Filter Buttons */}
      <div className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border">
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-4 py-2 rounded-full font-medium transition-colors ${filterStatus === 'all'
              ? 'bg-dr7-gold text-theme-bg-primary'
              : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
              }`}
          >
            Tutti ({documents.length})
          </button>
          <button
            onClick={() => setFilterStatus('pending_verification')}
            className={`px-4 py-2 rounded-full font-medium transition-colors ${filterStatus === 'pending_verification'
              ? 'bg-dr7-gold text-theme-bg-primary'
              : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
              }`}
          >
            Da Verificare ({documents.filter(d => d.status === 'pending_verification').length})
          </button>
          <button
            onClick={() => setFilterStatus('verified')}
            className={`px-4 py-2 rounded-full font-medium transition-colors ${filterStatus === 'verified'
              ? 'bg-dr7-gold text-theme-bg-primary'
              : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
              }`}
          >
            Verificati ({documents.filter(d => d.status === 'verified').length})
          </button>
          <button
            onClick={() => setFilterStatus('rejected')}
            className={`px-4 py-2 rounded-full font-medium transition-colors ${filterStatus === 'rejected'
              ? 'bg-dr7-gold text-theme-bg-primary'
              : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
              }`}
          >
            Rifiutati ({documents.filter(d => d.status === 'rejected').length})
          </button>
        </div>
      </div>

      {/* Documents by User — compact card per customer */}
      <div className="space-y-4">
        {Object.entries(documentsByUser).map(([userId, userDocs]) => {
          const user = userDocs[0].user
          const pendingCount = userDocs.filter(d => d.status === 'pending_verification').length
          return (
            <div key={userId} className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4">
              {/* Customer name pill + meta */}
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-3 py-1 bg-dr7-gold text-theme-bg-primary text-sm font-bold rounded border border-dr7-gold">
                    {user?.full_name || user?.email?.split('@')[0] || 'Sconosciuto'}
                  </span>
                  {user?.email && (
                    <span className="text-xs text-theme-text-muted">{user.email}</span>
                  )}
                  {user?.telefono && (
                    <span className="text-xs text-theme-text-muted">· {user.telefono}</span>
                  )}
                </div>
                {pendingCount > 0 && (
                  <span className="text-xs font-semibold text-yellow-400">
                    {pendingCount} da verificare
                  </span>
                )}
              </div>

              {/* Photo grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {userDocs.map((doc) => {
                  const isPending = doc.status === 'pending_verification'
                  const borderColor =
                    doc.status === 'verified' ? 'border-green-600/50' :
                    doc.status === 'rejected' ? 'border-red-600/50' :
                    'border-theme-border'
                  return (
                    <div key={doc.id} className={`bg-theme-bg-tertiary/50 border-2 ${borderColor} rounded-lg overflow-hidden flex flex-col`}>
                      {/* Thumbnail / preview area */}
                      <button
                        onClick={() => viewDocument(doc)}
                        className="aspect-[4/3] bg-theme-bg-primary/40 hover:bg-theme-bg-primary/70 flex items-center justify-center text-theme-text-muted text-xs transition-colors p-2"
                        title="Apri documento"
                      >
                        <span className="text-center">
                          <span className="block text-2xl mb-1">📄</span>
                          <span className="block font-semibold text-theme-text-primary">{getDocumentLabel(doc.document_type)}</span>
                        </span>
                      </button>
                      {/* Footer: status + actions */}
                      <div className="p-2 space-y-1.5">
                        <div className="flex justify-center">{getStatusBadge(doc.status)}</div>
                        {doc.rejection_reason && (
                          <p className="text-[10px] text-red-400 bg-red-900/20 px-1.5 py-1 rounded line-clamp-2" title={doc.rejection_reason}>
                            {doc.rejection_reason}
                          </p>
                        )}
                        {isPending ? (
                          <div className="flex gap-1">
                            <button
                              onClick={() => updateDocumentStatus(doc.id, 'verified')}
                              className="flex-1 px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-[11px] font-bold"
                              title="Accetta"
                            >
                              ACC
                            </button>
                            <button
                              onClick={() => {
                                setSelectedDoc(doc)
                                setShowDocModal(true)
                              }}
                              className="flex-1 px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-[11px] font-bold"
                              title="Rifiuta"
                            >
                              REJ
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => viewDocument(doc)}
                            className="w-full px-2 py-1 bg-theme-bg-hover hover:bg-theme-bg-tertiary text-theme-text-primary rounded text-[11px] font-semibold"
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
          <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-8 text-center">
            <p className="text-theme-text-muted">
              {filterStatus === 'all'
                ? 'Nessun documento caricato'
                : `Nessun documento ${filterStatus === 'pending_verification' ? 'da verificare' : filterStatus === 'verified' ? 'verificato' : 'rifiutato'}`
              }
            </p>
          </div>
        )}
      </div>

      {/* Rejection Modal */}
      {showDocModal && selectedDoc && selectedDoc.status === 'pending_verification' && (
        <div className="fixed inset-0 bg-theme-overlay backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-theme-bg-secondary border border-theme-border rounded-lg max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-theme-text-primary mb-4">Rifiuta Documento</h3>
            <p className="text-theme-text-muted mb-4">
              Stai rifiutando: <strong className="text-theme-text-primary">{getDocumentLabel(selectedDoc.document_type)}</strong>
            </p>
            <div className="mb-4">
              <label className="block text-sm text-theme-text-muted mb-2">Motivo del rifiuto</label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Inserisci il motivo del rifiuto..."
                className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary text-sm"
                rows={4}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowDocModal(false)
                  setSelectedDoc(null)
                  setRejectionReason('')
                }}
                className="flex-1 px-4 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded font-medium transition-colors"
              >
                Annulla
              </button>
              <button
                onClick={() => updateDocumentStatus(selectedDoc.id, 'rejected', rejectionReason)}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-theme-text-primary rounded font-medium transition-colors"
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
