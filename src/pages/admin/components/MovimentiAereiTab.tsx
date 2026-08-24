// 2026-07-13: Conteggio movimenti aerei sul piazzale (Noleggio Aria).
//
// 2026-08-24 (direzione): "i Movimenti Aerei devono essere SCRITTI, tutto
// quello che e' gia' stato fatto, quindi andata e ritorno".
// Prima esisteva solo il registro a mano: un volo gia' venduto e gia'
// effettuato non compariva finche' qualcuno non lo ribatteva. Adesso ogni
// volo che il gestionale conosce gia' produce i suoi due movimenti —
// ANDATA (decollo) e RITORNO (atterraggio) — senza scrivere niente:
//
//   • prenotazioni Noleggio Aria (`bookings`, service_type 'heli_rental'):
//     decollo al ritiro, atterraggio alla riconsegna;
//   • partenze tour (`noleggio_tour_departures`): decollo all'orario di
//     partenza, atterraggio a fine durata (default 30 minuti).
//
// Il registro a mano resta: serve per i movimenti che non nascono da una
// prenotazione (posizionamenti, manutenzione, voli tecnici) e quelli si
// possono ancora cancellare. I movimenti automatici no: sono il riflesso
// della prenotazione, si correggono correggendo quella.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

type Origine = 'manuale' | 'prenotazione' | 'tour'

interface Movimento {
  id: string
  movement_at: string
  tipo: 'decollo' | 'atterraggio'
  aeromobile: string | null
  nota: string | null
  origine: Origine
  /** Andata = decollo, Ritorno = atterraggio: la coppia dello stesso volo. */
  fase: 'andata' | 'ritorno'
  /** Gia' effettuato (nel passato) oppure ancora programmato. */
  effettuato: boolean
}

function nowLocalInput(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const DURATA_TOUR_DEFAULT_MIN = 30

export default function MovimentiAereiTab() {
  const [rows, setRows] = useState<Movimento[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [when, setWhen] = useState(nowLocalInput())
  const [tipo, setTipo] = useState<'decollo' | 'atterraggio'>('decollo')
  const [aeromobile, setAeromobile] = useState('')
  const [nota, setNota] = useState('')
  // Di default si guarda cio' che e' GIA' stato fatto: e' la domanda che si
  // fa a questa tab. Il programmato resta a un clic.
  const [soloEffettuati, setSoloEffettuati] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const adesso = Date.now()
    const out: Movimento[] = []

    // ── 1. Registro manuale ────────────────────────────────────────────────
    const { data: manuali, error } = await supabase
      .from('movimenti_aerei')
      .select('id, movement_at, tipo, aeromobile, nota')
      .order('movement_at', { ascending: false })
      .limit(500)
    if (error) toast.error('Errore: ' + error.message)
    for (const m of (manuali || [])) {
      out.push({
        id: `man:${m.id}`,
        movement_at: m.movement_at,
        tipo: m.tipo,
        aeromobile: m.aeromobile,
        nota: m.nota,
        origine: 'manuale',
        fase: m.tipo === 'decollo' ? 'andata' : 'ritorno',
        effettuato: new Date(m.movement_at).getTime() <= adesso,
      })
    }

    // ── 2. Prenotazioni Noleggio Aria: andata al ritiro, ritorno alla
    //      riconsegna. Le annullate non hanno volato: restano fuori.
    const { data: voli } = await supabase
      .from('bookings')
      .select('id, customer_name, vehicle_name, pickup_date, dropoff_date, status')
      .eq('service_type', 'heli_rental')
      .not('status', 'in', '(cancelled,annullata,deleted)')
      .order('pickup_date', { ascending: false })
      .limit(1000)
    for (const b of (voli || [])) {
      const cliente = (b.customer_name || '').trim()
      const etichetta = cliente ? `Prenotazione — ${cliente}` : 'Prenotazione'
      if (b.pickup_date) {
        out.push({
          id: `book:${b.id}:a`,
          movement_at: b.pickup_date,
          tipo: 'decollo',
          aeromobile: b.vehicle_name,
          nota: `${etichetta} · andata`,
          origine: 'prenotazione',
          fase: 'andata',
          effettuato: new Date(b.pickup_date).getTime() <= adesso,
        })
      }
      if (b.dropoff_date) {
        out.push({
          id: `book:${b.id}:r`,
          movement_at: b.dropoff_date,
          tipo: 'atterraggio',
          aeromobile: b.vehicle_name,
          nota: `${etichetta} · ritorno`,
          origine: 'prenotazione',
          fase: 'ritorno',
          effettuato: new Date(b.dropoff_date).getTime() <= adesso,
        })
      }
    }

    // ── 3. Partenze tour: decollo all'orario, atterraggio a fine durata.
    //      La tabella puo' non esistere ancora (migration tour non eseguita):
    //      in quel caso si prosegue senza, non e' un errore da mostrare.
    try {
      const { data: partenze } = await supabase
        .from('noleggio_tour_departures')
        .select('id, catalog_id, departure_date, departure_time, status')
        .neq('status', 'cancelled')
        .order('departure_date', { ascending: false })
        .limit(500)
      if (partenze && partenze.length) {
        const ids = Array.from(new Set(partenze.map(p => p.catalog_id).filter(Boolean)))
        const nomi = new Map<string, string>()
        const durate = new Map<string, number>()
        if (ids.length) {
          const { data: cat } = await supabase
            .from('noleggio_catalog')
            .select('id, name, tour_durations')
            .in('id', ids)
          for (const c of (cat || [])) {
            nomi.set(String(c.id), c.name)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const durs = (c as any).tour_durations as Array<{ minutes?: number }> | null
            const primo = Array.isArray(durs) ? durs.find(d => Number(d?.minutes) > 0) : null
            if (primo?.minutes) durate.set(String(c.id), Number(primo.minutes))
          }
        }
        for (const p of partenze) {
          const iso = new Date(`${p.departure_date}T${String(p.departure_time).slice(0, 5)}:00`)
          if (isNaN(iso.getTime())) continue
          const nome = nomi.get(String(p.catalog_id)) || 'Tour'
          const minuti = durate.get(String(p.catalog_id)) || DURATA_TOUR_DEFAULT_MIN
          const rientro = new Date(iso.getTime() + minuti * 60000)
          out.push({
            id: `tour:${p.id}:a`, movement_at: iso.toISOString(), tipo: 'decollo',
            aeromobile: nome, nota: 'Tour · andata', origine: 'tour', fase: 'andata',
            effettuato: iso.getTime() <= adesso,
          })
          out.push({
            id: `tour:${p.id}:r`, movement_at: rientro.toISOString(), tipo: 'atterraggio',
            aeromobile: nome, nota: `Tour · ritorno (${minuti} min)`, origine: 'tour', fase: 'ritorno',
            effettuato: rientro.getTime() <= adesso,
          })
        }
      }
    } catch { /* tabella tour assente: nessun movimento da li' */ }

    out.sort((a, b) => b.movement_at.localeCompare(a.movement_at))
    setRows(out)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

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
    if (r.origine !== 'manuale') return
    if (!confirm('Eliminare questo movimento?')) return
    const vero = r.id.replace(/^man:/, '')
    const { error } = await supabase.from('movimenti_aerei').delete().eq('id', vero)
    if (error) { toast.error('Errore: ' + error.message); return }
    setRows(prev => prev.filter(x => x.id !== r.id))
  }

  // Conteggi oggi / mese (Europe/Rome via toLocaleDateString). Contano i
  // movimenti EFFETTUATI: un volo di domani non e' un movimento di oggi.
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
  const monthStr = todayStr.slice(0, 7)
  const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
  const fatti = rows.filter(r => r.effettuato)
  const countToday = fatti.filter(r => dayKey(r.movement_at) === todayStr).length
  const countMonth = fatti.filter(r => dayKey(r.movement_at).slice(0, 7) === monthStr).length
  const countProgrammati = rows.length - fatti.length

  const visibili = soloEffettuati ? fatti : rows

  // Raggruppa per giorno per lo storico.
  const groups = new Map<string, Movimento[]>()
  for (const r of visibili) {
    const k = dayKey(r.movement_at)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }

  const badgeOrigine: Record<Origine, string> = {
    manuale: 'bg-theme-bg-tertiary text-theme-text-muted',
    prenotazione: 'bg-emerald-600/20 text-emerald-400',
    tour: 'bg-violet-600/20 text-violet-400',
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-semibold text-theme-text-primary tracking-tight">Movimenti Aerei</h2>
        <p className="text-sm text-theme-text-muted mt-1">
          Decolli e atterraggi sul piazzale DR7. Ogni prenotazione Aria e ogni partenza tour scrive
          da sola i suoi due movimenti: andata al decollo, ritorno all'atterraggio.
        </p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-2xl">
        <div className="p-4 rounded-xl border border-theme-border bg-theme-bg-secondary">
          <div className="text-xs text-theme-text-muted">Oggi</div>
          <div className="text-3xl font-bold text-dr7-gold tabular-nums">{countToday}</div>
        </div>
        <div className="p-4 rounded-xl border border-theme-border bg-theme-bg-secondary">
          <div className="text-xs text-theme-text-muted">Mese corrente</div>
          <div className="text-3xl font-bold text-theme-text-primary tabular-nums">{countMonth}</div>
        </div>
        <div className="p-4 rounded-xl border border-theme-border bg-theme-bg-secondary">
          <div className="text-xs text-theme-text-muted">Programmati</div>
          <div className="text-3xl font-bold text-theme-text-secondary tabular-nums">{countProgrammati}</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setSoloEffettuati(v => !v)}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${soloEffettuati ? 'bg-dr7-gold text-black border-dr7-gold' : 'bg-theme-bg-tertiary text-theme-text-secondary border-theme-border'}`}
        >{soloEffettuati ? 'Solo effettuati' : 'Effettuati + programmati'}</button>
        <span className="text-xs text-theme-text-muted">{visibili.length} movimenti in elenco</span>
      </div>

      {/* Registra */}
      <div className="p-4 rounded-xl border border-theme-border bg-theme-bg-secondary space-y-3">
        <h3 className="text-sm font-semibold text-theme-text-primary">Registra movimento non collegato a una prenotazione</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-theme-text-muted block mb-1">Data e ora</label>
            <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary" />
          </div>
          <div>
            <label className="text-xs text-theme-text-muted block mb-1">Tipo</label>
            <select value={tipo} onChange={e => setTipo(e.target.value as 'decollo' | 'atterraggio')} className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary">
              <option value="decollo">Decollo (andata)</option>
              <option value="atterraggio">Atterraggio (ritorno)</option>
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
      ) : visibili.length === 0 ? (
        <div className="py-8 text-center text-theme-text-muted text-sm">Nessun movimento.</div>
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
                  <div key={r.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 bg-theme-bg-secondary ${r.effettuato ? '' : 'opacity-60'}`}>
                    <div className="flex items-center gap-3 min-w-0 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.tipo === 'decollo' ? 'bg-sky-600/20 text-sky-400' : 'bg-amber-600/20 text-amber-400'}`}>
                        {r.tipo === 'decollo' ? 'Decollo · Andata' : 'Atterraggio · Ritorno'}
                      </span>
                      <span className="text-sm text-theme-text-secondary tabular-nums">{new Date(r.movement_at).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="text-sm text-theme-text-primary truncate">{r.aeromobile || ''}{r.nota ? ` · ${r.nota}` : ''}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${badgeOrigine[r.origine]}`}>
                        {r.origine === 'manuale' ? 'manuale' : r.origine === 'tour' ? 'da tour' : 'da prenotazione'}
                      </span>
                      {!r.effettuato && <span className="text-[10px] px-1.5 py-0.5 rounded bg-theme-bg-tertiary text-theme-text-muted">programmato</span>}
                    </div>
                    {r.origine === 'manuale' ? (
                      <button onClick={() => remove(r)} className="text-xs text-red-400 hover:text-red-300 shrink-0">Elimina</button>
                    ) : (
                      <span className="text-[11px] text-theme-text-muted shrink-0">si corregge dalla prenotazione</span>
                    )}
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
