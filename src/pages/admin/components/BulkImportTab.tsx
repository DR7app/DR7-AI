import { useState, useRef, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { logger } from '../../../utils/logger'

interface ExtractedData {
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

interface TrackedFile {
  file: File
  folder: string | null  // parent folder name, null if flat file
}

interface ExtractedFile {
  fileIndex: number
  fileName: string
  folder: string | null
  status: 'pending' | 'processing' | 'done' | 'error'
  error?: string
  data?: ExtractedData
}

// A merged customer groups multiple documents from the same person
interface MergedCustomer {
  key: string
  sources: { fileIndex: number; fileName: string; docType: string }[]
  data: ExtractedData
  saved: boolean
  error?: string
}

const FUNCTIONS_BASE = import.meta.env.DEV ? 'http://localhost:8888' : ''

export default function BulkImportTab() {
  const [trackedFiles, setTrackedFiles] = useState<TrackedFile[]>([])
  const [extractedFiles, setExtractedFiles] = useState<ExtractedFile[]>([])
  const [mergedCustomers, setMergedCustomers] = useState<MergedCustomer[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [processedCount, setProcessedCount] = useState(0)
  const [savedCount, setSavedCount] = useState(0)
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef(false)

  // Convenience: raw File array for base64/upload operations
  const files = trackedFiles.map(t => t.file)

  const isValidFile = (file: File) =>
    file.type.startsWith('image/') || file.type === 'application/pdf'

  // Extract parent folder name from webkitRelativePath (e.g. "ClienteA/fronte_ci.jpg" → "ClienteA")
  const getFolderFromPath = (path: string): string | null => {
    if (!path) return null
    const parts = path.split('/')
    // If path has at least 2 parts, the first meaningful folder is parts[0] for shallow
    // or the second-to-last for deep nesting. We want the immediate parent folder.
    if (parts.length >= 2) {
      // For "RootFolder/ClienteA/file.jpg" → "ClienteA" (immediate parent)
      // For "ClienteA/file.jpg" → "ClienteA"
      return parts[parts.length - 2] || null
    }
    return null
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newTracked: TrackedFile[] = Array.from(e.target.files)
        .filter(isValidFile)
        .map(file => ({
          file,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          folder: getFolderFromPath((file as any).webkitRelativePath || '')
        }))
      setTrackedFiles(prev => [...prev, ...newTracked])
    }
  }

  // Recursively read all files from a dropped directory entry, tracking folder path
  const readEntryFiles = (entry: FileSystemEntry, parentFolder: string | null): Promise<TrackedFile[]> => {
    return new Promise((resolve) => {
      if (entry.isFile) {
        (entry as FileSystemFileEntry).file(
          (file) => resolve(isValidFile(file) ? [{ file, folder: parentFolder }] : []),
          () => resolve([])
        )
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        const allTracked: TrackedFile[] = []

        const readBatch = () => {
          reader.readEntries(async (entries) => {
            if (entries.length === 0) {
              resolve(allTracked)
              return
            }
            for (const child of entries) {
              // Files directly inside this directory get this directory as their folder
              const childTracked = await readEntryFiles(child, entry.name)
              allTracked.push(...childTracked)
            }
            readBatch()
          }, () => resolve(allTracked))
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
      const droppedTracked = Array.from(e.dataTransfer.files)
        .filter(isValidFile)
        .map(file => ({ file, folder: null as string | null }))
      setTrackedFiles(prev => [...prev, ...droppedTracked])
      return
    }

    const collectedTracked: TrackedFile[] = []
    const entries: FileSystemEntry[] = []
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.()
      if (entry) entries.push(entry)
    }

    if (entries.length > 0) {
      for (const entry of entries) {
        // Top-level entry: if it's a directory, its children get that dir name as folder
        // If it's a file at root, folder = null
        const entryTracked = await readEntryFiles(entry, entry.isDirectory ? null : null)
        collectedTracked.push(...entryTracked)
      }
    } else {
      const fallback = Array.from(e.dataTransfer.files)
        .filter(isValidFile)
        .map(file => ({ file, folder: null as string | null }))
      collectedTracked.push(...fallback)
    }

    if (collectedTracked.length > 0) {
      setTrackedFiles(prev => [...prev, ...collectedTracked])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const removeFile = (index: number) => {
    setTrackedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        const base64 = result.split(',')[1]
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // --- Merge logic: group extracted docs by same person ---
  const normalizeKey = (nome?: string, cognome?: string): string => {
    const n = (nome || '').trim().toLowerCase().replace(/\s+/g, ' ')
    const c = (cognome || '').trim().toLowerCase().replace(/\s+/g, ' ')
    return `${n}|${c}`
  }

  const mergeExtractedFiles = (extracted: ExtractedFile[]): MergedCustomer[] => {
    const successful = extracted.filter(e => e.status === 'done' && e.data)

    // PRIMARY: Group by folder (all files in the same folder = same customer)
    // FALLBACK: For files without a folder, group by codice_fiscale or nome+cognome
    const groups = new Map<string, ExtractedFile[]>()

    for (const entry of successful) {
      // If file has a folder, that's the strongest grouping signal
      if (entry.folder) {
        const folderKey = `__folder_${entry.folder.trim().toLowerCase()}`
        if (groups.has(folderKey)) {
          groups.get(folderKey)!.push(entry)
        } else {
          groups.set(folderKey, [entry])
        }
        continue
      }

      // No folder - fall back to codice_fiscale / nome+cognome matching
      const cf = entry.data?.codice_fiscale?.trim().toUpperCase()
      const nameKey = normalizeKey(entry.data?.nome, entry.data?.cognome)

      if (nameKey === '|' && !cf) {
        const soloKey = `__solo_${entry.fileIndex}`
        groups.set(soloKey, [entry])
        continue
      }

      let matchedKey: string | null = null

      if (cf) {
        for (const [key, members] of groups) {
          if (key.startsWith('__folder_')) continue // Don't cross-match with folder groups
          const memberCf = members[0].data?.codice_fiscale?.trim().toUpperCase()
          if (memberCf && memberCf === cf) {
            matchedKey = key
            break
          }
        }
      }

      if (!matchedKey && nameKey !== '|') {
        for (const [key, members] of groups) {
          if (key.startsWith('__folder_')) continue
          const memberNameKey = normalizeKey(members[0].data?.nome, members[0].data?.cognome)
          if (memberNameKey !== '|' && memberNameKey === nameKey) {
            matchedKey = key
            break
          }
        }
      }

      if (matchedKey) {
        groups.get(matchedKey)!.push(entry)
      } else {
        const groupKey = cf || nameKey
        groups.set(groupKey, [entry])
      }
    }

    // Now merge each group into a single MergedCustomer
    const merged: MergedCustomer[] = []

    for (const [key, members] of groups) {
      const sources = members.map(m => ({
        fileIndex: m.fileIndex,
        fileName: m.fileName,
        docType: m.data?.document_type || 'sconosciuto'
      }))

      // Merge data: for each field, take the first non-empty value across all docs
      const mergedData: ExtractedData = {}
      const allFields: (keyof ExtractedData)[] = [
        'nome', 'cognome', 'sesso', 'data_nascita', 'luogo_nascita', 'provincia_nascita',
        'codice_fiscale', 'indirizzo', 'numero_civico', 'codice_postale',
        'citta_residenza', 'provincia_residenza',
        'documento_tipo', 'documento_numero', 'documento_rilascio',
        'documento_scadenza', 'documento_ente',
        'patente_numero', 'patente_tipo', 'patente_rilascio',
        'patente_scadenza', 'patente_ente',
      ]

      for (const field of allFields) {
        for (const member of members) {
          const val = member.data?.[field]
          if (val && val.trim()) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (mergedData as any)[field] = val
            break
          }
        }
      }

      // Collect all document types
      const docTypes = members.map(m => m.data?.document_type).filter(Boolean)
      if (docTypes.length > 0) mergedData.document_type = docTypes.join(', ')

      merged.push({
        key,
        sources,
        data: mergedData,
        saved: false
      })
    }

    return merged
  }

  const processFiles = async () => {
    if (files.length === 0) return
    setIsProcessing(true)
    setProcessedCount(0)
    setMergedCustomers([])
    abortRef.current = false

    const initialExtracted: ExtractedFile[] = trackedFiles.map((tf, index) => ({
      fileIndex: index,
      fileName: tf.file.name,
      folder: tf.folder,
      status: 'pending'
    }))
    setExtractedFiles(initialExtracted)

    const results = [...initialExtracted]

    for (let i = 0; i < files.length; i++) {
      if (abortRef.current) break

      results[i] = { ...results[i], status: 'processing' }
      setExtractedFiles([...results])

      try {
        const base64 = await fileToBase64(files[i])

        const response = await fetch(`${FUNCTIONS_BASE}/.netlify/functions/extract-document-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64 })
        })

        const result = await response.json()

        if (response.ok && result.success) {
          results[i] = { ...results[i], status: 'done', data: result.data }
        } else {
          results[i] = { ...results[i], status: 'error', error: result.error || 'Extraction failed' }
        }
      } catch (error: unknown) {
        const _errMsg = error instanceof Error ? error.message : String(error)
        results[i] = { ...results[i], status: 'error', error: _errMsg }
      }

      setExtractedFiles([...results])
      setProcessedCount(i + 1)

      if (i < files.length - 1 && !abortRef.current) {
        await new Promise(r => setTimeout(r, 500))
      }
    }

    // After all files processed, merge by person
    const merged = mergeExtractedFiles(results)
    setMergedCustomers(merged)
    setIsProcessing(false)
  }

  const stopProcessing = () => {
    abortRef.current = true
  }

  const updateMergedField = (index: number, field: string, value: string) => {
    setMergedCustomers(prev => prev.map((c, idx) =>
      idx === index ? { ...c, data: { ...c.data, [field]: value } } : c
    ))
  }

  // Sanitize extracted data to fit DB column constraints
  const sanitizeForDb = (d: ExtractedData): ExtractedData => {
    const clean = { ...d }

    // sesso: VARCHAR(1) - take only first character
    if (clean.sesso) clean.sesso = clean.sesso.trim().charAt(0).toUpperCase()

    // provincia: VARCHAR(2) - extract 2-letter code or take first 2 chars
    const sanitizeProvincia = (val?: string): string | undefined => {
      if (!val) return val
      const trimmed = val.trim().toUpperCase()
      // If already 2 chars, keep it
      if (trimmed.length <= 2) return trimmed
      // If it contains a 2-letter code in parentheses like "Cagliari (CA)", extract it
      const match = trimmed.match(/\(([A-Z]{2})\)/)
      if (match) return match[1]
      // Otherwise truncate to 2
      return trimmed.substring(0, 2)
    }
    clean.provincia_nascita = sanitizeProvincia(clean.provincia_nascita)
    clean.provincia_residenza = sanitizeProvincia(clean.provincia_residenza)

    // codice_postale: VARCHAR(5)
    if (clean.codice_postale) clean.codice_postale = clean.codice_postale.trim().substring(0, 5)

    // codice_fiscale: VARCHAR(16)
    if (clean.codice_fiscale) clean.codice_fiscale = clean.codice_fiscale.trim().substring(0, 16)

    // numero_civico: VARCHAR(10)
    if (clean.numero_civico) clean.numero_civico = clean.numero_civico.trim().substring(0, 10)

    // patente_tipo: VARCHAR(20)
    if (clean.patente_tipo) clean.patente_tipo = clean.patente_tipo.trim().substring(0, 20)

    // documento_numero: VARCHAR(20)
    if (clean.documento_numero) clean.documento_numero = clean.documento_numero.trim().substring(0, 20)

    // patente_numero: VARCHAR(20)
    if (clean.patente_numero) clean.patente_numero = clean.patente_numero.trim().substring(0, 20)

    // Truncate longer text fields to safe limits
    if (clean.nome) clean.nome = clean.nome.trim().substring(0, 100)
    if (clean.cognome) clean.cognome = clean.cognome.trim().substring(0, 100)
    if (clean.luogo_nascita) clean.luogo_nascita = clean.luogo_nascita.trim().substring(0, 100)
    if (clean.indirizzo) clean.indirizzo = clean.indirizzo.trim().substring(0, 200)
    if (clean.citta_residenza) clean.citta_residenza = clean.citta_residenza.trim().substring(0, 100)
    if (clean.documento_ente) clean.documento_ente = clean.documento_ente.trim().substring(0, 100)
    if (clean.patente_ente) clean.patente_ente = clean.patente_ente.trim().substring(0, 100)

    return clean
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
    const toSave = mergedCustomers.filter(c => !c.saved && !c.error)
    if (toSave.length === 0) return

    setIsSaving(true)
    setSavedCount(0)

    const { data: { user } } = await supabase.auth.getUser()

    for (let mi = 0; mi < mergedCustomers.length; mi++) {
      const customer = mergedCustomers[mi]
      if (customer.saved || customer.error) continue

      const d = sanitizeForDb(customer.data)

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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            merged_documents: customer.sources.length,
            source_files: customer.sources.map(s => s.fileName)
          }
        }

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

        // Upload ALL document files for this merged customer
        if (createdClientId && user) {
          for (const source of customer.sources) {
            const file = files[source.fileIndex]
            if (!file) continue

            try {
              const { bucket, docType: storageDocType } = getDocStorageInfo(source.docType)
              const fileExt = file.name.split('.').pop()
              const fileName = `${storageDocType}_${Date.now()}_${source.fileIndex}.${fileExt}`
              const filePath = `${createdClientId}/${fileName}`

              const { error: uploadError } = await supabase.storage
                .from(bucket)
                .upload(filePath, file, {
                  cacheControl: '3600',
                  upsert: true
                })

              if (uploadError) {
                logger.warn('Document upload error (non-fatal):', uploadError)
              } else {
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
              logger.warn('Document upload failed (non-fatal):', uploadErr)
            }
          }
        }

        setMergedCustomers(prev => prev.map((c, idx) =>
          idx === mi ? { ...c, saved: true } : c
        ))
        setSavedCount(prev => prev + 1)
      } catch (error: unknown) {
        const _errMsg = error instanceof Error ? error.message : String(error)
        console.error('Error saving customer:', error)
        setMergedCustomers(prev => prev.map((c, idx) =>
          idx === mi ? { ...c, error: `Save failed: ${_errMsg}` } : c
        ))
      }
    }

    setIsSaving(false)
  }

  const extractedSuccess = extractedFiles.filter(c => c.status === 'done').length
  const extractedErrors = extractedFiles.filter(c => c.status === 'error').length
  const mergedCount = mergedCustomers.length
  const mergedWithMultipleDocs = mergedCustomers.filter(c => c.sources.length > 1).length
  const savedTotal = mergedCustomers.filter(c => c.saved).length
  const unsavedCount = mergedCustomers.filter(c => !c.saved && !c.error).length

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
      {!isProcessing && mergedCustomers.length === 0 && extractedFiles.length === 0 && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className="border-2 border-dashed border-theme-border rounded-xl p-12 text-center hover:border-theme-border transition-colors bg-theme-bg-secondary/30"
        >
          <svg className="w-16 h-16 mx-auto text-theme-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              className="px-5 py-2 bg-theme-text-primary text-theme-bg-primary rounded-lg font-semibold text-sm hover:bg-theme-bg-hover transition-colors"
            >
              Seleziona File
            </button>
            <button
              onClick={() => folderInputRef.current?.click()}
              className="px-5 py-2 bg-theme-bg-tertiary text-theme-text-primary rounded-lg font-semibold text-sm hover:bg-theme-bg-hover transition-colors"
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
          <input
            ref={folderInputRef}
            type="file"
            {...{ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      )}

      {/* File List (before processing) */}
      {trackedFiles.length > 0 && mergedCustomers.length === 0 && extractedFiles.length === 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-theme-text-primary font-semibold">{trackedFiles.length} documenti selezionati</p>
              {(() => {
                const folders = new Set(trackedFiles.map(t => t.folder).filter(Boolean))
                return folders.size > 0 ? (
                  <p className="text-xs text-theme-text-muted mt-0.5">da {folders.size} cartelle</p>
                ) : null
              })()}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-theme-bg-tertiary text-theme-text-primary rounded-lg text-sm hover:bg-theme-bg-hover transition-colors"
              >
                + Aggiungi file
              </button>
              <button
                onClick={() => folderInputRef.current?.click()}
                className="px-4 py-2 bg-theme-bg-tertiary text-theme-text-primary rounded-lg text-sm hover:bg-theme-bg-hover transition-colors"
              >
                + Aggiungi cartella
              </button>
              <button
                onClick={processFiles}
                className="px-6 py-2 bg-theme-text-primary text-theme-bg-primary rounded-lg font-bold text-sm hover:bg-theme-bg-hover transition-colors"
              >
                Avvia Estrazione AI
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {trackedFiles.map((tf, i) => (
              <div key={i} className="relative bg-theme-bg-secondary/50 rounded-lg border border-theme-border p-3 group">
                <button
                  onClick={() => removeFile(i)}
                  className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-6 h-6 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  X
                </button>
                <div className="text-center">
                  <svg className="w-8 h-8 mx-auto text-theme-text-muted mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  {tf.folder && (
                    <p className="text-[10px] text-dr7-gold truncate">{tf.folder}/</p>
                  )}
                  <p className="text-xs text-theme-text-muted truncate">{tf.file.name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Processing Progress */}
      {isProcessing && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 border-2 border-t-white border-theme-border rounded-full animate-spin" />
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
          <div className="w-full bg-theme-bg-tertiary rounded-full h-2">
            <div
              className="bg-theme-text-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${(processedCount / files.length) * 100}%` }}
            />
          </div>
          <div className="flex gap-4 mt-3 text-sm">
            <span className="text-green-400">{extractedSuccess} estratti</span>
            <span className="text-red-400">{extractedErrors} errori</span>
          </div>
        </div>
      )}

      {/* Merged Results */}
      {mergedCustomers.length > 0 && !isProcessing && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex items-center justify-between">
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-green-400 font-semibold">{extractedSuccess} documenti estratti</span>
              {extractedErrors > 0 && <span className="text-red-400 font-semibold">{extractedErrors} errori</span>}
              <span className="text-theme-text-primary font-semibold">{mergedCount} clienti identificati</span>
              {mergedWithMultipleDocs > 0 && (
                <span className="text-dr7-gold font-semibold">{mergedWithMultipleDocs} uniti da piu documenti</span>
              )}
              {savedTotal > 0 && <span className="text-blue-400 font-semibold">{savedTotal} salvati</span>}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setTrackedFiles([]); setExtractedFiles([]); setMergedCustomers([]); setProcessedCount(0); setSavedCount(0) }}
                className="px-4 py-2 bg-theme-bg-tertiary text-theme-text-primary rounded-lg text-sm hover:bg-theme-bg-hover transition-colors"
              >
                Ricomincia
              </button>
              <button
                onClick={saveAllCustomers}
                disabled={isSaving || unsavedCount === 0}
                className="px-6 py-2 bg-green-600 text-white rounded-lg font-bold text-sm hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving
                  ? `Salvataggio ${savedCount}/${unsavedCount}...`
                  : unsavedCount === 0
                    ? 'Tutti salvati'
                    : `Salva ${unsavedCount} Clienti`
                }
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-theme-bg-primary/50 text-theme-text-muted text-xs">
                    <th className="text-left px-4 py-3 w-8">#</th>
                    <th className="text-left px-4 py-3">Documenti</th>
                    <th className="text-left px-4 py-3">Nome</th>
                    <th className="text-left px-4 py-3">Cognome</th>
                    <th className="text-left px-4 py-3">Codice Fiscale</th>
                    <th className="text-left px-4 py-3">Data Nascita</th>
                    <th className="text-left px-4 py-3">Tipi Doc</th>
                    <th className="text-center px-4 py-3">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {mergedCustomers.map((customer, i) => (
                    <>
                      <tr
                        key={`row-${i}`}
                        onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                        className={`border-t border-theme-border cursor-pointer transition-colors ${
                          customer.saved ? 'bg-green-900/10' :
                          customer.error ? 'bg-red-900/10' :
                          customer.sources.length > 1 ? 'bg-dr7-gold/5' :
                          'hover:bg-theme-bg-tertiary/30'
                        }`}
                      >
                        <td className="px-4 py-3 text-theme-text-muted">{i + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {customer.sources.length > 1 && (
                              <span className="bg-dr7-gold text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                                {customer.sources.length}
                              </span>
                            )}
                            <div className="text-xs text-theme-text-muted truncate max-w-[160px]">
                              {customer.sources.map(s => s.fileName).join(', ')}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-theme-text-primary font-medium">{customer.data.nome || '-'}</td>
                        <td className="px-4 py-3 text-theme-text-primary font-medium">{customer.data.cognome || '-'}</td>
                        <td className="px-4 py-3 text-theme-text-primary font-mono text-xs">{customer.data.codice_fiscale || '-'}</td>
                        <td className="px-4 py-3 text-theme-text-primary">{customer.data.data_nascita || '-'}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {customer.sources.map((s, si) => (
                              <span key={si} className={`text-xs px-2 py-0.5 rounded-full ${
                                s.docType === 'carta_identita' ? 'bg-blue-500/20 text-blue-400' :
                                s.docType === 'patente' ? 'bg-purple-500/20 text-purple-400' :
                                s.docType === 'codice_fiscale' || s.docType === 'tessera_sanitaria' ? 'bg-green-500/20 text-green-400' :
                                'bg-theme-bg-hover/20 text-theme-text-muted'
                              }`}>
                                {s.docType === 'carta_identita' ? 'CI' :
                                 s.docType === 'patente' ? 'Patente' :
                                 s.docType === 'codice_fiscale' ? 'CF' :
                                 s.docType === 'tessera_sanitaria' ? 'TS' :
                                 s.docType}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {customer.saved ? (
                            <span className="text-blue-400 text-xs font-semibold">Salvato</span>
                          ) : customer.error ? (
                            <span className="text-red-400 text-xs" title={customer.error}>Errore</span>
                          ) : customer.sources.length > 1 ? (
                            <span className="text-dr7-gold text-xs font-semibold">Unito</span>
                          ) : (
                            <span className="text-green-400 text-xs font-semibold">Estratto</span>
                          )}
                        </td>
                      </tr>
                      {/* Expanded row for editing */}
                      {expandedRow === i && (
                        <tr key={`detail-${i}`} className="border-t border-theme-border bg-theme-bg-primary/30">
                          <td colSpan={8} className="px-6 py-4">
                            {/* Source files list */}
                            {customer.sources.length > 1 && (
                              <div className="mb-4 p-3 bg-dr7-gold/10 rounded-lg border border-dr7-gold/30">
                                <p className="text-xs font-semibold text-dr7-gold mb-1">Documenti uniti ({customer.sources.length} file):</p>
                                <div className="flex flex-wrap gap-2">
                                  {customer.sources.map((s, si) => (
                                    <span key={si} className="text-xs bg-theme-bg-secondary text-theme-text-muted px-2 py-1 rounded">
                                      {s.fileName} ({s.docType === 'carta_identita' ? 'CI' :
                                       s.docType === 'patente' ? 'Patente' :
                                       s.docType === 'codice_fiscale' ? 'CF' : s.docType})
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
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
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    value={(customer.data as any)?.[field.key] || ''}
                                    onChange={(e) => updateMergedField(i, field.key, e.target.value)}
                                    className="mt-1 w-full bg-theme-bg-secondary border border-theme-border rounded px-2 py-1 text-sm text-theme-text-primary"
                                  />
                                </div>
                              ))}
                            </div>
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
