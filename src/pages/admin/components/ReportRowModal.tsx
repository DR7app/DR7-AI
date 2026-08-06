// Modale riusabile per la MODIFICA MANUALE dei report (#38). Stessa UX del
// Report Noleggio/Lavaggio (ReportsTab): correggi i valori numerici di una voce
// o aggiungi una voce manuale, sempre con motivo/nota obbligatoria. Il salvataggio
// vero e proprio (report_overrides) e' gestito dal chiamante via reportOverrides.ts.
import { useState } from 'react'
import toast from 'react-hot-toast'

export interface FieldDef { key: string; label: string }

export function ReportRowModal({ mode, row, fields, identityFields, addTemplate, onClose, onSaveEdit, onSaveAdd }: {
  mode: 'edit' | 'add'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any
  fields: FieldDef[]
  // campi identita' richiesti in add (es. label/nome della voce)
  identityFields: { key: string; label: string; placeholder?: string; required?: boolean }[]
  // valori extra di default per una riga aggiunta (per rispettare la forma dei dati)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addTemplate?: Record<string, any>
  onClose: () => void
  onSaveEdit: (changes: Record<string, number>, note: string) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSaveAdd: (row: any, note: string) => void
}) {
  const [ident, setIdent] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {}
    for (const f of identityFields) o[f.key] = row?.[f.key] != null ? String(row[f.key]) : ''
    return o
  })
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {}
    for (const f of fields) o[f.key] = row?.[f.key] != null ? String(row[f.key]) : ''
    return o
  })
  const [note, setNote] = useState<string>('')
  const num = (s: string) => { const n = parseFloat((s || '').replace(',', '.')); return isNaN(n) ? 0 : n }

  function submit() {
    if (!note.trim()) { toast.error('Inserisci un motivo/nota'); return }
    if (mode === 'edit') {
      const changes: Record<string, number> = {}
      for (const f of fields) {
        const nv = num(vals[f.key])
        if (nv !== Number(row?.[f.key] || 0)) changes[f.key] = nv
      }
      onSaveEdit(changes, note.trim())
    } else {
      for (const f of identityFields) {
        if (f.required && !ident[f.key]?.trim()) { toast.error(`Inserisci ${f.label.toLowerCase()}`); return }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newRow: Record<string, any> = { ...(addTemplate || {}) }
      for (const f of identityFields) newRow[f.key] = ident[f.key]?.trim() || ''
      for (const f of fields) newRow[f.key] = num(vals[f.key])
      onSaveAdd(newRow, note.trim())
    }
  }

  const title = row?.label || row?.type
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-theme-bg-secondary border border-theme-border rounded-xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-theme-text-primary">
          {mode === 'edit' ? `Modifica voce${title ? ` — ${title}` : ''}` : 'Aggiungi voce manuale'}
        </h3>
        {mode === 'add' && (
          <div className="grid grid-cols-1 gap-3">
            {identityFields.map(f => (
              <label key={f.key} className="text-xs text-theme-text-muted">{f.label}{f.required ? '' : ' (facoltativo)'}
                <input value={ident[f.key]} onChange={e => setIdent(v => ({ ...v, [f.key]: e.target.value }))} className="mt-1 w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary text-sm" placeholder={f.placeholder || ''} />
              </label>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {fields.map(f => (
            <label key={f.key} className="text-xs text-theme-text-muted">{f.label}
              <input value={vals[f.key]} onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))} inputMode="decimal" className="mt-1 w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary text-sm text-right tabular-nums" placeholder="0" />
            </label>
          ))}
        </div>
        <label className="text-xs text-theme-text-muted block">Motivo / nota (obbligatorio)
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="mt-1 w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary text-sm" placeholder="Perche' stai modificando questa voce" />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-theme-border text-theme-text-secondary">Annulla</button>
          <button onClick={submit} className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-500/20 border border-amber-500/40 text-amber-400 hover:bg-amber-500/30">Salva</button>
        </div>
      </div>
    </div>
  )
}
