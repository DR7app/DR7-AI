// =============================================================================
// Magazzino Generale — inventario aziendale a livello di tutti i reparti
// (caffetteria, pulizia, lubrificanti, lavaggio, ricambi, ecc.). Distinto dal
// magazzino ricambi-veicolo (FleetInventory). Regola chiave: quando la giacenza
// scende <= soglia minima parte un riordino (WhatsApp/Email/Amazon/Manuale) e un
// ALARM allo staff. Ogni carico/scarico/rettifica e' tracciato (inv_movimenti);
// ogni modifica strutturale in inv_audit_log. Tabelle: migration
// 20260721_inventario_magazzino.sql + _seed.sql.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

// ── Tipi ─────────────────────────────────────────────────────────────────────
interface Categoria { id: string; codice: string; nome: string; ordine: number; attiva: boolean }
interface Fornitore { id: string; nome: string; email: string | null; telefono: string | null; canale_riordino_default: string | null }
interface Articolo {
  id: string
  codice: string
  categoria_codice: string
  nome: string
  quantita: number
  unita: string | null
  giacenza_pct: number | null
  prezzo: number | null
  soglia_minima: number | null
  quantita_riordino: number | null
  fornitore_id: string | null
  canale_riordino: string | null
  amazon_asin: string | null
  amazon_url: string | null
  note: string | null
  attivo: boolean
}
interface Movimento { id: string; tipo: string; delta: number | null; qta_prima: number | null; qta_dopo: number | null; motivo: string | null; utente: string | null; created_at: string }
interface Ordine { id: string; articolo_id: string; fornitore_id: string | null; canale: string; quantita: number; stato: string; auto: boolean; created_at: string }

type Semaforo = 'rosso' | 'giallo' | 'verde' | 'grigio'
const CANALI = ['whatsapp', 'email', 'amazon', 'manuale'] as const

// ── Utilita ──────────────────────────────────────────────────────────────────
function eur(n: number | null | undefined): string {
  if (n == null) return '—'
  return '€' + n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function num(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('it-IT', { maximumFractionDigits: 2 })
}
function isPct(a: Articolo): boolean { return a.giacenza_pct != null }
function valoreScorta(a: Articolo): number { return isPct(a) ? (a.giacenza_pct ?? 0) : (a.quantita ?? 0) }

// Semaforo: rosso <= soglia · giallo tra soglia e soglia*1.5 · verde sopra · grigio senza soglia
function semaforo(a: Articolo): Semaforo {
  const s = a.soglia_minima
  if (s == null) return 'grigio'
  const v = valoreScorta(a)
  if (v <= s) return 'rosso'
  if (v <= s * 1.5) return 'giallo'
  return 'verde'
}
const SEM_DOT: Record<Semaforo, string> = {
  rosso: 'bg-red-500', giallo: 'bg-amber-400', verde: 'bg-emerald-500', grigio: 'bg-zinc-400',
}
const SEM_LABEL: Record<Semaforo, string> = {
  rosso: 'Sotto scorta', giallo: 'In avvicinamento', verde: 'OK', grigio: 'Non monitorato',
}

async function currentUserLabel(): Promise<string> {
  try {
    const { data } = await supabase.auth.getUser()
    return data.user?.email || data.user?.id || 'admin'
  } catch { return 'admin' }
}

export default function InventarioMagazzino() {
  const [categorie, setCategorie] = useState<Categoria[]>([])
  const [articoli, setArticoli] = useState<Articolo[]>([])
  const [fornitori, setFornitori] = useState<Fornitore[]>([])
  const [ordini, setOrdini] = useState<Ordine[]>([])
  const [loading, setLoading] = useState(true)
  const [tablesMissing, setTablesMissing] = useState(false)

  // UI state
  const [search, setSearch] = useState('')
  const [soloSottoScorta, setSoloSottoScorta] = useState(false)
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const [detailArticolo, setDetailArticolo] = useState<Articolo | null>(null)
  const [movimenti, setMovimenti] = useState<Movimento[]>([])
  const [editArticolo, setEditArticolo] = useState<Partial<Articolo> | null>(null)
  const [movModal, setMovModal] = useState<{ articolo: Articolo; tipo: 'carico' | 'scarico' | 'rettifica' } | null>(null)
  const [busy, setBusy] = useState(false)
  // Invio ordine via WhatsApp a un numero digitato al volo (non solo fornitori).
  const [sendOrderId, setSendOrderId] = useState<string | null>(null)
  const [sendPhone, setSendPhone] = useState('')

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    const [cats, arts, forn, ords] = await Promise.all([
      supabase.from('inv_categorie').select('*').order('ordine'),
      supabase.from('inv_articoli').select('*').order('codice'),
      supabase.from('fornitori').select('id,nome,email,telefono,canale_riordino_default').eq('attivo', true).order('nome'),
      supabase.from('inv_ordini').select('*').in('stato', ['bozza', 'inviato', 'confermato']),
    ])
    if (cats.error && /relation .* does not exist|schema cache/i.test(cats.error.message || '')) {
      setTablesMissing(true); setLoading(false); return
    }
    setCategorie(cats.data || [])
    setArticoli((arts.data as Articolo[]) || [])
    setFornitori((forn.data as Fornitore[]) || [])
    setOrdini((ords.data as Ordine[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── Derivati ───────────────────────────────────────────────────────────────
  const fornitoreById = useMemo(() => {
    const m = new Map<string, Fornitore>(); fornitori.forEach(f => m.set(f.id, f)); return m
  }, [fornitori])
  const openOrderByArticolo = useMemo(() => {
    const m = new Map<string, Ordine>(); ordini.forEach(o => m.set(o.articolo_id, o)); return m
  }, [ordini])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return articoli.filter(a => {
      if (soloSottoScorta && semaforo(a) !== 'rosso') return false
      if (!q) return true
      return a.nome.toLowerCase().includes(q) || a.codice.toLowerCase().includes(q) || (a.note || '').toLowerCase().includes(q)
    })
  }, [articoli, search, soloSottoScorta])

  const byCategoria = useMemo(() => {
    const m = new Map<string, Articolo[]>()
    for (const a of filtered) {
      if (!m.has(a.categoria_codice)) m.set(a.categoria_codice, [])
      m.get(a.categoria_codice)!.push(a)
    }
    return m
  }, [filtered])

  const sottoScortaCount = useMemo(() => articoli.filter(a => semaforo(a) === 'rosso').length, [articoli])
  const valoreTotale = useMemo(() => articoli.reduce((s, a) => s + (a.prezzo || 0) * (a.quantita || 0), 0), [articoli])

  // ── Next code per categoria ─────────────────────────────────────────────────
  function nextCode(catCode: string): string {
    let max = 0
    for (const a of articoli) {
      if (a.categoria_codice !== catCode) continue
      const m = a.codice.match(/-(\d+)$/)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    return `DR7-${catCode}-${String(max + 1).padStart(3, '0')}`
  }

  // ── Audit log ────────────────────────────────────────────────────────────
  async function audit(entita: string, entitaId: string | null, azione: 'crea' | 'modifica' | 'elimina', campo?: string, prima?: unknown, dopo?: unknown) {
    const utente = await currentUserLabel()
    await supabase.from('inv_audit_log').insert({
      entita, entita_id: entitaId, azione, campo: campo || null,
      valore_prima: prima == null ? null : String(prima),
      valore_dopo: dopo == null ? null : String(dopo),
      utente,
    }).then(() => {}, () => {})
  }

  // ── ALARM + riordino automatico quando si scende sotto soglia ─────────────
  async function triggerRiordino(a: Articolo, nuovaQuantita: number) {
    // 1) evita doppioni: se c'e' gia' un ordine aperto per l'articolo, stop.
    const { data: existing } = await supabase.from('inv_ordini')
      .select('id').eq('articolo_id', a.id).in('stato', ['bozza', 'inviato', 'confermato']).limit(1)
    if (existing && existing.length) return

    const forn = a.fornitore_id ? fornitoreById.get(a.fornitore_id) : undefined
    const canale = a.canale_riordino || forn?.canale_riordino_default || 'whatsapp'
    const quantita = a.quantita_riordino || a.soglia_minima || 1

    // 2) crea l'ordine (Bozza, auto). L'unique partial index protegge dalle race.
    const { data: ord, error: ordErr } = await supabase.from('inv_ordini').insert({
      articolo_id: a.id, fornitore_id: a.fornitore_id, canale, quantita,
      stato: 'bozza', auto: true,
    }).select('id').single()
    if (ordErr) return // probabile violazione unique (ordine gia' aperto): ok

    // 3) marca l'evento nel ledger movimenti
    await supabase.from('inv_movimenti').insert({
      articolo_id: a.id, tipo: 'riordino', delta: null,
      qta_prima: nuovaQuantita, qta_dopo: nuovaQuantita,
      motivo: `Soglia raggiunta → riordino ${quantita} (${canale})`,
      utente: await currentUserLabel(), ordine_id: ord?.id || null,
    })

    // 4) ALARM allo staff via WhatsApp (Green API). Non-bloccante.
    const unita = isPct(a) ? '%' : (a.unita || 'pz')
    const msg =
      `⚠️ SCORTA MINIMA — MAGAZZINO DR7\n\n` +
      `Articolo: ${a.nome}\n` +
      `Codice: ${a.codice}\n` +
      `Giacenza: ${num(nuovaQuantita)} ${unita} (soglia ${num(a.soglia_minima)})\n` +
      `Riordino: ${num(quantita)} via ${canale}` +
      (forn ? `\nFornitore: ${forn.nome}` : '')
    try {
      await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyAdmin: true, customMessage: msg }),
      })
    } catch { /* alarm best-effort */ }

    toast(`Scorta minima: ${a.nome} — ordine creato, alarm inviato`, { icon: '⚠️', duration: 6000 })
  }

  // ── Applica movimento (carico/scarico/rettifica) via RPC atomico ──────────
  async function applyMovimento(a: Articolo, tipo: 'carico' | 'scarico' | 'rettifica', valore: number, motivo: string) {
    setBusy(true)
    try {
      const utente = await currentUserLabel()
      const { data, error } = await supabase.rpc('inv_apply_movimento', {
        p_articolo_id: a.id, p_tipo: tipo, p_valore: valore, p_motivo: motivo, p_utente: utente,
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      const nuova = Number(row?.nuova_quantita ?? valoreScorta(a))
      const sotto = !!row?.sotto_soglia
      // aggiorna stato locale
      setArticoli(prev => prev.map(x => x.id === a.id
        ? { ...x, ...(isPct(a) ? { giacenza_pct: nuova } : { quantita: nuova }) } : x))
      const updated: Articolo = { ...a, ...(isPct(a) ? { giacenza_pct: nuova } : { quantita: nuova }) }
      toast.success(`${tipo === 'carico' ? 'Carico' : tipo === 'scarico' ? 'Scarico' : 'Rettifica'} registrato`)
      // trigger riordino solo su discesa sotto soglia (scarico/rettifica)
      if (sotto && tipo !== 'carico') {
        await triggerRiordino(updated, nuova)
        await load()
      }
    } catch (e) {
      toast.error(`Errore movimento: ${(e as Error).message}`)
    } finally {
      setBusy(false)
      setMovModal(null)
    }
  }

  // ── Salva articolo (crea/modifica) ────────────────────────────────────────
  async function saveArticolo(form: Partial<Articolo>) {
    if (!form.codice || !form.categoria_codice || !form.nome) {
      toast.error('Codice, categoria e nome sono obbligatori'); return
    }
    setBusy(true)
    try {
      const payload = {
        codice: form.codice, categoria_codice: form.categoria_codice, nome: form.nome,
        quantita: Number(form.quantita) || 0,
        unita: form.unita || null,
        giacenza_pct: form.giacenza_pct == null || (form.giacenza_pct as unknown as string) === '' ? null : Number(form.giacenza_pct),
        prezzo: form.prezzo == null || (form.prezzo as unknown as string) === '' ? null : Number(form.prezzo),
        soglia_minima: form.soglia_minima == null || (form.soglia_minima as unknown as string) === '' ? null : Number(form.soglia_minima),
        quantita_riordino: form.quantita_riordino == null || (form.quantita_riordino as unknown as string) === '' ? null : Number(form.quantita_riordino),
        fornitore_id: form.fornitore_id || null,
        canale_riordino: form.canale_riordino || null,
        amazon_asin: form.amazon_asin || null,
        amazon_url: form.amazon_url || null,
        note: form.note || null,
      }
      const isNew = !form.id
      const { data, error } = isNew
        ? await supabase.from('inv_articoli').insert(payload).select('*').single()
        : await supabase.from('inv_articoli').update(payload).eq('id', form.id!).select('*').single()
      if (error) throw error
      await audit('articolo', (data as Articolo).id, isNew ? 'crea' : 'modifica', undefined, isNew ? null : form.id, payload.codice)
      toast.success(isNew ? 'Articolo creato' : 'Articolo aggiornato')
      setEditArticolo(null)
      await load()
    } catch (e) {
      toast.error(`Errore salvataggio: ${(e as Error).message}`)
    } finally { setBusy(false) }
  }

  async function deleteArticolo(a: Articolo) {
    if (!confirm(`Eliminare "${a.nome}" (${a.codice})? Lo storico movimenti verra' rimosso.`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('inv_articoli').delete().eq('id', a.id)
      if (error) throw error
      await audit('articolo', a.id, 'elimina', undefined, a.codice, null)
      toast.success('Articolo eliminato')
      setEditArticolo(null); setDetailArticolo(null)
      await load()
    } catch (e) { toast.error(`Errore: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  // ── Storico movimenti per il dettaglio ────────────────────────────────────
  async function openDetail(a: Articolo) {
    setDetailArticolo(a); setMovimenti([])
    const { data } = await supabase.from('inv_movimenti').select('*').eq('articolo_id', a.id).order('created_at', { ascending: false }).limit(200)
    setMovimenti((data as Movimento[]) || [])
  }

  // ── Ordini: transizioni di stato ──────────────────────────────────────────
  async function ordineTransizione(o: Ordine, stato: string) {
    setBusy(true)
    try {
      const patch: Record<string, unknown> = { stato }
      if (stato === 'inviato') patch.sent_at = new Date().toISOString()
      if (stato === 'ricevuto') patch.received_at = new Date().toISOString()
      const { error } = await supabase.from('inv_ordini').update(patch).eq('id', o.id)
      if (error) throw error
      // se ricevuto -> carico automatico della quantita ordinata
      if (stato === 'ricevuto') {
        const a = articoli.find(x => x.id === o.articolo_id)
        if (a && !isPct(a)) {
          await supabase.rpc('inv_apply_movimento', {
            p_articolo_id: a.id, p_tipo: 'carico', p_valore: o.quantita,
            p_motivo: `Consegna ordine ricevuto`, p_utente: await currentUserLabel(),
          })
        }
      }
      toast.success(`Ordine ${stato}`)
      await load()
    } catch (e) { toast.error(`Errore: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  // Invia l'ordine via WhatsApp a un numero qualsiasi (digitato al volo o
  // precompilato dal fornitore), poi porta l'ordine a "inviato".
  async function inviaOrdineWhatsApp(o: Ordine, phoneRaw: string) {
    const phone = (phoneRaw || '').replace(/\D/g, '')
    if (phone.length < 8) { toast.error('Numero non valido'); return }
    setBusy(true)
    try {
      const a = articoli.find(x => x.id === o.articolo_id)
      const forn = o.fornitore_id ? fornitoreById.get(o.fornitore_id) : undefined
      const unita = a && isPct(a) ? '%' : (a?.unita || 'pz')
      const msg =
        `Ordine DR7 — Magazzino\n\n` +
        `Articolo: ${a?.nome || o.articolo_id}\n` +
        (a?.codice ? `Codice: ${a.codice}\n` : '') +
        `Quantita: ${num(o.quantita)} ${unita}\n` +
        (forn ? `Fornitore: ${forn.nome}\n` : '') +
        `\nConsegna presso: DR7 — Viale Marconi 229, 09131 Cagliari (CA)`
      const res = await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPhone: phone, customMessage: msg, type: 'Ordine Magazzino' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.success === false) throw new Error(data?.error || `HTTP ${res.status}`)
      await supabase.from('inv_ordini').update({ stato: 'inviato', sent_at: new Date().toISOString() }).eq('id', o.id)
      toast.success('Ordine inviato via WhatsApp')
      setSendOrderId(null); setSendPhone('')
      await load()
    } catch (e) { toast.error(`Errore invio: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  // Crea un ordine manuale (on-demand) per un articolo, anche se non e' sotto
  // scorta. Poi lo si invia via WhatsApp al numero che si vuole.
  async function creaOrdineManuale(a: Articolo) {
    if (openOrderByArticolo.has(a.id)) { toast('Ordine gia aperto per questo articolo', { icon: 'ℹ️' }); return }
    setBusy(true)
    try {
      const forn = a.fornitore_id ? fornitoreById.get(a.fornitore_id) : undefined
      const canale = a.canale_riordino || forn?.canale_riordino_default || 'whatsapp'
      const quantita = a.quantita_riordino || a.soglia_minima || 1
      const { error } = await supabase.from('inv_ordini').insert({
        articolo_id: a.id, fornitore_id: a.fornitore_id, canale, quantita, stato: 'bozza', auto: false,
      })
      if (error) throw error
      toast.success('Ordine creato — invialo via WhatsApp al numero che vuoi')
      await load()
    } catch (e) { toast.error(`Errore: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (tablesMissing) {
    return (
      <div className="p-6">
        <div className="max-w-2xl rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm text-theme-text-primary">
          <p className="font-semibold mb-2">Modulo non ancora attivo</p>
          <p className="text-theme-text-secondary">
            Applica le migration <code>20260721_inventario_magazzino.sql</code> e{' '}
            <code>20260721_inventario_magazzino_seed.sql</code> su Supabase per creare le tabelle e i 164 articoli.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Articoli totali" value={String(articoli.length)} />
        <Kpi label="Sotto scorta" value={String(sottoScortaCount)} tone={sottoScortaCount > 0 ? 'red' : 'emerald'} />
        <Kpi label="Ordini aperti" value={String(ordini.length)} tone={ordini.length > 0 ? 'amber' : 'default'} />
        <Kpi label="Valore magazzino" value={eur(valoreTotale)} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Cerca articolo, codice, note..."
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary placeholder:text-theme-text-muted"
        />
        <button
          onClick={() => setSoloSottoScorta(v => !v)}
          className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${soloSottoScorta ? 'bg-red-500/15 text-red-300 border-red-500/40' : 'bg-theme-bg-tertiary text-theme-text-secondary border-theme-border'}`}
        >Solo sotto scorta</button>
        <button
          onClick={() => { const c = categorie[0]?.codice; setEditArticolo({ categoria_codice: c, codice: c ? nextCode(c) : '', quantita: 0 }) }}
          className="px-3 py-2 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-700 text-white"
        >+ Nuovo articolo</button>
        <button onClick={() => setOpenCats(new Set(categorie.map(c => c.codice)))} className="px-3 py-2 rounded-lg text-sm text-theme-text-secondary border border-theme-border">Espandi tutto</button>
        <button onClick={() => setOpenCats(new Set())} className="px-3 py-2 rounded-lg text-sm text-theme-text-secondary border border-theme-border">Comprimi tutto</button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-theme-text-muted">Caricamento…</div>
      ) : (
        <div className="space-y-2.5">
          {categorie.map(cat => {
            const items = byCategoria.get(cat.codice) || []
            if (soloSottoScorta && items.length === 0) return null
            const open = openCats.has(cat.codice)
            const rossi = items.filter(a => semaforo(a) === 'rosso').length
            return (
              <div key={cat.codice} className="rounded-xl border border-theme-border bg-theme-bg-secondary overflow-hidden">
                <button
                  onClick={() => setOpenCats(prev => { const n = new Set(prev); n.has(cat.codice) ? n.delete(cat.codice) : n.add(cat.codice); return n })}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-theme-bg-hover transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-theme-bg-tertiary text-theme-text-muted">{cat.codice}</span>
                    <span className="font-semibold text-theme-text-primary text-sm">{cat.nome}</span>
                    <span className="text-xs text-theme-text-muted">({items.length})</span>
                    {rossi > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/40">{rossi} sotto scorta</span>}
                  </div>
                  <svg className={`w-4 h-4 text-theme-text-muted transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {open && (
                  <div className="divide-y divide-theme-border/50">
                    {items.map(a => {
                      const sem = semaforo(a)
                      const forn = a.fornitore_id ? fornitoreById.get(a.fornitore_id) : undefined
                      const hasOpenOrder = openOrderByArticolo.has(a.id)
                      return (
                        <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 hover:bg-theme-bg-tertiary/30">
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${SEM_DOT[sem]}`} title={SEM_LABEL[sem]} />
                          <button onClick={() => openDetail(a)} className="text-left min-w-[180px] flex-1">
                            <div className="text-sm font-medium text-theme-text-primary">{a.nome}</div>
                            <div className="text-[11px] text-theme-text-muted font-mono">{a.codice}{forn ? ` · ${forn.nome}` : ''}</div>
                          </button>
                          <div className="text-sm tabular-nums text-theme-text-primary min-w-[90px] text-right">
                            {isPct(a) ? `${num(a.giacenza_pct)}%` : `${num(a.quantita)} ${a.unita || ''}`}
                            {a.soglia_minima != null && <span className="text-[11px] text-theme-text-muted ml-1">/ {num(a.soglia_minima)}</span>}
                          </div>
                          <div className="text-sm tabular-nums text-theme-text-secondary min-w-[70px] text-right">{eur(a.prezzo)}</div>
                          {hasOpenOrder && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">Ordine aperto</span>}
                          <div className="flex items-center gap-1">
                            <button onClick={() => setMovModal({ articolo: a, tipo: 'carico' })} className="w-7 h-7 grid place-items-center rounded bg-emerald-600/80 hover:bg-emerald-600 text-white text-sm font-bold" title="Carico">+</button>
                            <button onClick={() => setMovModal({ articolo: a, tipo: 'scarico' })} className="w-7 h-7 grid place-items-center rounded bg-red-600/80 hover:bg-red-600 text-white text-sm font-bold" title="Scarico">−</button>
                            <button onClick={() => setMovModal({ articolo: a, tipo: 'rettifica' })} className="px-2 h-7 rounded bg-theme-bg-tertiary border border-theme-border text-theme-text-secondary text-xs" title="Rettifica inventario fisico">Rett.</button>
                            {!hasOpenOrder && <button onClick={() => creaOrdineManuale(a)} disabled={busy} className="px-2 h-7 rounded bg-green-600/80 hover:bg-green-600 text-white text-xs font-semibold disabled:opacity-50" title="Crea ordine e invialo via WhatsApp a un numero a scelta">Ordina</button>}
                            <button onClick={() => setEditArticolo(a)} className="px-2 h-7 rounded bg-theme-bg-tertiary border border-theme-border text-theme-text-secondary text-xs">Modifica</button>
                          </div>
                        </div>
                      )
                    })}
                    {items.length === 0 && <div className="px-4 py-3 text-xs text-theme-text-muted">Nessun articolo</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Ordini aperti */}
      {ordini.length > 0 && (
        <div className="rounded-xl border border-theme-border bg-theme-bg-secondary p-4">
          <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Ordini di riordino aperti ({ordini.length})</h3>
          <div className="space-y-1.5">
            {ordini.map(o => {
              const a = articoli.find(x => x.id === o.articolo_id)
              const forn = o.fornitore_id ? fornitoreById.get(o.fornitore_id) : undefined
              return (
                <div key={o.id} className="flex flex-wrap items-center gap-3 text-sm px-3 py-2 rounded-lg bg-theme-bg-tertiary/40">
                  <span className="flex-1 min-w-[160px] text-theme-text-primary">{a?.nome || o.articolo_id} <span className="text-[11px] text-theme-text-muted">×{num(o.quantita)}</span></span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-theme-bg-tertiary text-theme-text-muted uppercase">{o.canale}</span>
                  {forn && <span className="text-[11px] text-theme-text-muted">{forn.nome}</span>}
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 uppercase">{o.stato}</span>
                  {o.stato === 'bozza' && sendOrderId !== o.id && (
                    <button
                      onClick={() => { setSendOrderId(o.id); setSendPhone(forn?.telefono ? forn.telefono.replace(/\D/g, '') : '') }}
                      className="px-2 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-semibold"
                    >Invia WhatsApp</button>
                  )}
                  {o.stato === 'bozza' && sendOrderId === o.id && (
                    <div className="flex items-center gap-1 w-full mt-1">
                      <input
                        type="tel" value={sendPhone} onChange={e => setSendPhone(e.target.value)}
                        placeholder="Numero WhatsApp (es. 39347...)"
                        className="flex-1 px-2 py-1 rounded bg-theme-bg-tertiary border border-green-500/50 text-xs text-theme-text-primary"
                        autoFocus
                      />
                      <button disabled={busy} onClick={() => inviaOrdineWhatsApp(o, sendPhone)} className="px-2 py-1 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-semibold disabled:opacity-50">Invia</button>
                      <button onClick={() => { setSendOrderId(null); setSendPhone('') }} className="px-2 py-1 rounded bg-theme-bg-tertiary border border-theme-border text-theme-text-secondary text-xs">Annulla</button>
                    </div>
                  )}
                  {o.stato === 'bozza' && sendOrderId !== o.id && <button onClick={() => ordineTransizione(o, 'inviato')} className="px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold">Segna inviato</button>}
                  {(o.stato === 'inviato' || o.stato === 'confermato') && <button onClick={() => ordineTransizione(o, 'ricevuto')} className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">Ricevuto (carico)</button>}
                  <button onClick={() => ordineTransizione(o, 'annullato')} className="px-2 py-1 rounded bg-theme-bg-tertiary border border-theme-border text-theme-text-secondary text-xs">Annulla</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modal movimento */}
      {movModal && <MovimentoModal ctx={movModal} busy={busy} onClose={() => setMovModal(null)} onConfirm={(v, m) => applyMovimento(movModal.articolo, movModal.tipo, v, m)} />}

      {/* Modal edit/nuovo */}
      {editArticolo && (
        <ArticoloModal
          initial={editArticolo}
          categorie={categorie}
          fornitori={fornitori}
          busy={busy}
          nextCodeFor={nextCode}
          onClose={() => setEditArticolo(null)}
          onSave={saveArticolo}
          onDelete={editArticolo.id ? () => deleteArticolo(editArticolo as Articolo) : undefined}
        />
      )}

      {/* Modal dettaglio storico */}
      {detailArticolo && (
        <DetailModal articolo={detailArticolo} movimenti={movimenti} onClose={() => setDetailArticolo(null)} />
      )}
    </div>
  )
}

// ── Sotto-componenti ──────────────────────────────────────────────────────────
function Kpi({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'red' | 'amber' | 'emerald' }) {
  const toneCls = tone === 'red' ? 'text-red-400' : tone === 'amber' ? 'text-amber-400' : tone === 'emerald' ? 'text-emerald-400' : 'text-theme-text-primary'
  return (
    <div className="rounded-xl border border-theme-border bg-theme-bg-secondary px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-theme-text-muted">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${toneCls}`}>{value}</div>
    </div>
  )
}

function MovimentoModal({ ctx, busy, onClose, onConfirm }: { ctx: { articolo: Articolo; tipo: 'carico' | 'scarico' | 'rettifica' }; busy: boolean; onClose: () => void; onConfirm: (valore: number, motivo: string) => void }) {
  const pct = isPct(ctx.articolo)
  const [valore, setValore] = useState('')
  const [motivo, setMotivo] = useState('')
  const titolo = ctx.tipo === 'carico' ? 'Carico (+)' : ctx.tipo === 'scarico' ? 'Scarico (−)' : 'Rettifica inventario'
  const help = ctx.tipo === 'rettifica'
    ? `Imposta il valore reale trovato a inventario${pct ? ' (%)' : ''}.`
    : `Quantita da ${ctx.tipo === 'carico' ? 'aggiungere' : 'togliere'}${pct ? ' (%)' : ''}.`
  return (
    <Scrim onClose={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-theme-bg-secondary border border-theme-border p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-theme-text-primary">{titolo}</h3>
        <p className="text-xs text-theme-text-muted mt-0.5">{ctx.articolo.nome} · {ctx.articolo.codice}</p>
        <label className="block text-xs text-theme-text-secondary mt-4 mb-1">{help}</label>
        <input autoFocus type="number" step="0.01" min="0" value={valore} onChange={e => setValore(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary" />
        <label className="block text-xs text-theme-text-secondary mt-3 mb-1">Motivo</label>
        <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Es. rifornimento sala, evento clienti…"
          className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary" />
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg border border-theme-border text-theme-text-secondary text-sm">Annulla</button>
          <button
            disabled={busy || valore === '' || Number.isNaN(Number(valore))}
            onClick={() => onConfirm(Number(valore), motivo.trim())}
            className="flex-1 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold disabled:opacity-50"
          >{busy ? '…' : 'Conferma'}</button>
        </div>
      </div>
    </Scrim>
  )
}

function ArticoloModal({ initial, categorie, fornitori, busy, nextCodeFor, onClose, onSave, onDelete }: {
  initial: Partial<Articolo>; categorie: Categoria[]; fornitori: Fornitore[]; busy: boolean
  nextCodeFor: (c: string) => string; onClose: () => void; onSave: (f: Partial<Articolo>) => void; onDelete?: () => void
}) {
  const [f, setF] = useState<Partial<Articolo>>(initial)
  const isNew = !initial.id
  const set = (k: keyof Articolo, v: unknown) => setF(prev => ({ ...prev, [k]: v }))
  const inputCls = 'w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary'
  const lblCls = 'block text-[11px] uppercase tracking-wide text-theme-text-muted mb-1'
  return (
    <Scrim onClose={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-theme-bg-secondary border border-theme-border p-5 max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-theme-text-primary mb-4">{isNew ? 'Nuovo articolo' : 'Modifica articolo'}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-1">
            <label className={lblCls}>Categoria</label>
            <select value={f.categoria_codice || ''} onChange={e => { const c = e.target.value; set('categoria_codice', c); if (isNew) set('codice', nextCodeFor(c)) }} className={inputCls}>
              {categorie.map(c => <option key={c.codice} value={c.codice}>{c.codice} — {c.nome}</option>)}
            </select>
          </div>
          <div className="col-span-1">
            <label className={lblCls}>Codice</label>
            <input value={f.codice || ''} onChange={e => set('codice', e.target.value)} className={inputCls} disabled={!isNew} />
          </div>
          <div className="col-span-2">
            <label className={lblCls}>Nome articolo</label>
            <input value={f.nome || ''} onChange={e => set('nome', e.target.value)} className={inputCls} />
          </div>
          <div><label className={lblCls}>Quantita</label><input type="number" step="0.01" value={f.quantita ?? ''} onChange={e => set('quantita', e.target.value)} className={inputCls} /></div>
          <div><label className={lblCls}>Unita</label><input value={f.unita || ''} onChange={e => set('unita', e.target.value)} placeholder="pezzi, flaconi…" className={inputCls} /></div>
          <div><label className={lblCls}>Giacenza % (solo contenitori)</label><input type="number" step="1" min="0" max="100" value={f.giacenza_pct ?? ''} onChange={e => set('giacenza_pct', e.target.value)} placeholder="0–100" className={inputCls} /></div>
          <div><label className={lblCls}>Prezzo unitario €</label><input type="number" step="0.01" value={f.prezzo ?? ''} onChange={e => set('prezzo', e.target.value)} className={inputCls} /></div>
          <div><label className={lblCls}>Soglia minima</label><input type="number" step="0.01" value={f.soglia_minima ?? ''} onChange={e => set('soglia_minima', e.target.value)} placeholder="riordino sotto questo" className={inputCls} /></div>
          <div><label className={lblCls}>Quantita di riordino</label><input type="number" step="0.01" value={f.quantita_riordino ?? ''} onChange={e => set('quantita_riordino', e.target.value)} className={inputCls} /></div>
          <div><label className={lblCls}>Fornitore</label>
            <select value={f.fornitore_id || ''} onChange={e => set('fornitore_id', e.target.value)} className={inputCls}>
              <option value="">—</option>
              {fornitori.map(fo => <option key={fo.id} value={fo.id}>{fo.nome}</option>)}
            </select>
          </div>
          <div><label className={lblCls}>Canale riordino</label>
            <select value={f.canale_riordino || ''} onChange={e => set('canale_riordino', e.target.value)} className={inputCls}>
              <option value="">Default fornitore</option>
              {CANALI.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label className={lblCls}>Amazon ASIN</label><input value={f.amazon_asin || ''} onChange={e => set('amazon_asin', e.target.value)} className={inputCls} /></div>
          <div><label className={lblCls}>Amazon URL</label><input value={f.amazon_url || ''} onChange={e => set('amazon_url', e.target.value)} className={inputCls} /></div>
          <div className="col-span-2"><label className={lblCls}>Note</label><input value={f.note || ''} onChange={e => set('note', e.target.value)} className={inputCls} /></div>
        </div>
        <div className="flex items-center gap-2 mt-5">
          {onDelete && <button onClick={onDelete} disabled={busy} className="px-3 py-2 rounded-lg border border-red-500/40 text-red-400 text-sm">Elimina</button>}
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-theme-border text-theme-text-secondary text-sm">Annulla</button>
          <button onClick={() => onSave(f)} disabled={busy} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold disabled:opacity-50">{busy ? '…' : 'Salva'}</button>
        </div>
      </div>
    </Scrim>
  )
}

function DetailModal({ articolo, movimenti, onClose }: { articolo: Articolo; movimenti: Movimento[]; onClose: () => void }) {
  const tipoLabel: Record<string, string> = { carico: 'Carico', scarico: 'Scarico', rettifica: 'Rettifica', riordino: 'Riordino auto' }
  return (
    <Scrim onClose={onClose}>
      <div className="w-full max-w-xl rounded-xl bg-theme-bg-secondary border border-theme-border p-5 max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-theme-text-primary">{articolo.nome}</h3>
            <p className="text-xs text-theme-text-muted font-mono">{articolo.codice}</p>
          </div>
          <span className={`w-3 h-3 rounded-full ${SEM_DOT[semaforo(articolo)]}`} />
        </div>
        <h4 className="text-xs font-semibold text-theme-text-secondary mt-4 mb-2">Storico movimenti</h4>
        {movimenti.length === 0 ? (
          <p className="text-xs text-theme-text-muted">Nessun movimento registrato.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-theme-text-muted text-left border-b border-theme-border">
                  <th className="py-1.5 pr-2">Data</th><th className="pr-2">Tipo</th><th className="pr-2 text-right">Δ</th>
                  <th className="pr-2 text-right">Prima</th><th className="pr-2 text-right">Dopo</th><th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {movimenti.map(m => (
                  <tr key={m.id} className="border-b border-theme-border/40">
                    <td className="py-1.5 pr-2 text-theme-text-muted whitespace-nowrap">{new Date(m.created_at).toLocaleDateString('it-IT')}</td>
                    <td className="pr-2 text-theme-text-primary">{tipoLabel[m.tipo] || m.tipo}</td>
                    <td className={`pr-2 text-right tabular-nums ${(m.delta || 0) < 0 ? 'text-red-400' : (m.delta || 0) > 0 ? 'text-emerald-400' : 'text-theme-text-muted'}`}>{m.delta == null ? '—' : (m.delta > 0 ? '+' : '') + num(m.delta)}</td>
                    <td className="pr-2 text-right tabular-nums text-theme-text-secondary">{num(m.qta_prima)}</td>
                    <td className="pr-2 text-right tabular-nums text-theme-text-secondary">{num(m.qta_dopo)}</td>
                    <td className="text-theme-text-muted">{m.motivo || ''}{m.utente ? ` · ${m.utente}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-theme-border text-theme-text-secondary text-sm">Chiudi</button>
        </div>
      </div>
    </Scrim>
  )
}

function Scrim({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      {children}
    </div>
  )
}
