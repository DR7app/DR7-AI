import { useState } from 'react'
import { CATEGORIES } from './scadenzeConfig'
import type { NewScadenzaForm } from './scadenzeConfig'

interface ScadenzeAddModalProps {
  initialCategory?: string
  onAdd: (form: NewScadenzaForm) => Promise<boolean>
  onClose: () => void
}

export default function ScadenzeAddModal({ initialCategory, onAdd, onClose }: ScadenzeAddModalProps) {
  const [form, setForm] = useState<NewScadenzaForm>({
    category: initialCategory || 'affitti',
    item_type: '',
    description: '',
    due_date: '',
    amount: '',
    reference_name: ''
  })
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    setSubmitting(true)
    const success = await onAdd(form)
    setSubmitting(false)
    if (success) onClose()
  }

  return (
    <div className="fixed inset-0 bg-theme-overlay flex items-center justify-center z-50">
      <div className="bg-theme-bg-secondary rounded-lg p-6 w-full max-w-md border border-theme-border">
        <h3 className="text-xl font-bold text-theme-text-primary mb-4">Aggiungi Nuova Scadenza</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Categoria</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value, item_type: '' })}
              className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border"
            >
              {Object.entries(CATEGORIES).map(([key, cat]) => (
                <option key={key} value={key}>{cat.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Voce</label>
            <select
              value={form.item_type}
              onChange={(e) => setForm({ ...form, item_type: e.target.value })}
              className="w-full bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border"
            >
              <option value="">Seleziona voce...</option>
              {CATEGORIES[form.category]?.items.map(item => (
                <option key={item} value={item}>{item}</option>
              ))}
              <option value="__custom__">+ Aggiungi voce personalizzata</option>
            </select>
            {form.item_type === '__custom__' && (
              <input
                type="text"
                placeholder="Nome voce personalizzata"
                onChange={(e) => setForm({ ...form, item_type: e.target.value })}
                className="w-full mt-2 bg-theme-bg-tertiary text-theme-text-primary rounded px-3 py-2 border border-theme-border"
              />
            )}
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
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Importo (opzionale)</label>
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
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Descrizione (opzionale)</label>
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
            className="px-4 py-2 bg-dr7-gold text-black rounded-lg font-medium hover:bg-dr7-gold/90 disabled:opacity-50"
          >
            {submitting ? 'Aggiunta...' : 'Aggiungi'}
          </button>
        </div>
      </div>
    </div>
  )
}
