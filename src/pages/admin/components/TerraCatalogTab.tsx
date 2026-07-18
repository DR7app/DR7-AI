// Catalogo Noleggio Terra — 2026-07-18.
// Galleria in sola lettura di TUTTI i veicoli della flotta (tabella `vehicles`),
// con foto, categoria e targa. Stessa sorgente della scheda "Veicoli": modifica
// un'auto lì e il catalogo si aggiorna (nessuna duplicazione dati). La foto usa
// lo stesso ordine di priorità del sito (metadata.image, poi varianti).
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../supabaseClient'

interface CatalogVehicle {
  id: string
  display_name: string
  plate: string | null
  status: string | null
  category: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any> | null
}

/** Foto veicolo: stessa priorità di VehiclesTab/sito (metadata.image, ecc.). */
function vehiclePhoto(v: CatalogVehicle): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (v.metadata as any) || {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const direct = v as any
  const candidates = [m.image, m.image_url, m.hero_image, m.photo, m.picture, direct.image_url, direct.image]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return null
}

export default function TerraCatalogTab() {
  const [vehicles, setVehicles] = useState<CatalogVehicle[]>([])
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('vehicles')
        .select('id, display_name, plate, status, category, metadata')
        .neq('status', 'retired')
        .order('display_name')
      if (cancelled) return
      setVehicles((data || []) as CatalogVehicle[])
      // Etichette categorie dalla Centralina Pro (id -> label leggibile).
      try {
        const { data: cfg } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cats = ((cfg?.config as any)?.categories || []) as { id: string; label: string }[]
        if (!cancelled && Array.isArray(cats)) setCategories(cats)
      } catch { /* categorie opzionali */ }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const catLabel = (id: string | null) => categories.find(c => c.id === id)?.label || id || '—'

  const filtered = useMemo(() => vehicles.filter(v => {
    if (catFilter !== 'all' && v.category !== catFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (v.display_name || '').toLowerCase().includes(q) || (v.plate || '').toLowerCase().includes(q)
  }), [vehicles, search, catFilter])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-xl font-bold text-theme-text-primary">Catalogo Noleggio Terra</h2>
          <p className="text-sm text-theme-text-muted">{filtered.length} veicoli — foto e dati dalla scheda Veicoli.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca nome o targa..."
            className="px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm"
          />
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm"
          >
            <option value="all">Tutte le categorie</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-theme-text-muted text-center py-12">Caricamento catalogo...</p>
      ) : filtered.length === 0 ? (
        <p className="text-theme-text-muted text-center py-12">Nessun veicolo trovato.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(v => {
            const photo = vehiclePhoto(v)
            return (
              <div key={v.id} className="rounded-xl overflow-hidden border border-theme-border bg-theme-bg-secondary flex flex-col">
                <div className="aspect-[16/10] bg-theme-bg-tertiary overflow-hidden flex items-center justify-center">
                  {photo ? (
                    <img
                      src={photo}
                      alt={v.display_name}
                      loading="lazy"
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                    />
                  ) : (
                    <span className="text-theme-text-muted text-sm px-3 text-center">{v.display_name}</span>
                  )}
                </div>
                <div className="p-3 flex-1 flex flex-col gap-2">
                  <h3 className="text-sm font-semibold text-theme-text-primary truncate">{v.display_name}</h3>
                  <div className="flex items-center gap-2 text-xs text-theme-text-muted flex-wrap">
                    {v.category && (
                      <span className="px-2 py-0.5 rounded-full bg-theme-bg-tertiary border border-theme-border text-theme-text-secondary">{catLabel(v.category)}</span>
                    )}
                    {v.plate && <span className="tabular-nums">{v.plate}</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
