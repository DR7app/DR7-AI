// Gestione Autisti da Centralina (roadmap 22). Aggiunta/rimozione autisti qui,
// non piu' dalla sezione Lead (dove sono ora filtrati). Backend: /autisti
// (list/create/set_role) — customers_extended tagged metadata.role='autista'.
import { useCallback, useEffect, useState } from 'react'
import { ScheletroLista } from '../../../components/Scheletro'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'
import TelefonoConPrefisso from '../../../components/TelefonoConPrefisso'

// La funzione /autisti (mapRow) restituisce { id, full_name, phone }.
// 2026-08: il frontend leggeva nome/cognome/telefono (che NON arrivano) e
// mostrava "Autista" senza numero — i dati c'erano, era solo il mapping sbagliato.
interface Autista {
  id: string
  full_name: string
  phone: string
}

function autistaName(a: Autista): string {
  return (a.full_name || '').trim() || 'Autista'
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

  // 2026-08-05: gli <input> hanno una larghezza intrinseca (size=20) che nella
  // griglia faceva da min-content: le colonne 1fr non potevano restringersi e il
  // bottone "Aggiungi" usciva fuori dal bordo della card. w-full + min-w-0 sugli
  // input e shrink-0 sul bottone tengono tutto dentro il padding.
  const inputCls = 'w-full min-w-0 px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary'

  return (
    <div className="space-y-4">
      <div className="bg-theme-bg-secondary rounded-2xl border border-theme-border p-5">
        <div className="text-[15px] font-semibold text-theme-text-primary">Aggiungi autista</div>
        <p className="text-[13px] text-theme-text-muted mt-0.5 mb-4">Gli autisti si gestiscono qui e compaiono nel dropdown delle Uscite Straordinarie. Non appaiono più tra le Lead.</p>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center">
          <input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Nome" className={inputCls} />
          <input value={form.cognome} onChange={e => setForm({ ...form, cognome: e.target.value })} placeholder="Cognome" className={inputCls} />
          <TelefonoConPrefisso value={form.telefono} onChange={v => setForm({ ...form, telefono: v })} placeholder="Telefono"
            className={`flex-1 min-w-0 ${inputCls}`} selectClassName={`w-[104px] shrink-0 ${inputCls}`} mostraAnteprima={false} />
          <button onClick={addAutista} disabled={busy} className="shrink-0 whitespace-nowrap px-4 py-2 rounded-lg bg-[#007aff] hover:bg-[#0071eb] text-white text-sm font-semibold disabled:opacity-50">Aggiungi</button>
        </div>
      </div>

      <div className="bg-theme-bg-secondary rounded-2xl border border-theme-border p-5">
        <div className="text-[15px] font-semibold text-theme-text-primary mb-3">Autisti ({autisti.length})</div>
        {loading ? (
          <ScheletroLista righe={3} />
        ) : autisti.length === 0 ? (
          <p className="text-theme-text-muted text-sm py-4 text-center">Nessun autista. Aggiungine uno qui sopra.</p>
        ) : (
          <div className="space-y-1.5">
            {autisti.map(a => (
              <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-theme-bg-tertiary/40">
                <span className="flex-1 text-sm text-theme-text-primary">{autistaName(a)}</span>
                {a.phone && <span className="text-xs text-theme-text-muted font-mono">{a.phone}</span>}
                <button onClick={() => removeAutista(a)} disabled={busy} className="px-2.5 py-1 rounded-lg border border-red-500/40 text-red-400 text-xs disabled:opacity-50">Rimuovi</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
