/**
 * CompilaButton — Universal document auto-fill component
 *
 * Reads uploaded document images via Claude Vision OCR,
 * extracts personal/document/license data, and fills form fields.
 *
 * Usage:
 *   <CompilaButton
 *     documents={[{ file: File | string, label: 'Carta Identità Fronte' }]}
 *     currentData={{ nome: 'Mario', cognome: '' }}
 *     onDataExtracted={(data, conflicts) => { setFormData(...) }}
 *   />
 */

import { useState } from 'react'

export interface ExtractedData {
  // Personal
  nome?: string
  cognome?: string
  sesso?: 'M' | 'F' | ''
  data_nascita?: string
  luogo_nascita?: string
  provincia_nascita?: string
  codice_fiscale?: string
  // Address
  indirizzo?: string
  numero_civico?: string
  codice_postale?: string
  citta_residenza?: string
  provincia_residenza?: string
  // Identity document
  documento_tipo?: string
  documento_numero?: string
  documento_rilascio?: string
  documento_scadenza?: string
  documento_ente?: string
  // Driver's license
  patente_numero?: string
  patente_tipo?: string
  patente_rilascio?: string
  patente_scadenza?: string
  patente_ente?: string
  // Meta
  document_type?: string
  confidence?: string
  notes?: string
  [key: string]: string | undefined
}

export interface DataConflict {
  field: string
  currentValue: string
  extractedValue: string
}

interface DocumentInput {
  file: File | string | null  // File object, base64 string, or URL
  label?: string
}

interface CompilaButtonProps {
  documents: DocumentInput[]
  currentData?: Record<string, string | undefined | null>
  onDataExtracted: (data: ExtractedData, conflicts: DataConflict[]) => void
  onError?: (error: string) => void
  className?: string
  disabled?: boolean
}

async function compressImage(file: File, maxSizeKB = 4000, maxDim = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)

      let quality = 0.9
      let base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1]
      while (base64.length > maxSizeKB * 1024 * 1.37 && quality > 0.3) {
        quality -= 0.1
        base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1]
      }
      resolve(base64)
    }
    img.onerror = reject
    img.src = url
  })
}

function mergeExtractedData(results: ExtractedData[]): ExtractedData {
  const merged: ExtractedData = {}
  for (const result of results) {
    for (const [key, value] of Object.entries(result)) {
      if (!value || key === 'document_type' || key === 'confidence' || key === 'notes' || key === 'raw_text') continue
      // Keep first non-empty value for each field
      if (!merged[key]) {
        merged[key] = value
      }
    }
  }
  return merged
}

function findConflicts(
  currentData: Record<string, string | undefined | null>,
  extracted: ExtractedData
): DataConflict[] {
  const conflicts: DataConflict[] = []
  for (const [key, extractedValue] of Object.entries(extracted)) {
    if (!extractedValue) continue
    if (['document_type', 'confidence', 'notes', 'raw_text'].includes(key)) continue
    const currentValue = currentData[key]
    if (currentValue && currentValue.trim() !== '' && currentValue.toLowerCase().trim() !== extractedValue.toLowerCase().trim()) {
      conflicts.push({ field: key, currentValue, extractedValue })
    }
  }
  return conflicts
}

const FIELD_LABELS: Record<string, string> = {
  nome: 'Nome',
  cognome: 'Cognome',
  sesso: 'Sesso',
  data_nascita: 'Data di nascita',
  luogo_nascita: 'Luogo di nascita',
  provincia_nascita: 'Provincia nascita',
  codice_fiscale: 'Codice fiscale',
  indirizzo: 'Indirizzo',
  numero_civico: 'N. civico',
  codice_postale: 'CAP',
  citta_residenza: 'Città residenza',
  provincia_residenza: 'Provincia residenza',
  documento_tipo: 'Tipo documento',
  documento_numero: 'N. documento',
  documento_rilascio: 'Rilascio documento',
  documento_scadenza: 'Scadenza documento',
  documento_ente: 'Ente rilascio',
  patente_numero: 'N. patente',
  patente_tipo: 'Tipo patente',
  patente_rilascio: 'Rilascio patente',
  patente_scadenza: 'Scadenza patente',
  patente_ente: 'Ente patente',
}

export default function CompilaButton({
  documents,
  currentData = {},
  onDataExtracted,
  onError,
  className = '',
  disabled = false,
}: CompilaButtonProps) {
  const [isExtracting, setIsExtracting] = useState(false)
  const [conflicts, setConflicts] = useState<DataConflict[]>([])
  const [showConflicts, setShowConflicts] = useState(false)
  const [pendingData, setPendingData] = useState<ExtractedData | null>(null)
  const [extractionNotes, setExtractionNotes] = useState<string[]>([])

  const validDocs = documents.filter(d => d.file)

  const handleCompila = async () => {
    if (validDocs.length === 0) {
      onError?.('Carica almeno un documento prima di cliccare Compila')
      return
    }

    setIsExtracting(true)
    setConflicts([])
    setShowConflicts(false)
    setExtractionNotes([])

    try {
      const results: ExtractedData[] = []
      const notes: string[] = []

      for (const doc of validDocs) {
        let base64: string

        if (doc.file instanceof File) {
          base64 = await compressImage(doc.file)
        } else if (typeof doc.file === 'string') {
          if (doc.file.startsWith('data:')) {
            base64 = doc.file.split(',')[1]
          } else if (doc.file.startsWith('http')) {
            // URL — pass directly
            const res = await fetch('/.netlify/functions/extract-document-data', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl: doc.file }),
            })
            const data = await res.json()
            if (res.ok && data.extractedData) {
              results.push(data.extractedData)
              if (data.extractedData.notes) notes.push(`${doc.label || 'Documento'}: ${data.extractedData.notes}`)
            } else {
              notes.push(`${doc.label || 'Documento'}: ${data.error || 'Non leggibile'}`)
            }
            continue
          } else {
            base64 = doc.file
          }
        } else {
          continue
        }

        const res = await fetch('/.netlify/functions/extract-document-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64 }),
        })
        const data = await res.json()

        if (res.ok && data.extractedData) {
          results.push(data.extractedData)
          if (data.extractedData.notes) notes.push(`${doc.label || 'Documento'}: ${data.extractedData.notes}`)
          if (data.extractedData.confidence === 'low') notes.push(`${doc.label || 'Documento'}: Lettura a bassa affidabilità`)
        } else {
          notes.push(`${doc.label || 'Documento'}: ${data.error || 'Impossibile estrarre i dati'}`)
        }
      }

      if (results.length === 0) {
        onError?.('Impossibile estrarre dati dai documenti caricati')
        setIsExtracting(false)
        return
      }

      // Merge data from all documents
      const merged = mergeExtractedData(results)

      // Check for expired documents
      const today = new Date().toISOString().split('T')[0]
      if (merged.documento_scadenza && merged.documento_scadenza < today) {
        notes.push('Documento d\'identità SCADUTO')
      }
      if (merged.patente_scadenza && merged.patente_scadenza < today) {
        notes.push('Patente SCADUTA')
      }

      // Validate codice fiscale length
      if (merged.codice_fiscale && merged.codice_fiscale.length !== 16) {
        notes.push(`Codice fiscale rilevato non valido (${merged.codice_fiscale.length} caratteri invece di 16)`)
        delete merged.codice_fiscale
      }

      setExtractionNotes(notes)

      // Find conflicts with existing data
      const foundConflicts = findConflicts(currentData, merged)

      if (foundConflicts.length > 0) {
        setConflicts(foundConflicts)
        setPendingData(merged)
        setShowConflicts(true)
      } else {
        // No conflicts — apply directly (only fill empty fields)
        const safeData: ExtractedData = {}
        for (const [key, value] of Object.entries(merged)) {
          if (!value || ['document_type', 'confidence', 'notes', 'raw_text'].includes(key)) continue
          const current = currentData[key]
          if (!current || current.trim() === '') {
            safeData[key] = value
          }
        }
        onDataExtracted(safeData, [])
      }
    } catch (err: any) {
      onError?.(err.message || 'Errore durante la lettura del documento')
    } finally {
      setIsExtracting(false)
    }
  }

  const handleApplyWithOverwrite = () => {
    if (!pendingData) return
    // Apply all extracted data, overwriting conflicts
    onDataExtracted(pendingData, conflicts)
    setShowConflicts(false)
    setPendingData(null)
    setConflicts([])
  }

  const handleApplyKeepExisting = () => {
    if (!pendingData) return
    // Apply only non-conflicting fields
    const safeData: ExtractedData = {}
    const conflictFields = new Set(conflicts.map(c => c.field))
    for (const [key, value] of Object.entries(pendingData)) {
      if (!value || ['document_type', 'confidence', 'notes', 'raw_text'].includes(key)) continue
      if (!conflictFields.has(key)) {
        const current = currentData[key]
        if (!current || current.trim() === '') {
          safeData[key] = value
        }
      }
    }
    onDataExtracted(safeData, conflicts)
    setShowConflicts(false)
    setPendingData(null)
    setConflicts([])
  }

  return (
    <>
      <button
        type="button"
        onClick={handleCompila}
        disabled={disabled || isExtracting || validDocs.length === 0}
        className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
          isExtracting
            ? 'bg-yellow-600 text-white cursor-wait animate-pulse'
            : validDocs.length === 0
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
              : 'bg-dr7-gold text-white hover:bg-dr7-gold/80 cursor-pointer'
        } ${className}`}
      >
        {isExtracting ? 'Lettura in corso...' : 'Compila'}
      </button>

      {/* Extraction notes */}
      {extractionNotes.length > 0 && !showConflicts && (
        <div className="mt-2 space-y-1">
          {extractionNotes.map((note, i) => (
            <p key={i} className={`text-xs ${
              note.includes('SCADUT') ? 'text-red-400 font-semibold' :
              note.includes('Non leggibile') || note.includes('Impossibile') ? 'text-red-400' :
              'text-yellow-400'
            }`}>
              {note}
            </p>
          ))}
        </div>
      )}

      {/* Conflict resolution modal */}
      {showConflicts && conflicts.length > 0 && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-theme-bg-primary border border-theme-border rounded-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-theme-text-primary">Conflitto dati rilevato</h3>
            <p className="text-sm text-theme-text-muted">
              Alcuni dati estratti dal documento differiscono da quelli già presenti nel form.
            </p>

            <div className="space-y-3 max-h-60 overflow-y-auto">
              {conflicts.map((c, i) => (
                <div key={i} className="bg-theme-bg-tertiary rounded-lg p-3 border border-yellow-600/30">
                  <p className="text-xs text-theme-text-muted font-semibold mb-1">{FIELD_LABELS[c.field] || c.field}</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-theme-text-muted text-xs">Attuale:</span>
                      <p className="text-theme-text-primary">{c.currentValue}</p>
                    </div>
                    <div>
                      <span className="text-theme-text-muted text-xs">Dal documento:</span>
                      <p className="text-yellow-400">{c.extractedValue}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {extractionNotes.length > 0 && (
              <div className="space-y-1">
                {extractionNotes.map((note, i) => (
                  <p key={i} className="text-xs text-yellow-400">{note}</p>
                ))}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleApplyWithOverwrite}
                className="flex-1 px-4 py-2 bg-yellow-600 text-white rounded-lg font-semibold text-sm hover:bg-yellow-500"
              >
                Usa dati documento
              </button>
              <button
                onClick={handleApplyKeepExisting}
                className="flex-1 px-4 py-2 bg-theme-bg-hover text-theme-text-primary rounded-lg font-semibold text-sm hover:bg-gray-600"
              >
                Mantieni attuali
              </button>
              <button
                onClick={() => { setShowConflicts(false); setPendingData(null); setConflicts([]); }}
                className="px-4 py-2 bg-theme-bg-tertiary text-theme-text-muted rounded-lg text-sm hover:bg-theme-bg-hover"
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
