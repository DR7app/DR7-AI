import { useState } from 'react'
import { CATEGORIES } from './scadenzeConfig'
import type { Scadenza, NewScadenzaForm } from './scadenzeConfig'

interface ScadenzeEditModalProps {
  scadenza: Scadenza
  onSave: (id: string, updates: Partial<NewScadenzaForm>) => Promise<boolean>
  onClose: () => void
}

const RECURRING_OPTIONS = [
  { value: '', label: 'Non ricorrente' },
  { value: 'monthly', label: 'Ogni mese' },
  { value: 'quarterly', label: 'Ogni 3 mesi' },
  { value: 'biannual', label: 'Ogni 6 mesi' },
  { value: 'yearly', label: 'Ogni anno' },
]

export default function ScadenzeEditModal({ scadenza, onSave, onClose }: ScadenzeEditModalProps) {
  const [form, setForm] = useState({
    item_type: scadenza.item_type || '',
    description: scadenza.description || '',
    due_date: scadenza.due_date || '',
    amount: scadenza.amount ? (scadenza.amount / 100).toString() : '',
    reference_name: scadenza.reference_name || '',
    recurring_interval: scadenza.recurring_interval || ''
  })
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    setSubmitting(true)
    const success = await onSave(scadenza.id, form)
    setSubmitting(false)
    if (success) onClose()
  }

  const category = CATEGORIES[scadenza.category]

  return (
    <div className="fixed inset-0 bg-theme-overlay flex items-center justify-center z-50">
      <div className="bg-theme-bg-secondary rounded-lg p-6 w-full max-w-md border border-theme-border">
        <h3 className="text-xl font-bold text-theme-text-primary mb-1">Modifica Scadenza</h3>
        <p className="text-sm text-theme-text-muted mb-4">{category?.label || scadenza.category}</p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Voce</label>
            <input
              type="text"
              value={form.item_type}
              onChange={(e) => setForm({ ...form, item_type: e.target.value })}
              className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Riferimento</label>
            <input
              type="text"
              value={form.reference_name}
              onChange={(e) => setForm({ ...form, reference_name: e.target.value })}
              placeholder="es. Cliente / Veicolo / Fornitore"
              className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Data Scadenza</label>
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Ricorrenza</label>
            <select
              value={form.recurring_interval}
              onChange={(e) => setForm({ ...form, recurring_interval: e.target.value })}
              className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border"
            >
              {RECURRING_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Importo</label>
            <input
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0,00"
              className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Descrizione</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Note aggiuntive"
              className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-theme-bg-hover hover:bg-theme-bg-tertiary text-theme-text-primary rounded-lg"
          >
            Annulla
          </button>
          <button
            onClick={handleSubmit}
            disabled={!form.item_type || !form.due_date || submitting}
            className="px-4 py-2 bg-dr7-gold text-white rounded-lg font-medium hover:bg-dr7-gold/90 disabled:opacity-50"
          >
            {submitting ? 'Salvataggio...' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  )
}
