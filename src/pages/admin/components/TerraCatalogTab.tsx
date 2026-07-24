// Catalogo Noleggio Terra — 2026-07-18 · organizzato per categorie + aggiungi
// auto (roadmap 18). Galleria dei veicoli della flotta (tabella `vehicles`),
// raggruppati per categoria (etichette da Centralina Pro). Da qui si può
// aggiungere un nuovo veicolo (insert minimale su `vehicles`); la modifica di
// dettaglio resta nella scheda Veicoli.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

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

  // ── Aggiungi veicolo ──────────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)
  const [form, setForm] = useState<{ display_name: string; plate: string; category: string; daily_rate: string; image_url: string }>(
    { display_name: '', plate: '', category: '', daily_rate: '', image_url: '' }
  )

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('vehicles')
      .select('id, display_name, plate, status, category, metadata')
      .neq('status', 'retired')
      .order('display_name')
    setVehicles((data || []) as CatalogVehicle[])
    try {
      const { data: cfg } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cats = ((cfg?.config as any)?.categories || []) as { id: string; label: string }[]
      if (Array.isArray(cats)) setCategories(cats)
    } catch { /* categorie opzionali */ }
    setLoading(false)
  }

  useEffect(() => { let c = false; (async () => { if (!c) await load() })(); return () => { c = true } }, [])

  const catLabel = (id: string | null) => categories.find(c => c.id === id)?.label || id || 'Senza categoria'

  const filtered = useMemo(() => vehicles.filter(v => {
    if (catFilter !== 'all' && v.category !== catFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (v.display_name || '').toLowerCase().includes(q) || (v.plate || '').toLowerCase().includes(q)
  }), [vehicles, search, catFilter])

  // Raggruppa per categoria, nell'ordine di Centralina Pro; extra/sconosciute in fondo.
  const grouped = useMemo(() => {
    const byCat = new Map<string, CatalogVehicle[]>()
    for (const v of filtered) {
      const key = v.category || '__none__'
      if (!byCat.has(key)) byCat.set(key, [])
      byCat.get(key)!.push(v)
    }
    const ordered: { id: string; label: string; items: CatalogVehicle[] }[] = []
    for (const c of categories) {
      const items = byCat.get(c.id)
      if (items && items.length) { ordered.push({ id: c.id, label: c.label, items }); byCat.delete(c.id) }
    }
    // categorie non presenti in centralina (o senza categoria) in fondo
    for (const [key, items] of byCat) {
      ordered.push({ id: key, label: key === '__none__' ? 'Senza categoria' : catLabel(key), items })
    }
    return ordered
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, categories])

  async function uploadImage(file: File) {
    if (!file.type.startsWith('image/')) { toast.error('Solo file immagine'); return }
    setUploadingImg(true)
    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `vehicle-photos/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('catalog-images').upload(path, file, { cacheControl: '31536000', upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('catalog-images').getPublicUrl(path)
      setForm(prev => ({ ...prev, image_url: data?.publicUrl || '' }))
      toast.success('Foto caricata')
    } catch (e) { toast.error('Errore upload: ' + (e as Error).message) } finally { setUploadingImg(false) }
  }

  async function addVehicle() {
    if (!form.display_name.trim()) { toast.error('Nome veicolo obbligatorio'); return }
    if (!form.category) { toast.error('Seleziona una categoria'); return }
    setSaving(true)
    try {
      const rate = Number.parseFloat(form.daily_rate)
      const { error } = await supabase.from('vehicles').insert([{
        display_name: form.display_name.trim(),
        plate: form.plate.trim() || null,
        status: 'available',
        daily_rate: Number.isFinite(rate) ? rate : 0,
        category: form.category,
        metadata: form.image_url ? { image: form.image_url } : {},
      }])
      if (error) throw error
      toast.success('Veicolo aggiunto al catalogo')
      setShowAdd(false)
      setForm({ display_name: '', plate: '', category: '', daily_rate: '', image_url: '' })
      await load()
    } catch (e) { toast.error('Errore: ' + (e as Error).message) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-xl font-bold text-theme-text-primary">Catalogo Noleggio Terra</h2>
          <p className="text-sm text-theme-text-muted">{filtered.length} veicoli in {grouped.length} categorie — foto e dati dalla scheda Veicoli.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          <button
            onClick={() => { setForm(f => ({ ...f, category: catFilter !== 'all' ? catFilter : (categories[0]?.id || '') })); setShowAdd(true) }}
            className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold"
          >+ Aggiungi veicolo</button>
        </div>
      </div>

      {loading ? (
        <p className="text-theme-text-muted text-center py-12">Caricamento catalogo...</p>
      ) : grouped.length === 0 ? (
        <p className="text-theme-text-muted text-center py-12">Nessun veicolo trovato.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(group => (
            <div key={group.id}>
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-bold uppercase tracking-wide text-theme-text-primary">{group.label}</h3>
                <span className="text-xs text-theme-text-muted">({group.items.length})</span>
                <div className="flex-1 h-px bg-theme-border" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {group.items.map(v => {
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
                          {v.plate && <span className="tabular-nums">{v.plate}</span>}
                          {v.status && v.status !== 'available' && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30">{v.status}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal aggiungi veicolo */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-md rounded-xl bg-theme-bg-secondary border border-theme-border p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-theme-text-primary mb-4">Aggiungi veicolo al catalogo</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-theme-text-muted mb-1">Nome veicolo</label>
                <input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} placeholder="Es. Lamborghini Urus" className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-theme-text-muted mb-1">Targa</label>
                  <input value={form.plate} onChange={e => setForm({ ...form, plate: e.target.value.toUpperCase() })} placeholder="GA123BC" className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary font-mono" />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wide text-theme-text-muted mb-1">Tariffa/giorno €</label>
                  <input type="number" step="0.01" value={form.daily_rate} onChange={e => setForm({ ...form, daily_rate: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-theme-text-muted mb-1">Categoria</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm text-theme-text-primary">
                  <option value="">— seleziona —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-theme-text-muted mb-1">Foto</label>
                <div className="flex items-center gap-3">
                  <div className="w-16 h-12 rounded-lg overflow-hidden bg-theme-bg-tertiary border border-theme-border grid place-items-center shrink-0">
                    {form.image_url ? <img src={form.image_url} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-theme-text-muted">nessuna</span>}
                  </div>
                  <label className="px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-secondary text-sm cursor-pointer">
                    {uploadingImg ? 'Caricamento…' : 'Carica foto'}
                    <input type="file" accept="image/*" className="hidden" disabled={uploadingImg} onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.currentTarget.value = '' }} />
                  </label>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowAdd(false)} className="flex-1 px-3 py-2 rounded-lg border border-theme-border text-theme-text-secondary text-sm">Annulla</button>
              <button onClick={addVehicle} disabled={saving} className="flex-1 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold disabled:opacity-50">{saving ? 'Salvataggio…' : 'Aggiungi'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
