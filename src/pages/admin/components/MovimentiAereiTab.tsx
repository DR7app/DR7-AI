// 2026-07-13: Conteggio movimenti aerei sul piazzale (Noleggio Aria).
// L'operatore registra ogni decollo/atterraggio; la tab mostra il conteggio
// di oggi e del mese + lo storico recente.
import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

interface Movimento {
  id: string
  movement_at: string
  tipo: 'decollo' | 'atterraggio'
  aeromobile: string | null
  nota: string | null
}

function nowLocalInput(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function MovimentiAereiTab() {
  const [rows, setRows] = useState<Movimento[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [when, setWhen] = useState(nowLocalInput())
  const [tipo, setTipo] = useState<'decollo' | 'atterraggio'>('decollo')
  const [aeromobile, setAeromobile] = useState('')
  const [nota, setNota] = useState('')

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('movimenti_aerei')
      .select('id, movement_at, tipo, aeromobile, nota')
      .order('movement_at', { ascending: false })
      .limit(300)
    if (error) { toast.error('Errore: ' + error.message); setRows([]) }
    else setRows((data || []) as Movimento[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const add = async () => {
    setSaving(true)
    const iso = when ? new Date(when).toISOString() : new Date().toISOString()
    const { error } = await supabase.from('movimenti_aerei').insert({
      movement_at: iso, tipo, aeromobile: aeromobile.trim() || null, nota: nota.trim() || null,
    })
    setSaving(false)
    if (error) { toast.error('Errore: ' + error.message); return }
    toast.success('Movimento registrato')
    setAeromobile(''); setNota(''); setWhen(nowLocalInput())
    load()
  }
  const remove = async (r: Movimento) => {
    if (!confirm('Eliminare questo movimento?')) return
    const { error } = await supabase.from('movimenti_aerei').delete().eq('id', r.id)
    if (error) { toast.error('Errore: ' + error.message); return }
    setRows(prev => prev.filter(x => x.id !== r.id))
  }

  // Conteggi oggi / mese (Europe/Rome via toLocaleDateString).
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
  const monthStr = todayStr.slice(0, 7)
  const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
  const countToday = rows.filter(r => dayKey(r.movement_at) === todayStr).length
  const countMonth = rows.filter(r => dayKey(r.movement_at).slice(0, 7) === monthStr).length

  // Raggruppa per giorno per lo storico.
  const groups = new Map<string, Movimento[]>()
  for (const r of rows) {
    const k = dayKey(r.movement_at)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-semibold text-theme-text-primary tracking-tight">Movimenti Aerei</h2>
        <p className="text-sm text-theme-text-muted mt-1">Conteggio decolli/atterraggi sul piazzale DR7.</p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div className="p-4 rounded-xl border border-theme-border bg-theme-bg-secondary">
          <div className="text-xs text-theme-text-muted">Oggi</div>
          <div className="text-3xl font-bold text-dr7-gold tabular-nums">{countToday}</div>
        </div>
        <div className="p-4 rounded-xl border border-theme-border bg-theme-bg-secondary">
          <div className="text-xs text-theme-text-muted">Mese corrente</div>
          <div className="text-3xl font-bold text-theme-text-primary tabular-nums">{countMonth}</div>
        </div>
      </div>

      {/* Registra */}
      <div className="p-4 rounded-xl border border-theme-border bg-theme-bg-secondary space-y-3">
        <h3 className="text-sm font-semibold text-theme-text-primary">Registra movimento</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-theme-text-muted block mb-1">Data e ora</label>
            <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary" />
          </div>
          <div>
            <label className="text-xs text-theme-text-muted block mb-1">Tipo</label>
            <select value={tipo} onChange={e => setTipo(e.target.value as 'decollo' | 'atterraggio')} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary">
              <option value="decollo">Decollo</option>
              <option value="atterraggio">Atterraggio</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-theme-text-muted block mb-1">Aeromobile (opzionale)</label>
            <input value={aeromobile} onChange={e => setAeromobile(e.target.value)} placeholder="es. Airbus H125" className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary" />
          </div>
          <div>
            <label className="text-xs text-theme-text-muted block mb-1">Nota (opzionale)</label>
            <input value={nota} onChange={e => setNota(e.target.value)} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary" />
          </div>
        </div>
        <button onClick={add} disabled={saving} className="px-4 py-2 rounded-lg bg-dr7-gold text-black text-sm font-semibold disabled:opacity-50">
          {saving ? 'Salvataggio…' : '+ Registra movimento'}
        </button>
      </div>

      {/* Storico */}
      {loading ? (
        <div className="py-8 text-center text-theme-text-muted text-sm">Caricamento…</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-theme-text-muted text-sm">Nessun movimento registrato.</div>
      ) : (
        <div className="space-y-4">
          {[...groups.entries()].map(([day, list]) => (
            <div key={day}>
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-bold text-theme-text-primary">{new Date(day + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</h4>
                <span className="text-xs text-theme-text-muted">{list.length} movim.</span>
              </div>
              <div className="rounded-xl border border-theme-border overflow-hidden divide-y divide-theme-border">
                {list.map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 bg-theme-bg-secondary">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.tipo === 'decollo' ? 'bg-sky-600/20 text-sky-400' : 'bg-amber-600/20 text-amber-400'}`}>{r.tipo === 'decollo' ? 'Decollo' : 'Atterraggio'}</span>
                      <span className="text-sm text-theme-text-secondary tabular-nums">{new Date(r.movement_at).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="text-sm text-theme-text-primary truncate">{r.aeromobile || ''}{r.nota ? ` · ${r.nota}` : ''}</span>
                    </div>
                    <button onClick={() => remove(r)} className="text-xs text-red-400 hover:text-red-300 shrink-0">Elimina</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
