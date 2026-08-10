// #42 Acconti — registrazione acconti incassati nella giornata.
// Ogni operatore registra quanto ha incassato (con causale/nota); la direzione
// vede il riepilogo per giornata con il totale.
//
// 2026-08-03 (richiesta direzione 17/07): la tab e' di TUTTI gli operatori
// (UNIVERSAL_TABS in useAdminRole, niente permesso da spuntare nell'invito).
// Di conseguenza la vista e' scopata: l'operatore vede e cancella SOLO i propri
// acconti della giornata, direzione/superadmin/developer vedono tutto con il
// riepilogo per operatore. L'identita' arriva da useAdminRole (match su
// admins.user_id, come il resto del gestionale) invece che dalla mail.
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'
import EuropeanDateInput from '../../../components/EuropeanDateInput'

interface Acconto {
  id: string
  operatore_id: string | null
  operatore_nome: string | null
  metodo_pagamento?: string | null
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
  const { role, adminId, adminName, adminEmail, hasRole, loading: roleLoading } = useAdminRole()
  const [data, setData] = useState<string>(todayRome())
  const [rows, setRows] = useState<Acconto[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Form
  const [importo, setImporto] = useState('')
  const [causale, setCausale] = useState('')
  const [note, setNote] = useState('')

  // Direzione/superadmin/developer: riepilogo di TUTTI. Operatore: i suoi.
  const canSeeAll = role === 'superadmin' || hasRole('direzione') || hasRole('developer')
  const me = useMemo(
    () => ({ id: adminId, nome: adminName || (adminEmail || '').split('@')[0] || '' }),
    [adminId, adminName, adminEmail]
  )

  async function load() {
    if (roleLoading) return
    setLoading(true)
    let q = supabase
      .from('acconti_giornalieri')
      .select('*')
      .eq('data', data)
    if (!canSeeAll) {
      // Senza operatore_id (admin non ancora collegato) si ripiega sul nome
      // denormalizzato, cosi' l'operatore rivede comunque cio' che ha inserito.
      q = me.id ? q.eq('operatore_id', me.id) : q.eq('operatore_nome', me.nome)
    }
    const { data: d, error } = await q.order('created_at', { ascending: false })
    if (error) toast.error('Errore caricamento: ' + error.message)
    setRows((d as Acconto[]) || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [data, roleLoading, canSeeAll, me.id, me.nome]) // eslint-disable-line react-hooks/exhaustive-deps

  // 2026-08-10 (roadmap #42): senza il metodo di incasso la quadratura di
  // cassa e' impossibile — la direzione vede un totale ma non sa quanta parte
  // deve trovarsi fisicamente in cassa a fine giornata.
  const METODI = ['Contanti', 'POS', 'Bonifico', 'Nexi', 'Altro']
  const [metodo, setMetodo] = useState<string>('Contanti')

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
      metodo_pagamento: metodo || null,
      created_by: me.id,
    })
    setSaving(false)
    if (error) { toast.error('Salvataggio fallito: ' + error.message); return }
    setImporto(''); setCausale(''); setNote(''); setMetodo('Contanti')
    toast.success('Acconto registrato')
    load()
  }

  // L'operatore cancella solo i PROPRI acconti; direzione puo' correggere tutto.
  function canDelete(r: Acconto): boolean {
    if (canSeeAll) return true
    if (me.id && r.operatore_id) return r.operatore_id === me.id
    return !!me.nome && r.operatore_nome === me.nome
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
          <p className="text-sm text-theme-text-muted mt-1">
            Registra gli acconti incassati nella giornata. Operatore: <span className="text-theme-text-secondary font-medium">{me.nome || '—'}</span>
            {!canSeeAll && <span className="ml-1">· vedi solo i tuoi</span>}
          </p>
        </div>
        <label className="text-xs text-theme-text-muted">Giornata
          <EuropeanDateInput value={data} onChange={(__v: string) => setData(__v)} className="mt-1 block px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
        </label>
      </div>

      {/* Registra */}
      <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
        <h2 className="text-sm font-semibold text-theme-text-primary mb-3">Registra acconto</h2>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <label className="text-xs text-theme-text-muted">Importo €
            <input value={importo} onChange={e => setImporto(e.target.value)} inputMode="decimal" placeholder="0,00" className="mt-1 w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm text-right tabular-nums" />
          </label>
          <label className="text-xs text-theme-text-muted">Incassato con
            <select value={metodo} onChange={e => setMetodo(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm">
              {METODI.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
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
          <p className="text-xs text-theme-text-muted">{canSeeAll ? 'Totale giornata' : 'Totale incassato da te'}</p>
          <p className="text-2xl font-bold text-dr7-gold tabular-nums">{eur(totale)}</p>
          <p className="text-xs text-theme-text-muted mt-1">{rows.length} acconto/i</p>
        </div>
        {canSeeAll && (
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
        )}
      </div>

      {/* Lista */}
      <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
        <div className="px-4 py-3 border-b border-theme-border">
          <h2 className="text-sm font-semibold text-theme-text-primary">Acconti del {new Date(data + 'T00:00:00').toLocaleDateString('it-IT')}</h2>
        </div>
        {loading ? (
          <p className="p-4 text-sm text-theme-text-muted">Caricamento…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-theme-text-muted">{canSeeAll ? 'Nessun acconto registrato per questa giornata.' : 'Non hai registrato acconti per questa giornata.'}</p>
        ) : (
          <div className="divide-y divide-theme-border">
            {rows.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-theme-text-primary font-medium">{eur(r.importo_cents)} <span className="text-theme-text-muted font-normal">— {r.operatore_nome || 'Sconosciuto'}</span>{r.metodo_pagamento && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] border border-theme-border text-theme-text-muted">{r.metodo_pagamento}</span>}</p>
                  <p className="text-xs text-theme-text-muted truncate">{[r.causale, r.note].filter(Boolean).join(' · ') || '—'} · {new Date(r.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false })}</p>
                </div>
                {canDelete(r) && (
                  <button onClick={() => elimina(r.id)} className="text-[11px] px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 shrink-0">Elimina</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
