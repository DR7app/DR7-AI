import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import type { Vehicle } from '../../../types'
import { getVehicleStatus } from '../../../utils/fleetUtils'
import toast from 'react-hot-toast'

interface FleetListProps {
    onOpenDetail: (vehicleId: string) => void
}

interface ProCategory { id: string; label: string }

const STATO_LABEL: Record<string, string> = {
    available: 'Attivo',
    rented: 'In uso',
    maintenance: 'Manutenzione',
    retired: 'Ritirato',
}

const STATO_STYLE: Record<string, string> = {
    available: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    rented: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
    maintenance: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    retired: 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border',
}

const CATEGORY_HEX: Record<string, string> = {
    exotic: '#A855F7', supercars: '#A855F7',
    urban: '#06B6D4',
    aziendali: '#10B981',
    hypercar: '#EC4899',
    moto: '#F97316',
    scooter: '#F59E0B',
    suv_luxury: '#3B82F6',
}

function colorFor(catId: string): string {
    return CATEGORY_HEX[catId] || '#6B7280'
}

export default function FleetList({ onOpenDetail }: FleetListProps) {
    const [vehicles, setVehicles] = useState<Vehicle[]>([])
    const [proCategories, setProCategories] = useState<ProCategory[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [filterCategory, setFilterCategory] = useState<string>('all')
    const [filterStatus, setFilterStatus] = useState<string>('all')

    useEffect(() => {
        loadVehicles()
        loadCategories()
        // Realtime: tieni la lista in sync con admin.Veicoli e Centralina
        const sub = supabase
            .channel('fleet-list-sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => loadVehicles())
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'centralina_pro_config', filter: 'id=eq.main' }, () => loadCategories())
            .subscribe()
        return () => { sub.unsubscribe() }
    }, [])

    async function loadVehicles() {
        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('vehicles')
                .select('*')
                .neq('status', 'retired')
                .order('display_name')
            if (error) throw error
            setVehicles(data || [])
        } catch (error) {
            console.error('Error loading vehicles:', error)
            toast.error('Errore caricamento veicoli')
        } finally {
            setLoading(false)
        }
    }

    async function loadCategories() {
        const { data } = await supabase
            .from('centralina_pro_config')
            .select('config')
            .eq('id', 'main')
            .maybeSingle()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cats = ((data?.config || {}) as any).categories
        if (Array.isArray(cats)) {
            setProCategories(cats.filter((c: { id?: unknown; label?: unknown }) => typeof c?.id === 'string' && typeof c?.label === 'string') as ProCategory[])
        }
    }

    // Stats — solo dati reali da vehicles[].
    const stats = useMemo(() => {
        const total = vehicles.length
        const attivi = vehicles.filter(v => v.status === 'available').length
        const inUso = vehicles.filter(v => v.status === 'rented').length
        const fermi = vehicles.filter(v => v.status === 'maintenance').length
        const totalKm = vehicles.reduce((s, v) => s + (v.current_km || 0), 0)
        const dailyRateSum = vehicles.reduce((s, v) => s + (v.daily_rate || 0), 0)
        const meanDailyRate = total > 0 ? Math.round(dailyRateSum / total) : 0

        // Distribuzione per gruppo (categoria)
        const byCategory = new Map<string, number>()
        vehicles.forEach(v => {
            const k = v.category || 'altro'
            byCategory.set(k, (byCategory.get(k) || 0) + 1)
        })

        // Top per daily_rate (proxy del fatturato potenziale per giorno)
        const topByRate = [...vehicles]
            .filter(v => (v.daily_rate || 0) > 0)
            .sort((a, b) => (b.daily_rate || 0) - (a.daily_rate || 0))
            .slice(0, 5)

        // Veicoli con scadenza imminente (assicurazione, bollo, revisione, leasing)
        const today = new Date()
        const in30days = new Date(today.getTime() + 30 * 86400000)
        const dueSoon = vehicles.filter(v => {
            const dates = [v.insurance_expiry, v.tax_expiry, v.inspection_expiry, v.leasing_expiry]
                .filter(Boolean) as string[]
            return dates.some(d => {
                const dd = new Date(d)
                return dd >= today && dd <= in30days
            })
        }).length

        return { total, attivi, inUso, fermi, totalKm, meanDailyRate, byCategory, topByRate, dueSoon }
    }, [vehicles])

    // Lista filtrata
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase().replace(/\s/g, '')
        return vehicles.filter(v => {
            if (filterCategory !== 'all' && v.category !== filterCategory) return false
            if (filterStatus !== 'all' && v.status !== filterStatus) return false
            if (!q) return true
            const plate = (v.plate || '').toLowerCase().replace(/\s/g, '')
            const name = (v.display_name || '').toLowerCase()
            return plate.includes(q) || name.includes(q)
        })
    }, [vehicles, search, filterCategory, filterStatus])

    const labelFor = (catId: string | null) => {
        if (!catId) return '—'
        const found = proCategories.find(c => c.id === catId)
        return found?.label || catId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    }

    if (loading) return <div className="text-theme-text-muted py-12 text-center">Caricamento flotta...</div>

    return (
        <div className="space-y-4 lg:space-y-6">
            {/* Hero */}
            <div className="relative overflow-hidden bg-gradient-to-br from-theme-bg-secondary via-theme-bg-secondary to-theme-bg-tertiary rounded-2xl border border-theme-border p-5 lg:p-6">
                <div className="absolute -top-12 -right-12 w-56 h-56 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"/>
                <div className="absolute -bottom-12 -left-12 w-56 h-56 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"/>
                <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="w-11 h-11 rounded-xl bg-purple-500/10 border border-purple-500/30 grid place-items-center flex-shrink-0">
                            <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16l4-4m0 0l4 4m-4-4v9m11-9V8.5M6.5 8.5h11M3 8.5L4.07 6.36a2 2 0 011.79-1.11h12.28a2 2 0 011.79 1.11L21 8.5"/>
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-xl lg:text-2xl font-bold text-theme-text-primary leading-tight">Gestione Flotta</h2>
                            <p className="text-xs lg:text-sm text-theme-text-muted mt-0.5">Panoramica completa della tua flotta aziendale</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* KPI cards (solo dati reali) */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <KpiCard label="Totale Veicoli" value={stats.total} ring="#3B82F6"/>
                <KpiCard label="Attivi" value={stats.attivi} subtitle={stats.total > 0 ? `${Math.round((stats.attivi / stats.total) * 100)}% della flotta` : '—'} ring="#10B981"/>
                <KpiCard label="In Uso" value={stats.inUso} subtitle={stats.total > 0 ? `${Math.round((stats.inUso / stats.total) * 100)}% della flotta` : '—'} ring="#06B6D4"/>
                <KpiCard label="Fermi (Manutenzione)" value={stats.fermi} subtitle={stats.total > 0 ? `${Math.round((stats.fermi / stats.total) * 100)}% della flotta` : '—'} ring="#F59E0B" urgent={stats.fermi > 0}/>
                <KpiCard label="Scadenze 30 gg" value={stats.dueSoon} subtitle="ass. / bollo / rev. / leasing" ring="#EF4444" urgent={stats.dueSoon > 0}/>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                    </svg>
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Cerca per targa, nome o modello..."
                        className="w-full pl-9 pr-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary placeholder-theme-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                    />
                </div>
                <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary text-sm focus:outline-none"
                >
                    <option value="all">Tutti i gruppi</option>
                    {proCategories.map(c => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                </select>
                <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary text-sm focus:outline-none"
                >
                    <option value="all">Tutti gli stati</option>
                    <option value="available">Attivo</option>
                    <option value="rented">In uso</option>
                    <option value="maintenance">Manutenzione</option>
                </select>
            </div>

            {/* Layout: tabella + sidebar */}
            <div className="lg:flex lg:gap-4 lg:items-start">
                <div className="lg:flex-1 lg:min-w-0 bg-theme-bg-secondary rounded-2xl border border-theme-border overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-theme-border bg-theme-bg-tertiary/40 text-left">
                                    <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Veicolo</th>
                                    <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Gruppo</th>
                                    <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Targa</th>
                                    <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">KM</th>
                                    <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Stato</th>
                                    <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider text-right">Tariffa/g</th>
                                    <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Azioni</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(vehicle => {
                                    const { status: alertStatus, nearestDeadline } = getVehicleStatus(vehicle, null)
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    const img = (vehicle as any).metadata?.image as string | undefined
                                    const catColor = vehicle.category ? colorFor(vehicle.category) : '#6B7280'
                                    return (
                                        <tr
                                            key={vehicle.id}
                                            className="border-b border-theme-border/40 hover:bg-theme-bg-hover/30 cursor-pointer"
                                            onClick={() => onOpenDetail(vehicle.id)}
                                        >
                                            <td className="py-2 px-3">
                                                <div className="flex items-center gap-2.5">
                                                    {img ? (
                                                        <img src={img} alt={vehicle.display_name} className="w-12 h-9 rounded object-cover border border-theme-border flex-shrink-0"/>
                                                    ) : (
                                                        <div className="w-12 h-9 rounded bg-theme-bg-tertiary border border-theme-border grid place-items-center flex-shrink-0">
                                                            <svg className="w-5 h-5 text-theme-text-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 17v-2.5C3 13.12 4.12 12 5.5 12h13c1.38 0 2.5 1.12 2.5 2.5V17h-2v2a1 1 0 01-1 1h-1a1 1 0 01-1-1v-2H8v2a1 1 0 01-1 1H6a1 1 0 01-1-1v-2H3z"/>
                                                            </svg>
                                                        </div>
                                                    )}
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-semibold text-theme-text-primary truncate">{vehicle.display_name}</div>
                                                        {nearestDeadline && (
                                                            <div className={`text-[10px] mt-0.5 ${nearestDeadline.isUrgent ? 'text-red-400 font-bold' : nearestDeadline.isWarning ? 'text-amber-400' : 'text-theme-text-muted'}`}>
                                                                {nearestDeadline.label}: {nearestDeadline.isDate ? `${nearestDeadline.value} gg` : `${nearestDeadline.value} km`}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-2 px-3">
                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border" style={{ backgroundColor: `${catColor}20`, color: catColor, borderColor: `${catColor}66` }}>
                                                    {labelFor(vehicle.category)}
                                                </span>
                                            </td>
                                            <td className="py-2 px-3 text-theme-text-secondary text-xs font-mono">{vehicle.plate || '—'}</td>
                                            <td className="py-2 px-3 text-theme-text-primary text-xs font-mono tabular-nums">{(vehicle.current_km || 0).toLocaleString('it-IT')} km</td>
                                            <td className="py-2 px-3">
                                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${STATO_STYLE[vehicle.status] || ''} ${alertStatus === 'URGENTE' ? 'animate-pulse' : ''}`}>
                                                    {STATO_LABEL[vehicle.status] || vehicle.status}
                                                </span>
                                            </td>
                                            <td className="py-2 px-3 text-right text-xs text-dr7-gold font-bold tabular-nums">
                                                {vehicle.daily_rate > 0 ? `€${vehicle.daily_rate.toLocaleString('it-IT')}` : '—'}
                                            </td>
                                            <td className="py-2 px-3">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onOpenDetail(vehicle.id) }}
                                                    className="px-3 py-1 rounded-full text-[10px] font-semibold bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover border border-theme-border transition-colors"
                                                >
                                                    Apri scheda
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                    {filtered.length === 0 && (
                        <div className="py-12 text-center text-theme-text-muted text-sm">Nessun veicolo trovato</div>
                    )}
                </div>

                {/* Sidebar */}
                <aside className="hidden lg:block w-80 flex-shrink-0 space-y-4 lg:sticky lg:top-4 mt-4 lg:mt-0">
                    {/* Distribuzione per gruppo */}
                    <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                        <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider mb-3">Distribuzione per gruppo</h3>
                        <CategoryDonut byCategory={stats.byCategory} total={stats.total} labelFor={labelFor} colorFor={colorFor}/>
                    </div>

                    {/* Top per tariffa giornaliera */}
                    <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Top tariffa giornaliera</h3>
                            <span className="text-[10px] text-theme-text-muted">top 5</span>
                        </div>
                        {stats.topByRate.length === 0 ? (
                            <div className="text-xs text-theme-text-muted py-3 text-center">Nessun veicolo con tariffa</div>
                        ) : (
                            <div className="space-y-2">
                                {stats.topByRate.map(v => {
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    const img = (v as any).metadata?.image as string | undefined
                                    return (
                                        <button
                                            key={v.id}
                                            onClick={() => onOpenDetail(v.id)}
                                            className="w-full flex items-center gap-2.5 hover:bg-theme-bg-primary/40 rounded-lg p-1.5 -mx-1.5 transition-colors text-left"
                                        >
                                            {img ? (
                                                <img src={img} alt={v.display_name} className="w-10 h-7 rounded object-cover border border-theme-border flex-shrink-0"/>
                                            ) : (
                                                <div className="w-10 h-7 rounded bg-theme-bg-tertiary border border-theme-border flex-shrink-0"/>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs text-theme-text-primary font-semibold truncate">{v.display_name}</div>
                                                <div className="text-[10px] text-theme-text-muted truncate">{labelFor(v.category)}{v.plate ? ` · ${v.plate}` : ''}</div>
                                            </div>
                                            <div className="text-xs font-bold text-dr7-gold tabular-nums whitespace-nowrap">€{(v.daily_rate || 0).toLocaleString('it-IT')}</div>
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* Performance flotta */}
                    <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                        <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider mb-3">Performance flotta</h3>
                        <div className="space-y-2">
                            <Row label="KM totali percorsi" value={`${stats.totalKm.toLocaleString('it-IT')} km`}/>
                            <Row label="Media KM per veicolo" value={`${stats.total > 0 ? Math.round(stats.totalKm / stats.total).toLocaleString('it-IT') : 0} km`}/>
                            <Row label="Tariffa media/giorno" value={`€${stats.meanDailyRate.toLocaleString('it-IT')}`}/>
                            <Row label="Veicoli attivi" value={`${stats.attivi} / ${stats.total}`}/>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    )
}

function KpiCard({ label, value, subtitle, ring, urgent }: { label: string; value: number | string; subtitle?: string; ring: string; urgent?: boolean }) {
    return (
        <div className="relative overflow-hidden rounded-2xl border bg-theme-bg-secondary p-4" style={{ borderColor: `${ring}33` }}>
            <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl pointer-events-none" style={{ background: `${ring}22` }}/>
            <div className="relative">
                <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: `${ring}cc` }}>{label}</div>
                <div className={`text-2xl lg:text-3xl font-bold mt-2 tabular-nums ${urgent ? 'animate-pulse' : ''}`} style={{ color: ring }}>{value}</div>
                {subtitle && <div className="text-[11px] text-theme-text-muted mt-1 truncate">{subtitle}</div>}
            </div>
        </div>
    )
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between text-xs">
            <span className="text-theme-text-muted">{label}</span>
            <span className="text-theme-text-primary font-bold tabular-nums">{value}</span>
        </div>
    )
}

function CategoryDonut({ byCategory, total, labelFor, colorFor }: { byCategory: Map<string, number>; total: number; labelFor: (id: string) => string; colorFor: (id: string) => string }) {
    if (total === 0) return <div className="text-xs text-theme-text-muted py-3 text-center">Nessun veicolo</div>
    const slices = Array.from(byCategory.entries())
        .filter(([, n]) => n > 0)
        .map(([id, count]) => ({ id, count, color: colorFor(id), label: labelFor(id) }))
        .sort((a, b) => b.count - a.count)
    const r = 15.91549
    let offset = 0
    return (
        <div className="flex items-center gap-3">
            <div className="relative w-28 h-28 shrink-0">
                <svg className="w-28 h-28 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-theme-bg-tertiary"/>
                    {slices.map((s, i) => {
                        const pct = Math.round((s.count / total) * 100)
                        const dash = `${pct}, 100`
                        const el = <circle key={i} cx="18" cy="18" r={r} fill="none" strokeWidth="4" stroke={s.color} strokeDasharray={dash} strokeDashoffset={-offset}/>
                        offset += pct
                        return el
                    })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-2xl font-bold text-theme-text-primary tabular-nums">{total}</div>
                    <div className="text-[9px] text-theme-text-muted">veicoli</div>
                </div>
            </div>
            <div className="flex-1 space-y-1.5 min-w-0">
                {slices.map(s => (
                    <div key={s.id} className="flex items-center gap-2 text-[11px]">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }}/>
                        <span className="text-theme-text-secondary flex-1 truncate">{s.label}</span>
                        <span className="text-theme-text-primary font-bold tabular-nums">{s.count}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}
