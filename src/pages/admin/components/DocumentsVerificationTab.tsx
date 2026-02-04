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
      console.log('[DocumentsVerificationTab] Loading documents via Netlify function...')

      let useClientFallback = false

      try {
        const response = await fetch('/.netlify/functions/get-verification-requests')

        if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
          const result = await response.json()

          if (result.success && result.documents) {
            console.log('[DocumentsVerificationTab] Documents loaded via Netlify function:', result.documents.length)
            setDocuments(result.documents)
            return
          }
        }

        // If we get here, Netlify function didn't return valid data
        useClientFallback = true
      } catch (fetchError) {
        // Netlify function not available or returned invalid response
        console.log('[DocumentsVerificationTab] Netlify function error:', fetchError)
        useClientFallback = true
      }

      if (!useClientFallback) {
        setDocuments([])
        return
      }

      // Fallback: Netlify function not available (e.g., running with npm run dev)
      // Fetch data directly from Supabase
      console.log('[DocumentsVerificationTab] Using client-side fallback...')

      // 1. Fetch all documents
      const { data: docs, error: docsError } = await supabase
        .from('user_documents')
        .select('*')
        .order('upload_date', { ascending: false })

      if (docsError) throw docsError

      if (!docs || docs.length === 0) {
        console.log('[DocumentsVerificationTab] No documents found')
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

      console.log('[DocumentsVerificationTab] Documents loaded via client-side fallback:', enrichedDocuments.length)
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

      {/* Documents by User */}
      <div className="space-y-4">
        {Object.entries(documentsByUser).map(([userId, userDocs]) => {
          const user = userDocs[0].user
          return (
            <div key={userId} className="bg-theme-bg-secondary rounded-lg border border-theme-border overflow-hidden">
              {/* User Header */}
              <div className="bg-theme-bg-tertiary p-6 border-b border-theme-border">
                <div className="flex flex-col lg:flex-row lg:justify-between gap-6">
                  <div className="flex-1 space-y-4">
                    {/* Header with Name and Badges */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-2xl font-bold text-theme-text-primary">{user?.full_name || 'Nome non disponibile'}</h3>
                      {(user as any)?.is_new && (
                        <span className="px-3 py-1 text-xs font-bold bg-green-600 text-white rounded-full shadow-lg">
                          🆕 NUOVO CLIENTE
                        </span>
                      )}
                      {user?.tipo_cliente && (
                        <span className={`px-3 py-1 text-xs font-bold rounded-full ${user.tipo_cliente === 'persona_fisica' ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30' :
                          user.tipo_cliente === 'azienda' ? 'bg-purple-600/20 text-purple-400 border border-purple-600/30' :
                            'bg-orange-600/20 text-orange-400 border border-orange-600/30'
                          }`}>
                          {user.tipo_cliente === 'persona_fisica' ? '👤 Persona Fisica' :
                            user.tipo_cliente === 'azienda' ? '🏢 Azienda' :
                              '🏛️ Pubblica Amministrazione'}
                        </span>
                      )}
                      {user?.source && (
                        <span className="px-2 py-1 text-xs bg-theme-bg-tertiary/50 text-theme-text-muted rounded border border-theme-border/30" title={`Fonte: ${user.source}`}>
                          {user.source === 'website' ? '🌐 Web' :
                            user.source === 'website_registration' ? '🌐 Web (Auth)' :
                              user.source === 'booking_auto_created' ? '📅 Auto' :
                                user.source === 'admin' ? '⚙️ Admin' : user.source}
                        </span>
                      )}
                    </div>

                    {/* Personal Information */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-theme-text-muted">📧 Email:</span>
                        <span className="text-theme-text-primary font-medium">{user?.email || 'Non disponibile'}</span>
                      </div>
                      {user?.telefono && (
                        <div className="flex items-center gap-2">
                          <span className="text-theme-text-muted">📞 Telefono:</span>
                          <span className="text-theme-text-primary font-medium">{user.telefono}</span>
                        </div>
                      )}
                      {user?.pec && (
                        <div className="flex items-center gap-2">
                          <span className="text-theme-text-muted">📨 PEC:</span>
                          <span className="text-theme-text-primary font-medium">{user.pec}</span>
                        </div>
                      )}
                      {user?.sesso && (
                        <div className="flex items-center gap-2">
                          <span className="text-theme-text-muted">Sesso:</span>
                          <span className="text-theme-text-primary">{user.sesso === 'M' ? 'Maschile' : user.sesso === 'F' ? 'Femminile' : user.sesso}</span>
                        </div>
                      )}
                      {user?.codice_fiscale && (
                        <div className="flex items-center gap-2">
                          <span className="text-theme-text-muted">🆔 Codice Fiscale:</span>
                          <span className="text-theme-text-primary font-mono font-bold">{user.codice_fiscale.toUpperCase()}</span>
                        </div>
                      )}
                      {user?.data_nascita && (
                        <div className="flex items-center gap-2">
                          <span className="text-theme-text-muted">🎂 Nato il:</span>
                          <span className="text-theme-text-primary">
                            {new Date(user.data_nascita).toLocaleDateString('it-IT')}
                            {user.luogo_nascita && ` a ${user.luogo_nascita}`}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Address Information */}
                    {(user?.indirizzo || user?.citta_residenza) && (
                      <div className="pt-2 border-t border-theme-border/30">
                        <div className="flex items-start gap-2 text-sm">
                          <span className="text-theme-text-muted">🏠 Indirizzo:</span>
                          <span className="text-theme-text-primary">
                            {user.indirizzo}
                            {user.numero_civico && `, ${user.numero_civico}`}
                            {user.citta_residenza && ` - ${user.citta_residenza}`}
                            {user.cap && ` ${user.cap}`}
                            {user.provincia && ` (${user.provincia})`}
                            {user.nazione && user.nazione !== 'Italia' && ` - ${user.nazione}`}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Driver's License Information */}
                    {user?.numero_patente && (
                      <div className="pt-2 border-t border-theme-border/30">
                        <div className="text-sm font-semibold text-dr7-gold mb-2">🪪 Patente di Guida</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-theme-text-muted">Numero:</span>
                            <span className="text-theme-text-primary font-mono font-bold">{user.numero_patente}</span>
                          </div>
                          {user.categoria_patente && (
                            <div className="flex items-center gap-2">
                              <span className="text-theme-text-muted">Categoria:</span>
                              <span className="text-theme-text-primary font-bold">{user.categoria_patente}</span>
                            </div>
                          )}
                          {user.ente_rilascio && (
                            <div className="flex items-center gap-2">
                              <span className="text-theme-text-muted">Ente Rilascio:</span>
                              <span className="text-theme-text-primary">{user.ente_rilascio}</span>
                            </div>
                          )}
                          {user.data_rilascio && (
                            <div className="flex items-center gap-2">
                              <span className="text-theme-text-muted">Rilasciata il:</span>
                              <span className="text-theme-text-primary">{new Date(user.data_rilascio).toLocaleDateString('it-IT')}</span>
                            </div>
                          )}
                          {user.data_scadenza && (
                            <div className="flex items-center gap-2">
                              <span className="text-theme-text-muted">Scadenza:</span>
                              <span className={`font-medium ${new Date(user.data_scadenza) < new Date() ? 'text-red-400' :
                                new Date(user.data_scadenza) < new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) ? 'text-yellow-400' :
                                  'text-theme-text-primary'
                                }`}>
                                {new Date(user.data_scadenza).toLocaleDateString('it-IT')}
                                {new Date(user.data_scadenza) < new Date() && ' ⚠️ SCADUTA'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Company Information (Azienda) */}
                    {user?.tipo_cliente === 'azienda' && (user?.ragione_sociale || user?.denominazione || user?.partita_iva) && (
                      <div className="pt-2 border-t border-theme-border/30">
                        <div className="text-sm font-semibold text-purple-400 mb-2">🏢 Informazioni Azienda</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                          {(user.ragione_sociale || user.denominazione) && (
                            <div className="flex items-center gap-2">
                              <span className="text-theme-text-muted">Ragione Sociale:</span>
                              <span className="text-theme-text-primary font-bold">{user.ragione_sociale || user.denominazione}</span>
                            </div>
                          )}
                          {user.partita_iva && (
                            <div className="flex items-center gap-2">
                              <span className="text-theme-text-muted">Partita IVA:</span>
                              <span className="text-theme-text-primary font-mono font-bold">{user.partita_iva}</span>
                            </div>
                          )}
                          {user.rappresentante_legale && (
                            <div className="flex items-center gap-2">
                              <span className="text-theme-text-muted">Rappresentante:</span>
                              <span className="text-theme-text-primary">{user.rappresentante_legale}</span>
                            </div>
                          )}
                          {user.codice_destinatario && (
                            <div className="flex items-center gap-2">
                              <span className="text-theme-text-muted">Codice Destinatario:</span>
                              <span className="text-theme-text-primary font-mono">{user.codice_destinatario}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Public Administration Information */}
                    {user?.tipo_cliente === 'pubblica_amministrazione' && (user?.denominazione || user?.codice_ipa || user?.codice_univoco) && (
                      <div className="pt-2 border-t border-theme-border/30">
                        <div className="text-sm font-semibold text-orange-400 mb-2">🏛️ Pubblica Amministrazione</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                          {user.denominazione && (
                            <div className="flex items-center gap-2">
                              <span className="text-theme-text-muted">Denominazione:</span>
                              <span className="text-theme-text-primary font-bold">{user.denominazione}</span>
                            </div>
                          )}
                          {user.codice_ipa && (
                            <div className="flex items-center gap-2">
                              <span className="text-theme-text-muted">Codice IPA:</span>
                              <span className="text-theme-text-primary font-mono font-bold">{user.codice_ipa}</span>
                            </div>
                          )}
                          {user.codice_univoco && (
                            <div className="flex items-center gap-2">
                              <span className="text-theme-text-muted">Codice Univoco:</span>
                              <span className="text-theme-text-primary font-mono font-bold">{user.codice_univoco}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Registration Metadata */}
                    <div className="pt-2 border-t border-theme-border/30">
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-theme-text-muted">
                        {(user as any)?.created_at && (
                          <span>📅 Registrato: {new Date((user as any).created_at).toLocaleDateString('it-IT')} alle {new Date((user as any).created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
                        )}
                        {user?.updated_at && (
                          <span>🔄 Aggiornato: {new Date(user.updated_at).toLocaleDateString('it-IT')}</span>
                        )}
                        <span>🆔 ID: {userId.slice(0, 8)}...</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Side - Document Count */}
                  <div className="flex flex-col items-end justify-start">
                    <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-4 text-center min-w-[120px]">
                      <div className="text-3xl font-bold text-dr7-gold">{userDocs.length}</div>
                      <div className="text-xs text-theme-text-muted mt-1">Documenti</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* User Documents */}
              <div className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {userDocs.map((doc) => (
                    <div key={doc.id} className="bg-theme-bg-tertiary/50 border border-theme-border rounded-full p-4">
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
