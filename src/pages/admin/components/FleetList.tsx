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

interface VehicleStats {
    fatturato: number
    giorniNoleggio: number
    giorniFermo: number
    utilizzoPct: number
    numNoleggi: number
}

const PAID_STATES = new Set(['paid', 'succeeded', 'completed'])

export default function FleetList({ onOpenDetail }: FleetListProps) {
    const [vehicles, setVehicles] = useState<Vehicle[]>([])
    const [proCategories, setProCategories] = useState<ProCategory[]>([])
    const [vehicleStats, setVehicleStats] = useState<Map<string, VehicleStats>>(new Map())
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [filterCategory, setFilterCategory] = useState<string>('all')
    const [filterStatus, setFilterStatus] = useState<string>('all')

    useEffect(() => {
        loadVehicles()
        loadCategories()
        // Realtime: tieni la lista in sync con admin.Veicoli, Centralina e bookings
        const sub = supabase
            .channel('fleet-list-sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => loadVehicles())
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'centralina_pro_config', filter: 'id=eq.main' }, () => loadCategories())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => loadBookingStats())
            .subscribe()
        return () => { sub.unsubscribe() }
    }, [])

    // Quando cambiano i vehicles, ricalcola stats fatturato/utilizzo
    useEffect(() => {
        if (vehicles.length > 0) loadBookingStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vehicles.length])

    async function loadBookingStats() {
        // Ultimi 30 giorni: aggrega fatturato e giorni di noleggio per ogni
        // veicolo. Match per vehicle_id; fallback a plate poi a display_name.
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const thirtyAgo = new Date(today.getTime() - 30 * 86400000)
        const { data: bookings } = await supabase
            .from('bookings')
            .select('id, vehicle_id, plate, vehicle_name, pickup_date, dropoff_date, total_amount, status, payment_status, service_type')
            .gte('pickup_date', thirtyAgo.toISOString())
            .or('service_type.is.null,service_type.eq.car_rental,service_type.eq.rental')
            .limit(2000)

        const stats = new Map<string, VehicleStats>()
        // Indici per match veloce
        const byId = new Map<string, Vehicle>()
        const byPlate = new Map<string, Vehicle>()
        const byName = new Map<string, Vehicle>()
        for (const v of vehicles) {
            byId.set(v.id, v)
            if (v.plate) byPlate.set(v.plate.toLowerCase().replace(/\s/g, ''), v)
            if (v.display_name) byName.set(v.display_name.toLowerCase().trim(), v)
        }

        const occupiedByVehicle = new Map<string, Set<string>>()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const b of (bookings || []) as any[]) {
            if (b.status === 'cancelled' || b.status === 'annullata') continue
            // Match → vehicle id
            let vid: string | null = null
            if (b.vehicle_id && byId.has(b.vehicle_id)) vid = b.vehicle_id
            else if (b.plate) {
                const v = byPlate.get(String(b.plate).toLowerCase().replace(/\s/g, ''))
                if (v) vid = v.id
            }
            if (!vid && b.vehicle_name) {
                const v = byName.get(String(b.vehicle_name).toLowerCase().trim())
                if (v) vid = v.id
            }
            if (!vid) continue

            const cur = stats.get(vid) || { fatturato: 0, giorniNoleggio: 0, giorniFermo: 0, utilizzoPct: 0, numNoleggi: 0 }
            cur.numNoleggi++
            if (PAID_STATES.has(String(b.payment_status || '').toLowerCase())) {
                cur.fatturato += Number(b.total_amount || 0)
            }
            // Giorni occupati nella finestra (30gg). pickup/dropoff possono
            // estendersi prima/dopo: clamp a [thirtyAgo, today].
            if (b.pickup_date && b.dropoff_date) {
                const start = new Date(b.pickup_date); start.setHours(0, 0, 0, 0)
                const end = new Date(b.dropoff_date); end.setHours(0, 0, 0, 0)
                const sClamped = start < thirtyAgo ? thirtyAgo : start
                const eClamped = end > today ? today : end
                const set = occupiedByVehicle.get(vid) || new Set<string>()
                for (let t = sClamped.getTime(); t <= eClamped.getTime(); t += 86400000) {
                    set.add(new Date(t).toISOString().slice(0, 10))
                }
                occupiedByVehicle.set(vid, set)
            }
            stats.set(vid, cur)
        }

        // Calcolo finale di giorni noleggio + utilizzo
        for (const [vid, set] of occupiedByVehicle.entries()) {
            const cur = stats.get(vid)
            if (!cur) continue
            cur.giorniNoleggio = set.size
            cur.giorniFermo = Math.max(0, 30 - set.size)
            cur.utilizzoPct = Math.min(100, Math.round((set.size / 30) * 100))
        }

        setVehicleStats(stats)
    }

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

        // Aggregati su vehicleStats per le 3 KPI nuove (Fatturato / Utilizzo /
        // ROI) e per gli alert intelligenti.
        let totalFatturato = 0
        let utilizzoSum = 0
        let utilizzoCount = 0
        let roiSum = 0
        let roiCount = 0
        let fermiOltre3gg = 0
        let sottoTargetUtilizzo = 0
        vehicleStats.forEach((s, vid) => {
            totalFatturato += s.fatturato || 0
            if (typeof s.utilizzoPct === 'number') {
                utilizzoSum += s.utilizzoPct
                utilizzoCount++
                if (s.utilizzoPct < 40) sottoTargetUtilizzo++
            }
            if (s.giorniFermo >= 3) fermiOltre3gg++
            // ROI proxy: fatturato / (daily_rate * 30) * 100 = utilizzo% del
            // potenziale mensile. Conservatore ma usa solo dati reali.
            const veh = vehicles.find(v => v.id === vid)
            const monthlyPotential = (veh?.daily_rate || 0) * 30
            if (monthlyPotential > 0) {
                roiSum += (s.fatturato / monthlyPotential) * 100
                roiCount++
            }
        })
        const utilizzoMedio = utilizzoCount > 0 ? Math.round(utilizzoSum / utilizzoCount) : 0
        const roiMedio = roiCount > 0 ? Math.round((roiSum / roiCount) * 10) / 10 : 0

        return {
            total, attivi, inUso, fermi, totalKm, meanDailyRate, byCategory, topByRate, dueSoon,
            totalFatturato, utilizzoMedio, roiMedio, fermiOltre3gg, sottoTargetUtilizzo,
        }
    }, [vehicles, vehicleStats])

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
            <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-5 lg:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="w-11 h-11 rounded-xl border border-theme-border bg-theme-bg-tertiary grid place-items-center flex-shrink-0">
                            <svg className="w-5 h-5 text-theme-text-primary" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
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

            {/* KPI cards — 6 metriche come da mockup. Tutti i numeri vengono
                dai dati reali (vehicleStats + vehicles), niente mock. */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                <KpiCard label="Totale Veicoli" value={stats.total} subtitle="100% della flotta"/>
                <KpiCard label="Veicoli Attivi" value={stats.attivi} subtitle={stats.total > 0 ? `${Math.round((stats.attivi / stats.total) * 100)}% della flotta` : '—'}/>
                <KpiCard label="Veicoli Fermi" value={stats.fermi} subtitle={stats.total > 0 ? `${Math.round((stats.fermi / stats.total) * 100)}% della flotta` : '—'} urgent={stats.fermi > 0}/>
                <KpiCard label="Fatturato Flotta" value={`€${stats.totalFatturato.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`} subtitle="ultimi 30 giorni"/>
                <KpiCard label="Utilizzo Medio" value={`${stats.utilizzoMedio}%`} subtitle="media veicolare"/>
                <KpiCard label="ROI Medio Flotta" value={`${stats.roiMedio.toString().replace('.', ',')}%`} subtitle="fatturato/potenziale"/>
            </div>

            {/* Alert Intelligenti — sezione condizionale che mostra gli avvisi
                derivati direttamente dai dati. Non rendering se non ci sono
                alert da mostrare. */}
            {(() => {
                const alerts: { tone: 'red' | 'amber' | 'yellow'; text: string }[] = []
                if (stats.fermiOltre3gg > 0) alerts.push({ tone: 'red', text: `${stats.fermiOltre3gg} ${stats.fermiOltre3gg === 1 ? 'veicolo fermo' : 'veicoli fermi'} da oltre 3 giorni` })
                if (stats.sottoTargetUtilizzo > 0) alerts.push({ tone: 'amber', text: `${stats.sottoTargetUtilizzo} ${stats.sottoTargetUtilizzo === 1 ? 'veicolo sotto' : 'veicoli sotto'} il target di utilizzo` })
                if (stats.dueSoon > 0) alerts.push({ tone: 'yellow', text: `${stats.dueSoon} ${stats.dueSoon === 1 ? 'scadenza' : 'scadenze'} entro 30 giorni (ass. / bollo / rev. / leasing)` })
                if (alerts.length === 0) return null
                const dotColor = { red: 'bg-red-500', amber: 'bg-amber-500', yellow: 'bg-yellow-500' }
                return (
                    <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary px-4 py-3">
                        <div className="flex items-center gap-2 mb-2">
                            <svg className="w-4 h-4 text-theme-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 4.93l14.14 14.14M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </svg>
                            <span className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Alert Intelligenti</span>
                            <span className="text-[11px] text-theme-text-muted">{alerts.length} {alerts.length === 1 ? 'avviso disponibile' : 'avvisi disponibili'}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {alerts.map((a, i) => (
                                <div key={i} className="flex items-center gap-2 bg-theme-bg-primary/40 border border-theme-border/50 rounded-full px-3 py-1.5">
                                    <span className={`w-2 h-2 rounded-full ${dotColor[a.tone]}`}/>
                                    <span className="text-[11px] text-theme-text-primary">{a.text}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )
            })()}

            {/* Filters — search + 3 dropdowns + Filtri pill + Nuovo Veicolo CTA */}
            <div className="flex flex-col lg:flex-row gap-2 items-stretch lg:items-center">
                <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                    </svg>
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Cerca per targa, nome o modello..."
                        className="w-full pl-9 pr-3 py-2 min-h-[40px] bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary placeholder-theme-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-theme-text-primary/30"
                    />
                </div>
                <div className="flex gap-2 flex-wrap">
                    <select
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="px-3 py-2 min-h-[40px] bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary text-sm focus:outline-none"
                    >
                        <option value="all">Tutti i gruppi</option>
                        {proCategories.map(c => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                    </select>
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="px-3 py-2 min-h-[40px] bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary text-sm focus:outline-none"
                    >
                        <option value="all">Tutti gli stati</option>
                        <option value="available">Attivo</option>
                        <option value="rented">In uso</option>
                        <option value="maintenance">Manutenzione</option>
                    </select>
                    <select
                        defaultValue=""
                        className="px-3 py-2 min-h-[40px] bg-theme-bg-tertiary border border-theme-border rounded-full text-theme-text-primary text-sm focus:outline-none"
                        title="Filtro disponibilità (in arrivo)"
                    >
                        <option value="">Disponibilità</option>
                        <option value="available">Disponibili oggi</option>
                        <option value="busy">Occupati oggi</option>
                    </select>
                    <button
                        type="button"
                        className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-full text-sm bg-theme-bg-tertiary border border-theme-border text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
                        title="Filtri avanzati (in arrivo)"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 12h12M10 20h4"/>
                        </svg>
                        Filtri
                    </button>
                    <button
                        type="button"
                        onClick={() => { try { window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: 'vehicles' } })) } catch { /* ignore */ } }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-full text-sm font-semibold bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 transition-colors"
                        title="Apri la tab Veicoli per aggiungere un nuovo veicolo"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                        </svg>
                        Nuovo Veicolo
                    </button>
                </div>
            </div>

            {/* Layout: tabella + sidebar */}
            <div className="lg:flex lg:gap-4 lg:items-start">
                <div className="lg:flex-1 lg:min-w-0 bg-theme-bg-secondary rounded-2xl border border-theme-border overflow-hidden">
                    {/* Mobile card view (<sm) — la tabella a 8 colonne sotto e\'
                        comprimibile solo orizzontalmente, illeggibile su 360px. */}
                    <div className="sm:hidden divide-y divide-theme-border">
                        {filtered.map(vehicle => {
                            const { nearestDeadline } = getVehicleStatus(vehicle, null)
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const img = (vehicle as any).metadata?.image as string | undefined
                            const catColor = vehicle.category ? colorFor(vehicle.category) : '#6B7280'
                            const s = vehicleStats.get(vehicle.id)
                            const pct = s?.utilizzoPct ?? 0
                            const pctColor = pct >= 70 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444'
                            return (
                                <button
                                    key={`mcard-${vehicle.id}`}
                                    onClick={() => onOpenDetail(vehicle.id)}
                                    className="w-full text-left p-3 hover:bg-theme-bg-hover/30 transition-colors min-h-[44px]"
                                >
                                    <div className="flex items-start gap-3">
                                        {img ? (
                                            <img src={img} alt={vehicle.display_name} className="w-14 h-10 rounded object-cover border border-theme-border shrink-0"/>
                                        ) : (
                                            <div className="w-14 h-10 rounded bg-theme-bg-tertiary border border-theme-border grid place-items-center shrink-0">
                                                <svg className="w-5 h-5 text-theme-text-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 17v-2.5C3 13.12 4.12 12 5.5 12h13c1.38 0 2.5 1.12 2.5 2.5V17h-2v2a1 1 0 01-1 1h-1a1 1 0 01-1-1v-2H8v2a1 1 0 01-1 1H6a1 1 0 01-1-1v-2H3z"/>
                                                </svg>
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-semibold text-theme-text-primary truncate">{vehicle.display_name}</span>
                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border" style={{ backgroundColor: `${catColor}20`, color: catColor, borderColor: `${catColor}66` }}>
                                                    {labelFor(vehicle.category)}
                                                </span>
                                            </div>
                                            <div className="text-[11px] text-theme-text-muted font-mono mt-0.5">{vehicle.plate || '—'} · {(vehicle.current_km || 0).toLocaleString('it-IT')} km</div>
                                            {nearestDeadline && (
                                                <div className={`text-[10px] mt-0.5 ${nearestDeadline.isUrgent ? 'text-red-400 font-bold' : nearestDeadline.isWarning ? 'text-amber-400' : 'text-theme-text-muted'}`}>
                                                    {nearestDeadline.label}: {nearestDeadline.isDate ? `${nearestDeadline.value} gg` : `${nearestDeadline.value} km`}
                                                </div>
                                            )}
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${STATO_STYLE[vehicle.status] || ''}`}>
                                                    {STATO_LABEL[vehicle.status] || vehicle.status}
                                                </span>
                                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                                    <div className="flex-1 h-1.5 rounded-full bg-theme-bg-tertiary overflow-hidden min-w-[40px]">
                                                        <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: pctColor }}/>
                                                    </div>
                                                    <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ color: pctColor }}>{pct}%</span>
                                                </div>
                                                {s?.fatturato && s.fatturato > 0 && (
                                                    <span className="text-[11px] font-bold text-theme-text-primary tabular-nums shrink-0">€{s.fatturato.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                    <div className="hidden sm:block overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-theme-border bg-theme-bg-tertiary/40 text-left">
                                    <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Veicolo</th>
                                    <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Gruppo</th>
                                    <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Targa</th>
                                    <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">KM</th>
                                    <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Stato</th>
                                    <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">Utilizzo 30g</th>
                                    <th className="py-2.5 px-3 text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider text-right">Fatturato 30g</th>
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
                                            <td className="py-2 px-3">
                                                {(() => {
                                                    const s = vehicleStats.get(vehicle.id)
                                                    const pct = s?.utilizzoPct ?? 0
                                                    const color = pct >= 70 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444'
                                                    return (
                                                        <div className="flex items-center gap-2 min-w-[90px]">
                                                            <div className="flex-1 h-1.5 rounded-full bg-theme-bg-tertiary overflow-hidden">
                                                                <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }}/>
                                                            </div>
                                                            <span className="text-[10px] font-bold tabular-nums" style={{ color }}>{pct}%</span>
                                                        </div>
                                                    )
                                                })()}
                                            </td>
                                            <td className="py-2 px-3 text-right text-xs text-theme-text-primary font-bold tabular-nums">
                                                {(() => {
                                                    const s = vehicleStats.get(vehicle.id)
                                                    const f = s?.fatturato || 0
                                                    return f > 0 ? `€${f.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'
                                                })()}
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

                    {/* Top per fatturato (ultimi 30 giorni) */}
                    <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Top per fatturato</h3>
                            <span className="text-[10px] text-theme-text-muted">30 gg</span>
                        </div>
                        {(() => {
                            const ranked = vehicles
                                .map(v => ({ vehicle: v, fatturato: vehicleStats.get(v.id)?.fatturato || 0 }))
                                .filter(x => x.fatturato > 0)
                                .sort((a, b) => b.fatturato - a.fatturato)
                                .slice(0, 5)
                            if (ranked.length === 0) {
                                return <div className="text-xs text-theme-text-muted py-3 text-center">Nessun fatturato negli ultimi 30 giorni</div>
                            }
                            return (
                                <div className="space-y-2">
                                    {ranked.map(({ vehicle: v, fatturato }) => {
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
                                                <div className="text-xs font-bold text-theme-text-primary tabular-nums whitespace-nowrap">€{fatturato.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                                            </button>
                                        )
                                    })}
                                </div>
                            )
                        })()}
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

                    {/* Suggerimenti Smart — heuristics su dati reali. */}
                    {(() => {
                        const lines: string[] = []
                        if (stats.sottoTargetUtilizzo > 0) lines.push(`${stats.sottoTargetUtilizzo} ${stats.sottoTargetUtilizzo === 1 ? 'veicolo ha' : 'veicoli hanno'} un utilizzo basso. Valuta una promozione mirata per aumentare le prenotazioni.`)
                        if (stats.fermiOltre3gg > 0) lines.push(`${stats.fermiOltre3gg} ${stats.fermiOltre3gg === 1 ? 'veicolo fermo' : 'veicoli fermi'} da oltre 3 giorni — controlla la disponibilità e gli interventi.`)
                        if (stats.dueSoon > 0) lines.push(`${stats.dueSoon} ${stats.dueSoon === 1 ? 'scadenza' : 'scadenze'} entro 30 giorni: pianifica i rinnovi.`)
                        if (lines.length === 0) lines.push('Tutto sotto controllo: nessuna anomalia rilevata sulla flotta.')
                        return (
                            <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <svg className="w-4 h-4 text-theme-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                                    </svg>
                                    <h3 className="text-xs font-bold text-theme-text-primary uppercase tracking-wider">Suggerimenti Smart</h3>
                                </div>
                                <ul className="space-y-1.5 text-[11px] text-theme-text-secondary leading-relaxed">
                                    {lines.map((l, i) => <li key={i}>{l}</li>)}
                                </ul>
                                {stats.sottoTargetUtilizzo > 0 && (
                                    <button
                                        onClick={() => { try { window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: 'campagna-marketing' } })) } catch { /* ignore */ } }}
                                        className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] rounded-full text-xs font-semibold bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 transition-colors"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                                        </svg>
                                        Crea Promozione
                                    </button>
                                )}
                            </div>
                        )
                    })()}
                </aside>
            </div>
        </div>
    )
}

function KpiCard({ label, value, subtitle, urgent }: { label: string; value: number | string; subtitle?: string; urgent?: boolean }) {
    return (
        <div className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-theme-text-muted">{label}</div>
            <div className={`text-2xl lg:text-3xl font-bold mt-2 tabular-nums text-theme-text-primary ${urgent ? 'animate-pulse' : ''}`}>{value}</div>
            {subtitle && <div className="text-[11px] text-theme-text-muted mt-1 truncate">{subtitle}</div>}
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
