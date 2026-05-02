import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../../supabaseClient'

interface Categoria {
  id: string
  slug: string
  label: string
  sort_order: number
  attiva: boolean
}

interface Props {
  onClose: () => void
  onChanged: () => void
}

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export default function CategorieManagerModal({ onClose, onChanged }: Props) {
  const [list, setList] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('fornitore_categorie')
      .select('*')
      .order('sort_order', { ascending: true })
    if (error) {
      toast.error(`Errore caricamento categorie: ${error.message}`)
    } else {
      setList((data || []) as Categoria[])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addCategory() {
    const label = newLabel.trim()
    if (!label) return
    const slug = slugify(label)
    if (!slug) {
      toast.error('Nome non valido')
      return
    }
    setSaving(true)
    try {
      const maxOrder = list.reduce((m, c) => Math.max(m, c.sort_order), 0)
      const { error } = await supabase
        .from('fornitore_categorie')
        .insert({ slug, label, sort_order: maxOrder + 10, attiva: true })
      if (error) throw error
      setNewLabel('')
      await load()
      onChanged()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Aggiunta fallita: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  async function renameCategory(c: Categoria, newLabel: string) {
    if (!newLabel.trim() || newLabel === c.label) return
    const { error } = await supabase
      .from('fornitore_categorie')
      .update({ label: newLabel.trim() })
      .eq('id', c.id)
    if (error) toast.error(`Rinomina fallita: ${error.message}`)
    else { await load(); onChanged() }
  }

  async function toggleAttiva(c: Categoria) {
    const { error } = await supabase
      .from('fornitore_categorie')
      .update({ attiva: !c.attiva })
      .eq('id', c.id)
    if (error) toast.error(`Aggiornamento fallito: ${error.message}`)
    else { await load(); onChanged() }
  }

  async function deleteCategory(c: Categoria) {
    if (!window.confirm(`Eliminare la categoria "${c.label}"? I fornitori con questa categoria non saranno cancellati ma resteranno con il valore "${c.slug}".`)) return
    const { error } = await supabase
      .from('fornitore_categorie')
      .delete()
      .eq('id', c.id)
    if (error) toast.error(`Eliminazione fallita: ${error.message}`)
    else { await load(); onChanged() }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-xl w-full max-h-[90vh] overflow-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-theme-text-primary">Categorie Fornitori</h3>
          <button onClick={onClose} className="text-theme-text-muted text-2xl leading-none hover:text-theme-text-primary">×</button>
        </div>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addCategory() }}
            placeholder="Nuova categoria (es. Assicurazioni)"
            className="flex-1 bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:border-dr7-gold"
          />
          <button
            onClick={addCategory}
            disabled={saving || !newLabel.trim()}
            className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            Aggiungi
          </button>
        </div>

        {loading ? (
          <div className="text-center py-6 text-theme-text-muted text-sm">Caricamento...</div>
        ) : list.length === 0 ? (
          <div className="text-center py-6 text-theme-text-muted text-sm">Nessuna categoria</div>
        ) : (
          <ul className="divide-y divide-theme-border">
            {list.map(c => (
              <li key={c.id} className="flex items-center gap-2 py-2">
                <input
                  type="text"
                  defaultValue={c.label}
                  onBlur={(e) => renameCategory(c, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  className={`flex-1 bg-transparent border border-transparent hover:border-theme-border focus:border-dr7-gold rounded px-2 py-1 text-sm ${c.attiva ? 'text-theme-text-primary' : 'text-theme-text-muted line-through'}`}
                />
                <span className="text-xs font-mono text-theme-text-muted">{c.slug}</span>
                <button
                  onClick={() => toggleAttiva(c)}
                  className={`text-xs px-2 py-1 rounded ${c.attiva ? 'bg-amber-600/20 text-amber-400 hover:bg-amber-600/30' : 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'}`}
                >
                  {c.attiva ? 'Disattiva' : 'Attiva'}
                </button>
                <button
                  onClick={() => deleteCategory(c)}
                  className="text-xs px-2 py-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30"
                  title="Elimina categoria"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-theme-text-muted mt-4">
          Modifica il nome cliccandolo. Disattivare nasconde la categoria dal dropdown senza cancellare lo slug usato dai fornitori esistenti.
        </p>
      </div>
    </div>
  )
}
