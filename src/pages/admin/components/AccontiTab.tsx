// #42 Acconti — registrazione acconti incassati nella giornata.
// Ogni operatore registra quanto ha incassato (con causale/nota); la direzione
// vede il riepilogo per giornata con il totale.
//
// 2026-08-03 (richiesta direzione 17/07): la tab e' di TUTTI gli operatori
// (UNIVERSAL_TABS in useAdminRole, niente permesso da spuntare nell'invito).
// Di conseguenza la vista e' scopata: l'operatore vede e cancella SOLO i propri
// acconti della giornata, la sola direzione vede tutto con il riepilogo per
// operatore (dal 14/08 nemmeno superadmin e developer). L'identita' arriva da useAdminRole (match su
// admins.user_id, come il resto del gestionale) invece che dalla mail.
//
// 2026-08-14 (richiesta direzione): due aggiunte.
//  1. L'Amministrazione intesta l'acconto A NOME di un altro operatore — chi
//     porta i contanti in ufficio spesso non e' chi li inserisce a gestionale.
//  2. Vista Storico: gli acconti non spariscono piu' cambiando giornata, si
//     rileggono per periodo, raggruppati per giorno con il totale del giorno.
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'
import EuropeanDateInput from '../../../components/EuropeanDateInput'

interface AdminOption {
  id: string
  nome: string | null
  email: string | null
  stato: string | null
  archived_at: string | null
}

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
function itDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('it-IT')
}

export default function AccontiTab() {
  const { adminId, adminName, adminEmail, hasRole, loading: roleLoading } = useAdminRole()
  const [data, setData] = useState<string>(todayRome())
  const [rows, setRows] = useState<Acconto[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Form
  const [importo, setImporto] = useState('')
  const [causale, setCausale] = useState('')
  const [note, setNote] = useState('')

  // 2026-08-14 (richiesta direzione): SOLO la direzione (Valerio e Ilenia, via
  // ROLE_FAILSAFE) vede gli acconti di tutti. Ogni altro operatore — superadmin
  // e developer compresi — vede ESCLUSIVAMENTE i propri: gli incassi personali
  // non sono un dato di gestione condiviso. Era `role === 'superadmin' ||
  // hasRole('direzione') || hasRole('developer')`, che apriva la cassa di tutti
  // a chiunque avesse un ruolo tecnico.
  // 2026-08-19 (richiesta direzione): oltre alla direzione, vede tutti gli
  // acconti SOLO chi ha la spunta "Acconti: vede tutti" nella sua scheda
  // operatore. Il ruolo superadmin NON basta: David e' superadmin e deve
  // vedere esclusivamente i propri incassi.
  // 2026-08-20: NON basta piu' `direzione`. Controllo sul database del 20/08:
  // Davide, Salvatore e Ophelie hanno tutti il tag `role:direzione`, quindi
  // vedevano la cassa di tutti — l'opposto della richiesta. Per gli acconti
  // vale SOLO la spunta "Acconti: vede tutti", piu' il failsafe di Valerio e
  // Ilenia (che non devono poter restare chiusi fuori dalla propria cassa).
  // Stessa identica regola della funzione dr7_can_see_all_acconti in database.
  const ACCONTI_FAILSAFE = ['valerio@dr7.app', 'ilenia@dr7.app']
  const canSeeAll = hasRole('acconti-tutti')
    || ACCONTI_FAILSAFE.includes((adminEmail || '').toLowerCase())
  const me = useMemo(
    () => ({ id: adminId, nome: adminName || (adminEmail || '').split('@')[0] || '' }),
    [adminId, adminName, adminEmail]
  )

  // Solo la direzione vede la tendina "Operatore": ogni altro operatore
  // continua a registrare esclusivamente per se stesso.
  const [operatori, setOperatori] = useState<AdminOption[]>([])
  const [operatoreId, setOperatoreId] = useState<string>('')

  // Vista Giornata / Storico + periodo dello storico.
  const [vista, setVista] = useState<'giornata' | 'storico'>('giornata')
  const [daData, setDaData] = useState<string>(() => todayRome().slice(0, 8) + '01')
  const [aData, setAData] = useState<string>(todayRome())
  const [filtroOperatore, setFiltroOperatore] = useState<string>('')

  useEffect(() => {
    if (roleLoading || !canSeeAll) return
    let annullato = false
    ;(async () => {
      const { data: d, error } = await supabase
        .from('admins')
        .select('id, nome, email, stato, archived_at')
        .is('archived_at', null)
        .order('nome', { ascending: true })
      if (annullato) return
      // RLS bloccata: niente tendina, resta la registrazione per se' stessi.
      if (error) { setOperatori([]); return } // eslint-disable-line curly
      // 2026-08-25: l'archiviazione di un operatore (Operatori > Storico) scrive
      // `archived_at`, NON `stato` — filtrare solo su `stato` lasciava gli ex
      // operatori nella tendina "Operatore", quindi l'Amministrazione poteva
      // ancora intestare un acconto a chi non lavora piu' qui. Doppio filtro:
      // archiviati fuori (anche lato query) e stato diverso da Attivo fuori.
      const attivi = ((d as AdminOption[]) || [])
        .filter(a => !a.archived_at)
        .filter(a => (a.stato || 'Attivo').toLowerCase() === 'attivo')
      setOperatori(attivi)
    })()
    return () => { annullato = true }
  }, [roleLoading, canSeeAll])

  function nomeOperatore(a: AdminOption): string {
    return (a.nome || '').trim() || (a.email || '').split('@')[0] || 'Operatore'
  }

  async function load() {
    if (roleLoading) return
    setLoading(true)
    let q = supabase.from('acconti_giornalieri').select('*')
    if (vista === 'giornata') {
      q = q.eq('data', data)
    } else {
      q = q.gte('data', daData).lte('data', aData)
      if (canSeeAll && filtroOperatore) q = q.eq('operatore_id', filtroOperatore)
    }
    if (!canSeeAll) {
      // Senza operatore_id (admin non ancora collegato) si ripiega sul nome
      // denormalizzato, cosi' l'operatore rivede comunque cio' che ha inserito.
      q = me.id ? q.eq('operatore_id', me.id) : q.eq('operatore_nome', me.nome)
    }
    // PostgREST taglia a 1000 righe: lo storico e' esplicitamente limitato e
    // filtrabile per periodo invece di illudere che sia completo.
    const { data: d, error } = await q
      .order('data', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) toast.error('Errore caricamento: ' + error.message)
    setRows((d as Acconto[]) || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [data, vista, daData, aData, filtroOperatore, roleLoading, canSeeAll, me.id, me.nome]) // eslint-disable-line react-hooks/exhaustive-deps

  // 2026-08-10 (roadmap #42): senza il metodo di incasso la quadratura di
  // cassa e' impossibile — la direzione vede un totale ma non sa quanta parte
  // deve trovarsi fisicamente in cassa a fine giornata.
  const METODI = ['Contanti', 'POS', 'Bonifico', 'Nexi', 'Altro']
  const [metodo, setMetodo] = useState<string>('Contanti')

  async function registra() {
    const cents = Math.round(parseFloat((importo || '').replace(',', '.')) * 100)
    if (!Number.isFinite(cents) || cents <= 0) { toast.error('Inserisci un importo valido'); return }
    // Solo direzione puo' intestare l'acconto a un altro operatore; per tutti
    // gli altri (e in mancanza di scelta) resta l'utente loggato. `created_by`
    // e' sempre chi ha materialmente inserito la riga, cosi' resta la traccia.
    const scelto = canSeeAll && operatoreId ? operatori.find(o => o.id === operatoreId) : undefined
    const intestatarioId = scelto ? scelto.id : me.id
    const intestatarioNome = scelto ? nomeOperatore(scelto) : me.nome

    setSaving(true)
    const { data: inserito, error } = await supabase.from('acconti_giornalieri').insert({
      operatore_id: intestatarioId,
      operatore_nome: intestatarioNome || null,
      data,
      importo_cents: cents,
      causale: causale.trim() || null,
      note: note.trim() || null,
      metodo_pagamento: metodo || null,
      created_by: me.id,
    }).select('id').maybeSingle()
    setSaving(false)
    if (error) { toast.error('Salvataggio fallito: ' + error.message); return }

    // Messaggi di Sistema Pro — evento "Acconto registrato (collaboratore)".
    // Il messaggio parte SOLO se la direzione ha creato e attivato un template
    // con quel trigger; va al collaboratore intestatario (numero letto da
    // admins.contatto_interno), mai a un cliente. Fire-and-forget: se manca il
    // numero o il template, il salvataggio dell'acconto resta comunque valido.
    if (inserito?.id) {
      fetch('/.netlify/functions/trigger-system-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'on_acconto', entityType: 'acconto', entityId: inserito.id }),
      })
        .then(r => r.json())
        .then((r: { skipped?: boolean; reason?: string; message?: string; sent?: number }) => {
          // L'esito va detto: un avviso che non parte in silenzio e' esattamente
          // il motivo per cui non ci si accorge che il collaboratore non riceve
          // mai niente.
          if (r?.reason === 'no_operator_phone') {
            toast(r.message || 'Messaggio non inviato: manca il Contatto interno dell\'operatore.', { icon: '!', duration: 7000 })
          }
        })
        .catch(() => { /* non blocca la registrazione */ })
    }
    setImporto(''); setCausale(''); setNote(''); setMetodo('Contanti')
    toast.success(scelto ? `Acconto registrato per ${intestatarioNome}` : 'Acconto registrato')
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
  // Storico: righe raggruppate per giornata, col totale del giorno accanto alla
  // data — la direzione ricostruisce la cassa di una data passata senza dover
  // cambiare filtro una giornata alla volta.
  const perGiorno = useMemo(() => {
    const m = new Map<string, Acconto[]>()
    for (const r of rows) {
      const arr = m.get(r.data)
      if (arr) arr.push(r); else m.set(r.data, [r])
    }
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1))
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
        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex rounded-lg border border-theme-border overflow-hidden self-end">
            {(['giornata', 'storico'] as const).map(v => (
              <button
                key={v}
                onClick={() => setVista(v)}
                className={`px-3 py-2 text-xs font-semibold ${vista === v ? 'bg-dr7-gold text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}
              >
                {v === 'giornata' ? 'Giornata' : 'Storico'}
              </button>
            ))}
          </div>
          {vista === 'giornata' ? (
            <label className="text-xs text-theme-text-muted">Giornata
              <EuropeanDateInput value={data} onChange={(__v: string) => setData(__v)} className="mt-1 block px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
            </label>
          ) : (
            <>
              <label className="text-xs text-theme-text-muted">Da
                <EuropeanDateInput value={daData} onChange={(__v: string) => setDaData(__v)} className="mt-1 block px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
              </label>
              <label className="text-xs text-theme-text-muted">A
                <EuropeanDateInput value={aData} onChange={(__v: string) => setAData(__v)} className="mt-1 block px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
              </label>
              {canSeeAll && operatori.length > 0 && (
                <label className="text-xs text-theme-text-muted">Operatore
                  <select value={filtroOperatore} onChange={e => setFiltroOperatore(e.target.value)} className="mt-1 block px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                    <option value="">Tutti</option>
                    {operatori.map(o => <option key={o.id} value={o.id}>{nomeOperatore(o)}</option>)}
                  </select>
                </label>
              )}
            </>
          )}
        </div>
      </div>

      {/* Registra — solo in vista Giornata: l'acconto si intesta alla data
          selezionata li' sopra, che in Storico non e' visibile. */}
      {vista === 'giornata' && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
          <h2 className="text-sm font-semibold text-theme-text-primary mb-3">Registra acconto</h2>
          <div className={`grid grid-cols-1 gap-3 ${canSeeAll && operatori.length > 0 ? 'sm:grid-cols-6' : 'sm:grid-cols-5'}`}>
            {canSeeAll && operatori.length > 0 && (
              <label className="text-xs text-theme-text-muted">Operatore
                <select value={operatoreId} onChange={e => setOperatoreId(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm">
                  <option value="">{me.nome || 'Io'} (io)</option>
                  {operatori.filter(o => o.id !== me.id).map(o => (
                    <option key={o.id} value={o.id}>{nomeOperatore(o)}</option>
                  ))}
                </select>
              </label>
            )}
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
      )}

      {/* Riepilogo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
          <p className="text-xs text-theme-text-muted">
            {vista === 'storico' ? 'Totale periodo' : canSeeAll ? 'Totale giornata' : 'Totale incassato da te'}
          </p>
          <p className="text-2xl font-bold text-dr7-gold tabular-nums">{eur(totale)}</p>
          <p className="text-xs text-theme-text-muted mt-1">
            {rows.length} acconto/i{vista === 'storico' && perGiorno.length > 0 ? ` · ${perGiorno.length} giornata/e` : ''}
          </p>
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
          <h2 className="text-sm font-semibold text-theme-text-primary">
            {vista === 'giornata'
              ? `Acconti del ${itDate(data)}`
              : `Storico dal ${itDate(daData)} al ${itDate(aData)}`}
          </h2>
        </div>
        {loading ? (
          <p className="p-4 text-sm text-theme-text-muted">Caricamento…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-theme-text-muted">
            {vista === 'storico'
              ? 'Nessun acconto nel periodo selezionato.'
              : canSeeAll ? 'Nessun acconto registrato per questa giornata.' : 'Non hai registrato acconti per questa giornata.'}
          </p>
        ) : (
          <div className="divide-y divide-theme-border">
            {perGiorno.map(([giorno, righe]) => (
              <div key={giorno}>
                {vista === 'storico' && (
                  <div className="flex items-center justify-between gap-3 px-4 py-2 bg-theme-bg-tertiary">
                    <span className="text-xs font-semibold text-theme-text-secondary">{itDate(giorno)}</span>
                    <span className="text-xs font-semibold text-dr7-gold tabular-nums">{eur(righe.reduce((s, x) => s + (x.importo_cents || 0), 0))}</span>
                  </div>
                )}
                <div className="divide-y divide-theme-border">
                  {righe.map(r => (
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
