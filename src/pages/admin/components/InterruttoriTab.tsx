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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cfg = Record<string, any>
type BookingMode = 'preventivo' | 'bookable'
// Business i cui servizi passano dalla pagina pubblica preventivo/prenotabile
// (NoleggioServicePage). Terra (wizard auto) e Lavaggio non hanno questa modalita'.
const MODE_BUSINESSES: BusinessId[] = ['mare', 'aria', 'soggiorni']

export default function InterruttoriTab() {
  const [loading, setLoading] = useState(true)
  // config completa per riga (row -> config jsonb), per read-modify-write sicuro
  const [configs, setConfigs] = useState<Record<string, Cfg>>({})
  // sezioni spente per business (businessId -> set di sectionId)
  const [off, setOff] = useState<Record<BusinessId, Set<string>>>(() => ({} as Record<BusinessId, Set<string>>))
  // modalita' sito per business (default 'bookable' = comportamento attuale)
  const [modes, setModes] = useState<Record<BusinessId, BookingMode>>(() => ({} as Record<BusinessId, BookingMode>))
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
  async function writeConfig(business: BusinessId, patch: Cfg) {
    const b = BUSINESSES.find(x => x.id === business)!
    const base: Cfg = (configs[b.row] && Object.keys(configs[b.row]).length > 0)
      ? configs[b.row]
      : (configs['main'] || {})
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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
