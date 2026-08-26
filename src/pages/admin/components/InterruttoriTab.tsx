// Interruttori universali ON/OFF (#17). Vista unica di TUTTI gli interruttori
// sezione per ogni business: e' lo stesso meccanismo dei toggle nel menu di
// Centralina Pro (config.sezioni_off per riga business), qui consolidato in un
// solo posto. Spegnere una sezione la nasconde dai flussi di quel business
// senza cancellare nulla — riaccendibile quando vuoi.
//
// Legge/scrive direttamente centralina_pro_config (una riga per business),
// facendo read-modify-write dell'INTERA config cosi' non sovrascrive il resto.
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { SECTIONS, BUSINESSES, type BusinessId } from './CentralinaProTab'
import { MARE_FORM_SECTIONS, FORM_SECTIONS_SOLO_MARE, BOOKING_FORM_OFF_KEY, CENTRALINA_SECTION_BY_FORM_SECTION } from './mareFormSections'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cfg = Record<string, any>
type BookingMode = 'preventivo' | 'bookable'
// Business i cui servizi passano dalla pagina pubblica preventivo/prenotabile
// (NoleggioServicePage). Terra (wizard auto) e Lavaggio non hanno questa modalita'.
const MODE_BUSINESSES: BusinessId[] = ['mare', 'aria', 'soggiorni']
// Business la cui "Nuova prenotazione" e' ReservationsTab con il proprio
// serviceType: sono gli unici in cui gli interruttori del form hanno effetto.
// Terra non c'e' di proposito — il suo form resta quello di sempre.
const FORM_BUSINESSES: BusinessId[] = ['mare', 'aria', 'soggiorni']

export default function InterruttoriTab() {
  const [loading, setLoading] = useState(true)
  // config completa per riga (row -> config jsonb), per read-modify-write sicuro
  const [configs, setConfigs] = useState<Record<string, Cfg>>({})
  // sezioni spente per business (businessId -> set di sectionId)
  const [off, setOff] = useState<Record<BusinessId, Set<string>>>(() => ({} as Record<BusinessId, Set<string>>))
  // modalita' sito per business (default 'bookable' = comportamento attuale)
  const [modes, setModes] = useState<Record<BusinessId, BookingMode>>(() => ({} as Record<BusinessId, BookingMode>))
  // Sezioni del FORM di prenotazione spente, per business. Chiave separata da
  // `sezioni_off` perche' riguarda il form, non la configurazione Centralina.
  const [formOff, setFormOff] = useState<Record<string, Set<string>>>({})
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const rows = Array.from(new Set(BUSINESSES.map(b => b.row)))
      const { data } = await supabase.from('centralina_pro_config').select('id, config').in('id', rows)
      if (!alive) return
      const cfgByRow: Record<string, Cfg> = {}
      for (const r of (data || []) as { id: string; config: Cfg }[]) cfgByRow[r.id] = r.config || {}
      const offMap = {} as Record<BusinessId, Set<string>>
      const modeMap = {} as Record<BusinessId, BookingMode>
      for (const b of BUSINESSES) {
        const cfg = cfgByRow[b.row] || {}
        const arr = Array.isArray(cfg.sezioni_off) ? (cfg.sezioni_off as string[]) : []
        offMap[b.id] = new Set(arr)
        modeMap[b.id] = cfg.booking_mode === 'preventivo' ? 'preventivo' : 'bookable'
      }
      const formOffMap: Record<string, Set<string>> = {}
      for (const b of BUSINESSES) {
        const cfg = cfgByRow[b.row] || {}
        formOffMap[b.id] = new Set(Array.isArray(cfg[BOOKING_FORM_OFF_KEY]) ? (cfg[BOOKING_FORM_OFF_KEY] as string[]) : [])
      }
      setFormOff(formOffMap)
      setConfigs(cfgByRow)
      setOff(offMap)
      setModes(modeMap)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  // Read-modify-write dell'INTERA config del business, seminando da 'main' se la
  // riga non esiste ancora (come fa Centralina Pro), cosi' non si crea una riga
  // quasi-vuota. Ritorna l'errore eventuale.
  // 2026-08-08: la base DEVE essere una lettura FRESCA dal DB, non lo stato
  // `configs` caricato al mount. Prima si scriveva `{ ...configStato, ...patch }`
  // con lo snapshot vecchio: ogni ON/OFF (operazione giornaliera) riscriveva
  // l'INTERA config con la versione stantia, cancellando le chiavi modificate
  // altrove nel frattempo (es. notifications.cauzioni_staff_phones — i numeri
  // direzione per i solleciti cauzioni "sparivano ogni giorno").
  async function writeConfig(business: BusinessId, patch: Cfg) {
    const b = BUSINESSES.find(x => x.id === business)!
    let base: Cfg = {}
    try {
      const { data: freshRow } = await supabase.from('centralina_pro_config').select('config').eq('id', b.row).maybeSingle()
      if (freshRow?.config && Object.keys(freshRow.config as Cfg).length > 0) {
        base = freshRow.config as Cfg
      } else {
        // Riga assente: semina dalla config 'main' FRESCA (non dallo stato).
        const { data: mainRow } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
        base = (mainRow?.config as Cfg) || configs['main'] || {}
      }
    } catch {
      // Rete KO: ripiega sullo stato in memoria pur di non perdere il toggle.
      base = (configs[b.row] && Object.keys(configs[b.row]).length > 0) ? configs[b.row] : (configs['main'] || {})
    }
    const newConfig: Cfg = { ...base, ...patch }
    const { error } = await supabase.from('centralina_pro_config').upsert({ id: b.row, config: newConfig }, { onConflict: 'id' })
    if (!error) setConfigs(prev => ({ ...prev, [b.row]: newConfig }))
    return error
  }

  async function setMode(business: BusinessId, mode: BookingMode) {
    const prev = modes[business] || 'bookable'
    if (prev === mode) return
    setModes(m => ({ ...m, [business]: mode }))
    setSaving(`${business}:mode`)
    const error = await writeConfig(business, { booking_mode: mode })
    setSaving(null)
    if (error) { setModes(m => ({ ...m, [business]: prev })); toast.error('Salvataggio fallito: ' + error.message) }
    else toast.success(mode === 'preventivo' ? 'Modalità: solo preventivo' : 'Modalità: prenotabile')
  }

  async function toggle(business: BusinessId, sectionId: string) {
    const cur = off[business] || new Set<string>()
    const next = new Set(cur)
    const wasOff = next.has(sectionId)
    if (wasOff) next.delete(sectionId); else next.add(sectionId)
    // Aggiornamento ottimistico
    setOff(prev => ({ ...prev, [business]: next }))
    setSaving(`${business}:${sectionId}`)
    const error = await writeConfig(business, { sezioni_off: Array.from(next) })
    setSaving(null)
    if (error) {
      setOff(prev => ({ ...prev, [business]: cur }))
      toast.error('Salvataggio fallito: ' + error.message)
    } else {
      toast.success(wasOff ? 'Sezione attivata' : 'Sezione disattivata')
    }
  }

  // Accende/spegne una sezione del form "Nuova prenotazione" di quel business.
  async function toggleForm(business: BusinessId, sectionId: string) {
    const cur = formOff[business] || new Set<string>()
    const next = new Set(cur)
    const wasOff = next.has(sectionId)
    if (wasOff) next.delete(sectionId); else next.add(sectionId)
    setFormOff(prev => ({ ...prev, [business]: next }))
    setSaving(`${business}:form:${sectionId}`)
    const error = await writeConfig(business, { [BOOKING_FORM_OFF_KEY]: Array.from(next) })
    setSaving(null)
    if (error) { setFormOff(prev => ({ ...prev, [business]: cur })); toast.error('Salvataggio fallito: ' + error.message) }
    else toast.success(wasOff ? 'Sezione attivata nel form' : 'Sezione nascosta dal form')
  }

  const businessList = useMemo(() => BUSINESSES, [])

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-theme-text-primary">Interruttori ON/OFF</h1>
        <p className="text-sm text-theme-text-muted mt-1">
          Accendi o spegni ogni sezione per ciascun business, tutto da qui. Quando una sezione è
          <span className="text-theme-text-secondary font-medium"> OFF</span> viene nascosta dalla configurazione di quel business in Centralina Pro (es. togliere <em>Assicurazioni</em> o <em>Servizi/Experience</em> dal Noleggio Mare) senza cancellare nulla: puoi riaccenderla quando vuoi. Sono gli stessi interruttori del menu di Centralina Pro, qui riuniti in un unico posto.
        </p>
      </div>

      {loading ? (
        <p className="text-theme-text-muted text-sm">Caricamento...</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {businessList.map(b => {
            const offSet = off[b.id] || new Set<string>()
            return (
              <div key={b.id} className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
                <div className="px-4 py-3 border-b border-theme-border flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-theme-text-primary">{b.label}</h2>
                  <span className="text-[11px] text-theme-text-muted">
                    {SECTIONS.length - offSet.size}/{SECTIONS.length} attive
                  </span>
                </div>
                {/* Modalita' sito: solo preventivo (WhatsApp) o prenotabile online.
                    Solo per i business con pagina pubblica preventivo/prenota. */}
                {MODE_BUSINESSES.includes(b.id) && (
                  <div className="px-4 py-3 border-b border-theme-border flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-theme-text-primary">Modalità sito</p>
                      <p className="text-[11px] text-theme-text-muted">Come i clienti prenotano dal sito</p>
                    </div>
                    <div className="inline-flex rounded-lg border border-theme-border overflow-hidden text-xs">
                      {(['preventivo', 'bookable'] as BookingMode[]).map(m => {
                        const activeMode = (modes[b.id] || 'bookable') === m
                        return (
                          <button
                            key={m}
                            disabled={saving === `${b.id}:mode`}
                            onClick={() => setMode(b.id, m)}
                            className={`px-3 py-1.5 font-medium transition-colors disabled:opacity-50 ${activeMode ? 'bg-[#007aff] text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:text-theme-text-primary'}`}
                          >
                            {m === 'preventivo' ? 'Solo preventivo' : 'Prenotabile'}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="divide-y divide-theme-border">
                  {SECTIONS.map(s => {
                    const isOff = offSet.has(s.id)
                    const busy = saving === `${b.id}:${s.id}`
                    return (
                      <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <span className={`text-sm ${isOff ? 'text-theme-text-muted line-through' : 'text-theme-text-primary'}`}>{s.title}</span>
                        <button
                          role="switch"
                          aria-checked={!isOff}
                          disabled={busy}
                          onClick={() => toggle(b.id, s.id)}
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${isOff ? 'bg-theme-bg-tertiary border border-theme-border' : 'bg-emerald-500'}`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isOff ? 'translate-x-1' : 'translate-x-[18px]'}`} />
                        </button>
                      </div>
                    )
                  })}
                </div>

                {/* Sezioni del form "Nuova prenotazione" di Mare, Aria e
                    Soggiorni (ReservationsTab con il loro serviceType).
                    Cliente, Mezzo, Date/Orari, Luoghi, Riepilogo e Pagamento
                    non sono spegnibili: senza quelli non esiste una
                    prenotazione. Skipper, patente nautica e passeggeri sono
                    sezioni d'acqua e restano al solo Noleggio Mare. */}
                {FORM_BUSINESSES.includes(b.id) && (
                  <div className="border-t-2 border-theme-border">
                    <div className="px-4 py-3 bg-theme-bg-tertiary/40">
                      <p className="text-sm font-semibold text-theme-text-primary">Form prenotazione</p>
                      <p className="text-[11px] text-theme-text-muted mt-0.5">
                        Quali blocchi vedi quando apri <em>+ Nuova prenotazione</em>. Km/Sforo e Assicurazioni non ci sono: non si applicano a questi business.
                      </p>
                    </div>
                    <div className="divide-y divide-theme-border">
                      {MARE_FORM_SECTIONS.filter(s => b.id === 'mare' || !FORM_SECTIONS_SOLO_MARE.has(s.id)).map(s => {
                        // Sezione Centralina che pilota questo blocco: se e' OFF
                        // qui sopra, il blocco e' spento anche nel form e
                        // l'interruttore non puo' riaccenderlo.
                        const parent = CENTRALINA_SECTION_BY_FORM_SECTION[s.id]
                        const forcedOff = !!parent && offSet.has(parent.id)
                        const isOff = (formOff[b.id] || new Set<string>()).has(s.id) || forcedOff
                        const busy = saving === `${b.id}:form:${s.id}`
                        return (
                          <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <div className="min-w-0">
                              <p className={`text-sm ${isOff ? 'text-theme-text-muted line-through' : 'text-theme-text-primary'}`}>{s.title}</p>
                              <p className="text-[11px] text-theme-text-muted">
                                {forcedOff ? `Spenta da «${parent!.title}» qui sopra` : s.hint}
                              </p>
                            </div>
                            <button
                              role="switch"
                              aria-checked={!isOff}
                              disabled={busy || forcedOff}
                              title={forcedOff ? `Riaccendi «${parent!.title}» qui sopra per usarla nel form` : undefined}
                              onClick={() => toggleForm(b.id, s.id)}
                              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${isOff ? 'bg-theme-bg-tertiary border border-theme-border' : 'bg-emerald-500'}`}
                            >
                              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isOff ? 'translate-x-1' : 'translate-x-[18px]'}`} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
