// Gestione Autisti da Centralina (roadmap 22). Aggiunta/rimozione autisti qui,
// non piu' dalla sezione Lead (dove sono ora filtrati). Backend: /autisti
// (list/create/set_role) — customers_extended tagged metadata.role='autista'.
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'

interface Autista {
  id: string
  nome: string | null
  cognome: string | null
  denominazione: string | null
  ragione_sociale: string | null
  telefono: string | null
}

function autistaName(a: Autista): string {
  return `${a.nome || ''} ${a.cognome || ''}`.trim() || a.denominazione || a.ragione_sociale || 'Autista'
}

export default function AutistiConfigSection() {
  const [autisti, setAutisti] = useState<Autista[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ nome: '', cognome: '', telefono: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch('/.netlify/functions/autisti', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) setAutisti((data.autisti as Autista[]) || [])
      else toast.error('Errore: ' + (data.error || res.statusText))
    } catch (e) { toast.error('Errore: ' + (e as Error).message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function addAutista() {
    if (!form.nome.trim() && !form.cognome.trim()) { toast.error('Inserisci almeno nome o cognome'); return }
    setBusy(true)
    try {
      const res = await authFetch('/.netlify/functions/autisti', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', nome: form.nome.trim(), cognome: form.cognome.trim(), telefono: form.telefono.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error('Errore: ' + (data.error || res.statusText)); return }
      toast.success('Autista aggiunto')
      setForm({ nome: '', cognome: '', telefono: '' })
      await load()
    } catch (e) { toast.error('Errore: ' + (e as Error).message) } finally { setBusy(false) }
  }

  async function removeAutista(a: Autista) {
    if (!window.confirm(`Rimuovere ${autistaName(a)} dagli autisti?`)) return
    setBusy(true)
    try {
      const res = await authFetch('/.netlify/functions/autisti', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_role', customerId: a.id, isAutista: false }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error('Errore: ' + (data.error || res.statusText)); return }
      toast.success('Autista rimosso')
      await load()
    } catch (e) { toast.error('Errore: ' + (e as Error).message) } finally { setBusy(false) }
  }

  const inputCls = 'px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary'

  return (
    <div className="space-y-4">
      <div className="bg-theme-bg-secondary rounded-2xl border border-theme-border p-5">
        <div className="text-[15px] font-semibold text-theme-text-primary">Aggiungi autista</div>
        <p className="text-[13px] text-theme-text-muted mt-0.5 mb-4">Gli autisti si gestiscono qui e compaiono nel dropdown delle Uscite Straordinarie. Non appaiono più tra le Lead.</p>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2">
          <input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Nome" className={inputCls} />
          <input value={form.cognome} onChange={e => setForm({ ...form, cognome: e.target.value })} placeholder="Cognome" className={inputCls} />
          <input value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} placeholder="Telefono" className={inputCls} />
          <button onClick={addAutista} disabled={busy} className="px-4 py-2 rounded-lg bg-[#007aff] text-white text-sm font-semibold disabled:opacity-50">Aggiungi</button>
        </div>
      </div>

      <div className="bg-theme-bg-secondary rounded-2xl border border-theme-border p-5">
        <div className="text-[15px] font-semibold text-theme-text-primary mb-3">Autisti ({autisti.length})</div>
        {loading ? (
          <p className="text-theme-text-muted text-sm py-4 text-center">Caricamento…</p>
        ) : autisti.length === 0 ? (
          <p className="text-theme-text-muted text-sm py-4 text-center">Nessun autista. Aggiungine uno qui sopra.</p>
        ) : (
          <div className="space-y-1.5">
            {autisti.map(a => (
              <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-theme-bg-tertiary/40">
                <span className="flex-1 text-sm text-theme-text-primary">{autistaName(a)}</span>
                {a.telefono && <span className="text-xs text-theme-text-muted font-mono">{a.telefono}</span>}
                <button onClick={() => removeAutista(a)} disabled={busy} className="px-2.5 py-1 rounded-lg border border-red-500/40 text-red-400 text-xs disabled:opacity-50">Rimuovi</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
