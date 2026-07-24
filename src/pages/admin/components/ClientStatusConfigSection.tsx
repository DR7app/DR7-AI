// Status clienti personalizzabili (roadmap 20). Sezione autonoma in Centralina
// Pro: personalizza nome/descrizione/colore degli status cliente. Le chiavi
// (standard/member/elite/blacklist) restano fisse perche' guidano la logica.
import { useEffect, useState } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

interface StatusRow {
  status_key: string
  label: string
  descrizione: string | null
  color: string
  ordine: number
}

const COLOR_OPTIONS = [
  { id: 'gray', label: 'Grigio', dot: 'bg-gray-400' },
  { id: 'blue', label: 'Blu', dot: 'bg-blue-500' },
  { id: 'amber', label: 'Ambra', dot: 'bg-amber-500' },
  { id: 'red', label: 'Rosso', dot: 'bg-red-500' },
  { id: 'emerald', label: 'Verde', dot: 'bg-emerald-500' },
  { id: 'purple', label: 'Viola', dot: 'bg-purple-500' },
]

export default function ClientStatusConfigSection() {
  const [rows, setRows] = useState<StatusRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('client_status_config')
        .select('status_key, label, descrizione, color, ordine')
        .order('ordine')
      if (error && /relation .* does not exist|schema cache/i.test(error.message || '')) {
        setMissing(true); setLoading(false); return
      }
      setRows((data as StatusRow[]) || [])
      setLoading(false)
    })()
  }, [])

  const setField = (key: string, patch: Partial<StatusRow>) =>
    setRows(prev => prev.map(r => r.status_key === key ? { ...r, ...patch } : r))

  async function save() {
    setSaving(true)
    try {
      for (const r of rows) {
        const { error } = await supabase.from('client_status_config')
          .update({ label: r.label, descrizione: r.descrizione || null, color: r.color, updated_at: new Date().toISOString() })
          .eq('status_key', r.status_key)
        if (error) throw error
      }
      toast.success('Status clienti salvati')
    } catch (e) { toast.error('Errore: ' + (e as Error).message) } finally { setSaving(false) }
  }

  if (missing) {
    return (
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm text-theme-text-primary">
        Applica la migration <code>20260725_client_status_config.sql</code> per abilitare gli status clienti personalizzabili.
      </div>
    )
  }

  return (
    <div className="bg-theme-bg-secondary rounded-2xl border border-theme-border p-5">
      <div className="text-[15px] font-semibold text-theme-text-primary">Status clienti</div>
      <p className="text-[13px] text-theme-text-muted mt-0.5 mb-4">Personalizza nome, descrizione e colore di ogni status. La logica interna resta invariata.</p>
      {loading ? (
        <p className="text-theme-text-muted py-6 text-center text-sm">Caricamento…</p>
      ) : (
        <div className="space-y-3">
          {rows.map(r => {
            const dot = COLOR_OPTIONS.find(c => c.id === r.color)?.dot || 'bg-gray-400'
            return (
              <div key={r.status_key} className="rounded-xl border border-theme-border bg-theme-bg-tertiary/30 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                  <span className="text-[11px] font-mono uppercase text-theme-text-muted">{r.status_key}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                  <input
                    value={r.label}
                    onChange={e => setField(r.status_key, { label: e.target.value })}
                    placeholder="Nome status"
                    className="px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary"
                  />
                  <input
                    value={r.descrizione || ''}
                    onChange={e => setField(r.status_key, { descrizione: e.target.value })}
                    placeholder="Descrizione"
                    className="px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary"
                  />
                  <select
                    value={r.color}
                    onChange={e => setField(r.status_key, { color: e.target.value })}
                    className="px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary"
                  >
                    {COLOR_OPTIONS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
              </div>
            )
          })}
          <div className="flex justify-end pt-1">
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-[#007aff] text-white text-sm font-semibold disabled:opacity-50">{saving ? 'Salvataggio…' : 'Salva status'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper condiviso: mappa color id -> classi badge (usato dalla scheda cliente).
export function statusColorClasses(color: string): { text: string; bg: string } {
  switch (color) {
    case 'blue': return { text: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' }
    case 'amber': return { text: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' }
    case 'red': return { text: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' }
    case 'emerald': return { text: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' }
    case 'purple': return { text: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' }
    default: return { text: 'text-gray-400', bg: 'bg-gray-500/10 border-gray-500/30' }
  }
}
