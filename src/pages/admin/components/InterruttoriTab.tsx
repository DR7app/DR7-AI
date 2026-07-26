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

export default function InterruttoriTab() {
  const [loading, setLoading] = useState(true)
  // config completa per riga (row -> config jsonb), per read-modify-write sicuro
  const [configs, setConfigs] = useState<Record<string, Cfg>>({})
  // sezioni spente per business (businessId -> set di sectionId)
  const [off, setOff] = useState<Record<BusinessId, Set<string>>>(() => ({} as Record<BusinessId, Set<string>>))
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
      for (const b of BUSINESSES) {
        const cfg = cfgByRow[b.row] || {}
        const arr = Array.isArray(cfg.sezioni_off) ? (cfg.sezioni_off as string[]) : []
        offMap[b.id] = new Set(arr)
      }
      setConfigs(cfgByRow)
      setOff(offMap)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  async function toggle(business: BusinessId, sectionId: string) {
    const b = BUSINESSES.find(x => x.id === business)!
    const cur = off[business] || new Set<string>()
    const next = new Set(cur)
    const wasOff = next.has(sectionId)
    if (wasOff) next.delete(sectionId); else next.add(sectionId)
    // Aggiornamento ottimistico
    setOff(prev => ({ ...prev, [business]: next }))
    setSaving(`${business}:${sectionId}`)
    // Base = config esistente del business, oppure seed dalla config Terra/'main'
    // (come fa Centralina Pro alla prima apertura di un business nuovo), cosi'
    // non creiamo una riga quasi-vuota che romperebbe il seeding.
    const base: Cfg = (configs[b.row] && Object.keys(configs[b.row]).length > 0)
      ? configs[b.row]
      : (configs['main'] || {})
    const newConfig: Cfg = { ...base, sezioni_off: Array.from(next) }
    const { error } = await supabase.from('centralina_pro_config').upsert({ id: b.row, config: newConfig }, { onConflict: 'id' })
    setSaving(null)
    if (error) {
      setOff(prev => ({ ...prev, [business]: cur }))
      toast.error('Salvataggio fallito: ' + error.message)
    } else {
      setConfigs(prev => ({ ...prev, [b.row]: newConfig }))
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
