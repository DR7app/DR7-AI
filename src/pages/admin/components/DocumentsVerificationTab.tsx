import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

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
    codice_fiscale?: string
    data_nascita?: string
    luogo_nascita?: string
    indirizzo_residenza?: string
    citta_residenza?: string
    cap_residenza?: string
    provincia_residenza?: string
    tipo_cliente?: string
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
      console.log('[DocumentsVerificationTab] Loading documents via Netlify function...')

      const response = await fetch('/.netlify/functions/get-verification-requests')
      if (!response.ok) throw new Error(`Function failed with status ${response.status}`)

      const result = await response.json()

      if (result.success && result.documents) {
        console.log('[DocumentsVerificationTab] Documents loaded:', result.documents.length)
        setDocuments(result.documents)
      } else {
        console.error('[DocumentsVerificationTab] Error loading documents:', result.error)
        throw new Error(result.error || 'Unknown error')
      }
    } catch (error) {
      console.error('Failed to load documents:', error)
      // Fallback: try client side if function fails (though unlikely)
      // We skip fallback to avoid confusion if RLS is the issue
    } finally {
      setLoading(false)
    }
  }

  async function updateDocumentStatus(documentId: string, status: 'verified' | 'rejected', reason?: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser()

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

      alert(`Documento ${status === 'verified' ? 'verificato' : 'rifiutato'} con successo!`)
      setShowDocModal(false)
      setSelectedDoc(null)
      setRejectionReason('')
      loadDocuments()
    } catch (error) {
      console.error('Failed to update document status:', error)
      alert('Errore nell\'aggiornamento dello stato del documento')
    }
  }

  async function viewDocument(doc: UserDocument) {
    try {
      // Use secure server-side function to bypass RLS
      const response = await fetch('/.netlify/functions/get-customer-documents', {
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
        const match = allDocs.find((d: any) => d.fileName === targetFileName)

        if (match?.url) {
          window.open(match.url, '_blank')
        } else {
          // Fallback: try to find by fuzzy match if exact match fails
          const fuzzyMatch = allDocs.find((d: any) =>
            doc.file_path.includes(d.fileName) || d.fileName.includes(targetFileName || '___')
          )

          if (fuzzyMatch?.url) {
            window.open(fuzzyMatch.url, '_blank')
          } else {
            console.error('Document mismatch. Targets:', targetFileName, 'Found:', allDocs.map((d: any) => d.fileName))
            alert('Impossibile recuperare il file sicuro. Riprova.')
          }
        }
      }
    } catch (error) {
      console.error('Failed to get document URL:', error)
      alert('Errore nel caricamento del documento')
    }
  }

  const getDocumentLabel = (docType: string) => {
    const labels: { [key: string]: string } = {
      cartaIdentitaFront: 'CI Fronte',
      cartaIdentitaBack: 'CI Retro',
      codiceFiscaleFront: 'CF Fronte',
      codiceFiscaleBack: 'CF Retro',
      patenteFront: 'Patente Fronte',
      patenteBack: 'Patente Retro'
    }
    return labels[docType] || docType
  }

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending_verification: { text: 'Da Verificare', color: 'bg-yellow-600 text-black' },
      verified: { text: 'Verificato', color: 'bg-green-600 text-theme-text-primary' },
      rejected: { text: 'Rifiutato', color: 'bg-red-600 text-theme-text-primary' }
    }
    const config = statusConfig[status as keyof typeof statusConfig] || { text: status, color: 'bg-gray-600 text-theme-text-primary' }
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
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
        <div className="bg-theme-bg-secondary p-4 rounded-lg border border-theme-border">
          <div className="text-sm text-theme-text-muted">Totale Documenti</div>
          <div className="text-2xl font-bold text-theme-text-primary">{documents.length}</div>
        </div>
        <div className="bg-theme-bg-secondary p-4 rounded-lg border border-theme-border">
          <div className="text-sm text-theme-text-muted">Da Verificare</div>
          <div className="text-2xl font-bold text-yellow-400">
            {documents.filter(d => d.status === 'pending_verification').length}
          </div>
        </div>
        <div className="bg-theme-bg-secondary p-4 rounded-lg border border-theme-border">
          <div className="text-sm text-theme-text-muted">Verificati</div>
          <div className="text-2xl font-bold text-green-400">
            {documents.filter(d => d.status === 'verified').length}
          </div>
        </div>
        <div className="bg-theme-bg-secondary p-4 rounded-lg border border-theme-border">
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
              ? 'bg-dr7-gold text-black'
              : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
              }`}
          >
            Tutti ({documents.length})
          </button>
          <button
            onClick={() => setFilterStatus('pending_verification')}
            className={`px-4 py-2 rounded-full font-medium transition-colors ${filterStatus === 'pending_verification'
              ? 'bg-dr7-gold text-black'
              : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
              }`}
          >
            Da Verificare ({documents.filter(d => d.status === 'pending_verification').length})
          </button>
          <button
            onClick={() => setFilterStatus('verified')}
            className={`px-4 py-2 rounded-full font-medium transition-colors ${filterStatus === 'verified'
              ? 'bg-dr7-gold text-black'
              : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
              }`}
          >
            Verificati ({documents.filter(d => d.status === 'verified').length})
          </button>
          <button
            onClick={() => setFilterStatus('rejected')}
            className={`px-4 py-2 rounded-full font-medium transition-colors ${filterStatus === 'rejected'
              ? 'bg-dr7-gold text-black'
              : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
              }`}
          >
            Rifiutati ({documents.filter(d => d.status === 'rejected').length})
          </button>
        </div>
      </div>

      {/* Documents by User */}
      <div className="space-y-4">
        {Object.entries(documentsByUser).map(([userId, userDocs]) => {
          const user = userDocs[0].user
          return (
            <div key={userId} className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
              {/* User Header */}
              <div className="bg-theme-bg-tertiary p-4 border-b border-theme-border">
                <div className="flex flex-col lg:flex-row lg:justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-xl font-bold text-theme-text-primary">{user?.full_name || 'Nome non disponibile'}</h3>
                      {(user as any)?.is_new && (
                        <span className="px-2 py-1 text-xs font-bold bg-green-600 text-theme-text-primary rounded">
                          NUOVO CLIENTE
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-theme-text-muted">Email:</span>
                        <span className="text-theme-text-primary">{user?.email || 'Non disponibile'}</span>
                      </div>
                      {user?.telefono && (
                        <div className="flex items-center gap-2">
                          <span className="text-theme-text-muted">Telefono:</span>
                          <span className="text-theme-text-primary">{user.telefono}</span>
                        </div>
                      )}
                      {user?.codice_fiscale && (
                        <div className="flex items-center gap-2">
                          <span className="text-theme-text-muted">Codice Fiscale:</span>
                          <span className="text-theme-text-primary font-mono">{user.codice_fiscale}</span>
                        </div>
                      )}
                      {user?.data_nascita && (
                        <div className="flex items-center gap-2">
                          <span className="text-theme-text-muted">Nato il:</span>
                          <span className="text-theme-text-primary">
                            {new Date(user.data_nascita).toLocaleDateString('it-IT')}
                            {user.luogo_nascita && ` a ${user.luogo_nascita}`}
                          </span>
                        </div>
                      )}
                      {user?.indirizzo_residenza && (
                        <div className="flex items-center gap-2 md:col-span-2">
                          <span className="text-theme-text-muted">Residenza:</span>
                          <span className="text-theme-text-primary">
                            {user.indirizzo_residenza}
                            {user.citta_residenza && `, ${user.citta_residenza}`}
                            {user.cap_residenza && ` ${user.cap_residenza}`}
                            {user.provincia_residenza && ` (${user.provincia_residenza})`}
                          </span>
                        </div>
                      )}
                      {(user as any)?.created_at && (
                        <div className="flex items-center gap-2">
                          <span className="text-theme-text-muted">Registrato:</span>
                          <span className="text-theme-text-primary">{new Date((user as any).created_at).toLocaleDateString('it-IT')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end justify-between">
                    <div className="text-right mb-2">
                      <p className="text-sm text-theme-text-muted">Documenti: {userDocs.length}</p>
                      <p className="text-xs text-gray-500">ID: {userId.slice(0, 8)}...</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* User Documents */}
              <div className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {userDocs.map((doc) => (
                    <div key={doc.id} className="bg-theme-bg-tertiary/50 border border-theme-border rounded-lg p-4">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="text-theme-text-primary font-medium">{getDocumentLabel(doc.document_type)}</h4>
                        {getStatusBadge(doc.status)}
                      </div>
                      <p className="text-xs text-theme-text-muted mb-3">
                        Caricato: {new Date(doc.upload_date).toLocaleDateString('it-IT')}
                      </p>
                      {doc.rejection_reason && (
                        <p className="text-xs text-red-400 mb-3 bg-red-900/20 p-2 rounded">
                          Motivo: {doc.rejection_reason}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => viewDocument(doc)}
                          className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-theme-text-primary rounded text-xs font-semibold transition-colors"
                        >
                          Visualizza
                        </button>
                        {doc.status === 'pending_verification' && (
                          <>
                            <button
                              onClick={() => updateDocumentStatus(doc.id, 'verified')}
                              className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-theme-text-primary rounded text-xs font-semibold transition-colors"
                            >
                              Verifica
                            </button>
                            <button
                              onClick={() => {
                                setSelectedDoc(doc)
                                setShowDocModal(true)
                              }}
                              className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-theme-text-primary rounded text-xs font-semibold transition-colors"
                            >
                              Rifiuta
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}

        {Object.keys(documentsByUser).length === 0 && (
          <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-8 text-center">
            <p className="text-gray-500">
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
        <div className="fixed inset-0 /80 flex items-center justify-center z-50 p-4">
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
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-theme-text-primary rounded font-medium transition-colors"
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
