import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'

interface CustomerDocumentsProps {
  customerId: string
  customerName: string
  onClose: () => void
}

interface CustomerDetails {
  id: string
  tipo_cliente: 'persona_fisica' | 'azienda' | 'pubblica_amministrazione'
  // Global
  email: string
  telefono: string
  nazione: string
  // Persona Fisica
  nome?: string
  cognome?: string
  codice_fiscale?: string
  sesso?: string
  data_nascita?: string
  citta_nascita?: string
  provincia_nascita?: string
  indirizzo?: string
  numero_civico?: string
  codice_postale?: string
  citta_residenza?: string
  provincia_residenza?: string
  pec?: string
  tipo_patente?: string
  numero_patente?: string
  emessa_da?: string
  data_rilascio_patente?: string
  scadenza_patente?: string
  // Azienda
  denominazione?: string
  partita_iva?: string
  cf_azienda?: string
  sede_legale?: string
  sede_operativa?: string
  codice_destinatario?: string
  pec_azienda?: string
  nome_rappresentante?: string
  cognome_rappresentante?: string
  cf_rappresentante?: string
  ruolo_rappresentante?: string
  tipo_documento_rappresentante?: string
  numero_documento_rappresentante?: string
  data_rilascio_documento?: string
  luogo_rilascio_documento?: string
  // Pubblica Amministrazione
  codice_univoco?: string
  cf_pa?: string
  ente_ufficio?: string
  citta?: string
  partita_iva_pa?: string
  pec_pa?: string
}

interface CustomerDocument {
  id: string
  customer_id: string
  document_type: 'drivers_license' | 'identity_document'
  file_name: string
  file_path: string
  file_size: number
  mime_type: string
  bucket_id: string
  uploaded_at: string
}

const DRIVERS_LICENSE_BUCKET = 'driver-licenses'
const IDENTITY_DOCS_BUCKET = 'customer-documents'

export default function CustomerDocuments({ customerId, customerName, onClose }: CustomerDocumentsProps) {
  const [documents, setDocuments] = useState<CustomerDocument[]>([])
  const [customerDetails, setCustomerDetails] = useState<CustomerDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<{ [key: string]: boolean }>({})
  const [selectedFiles, setSelectedFiles] = useState<{ [key: string]: File | null }>({
    drivers_license: null,
    identity_document: null
  })
  const [previewUrls, setPreviewUrls] = useState<{ [key: string]: string | null }>({})

  useEffect(() => {
    loadCustomerData()
  }, [customerId])

  async function loadCustomerData() {
    setLoading(true)
    try {
      // Load customer details
      const { data: customerData, error: customerError } = await supabase
        .from('customers_extended')
        .select('*')
        .eq('id', customerId)
        .single()

      if (customerError) throw customerError
      setCustomerDetails(customerData)

      // Load document metadata from database
      const { data: docsData, error: docsError } = await supabase
        .from('customer_documents')
        .select('*')
        .eq('customer_id', customerId)

      if (docsError) throw docsError

      setDocuments(docsData || [])

      // Load preview URLs for existing documents
      if (docsData && docsData.length > 0) {
        const urls: { [key: string]: string | null } = {}
        for (const doc of docsData) {
          const { data: urlData } = await supabase.storage
            .from(doc.bucket_id)
            .createSignedUrl(doc.file_path, 3600)

          urls[doc.document_type] = urlData?.signedUrl || null
        }
        setPreviewUrls(urls)
      }
    } catch (error: any) {
      console.error('Error loading customer data:', error)
      alert(`Errore nel caricamento dati: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function loadDocuments() {
    try {
      // Load document metadata from database
      const { data, error } = await supabase
        .from('customer_documents')
        .select('*')
        .eq('customer_id', customerId)

      if (error) throw error

      setDocuments(data || [])

      // Load preview URLs for existing documents
      if (data && data.length > 0) {
        const urls: { [key: string]: string | null } = {}
        for (const doc of data) {
          const { data: urlData } = await supabase.storage
            .from(doc.bucket_id)
            .createSignedUrl(doc.file_path, 3600)

          urls[doc.document_type] = urlData?.signedUrl || null
        }
        setPreviewUrls(urls)
      }
    } catch (error: any) {
      console.error('Error loading documents:', error)
      alert(`Errore nel caricamento documenti: ${error.message}`)
    }
  }

  async function handleUpload(documentType: 'drivers_license' | 'identity_document') {
    const file = selectedFiles[documentType]
    if (!file) {
      alert('Seleziona un file da caricare')
      return
    }

    setUploading({ ...uploading, [documentType]: true })
    try {
      // Check authentication
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (!user || authError) {
        alert('ERRORE: Non sei autenticato. Effettua il login e riprova.')
        return
      }

      const fileExt = file.name.split('.').pop()
      const fileName = `${documentType}_${Date.now()}.${fileExt}`
      const filePath = `${customerId}/${fileName}`

      // Select correct bucket based on document type
      const bucket = documentType === 'drivers_license' ? DRIVERS_LICENSE_BUCKET : IDENTITY_DOCS_BUCKET

      // Upload to storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        })

      console.log('Upload result:', uploadData)
      if (uploadError) throw uploadError

      // Check if document already exists for this type
      const existingDoc = documents.find(d => d.document_type === documentType)

      if (existingDoc) {
        // Update existing document
        const { error: updateError } = await supabase
          .from('customer_documents')
          .update({
            file_name: file.name,
            file_path: filePath,
            file_size: file.size,
            mime_type: file.type,
            bucket_id: bucket,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingDoc.id)

        if (updateError) throw updateError

        // Delete old file from storage
        if (existingDoc.file_path !== filePath) {
          await supabase.storage
            .from(existingDoc.bucket_id)
            .remove([existingDoc.file_path])
        }
      } else {
        // Insert new document record
        const { error: insertError } = await supabase
          .from('customer_documents')
          .insert({
            customer_id: customerId,
            document_type: documentType,
            file_name: file.name,
            file_path: filePath,
            file_size: file.size,
            mime_type: file.type,
            bucket_id: bucket,
            uploaded_by: user.id
          })

        if (insertError) throw insertError
      }

      alert('Documento caricato con successo!')
      setSelectedFiles({ ...selectedFiles, [documentType]: null })
      await loadDocuments()
    } catch (error: any) {
      console.error('Error uploading document:', error)
      alert(`ERRORE nel caricamento: ${error.message}`)
    } finally {
      setUploading({ ...uploading, [documentType]: false })
    }
  }

  async function handleDelete(documentId: string, filePath: string, bucketId: string) {
    if (!confirm('Sei sicuro di voler eliminare questo documento?')) {
      return
    }

    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from(bucketId)
        .remove([filePath])

      if (storageError) throw storageError

      // Delete from database
      const { error: dbError } = await supabase
        .from('customer_documents')
        .delete()
        .eq('id', documentId)

      if (dbError) throw dbError

      alert('Documento eliminato')
      await loadDocuments()
    } catch (error: any) {
      console.error('Error deleting document:', error)
      alert(`ERRORE nell'eliminazione: ${error.message}`)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const isImage = (mimeType: string) => {
    return mimeType.startsWith('image/')
  }

  const getDocument = (type: 'drivers_license' | 'identity_document') => {
    return documents.find(d => d.document_type === type)
  }

  const renderDocumentSection = (
    type: 'drivers_license' | 'identity_document',
    label: string,
    description: string
  ) => {
    const doc = getDocument(type)
    const previewUrl = previewUrls[type]
    const isUploading = uploading[type]
    const selectedFile = selectedFiles[type]

    return (
      <div className="bg-theme-bg-tertiary border border-theme-border rounded-full p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h4 className="text-lg font-semibold text-dr7-gold">{label}</h4>
            <p className="text-sm text-theme-text-muted mt-1">{description}</p>
          </div>
          {doc && (
            <span className="px-3 py-1 bg-green-900/50 text-green-400 text-xs font-medium rounded">
              Caricato
            </span>
          )}
        </div>

        {/* Existing Document Preview */}
        {doc && previewUrl && (
          <div className="mb-4 bg-theme-bg-secondary border border-theme-border-light rounded-full p-4">
            <div className="flex gap-4">
              {/* Preview */}
              {isImage(doc.mime_type) ? (
                <div className="w-32 h-32 flex-shrink-0 bg-gray-950 rounded overflow-hidden">
                  <img
                    src={previewUrl}
                    alt={label}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-32 h-32 flex-shrink-0 bg-gray-950 rounded flex items-center justify-center">
                  <div className="text-center">
                    <svg className="w-12 h-12 mx-auto text-gray-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <p className="text-xs text-gray-500">{doc.mime_type.split('/')[1].toUpperCase()}</p>
                  </div>
                </div>
              )}

              {/* Document Info */}
              <div className="flex-1 min-w-0">
                <p className="text-theme-text-primary font-medium truncate mb-1">{doc.file_name}</p>
                <p className="text-xs text-theme-text-muted mb-2">
                  {formatFileSize(doc.file_size)} • Caricato il{' '}
                  {new Date(doc.uploaded_at).toLocaleDateString('it-IT', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
                <div className="flex gap-2">
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-theme-text-primary rounded text-sm font-medium transition-colors"
                  >
                    Visualizza
                  </a>
                  <a
                    href={previewUrl}
                    download={doc.file_name}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-theme-text-primary rounded text-sm font-medium transition-colors"
                  >
                    Scarica
                  </a>
                  <button
                    onClick={() => handleDelete(doc.id, doc.file_path, doc.bucket_id)}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-theme-text-primary rounded text-sm font-medium transition-colors"
                  >
                    Elimina
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Upload New/Replace Document */}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-2">
              {doc ? 'Sostituisci Documento' : 'Carica Documento'}
            </label>
            <input
              type="file"
              onChange={(e) => setSelectedFiles({ ...selectedFiles, [type]: e.target.files?.[0] || null })}
              className="w-full px-3 py-2 bg-gray-700 border border-theme-border-light rounded text-theme-text-primary text-sm
                file:mr-4 file:py-2 file:px-4 file:rounded file:border-0
                file:text-sm file:font-semibold file:bg-dr7-gold file:text-black
                hover:file:bg-yellow-500 file:cursor-pointer"
              accept="image/*,.pdf"
              disabled={isUploading}
            />
            {selectedFile && (
              <p className="text-xs text-theme-text-muted mt-2">
                File selezionato: {selectedFile.name} ({formatFileSize(selectedFile.size)})
              </p>
            )}
          </div>
          <Button
            onClick={() => handleUpload(type)}
            disabled={!selectedFile || isUploading}
          >
            {isUploading ? 'Caricamento...' : doc ? 'Sostituisci' : 'Carica'}
          </Button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-theme-bg-primary/80 flex items-center justify-center z-50">
        <div className="bg-theme-bg-secondary border border-theme-border rounded-full p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
          <p className="text-theme-text-primary">Caricamento documenti...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-theme-bg-primary/80 flex items-center justify-center z-50 p-4">
      <div className="bg-theme-bg-secondary border border-theme-border rounded-full max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-theme-bg-secondary border-b border-theme-border p-6 flex justify-between items-center">
          <div>
            <h3 className="text-xl font-bold text-theme-text-primary">Documenti Cliente</h3>
            <p className="text-sm text-theme-text-muted mt-1">{customerName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Customer Details Section */}
          {customerDetails && (
            <div className="bg-gradient-to-r from-dr7-gold/10 to-transparent border border-dr7-gold/30 rounded-full p-6">
              <h4 className="text-lg font-bold text-dr7-gold mb-4 flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Dettagli Completi Cliente
              </h4>

              {/* PERSONA FISICA */}
              {customerDetails.tipo_cliente === 'persona_fisica' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <div><span className="text-theme-text-muted">Nome:</span> <span className="text-theme-text-primary font-medium">{customerDetails.nome}</span></div>
                    <div><span className="text-theme-text-muted">Cognome:</span> <span className="text-theme-text-primary font-medium">{customerDetails.cognome}</span></div>
                    <div><span className="text-theme-text-muted">Codice Fiscale:</span> <span className="text-theme-text-primary font-medium">{customerDetails.codice_fiscale}</span></div>
                    {customerDetails.sesso && <div><span className="text-theme-text-muted">Sesso:</span> <span className="text-theme-text-primary">{customerDetails.sesso === 'M' ? 'Maschio' : 'Femmina'}</span></div>}
                    {customerDetails.data_nascita && <div><span className="text-theme-text-muted">Data di Nascita:</span> <span className="text-theme-text-primary">{new Date(customerDetails.data_nascita).toLocaleDateString('it-IT')}</span></div>}
                    {customerDetails.citta_nascita && <div><span className="text-theme-text-muted">Città di Nascita:</span> <span className="text-theme-text-primary">{customerDetails.citta_nascita} {customerDetails.provincia_nascita && `(${customerDetails.provincia_nascita})`}</span></div>}
                    <div><span className="text-theme-text-muted">Email:</span> <span className="text-theme-text-primary">{customerDetails.email}</span></div>
                    <div><span className="text-theme-text-muted">Telefono:</span> <span className="text-theme-text-primary">{customerDetails.telefono}</span></div>
                    {customerDetails.pec && <div><span className="text-theme-text-muted">PEC:</span> <span className="text-theme-text-primary">{customerDetails.pec}</span></div>}
                  </div>
                  <div className="space-y-2">
                    {customerDetails.indirizzo && <div><span className="text-theme-text-muted">Indirizzo:</span> <span className="text-theme-text-primary">{customerDetails.indirizzo} {customerDetails.numero_civico}</span></div>}
                    {customerDetails.citta_residenza && <div><span className="text-theme-text-muted">Città:</span> <span className="text-theme-text-primary">{customerDetails.citta_residenza} ({customerDetails.provincia_residenza})</span></div>}
                    {customerDetails.codice_postale && <div><span className="text-theme-text-muted">CAP:</span> <span className="text-theme-text-primary">{customerDetails.codice_postale}</span></div>}
                    <div><span className="text-theme-text-muted">Nazione:</span> <span className="text-theme-text-primary">{customerDetails.nazione}</span></div>

                    {/* Driving License Info */}
                    {customerDetails.tipo_patente && (
                      <div className="mt-4 pt-4 border-t border-theme-border">
                        <div className="text-dr7-gold font-semibold mb-2">Patente di Guida</div>
                        <div><span className="text-theme-text-muted">Tipo:</span> <span className="text-theme-text-primary">{customerDetails.tipo_patente}</span></div>
                        {customerDetails.numero_patente && <div><span className="text-theme-text-muted">Numero:</span> <span className="text-theme-text-primary">{customerDetails.numero_patente}</span></div>}
                        {customerDetails.emessa_da && <div><span className="text-theme-text-muted">Emessa da:</span> <span className="text-theme-text-primary">{customerDetails.emessa_da}</span></div>}
                        {customerDetails.data_rilascio_patente && <div><span className="text-theme-text-muted">Rilascio:</span> <span className="text-theme-text-primary">{new Date(customerDetails.data_rilascio_patente).toLocaleDateString('it-IT')}</span></div>}
                        {customerDetails.scadenza_patente && <div><span className="text-theme-text-muted">Scadenza:</span> <span className="text-theme-text-primary">{new Date(customerDetails.scadenza_patente).toLocaleDateString('it-IT')}</span></div>}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* AZIENDA */}
              {customerDetails.tipo_cliente === 'azienda' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <div><span className="text-theme-text-muted">Ragione Sociale:</span> <span className="text-theme-text-primary font-medium">{customerDetails.denominazione}</span></div>
                    <div><span className="text-theme-text-muted">Partita IVA:</span> <span className="text-theme-text-primary font-medium">{customerDetails.partita_iva}</span></div>
                    {customerDetails.cf_azienda && <div><span className="text-theme-text-muted">Codice Fiscale:</span> <span className="text-theme-text-primary">{customerDetails.cf_azienda}</span></div>}
                    {customerDetails.sede_legale && <div><span className="text-theme-text-muted">Sede Legale:</span> <span className="text-theme-text-primary">{customerDetails.sede_legale}</span></div>}
                    {customerDetails.sede_operativa && <div><span className="text-theme-text-muted">Sede Operativa:</span> <span className="text-theme-text-primary">{customerDetails.sede_operativa}</span></div>}
                    {customerDetails.codice_destinatario && <div><span className="text-theme-text-muted">Codice SDI:</span> <span className="text-theme-text-primary">{customerDetails.codice_destinatario}</span></div>}
                    {customerDetails.pec_azienda && <div><span className="text-theme-text-muted">PEC:</span> <span className="text-theme-text-primary">{customerDetails.pec_azienda}</span></div>}
                    <div><span className="text-theme-text-muted">Email:</span> <span className="text-theme-text-primary">{customerDetails.email}</span></div>
                    <div><span className="text-theme-text-muted">Telefono:</span> <span className="text-theme-text-primary">{customerDetails.telefono}</span></div>
                  </div>
                  <div className="space-y-2">
                    {/* Legal Representative */}
                    {customerDetails.nome_rappresentante && (
                      <div className="mt-0 pt-0 border-t-0 border-theme-border">
                        <div className="text-dr7-gold font-semibold mb-2">Rappresentante Legale</div>
                        <div><span className="text-theme-text-muted">Nome:</span> <span className="text-theme-text-primary">{customerDetails.nome_rappresentante} {customerDetails.cognome_rappresentante}</span></div>
                        {customerDetails.cf_rappresentante && <div><span className="text-theme-text-muted">Codice Fiscale:</span> <span className="text-theme-text-primary">{customerDetails.cf_rappresentante}</span></div>}
                        {customerDetails.ruolo_rappresentante && <div><span className="text-theme-text-muted">Ruolo:</span> <span className="text-theme-text-primary">{customerDetails.ruolo_rappresentante}</span></div>}
                        {customerDetails.tipo_documento_rappresentante && (
                          <div><span className="text-theme-text-muted">Documento:</span> <span className="text-theme-text-primary">{customerDetails.tipo_documento_rappresentante} {customerDetails.numero_documento_rappresentante}</span></div>
                        )}
                        {customerDetails.data_rilascio_documento && (
                          <div><span className="text-theme-text-muted">Rilasciato:</span> <span className="text-theme-text-primary">{new Date(customerDetails.data_rilascio_documento).toLocaleDateString('it-IT')} - {customerDetails.luogo_rilascio_documento}</span></div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* PUBBLICA AMMINISTRAZIONE */}
              {customerDetails.tipo_cliente === 'pubblica_amministrazione' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <div><span className="text-theme-text-muted">Ente/Ufficio:</span> <span className="text-theme-text-primary font-medium">{customerDetails.ente_ufficio}</span></div>
                    <div><span className="text-theme-text-muted">Codice Univoco:</span> <span className="text-theme-text-primary font-medium">{customerDetails.codice_univoco}</span></div>
                    {customerDetails.cf_pa && <div><span className="text-theme-text-muted">Codice Fiscale:</span> <span className="text-theme-text-primary">{customerDetails.cf_pa}</span></div>}
                    {customerDetails.partita_iva_pa && <div><span className="text-theme-text-muted">Partita IVA:</span> <span className="text-theme-text-primary">{customerDetails.partita_iva_pa}</span></div>}
                  </div>
                  <div className="space-y-2">
                    {customerDetails.citta && <div><span className="text-theme-text-muted">Città:</span> <span className="text-theme-text-primary">{customerDetails.citta}</span></div>}
                    {customerDetails.pec_pa && <div><span className="text-theme-text-muted">PEC:</span> <span className="text-theme-text-primary">{customerDetails.pec_pa}</span></div>}
                    <div><span className="text-theme-text-muted">Email:</span> <span className="text-theme-text-primary">{customerDetails.email}</span></div>
                    <div><span className="text-theme-text-muted">Telefono:</span> <span className="text-theme-text-primary">{customerDetails.telefono}</span></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Info Box */}
          <div className="bg-blue-900/30 border-2 border-blue-500 rounded-full p-4">
            <div className="flex items-start gap-3">
              <div className="text-blue-400 text-2xl">ℹ️</div>
              <div className="flex-1">
                <h4 className="text-blue-300 font-semibold mb-2">Carica i Documenti del Cliente</h4>
                <div className="space-y-1 text-sm text-blue-200">
                  <p>Carica la patente di guida e il documento di identità (carta d'identità o passaporto) del cliente.</p>
                  <p className="text-xs mt-2 text-blue-300">Formati supportati: JPG, PNG, PDF • Massimo 50MB per file</p>
                </div>
              </div>
            </div>
          </div>

          {/* Driver's License Section */}
          {renderDocumentSection(
            'drivers_license',
            'Patente di Guida',
            'Carica la patente di guida del cliente'
          )}

          {/* Identity Document Section */}
          {renderDocumentSection(
            'identity_document',
            'Documento di Identità',
            'Carica carta d\'identità o passaporto del cliente'
          )}

          {/* Storage Info */}
          <div className="bg-theme-bg-tertiary/50 border border-theme-border rounded-full p-4">
            <h5 className="text-sm font-semibold text-theme-text-primary mb-2">Informazioni Storage</h5>
            <div className="space-y-1">
              <p className="text-xs text-theme-text-muted">
                <strong>Buckets:</strong> <code className="bg-gray-700 px-2 py-0.5 rounded mr-1">{DRIVERS_LICENSE_BUCKET}</code>
                <code className="bg-gray-700 px-2 py-0.5 rounded">{IDENTITY_DOCS_BUCKET}</code>
              </p>
              <p className="text-xs text-theme-text-muted">
                <strong>Path:</strong> <code className="bg-gray-700 px-2 py-0.5 rounded">{customerId}/</code>
              </p>
              <p className="text-xs text-theme-text-muted">
                <strong>Formati supportati:</strong> Immagini (JPG, PNG), PDF
              </p>
              <p className="text-xs text-theme-text-muted">
                <strong>Documenti caricati:</strong> {documents.length}/2
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-theme-bg-secondary border-t border-theme-border p-4">
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Chiudi
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
