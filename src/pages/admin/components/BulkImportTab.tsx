import { useState, useRef, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'

interface ExtractedCustomer {
  fileIndex: number
  fileName: string
  status: 'pending' | 'processing' | 'done' | 'error'
  error?: string
  data?: {
    nome?: string
    cognome?: string
    sesso?: string
    data_nascita?: string
    luogo_nascita?: string
    provincia_nascita?: string
    codice_fiscale?: string
    indirizzo?: string
    numero_civico?: string
    codice_postale?: string
    citta_residenza?: string
    provincia_residenza?: string
    documento_tipo?: string
    documento_numero?: string
    documento_rilascio?: string
    documento_scadenza?: string
    documento_ente?: string
    patente_numero?: string
    patente_tipo?: string
    patente_rilascio?: string
    patente_scadenza?: string
    patente_ente?: string
    document_type?: string
    confidence?: string
    notes?: string
  }
  saved?: boolean
}

const FUNCTIONS_BASE = import.meta.env.DEV ? 'http://localhost:8888' : ''

export default function BulkImportTab() {
  const [files, setFiles] = useState<File[]>([])
  const [customers, setCustomers] = useState<ExtractedCustomer[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [processedCount, setProcessedCount] = useState(0)
  const [savedCount, setSavedCount] = useState(0)
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef(false)

  const isValidFile = (file: File) =>
    file.type.startsWith('image/') || file.type === 'application/pdf'

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).filter(isValidFile)
      setFiles(prev => [...prev, ...newFiles])
    }
  }

  // Recursively read all files from a dropped directory entry
  const readEntryFiles = (entry: FileSystemEntry): Promise<File[]> => {
    return new Promise((resolve) => {
      if (entry.isFile) {
        (entry as FileSystemFileEntry).file(
          (file) => resolve(isValidFile(file) ? [file] : []),
          () => resolve([])
        )
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        const allFiles: File[] = []

        const readBatch = () => {
          reader.readEntries(async (entries) => {
            if (entries.length === 0) {
              resolve(allFiles)
              return
            }
            for (const child of entries) {
              const childFiles = await readEntryFiles(child)
              allFiles.push(...childFiles)
            }
            // readEntries may not return all at once, keep reading
            readBatch()
          }, () => resolve(allFiles))
        }
        readBatch()
      } else {
        resolve([])
      }
    })
  }

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()

    const items = e.dataTransfer.items
    if (!items) {
      // Fallback: no items API, use files directly
      const droppedFiles = Array.from(e.dataTransfer.files).filter(isValidFile)
      setFiles(prev => [...prev, ...droppedFiles])
      return
    }

    const collectedFiles: File[] = []

    // Use webkitGetAsEntry to handle folders
    const entries: FileSystemEntry[] = []
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.()
      if (entry) entries.push(entry)
    }

    if (entries.length > 0) {
      for (const entry of entries) {
        const entryFiles = await readEntryFiles(entry)
        collectedFiles.push(...entryFiles)
      }
    } else {
      // Fallback if webkitGetAsEntry not supported
      collectedFiles.push(...Array.from(e.dataTransfer.files).filter(isValidFile))
    }

    if (collectedFiles.length > 0) {
      setFiles(prev => [...prev, ...collectedFiles])
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        // Remove the data:image/...;base64, prefix
        const base64 = result.split(',')[1]
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const processFiles = async () => {
    if (files.length === 0) return
    setIsProcessing(true)
    setProcessedCount(0)
    abortRef.current = false

    // Initialize customer entries
    const initialCustomers: ExtractedCustomer[] = files.map((file, index) => ({
      fileIndex: index,
      fileName: file.name,
      status: 'pending'
    }))
    setCustomers(initialCustomers)

    // Process files sequentially (to avoid overloading the API)
    for (let i = 0; i < files.length; i++) {
      if (abortRef.current) break

      // Update status to processing
      setCustomers(prev => prev.map((c, idx) =>
        idx === i ? { ...c, status: 'processing' } : c
      ))

      try {
        const base64 = await fileToBase64(files[i])

        const response = await fetch(`${FUNCTIONS_BASE}/.netlify/functions/extract-document-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64 })
        })

        const result = await response.json()

        if (response.ok && result.success) {
          setCustomers(prev => prev.map((c, idx) =>
            idx === i ? { ...c, status: 'done', data: result.data } : c
          ))
        } else {
          setCustomers(prev => prev.map((c, idx) =>
            idx === i ? { ...c, status: 'error', error: result.error || 'Extraction failed' } : c
          ))
        }
      } catch (error: any) {
        setCustomers(prev => prev.map((c, idx) =>
          idx === i ? { ...c, status: 'error', error: error.message } : c
        ))
      }

      setProcessedCount(i + 1)

      // Small delay between requests to avoid rate limiting
      if (i < files.length - 1 && !abortRef.current) {
        await new Promise(r => setTimeout(r, 500))
      }
    }

    setIsProcessing(false)
  }

  const stopProcessing = () => {
    abortRef.current = true
  }

  const updateCustomerField = (index: number, field: string, value: string) => {
    setCustomers(prev => prev.map((c, idx) =>
      idx === index ? { ...c, data: { ...c.data, [field]: value } } : c
    ))
  }

  // Determine storage bucket and document type based on extracted document_type
  const getDocStorageInfo = (docType?: string): { bucket: string; docType: string } => {
    switch (docType) {
      case 'patente':
        return { bucket: 'driver-licenses', docType: 'drivers_license' }
      case 'codice_fiscale':
      case 'tessera_sanitaria':
        return { bucket: 'codice-fiscale', docType: 'codice_fiscale' }
      case 'carta_identita':
      default:
        return { bucket: 'customer-documents', docType: 'identity_document' }
    }
  }

  const saveAllCustomers = async () => {
    const toSave = customers.filter(c => c.status === 'done' && c.data && !c.saved)
    if (toSave.length === 0) return

    setIsSaving(true)
    setSavedCount(0)

    // Get authenticated user for document uploads
    const { data: { user } } = await supabase.auth.getUser()

    for (const customer of toSave) {
      const d = customer.data!

      try {
        // Check if customer already exists by codice_fiscale
        let existingId: string | null = null
        if (d.codice_fiscale) {
          const { data: existing } = await supabase
            .from('customers_extended')
            .select('id')
            .eq('codice_fiscale', d.codice_fiscale.toUpperCase())
            .maybeSingle()
          if (existing) existingId = existing.id
        }

        const customerData: any = {
          tipo_cliente: 'persona_fisica',
          nome: d.nome || null,
          cognome: d.cognome || null,
          sesso: d.sesso || null,
          data_nascita: d.data_nascita || null,
          luogo_nascita: d.luogo_nascita || null,
          citta_nascita: d.luogo_nascita || null,
          provincia_nascita: d.provincia_nascita || null,
          codice_fiscale: d.codice_fiscale?.toUpperCase() || null,
          indirizzo: d.indirizzo || null,
          numero_civico: d.numero_civico || null,
          codice_postale: d.codice_postale || null,
          citta_residenza: d.citta_residenza || null,
          provincia_residenza: d.provincia_residenza || null,
          nazione: 'Italia',
          source: 'admin',
          created_at: new Date().toISOString(),
          // Top-level patente fields (same as NewClientModal)
          patente: d.patente_numero?.toUpperCase() || null,
          numero_patente: d.patente_numero?.toUpperCase() || null,
          tipo_patente: d.patente_tipo || null,
          data_rilascio_patente: d.patente_rilascio || null,
          scadenza_patente: d.patente_scadenza || null,
          emessa_da: d.patente_ente || null,
          metadata: {
            sesso: d.sesso || null,
            provincia_nascita: d.provincia_nascita || null,
            patente: {
              numero: d.patente_numero || null,
              tipo: d.patente_tipo || null,
              ente: d.patente_ente || null,
              rilascio: d.patente_rilascio || null,
              scadenza: d.patente_scadenza || null,
            },
            documento_tipo: d.documento_tipo || null,
            documento_numero: d.documento_numero || null,
            documento_rilascio: d.documento_rilascio || null,
            documento_scadenza: d.documento_scadenza || null,
            documento_ente: d.documento_ente || null,
            imported_at: new Date().toISOString(),
            import_source: 'bulk_import',
            extraction_confidence: d.confidence || null
          }
        }

        // Save via save-customer Netlify function (bypasses RLS, same as NewClientModal)
        let createdClientId: string | null = existingId

        if (existingId) {
          const response = await fetch(`${FUNCTIONS_BASE}/.netlify/functions/save-customer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customerData, customerId: existingId })
          })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'Update failed')
        } else {
          const response = await fetch(`${FUNCTIONS_BASE}/.netlify/functions/save-customer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customerData })
          })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'Insert failed')
          createdClientId = result.customer?.id
        }

        // Also insert/update basic customers table for backward compatibility
        if (createdClientId) {
          const basicData = {
            id: createdClientId,
            full_name: `${d.nome || ''} ${d.cognome || ''}`.trim(),
            driver_license_number: d.patente_numero?.toUpperCase() || null,
            tipo_cliente: 'persona_fisica',
            updated_at: new Date().toISOString()
          }

          if (existingId) {
            await supabase.from('customers').update(basicData).eq('id', existingId)
          } else {
            await supabase.from('customers').insert([{ ...basicData, created_at: new Date().toISOString() }])
          }
        }

        // Upload document file to Supabase Storage
        const file = files[customer.fileIndex]
        if (createdClientId && file && user) {
          try {
            const { bucket, docType: storageDocType } = getDocStorageInfo(d.document_type)
            const fileExt = file.name.split('.').pop()
            const fileName = `${storageDocType}_${Date.now()}.${fileExt}`
            const filePath = `${createdClientId}/${fileName}`

            const { error: uploadError } = await supabase.storage
              .from(bucket)
              .upload(filePath, file, {
                cacheControl: '3600',
                upsert: true
              })

            if (uploadError) {
              console.warn('Document upload error (non-fatal):', uploadError)
            } else {
              // Record in customer_documents table
              await supabase.from('customer_documents').insert({
                customer_id: createdClientId,
                document_type: storageDocType,
                file_name: file.name,
                file_path: filePath,
                file_size: file.size,
                mime_type: file.type,
                bucket_id: bucket,
                uploaded_by: user.id
              })
            }
          } catch (uploadErr) {
            console.warn('Document upload failed (non-fatal):', uploadErr)
          }
        }

        // Mark as saved
        setCustomers(prev => prev.map(c =>
          c.fileIndex === customer.fileIndex ? { ...c, saved: true } : c
        ))
        setSavedCount(prev => prev + 1)
      } catch (error: any) {
        console.error('Error saving customer:', error)
        setCustomers(prev => prev.map(c =>
          c.fileIndex === customer.fileIndex
            ? { ...c, error: `Save failed: ${error.message}` }
            : c
        ))
      }
    }

    setIsSaving(false)
  }

  const successCount = customers.filter(c => c.status === 'done').length
  const errorCount = customers.filter(c => c.status === 'error').length
  const savedTotal = customers.filter(c => c.saved).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-theme-text-primary">Import Clienti in Massa</h2>
          <p className="text-sm text-theme-text-muted mt-1">
            Carica documenti (CI, patente, CF) e i dati verranno estratti automaticamente con AI
          </p>
        </div>
      </div>

      {/* Drop Zone */}
      {!isProcessing && customers.length === 0 && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className="border-2 border-dashed border-gray-600 rounded-xl p-12 text-center hover:border-white/50 transition-colors bg-gray-800/30"
        >
          <svg className="w-16 h-16 mx-auto text-gray-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-lg text-theme-text-primary font-semibold mb-2">
            Trascina file o cartelle qui
          </p>
          <p className="text-sm text-theme-text-muted mb-4">
            Supporta JPG, PNG, PDF - Carte d'identita, patenti, tessere sanitarie
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-5 py-2 bg-white text-black rounded-lg font-semibold text-sm hover:bg-gray-200 transition-colors"
            >
              Seleziona File
            </button>
            <button
              onClick={() => folderInputRef.current?.click()}
              className="px-5 py-2 bg-gray-700 text-white rounded-lg font-semibold text-sm hover:bg-gray-600 transition-colors"
            >
              Seleziona Cartella
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
          {/* @ts-ignore - webkitdirectory is non-standard but widely supported */}
          <input
            ref={folderInputRef}
            type="file"
            // @ts-ignore
            webkitdirectory=""
            directory=""
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      )}

      {/* File List (before processing) */}
      {files.length > 0 && customers.length === 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-theme-text-primary font-semibold">{files.length} documenti selezionati</p>
            <div className="flex gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm hover:bg-gray-600 transition-colors"
              >
                + Aggiungi file
              </button>
              <button
                onClick={() => folderInputRef.current?.click()}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm hover:bg-gray-600 transition-colors"
              >
                + Aggiungi cartella
              </button>
              <button
                onClick={processFiles}
                className="px-6 py-2 bg-white text-black rounded-lg font-bold text-sm hover:bg-gray-200 transition-colors"
              >
                Avvia Estrazione AI
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {files.map((file, i) => (
              <div key={i} className="relative bg-gray-800/50 rounded-lg border border-theme-border p-3 group">
                <button
                  onClick={() => removeFile(i)}
                  className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-6 h-6 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  X
                </button>
                <div className="text-center">
                  <svg className="w-8 h-8 mx-auto text-gray-500 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-xs text-theme-text-muted truncate">{file.name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Processing Progress */}
      {isProcessing && (
        <div className="bg-gray-800/50 rounded-xl border border-theme-border p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 border-2 border-t-white border-gray-600 rounded-full animate-spin" />
              <p className="text-theme-text-primary font-semibold">
                Estrazione in corso... {processedCount}/{files.length}
              </p>
            </div>
            <button
              onClick={stopProcessing}
              className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors"
            >
              Interrompi
            </button>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-white h-2 rounded-full transition-all duration-300"
              style={{ width: `${(processedCount / files.length) * 100}%` }}
            />
          </div>
          <div className="flex gap-4 mt-3 text-sm">
            <span className="text-green-400">{successCount} estratti</span>
            <span className="text-red-400">{errorCount} errori</span>
          </div>
        </div>
      )}

      {/* Results Table */}
      {customers.length > 0 && !isProcessing && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex items-center justify-between">
            <div className="flex gap-4 text-sm">
              <span className="text-green-400 font-semibold">{successCount} estratti</span>
              <span className="text-red-400 font-semibold">{errorCount} errori</span>
              {savedTotal > 0 && <span className="text-blue-400 font-semibold">{savedTotal} salvati</span>}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setFiles([]); setCustomers([]); setProcessedCount(0); setSavedCount(0) }}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm hover:bg-gray-600 transition-colors"
              >
                Ricomincia
              </button>
              <button
                onClick={saveAllCustomers}
                disabled={isSaving || successCount === 0 || savedTotal === successCount}
                className="px-6 py-2 bg-green-600 text-white rounded-lg font-bold text-sm hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving
                  ? `Salvataggio ${savedCount}/${successCount - savedTotal}...`
                  : savedTotal === successCount
                    ? 'Tutti salvati'
                    : `Salva ${successCount - savedTotal} Clienti`
                }
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-gray-800/50 rounded-xl border border-theme-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-900/50 text-theme-text-muted text-xs">
                    <th className="text-left px-4 py-3 w-8">#</th>
                    <th className="text-left px-4 py-3">File</th>
                    <th className="text-left px-4 py-3">Nome</th>
                    <th className="text-left px-4 py-3">Cognome</th>
                    <th className="text-left px-4 py-3">Codice Fiscale</th>
                    <th className="text-left px-4 py-3">Data Nascita</th>
                    <th className="text-left px-4 py-3">Tipo Doc</th>
                    <th className="text-center px-4 py-3">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer, i) => (
                    <>
                      <tr
                        key={`row-${i}`}
                        onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                        className={`border-t border-theme-border cursor-pointer transition-colors ${
                          customer.saved ? 'bg-green-900/10' :
                          customer.status === 'error' ? 'bg-red-900/10' :
                          'hover:bg-gray-700/30'
                        }`}
                      >
                        <td className="px-4 py-3 text-theme-text-muted">{i + 1}</td>
                        <td className="px-4 py-3 text-theme-text-muted text-xs truncate max-w-[120px]">{customer.fileName}</td>
                        <td className="px-4 py-3 text-theme-text-primary font-medium">{customer.data?.nome || '-'}</td>
                        <td className="px-4 py-3 text-theme-text-primary font-medium">{customer.data?.cognome || '-'}</td>
                        <td className="px-4 py-3 text-theme-text-primary font-mono text-xs">{customer.data?.codice_fiscale || '-'}</td>
                        <td className="px-4 py-3 text-theme-text-primary">{customer.data?.data_nascita || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            customer.data?.document_type === 'carta_identita' ? 'bg-blue-500/20 text-blue-400' :
                            customer.data?.document_type === 'patente' ? 'bg-purple-500/20 text-purple-400' :
                            'bg-gray-500/20 text-gray-400'
                          }`}>
                            {customer.data?.document_type === 'carta_identita' ? 'CI' :
                             customer.data?.document_type === 'patente' ? 'Patente' :
                             customer.data?.document_type || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {customer.status === 'processing' && (
                            <div className="w-4 h-4 border-2 border-t-white border-gray-600 rounded-full animate-spin mx-auto" />
                          )}
                          {customer.status === 'done' && !customer.saved && (
                            <span className="text-green-400 text-xs font-semibold">Estratto</span>
                          )}
                          {customer.saved && (
                            <span className="text-blue-400 text-xs font-semibold">Salvato</span>
                          )}
                          {customer.status === 'error' && (
                            <span className="text-red-400 text-xs" title={customer.error}>Errore</span>
                          )}
                          {customer.status === 'pending' && (
                            <span className="text-gray-500 text-xs">In attesa</span>
                          )}
                        </td>
                      </tr>
                      {/* Expanded row for editing */}
                      {expandedRow === i && customer.data && (
                        <tr key={`detail-${i}`} className="border-t border-theme-border bg-gray-900/30">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              {[
                                { key: 'nome', label: 'Nome' },
                                { key: 'cognome', label: 'Cognome' },
                                { key: 'sesso', label: 'Sesso' },
                                { key: 'data_nascita', label: 'Data Nascita' },
                                { key: 'luogo_nascita', label: 'Luogo Nascita' },
                                { key: 'provincia_nascita', label: 'Prov. Nascita' },
                                { key: 'codice_fiscale', label: 'Codice Fiscale' },
                                { key: 'indirizzo', label: 'Indirizzo' },
                                { key: 'numero_civico', label: 'N. Civico' },
                                { key: 'codice_postale', label: 'CAP' },
                                { key: 'citta_residenza', label: 'Citta' },
                                { key: 'provincia_residenza', label: 'Provincia' },
                                { key: 'documento_numero', label: 'N. Documento' },
                                { key: 'documento_scadenza', label: 'Scad. Documento' },
                                { key: 'patente_numero', label: 'N. Patente' },
                                { key: 'patente_tipo', label: 'Tipo Patente' },
                                { key: 'patente_scadenza', label: 'Scad. Patente' },
                                { key: 'patente_ente', label: 'Ente Patente' },
                              ].map(field => (
                                <div key={field.key}>
                                  <label className="text-xs text-theme-text-muted">{field.label}</label>
                                  <input
                                    type="text"
                                    value={(customer.data as any)?.[field.key] || ''}
                                    onChange={(e) => updateCustomerField(i, field.key, e.target.value)}
                                    className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
                                  />
                                </div>
                              ))}
                            </div>
                            {customer.data.notes && (
                              <p className="mt-3 text-xs text-yellow-400">Note: {customer.data.notes}</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
