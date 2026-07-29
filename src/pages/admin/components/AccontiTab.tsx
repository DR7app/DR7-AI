// #42 Acconti — registrazione acconti incassati nella giornata.
// Ogni operatore registra quanto ha incassato (con causale/nota); la direzione
// vede il riepilogo per giornata con il totale. Operatore = utente loggato
// (match per email su `admins`).
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'

interface Acconto {
  id: string
  operatore_id: string | null
  operatore_nome: string | null
  data: string
  importo_cents: number
  causale: string | null
  note: string | null
  created_at: string
}

function todayRome(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}
function eur(cents: number): string {
  return (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
}

export default function AccontiTab() {
  const [data, setData] = useState<string>(todayRome())
  const [rows, setRows] = useState<Acconto[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [me, setMe] = useState<{ id: string | null; nome: string }>({ id: null, nome: '' })

  // Form
  const [importo, setImporto] = useState('')
  const [causale, setCausale] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser()
        const email = u.user?.email || ''
        if (email) {
          const { data: adm } = await supabase.from('admins').select('id, nome').eq('email', email).maybeSingle()
          if (adm) setMe({ id: adm.id, nome: adm.nome || email.split('@')[0] })
          else setMe({ id: null, nome: email.split('@')[0] })
        }
      } catch { /* ignore */ }
    })()
  }, [])

  async function load() {
    setLoading(true)
    const { data: d, error } = await supabase
      .from('acconti_giornalieri')
      .select('*')
      .eq('data', data)
      .order('created_at', { ascending: false })
    if (error) toast.error('Errore caricamento: ' + error.message)
    setRows((d as Acconto[]) || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  async function registra() {
    const cents = Math.round(parseFloat((importo || '').replace(',', '.')) * 100)
    if (!Number.isFinite(cents) || cents <= 0) { toast.error('Inserisci un importo valido'); return }
    setSaving(true)
    const { error } = await supabase.from('acconti_giornalieri').insert({
      operatore_id: me.id,
      operatore_nome: me.nome || null,
      data,
      importo_cents: cents,
      causale: causale.trim() || null,
      note: note.trim() || null,
      created_by: me.id,
    })
    setSaving(false)
    if (error) { toast.error('Salvataggio fallito: ' + error.message); return }
    setImporto(''); setCausale(''); setNote('')
    toast.success('Acconto registrato')
    load()
  }

  async function elimina(id: string) {
    if (!confirm('Eliminare questo acconto?')) return
    const { error } = await supabase.from('acconti_giornalieri').delete().eq('id', id)
    if (error) { toast.error('Errore: ' + error.message); return }
    toast.success('Acconto eliminato')
    load()
  }

  const totale = useMemo(() => rows.reduce((s, r) => s + (r.importo_cents || 0), 0), [rows])
  const perOperatore = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const k = r.operatore_nome || 'Sconosciuto'
      m.set(k, (m.get(k) || 0) + (r.importo_cents || 0))
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [rows])

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">Acconti Giornalieri</h1>
          <p className="text-sm text-theme-text-muted mt-1">Registra gli acconti incassati nella giornata. Operatore: <span className="text-theme-text-secondary font-medium">{me.nome || '—'}</span></p>
        </div>
        <label className="text-xs text-theme-text-muted">Giornata
          <input type="date" value={data} onChange={e => setData(e.target.value)} className="mt-1 block px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
        </label>
      </div>

      {/* Registra */}
      <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
        <h2 className="text-sm font-semibold text-theme-text-primary mb-3">Registra acconto</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <label className="text-xs text-theme-text-muted">Importo €
            <input value={importo} onChange={e => setImporto(e.target.value)} inputMode="decimal" placeholder="0,00" className="mt-1 w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm text-right tabular-nums" />
          </label>
          <label className="text-xs text-theme-text-muted sm:col-span-1">Causale
            <input value={causale} onChange={e => setCausale(e.target.value)} placeholder="Es. Contanti noleggio" className="mt-1 w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm" />
          </label>
          <label className="text-xs text-theme-text-muted sm:col-span-2">Nota (facoltativa)
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Dettaglio" className="mt-1 w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm" />
          </label>
        </div>
        <div className="flex justify-end mt-3">
          <button onClick={registra} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold bg-dr7-gold text-white hover:opacity-90 disabled:opacity-50">{saving ? 'Salvataggio…' : 'Registra acconto'}</button>
        </div>
      </div>

      {/* Riepilogo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
          <p className="text-xs text-theme-text-muted">Totale giornata</p>
          <p className="text-2xl font-bold text-dr7-gold tabular-nums">{eur(totale)}</p>
          <p className="text-xs text-theme-text-muted mt-1">{rows.length} acconto/i</p>
        </div>
        <div className="md:col-span-2 bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
          <p className="text-xs text-theme-text-muted mb-2">Per operatore</p>
          {perOperatore.length === 0 ? (
            <p className="text-sm text-theme-text-muted">Nessun acconto.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {perOperatore.map(([nome, cents]) => (
                <span key={nome} className="px-2.5 py-1 rounded-full bg-theme-bg-tertiary border border-theme-border text-xs text-theme-text-secondary">
                  {nome}: <span className="text-theme-text-primary font-semibold tabular-nums">{eur(cents)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Lista */}
      <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
        <div className="px-4 py-3 border-b border-theme-border">
          <h2 className="text-sm font-semibold text-theme-text-primary">Acconti del {new Date(data + 'T00:00:00').toLocaleDateString('it-IT')}</h2>
        </div>
        {loading ? (
          <p className="p-4 text-sm text-theme-text-muted">Caricamento…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-theme-text-muted">Nessun acconto registrato per questa giornata.</p>
        ) : (
          <div className="divide-y divide-theme-border">
            {rows.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-theme-text-primary font-medium">{eur(r.importo_cents)} <span className="text-theme-text-muted font-normal">— {r.operatore_nome || 'Sconosciuto'}</span></p>
                  <p className="text-xs text-theme-text-muted truncate">{[r.causale, r.note].filter(Boolean).join(' · ') || '—'} · {new Date(r.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false })}</p>
                </div>
                <button onClick={() => elimina(r.id)} className="text-[11px] px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 shrink-0">Elimina</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
