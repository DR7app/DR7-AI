import { useState, useEffect, useMemo, useCallback } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'
import { supabase } from '../../../supabaseClient'

/**
 * Maxi Promo Gap Marketing — dashboard.
 *
 * Body del messaggio: vive in Messaggi di Sistema Pro → "MAXI PROMO GAP 1GG".
 * Variabili: {vehicle_specs}, {date_gap}, {date_gap_long}, {date_gap_short}.
 * Trigger cron: ogni 10 min, parte se Roma >= 18:00 OR booking creato negli
 * ultimi 20 min sul veicolo con gap. Dedup per (veicolo, gap_date, dest).
 */
type Mode = 'off' | 'pilot' | 'broadcast'

interface Settings {
    mode: Mode
    pilot_phone: string | null
    updated_at: string
}

type Range = '7gg' | '30gg' | '90gg' | 'mese'

interface VehicleRow {
    id: string
    name: string
    plate: string
    gap_date: string
    gap_hours?: number
    image?: string | null
    prezzoStandard?: number | null
    prezzoSuggerito?: number | null
    sconto?: number
    probabilita?: number
    stato?: 'da_inviare' | 'inviato' | 'convertito' | 'in_attesa'
}

interface SentLog {
    vehicle_id: string
    gap_date: string
    recipient: string
    sent_at: string
}

const ROME_TZ = 'Europe/Rome'

function eur(n: number | null | undefined): string {
    if (n == null || isNaN(n)) return '—'
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}
function fmtDateIT(s: string): string {
    if (!s) return '—'
    // Il backend ritorna gap_date gia' formattato in italiano ("12/05/2026")
    // per la sostituzione nei template WhatsApp. Se vediamo "/" passiamo
    // attraverso; altrimenti trattiamo come ISO yyyy-mm-dd e formattiamo.
    if (s.includes('/')) return s
    const d = new Date(s + 'T12:00:00')
    if (isNaN(d.getTime())) return s
    return d.toLocaleDateString('it-IT', { timeZone: ROME_TZ, day: '2-digit', month: 'long', year: 'numeric' })
}
function fmtDateShort(s: string): string {
    if (!s) return '—'
    if (s.includes('/')) {
        // "12/05/2026" → "12/05"
        const [day, month] = s.split('/')
        return day && month ? `${day}/${month}` : s
    }
    const d = new Date(s + 'T12:00:00')
    if (isNaN(d.getTime())) return s
    return d.toLocaleDateString('it-IT', { timeZone: ROME_TZ, day: '2-digit', month: '2-digit' })
}

export default function MaxiPromoGapTab() {
    const [range, setRange] = useState<Range>('30gg')
    const [settings, setSettings] = useState<Settings | null>(null)
    const [draftMode, setDraftMode] = useState<Mode>('off')
    const [draftPhone, setDraftPhone] = useState('')
    const [savingSettings, setSavingSettings] = useState(false)

    const [phone, setPhone] = useState('')
    const [loading, setLoading] = useState(false)
    const [detecting, setDetecting] = useState(false)
    const [gapVehicles, setGapVehicles] = useState<VehicleRow[]>([])
    const [sentLog, setSentLog] = useState<SentLog[]>([])
    const [convertedCount, setConvertedCount] = useState(0)
    const [convertedRevenue, setConvertedRevenue] = useState(0)

    const periodRange = useMemo(() => {
        const end = new Date()
        const start = new Date()
        if (range === '7gg') start.setDate(start.getDate() - 6)
        else if (range === '30gg') start.setDate(start.getDate() - 29)
        else if (range === '90gg') start.setDate(start.getDate() - 89)
        else if (range === 'mese') start.setDate(1)
        return { start, end }
    }, [range])

    const loadSettings = useCallback(async () => {
        const { data } = await supabase
            .from('maxi_promo_settings')
            .select('mode, pilot_phone, updated_at')
            .eq('id', 1)
            .maybeSingle()
        if (data) {
            setSettings(data as Settings)
            setDraftMode((data.mode as Mode) || 'off')
            setDraftPhone(data.pilot_phone || '')
        } else {
            setSettings({ mode: 'off', pilot_phone: null, updated_at: '' })
        }
    }, [])

    const loadStats = useCallback(async () => {
        const fromIso = periodRange.start.toISOString()
        const toIso = periodRange.end.toISOString()
        const { data: logs } = await supabase
            .from('maxi_promo_sent_log')
            .select('vehicle_id, gap_date, recipient, sent_at')
            .gte('sent_at', fromIso)
            .lte('sent_at', toIso)
            .order('sent_at', { ascending: false })
            .limit(2000)
        const list = (logs || []) as SentLog[]
        setSentLog(list)

        // Conversioni: bookings con pickup_date = gap_date e creati >= sent_at
        // (per i log presi nel periodo). Ottimizziamo: una sola query per tutti
        // gli id veicolo coinvolti, poi filtriamo lato client.
        const vehicleIds = Array.from(new Set(list.map(l => l.vehicle_id))).slice(0, 200)
        if (vehicleIds.length > 0) {
            const { data: convBookings } = await supabase
                .from('bookings')
                .select('id, vehicle_id, pickup_date, total_amount, created_at')
                .in('vehicle_id', vehicleIds)
                .gte('created_at', fromIso)
            let count = 0, revenue = 0
            for (const b of (convBookings || []) as { vehicle_id: string; pickup_date: string; total_amount: number; created_at: string }[]) {
                const pickupDay = b.pickup_date ? b.pickup_date.split('T')[0] : ''
                const matchedLog = list.find(l => l.vehicle_id === b.vehicle_id
                    && l.gap_date === pickupDay
                    && new Date(b.created_at) >= new Date(l.sent_at))
                if (matchedLog) {
                    count++
                    revenue += Number(b.total_amount) || 0
                }
            }
            setConvertedCount(count)
            setConvertedRevenue(revenue)
        } else {
            setConvertedCount(0)
            setConvertedRevenue(0)
        }
    }, [periodRange.start, periodRange.end])

    const detectGaps = useCallback(async () => {
        setDetecting(true)
        try {
            const res = await authFetch('/.netlify/functions/maxi-promo-gap-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dryRun: true }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
            const vehicles = (data.vehicles || []) as { id?: string; name?: string; plate?: string; gap_date?: string; gap_hours?: number }[]
            const vehicleIds = vehicles.map(v => v.id).filter(Boolean) as string[]
            const detailMap = new Map<string, { image?: string; prezzo?: number }>()
            if (vehicleIds.length > 0) {
                const { data: vRows } = await supabase
                    .from('vehicles')
                    .select('id, metadata, name, daily_price_eur')
                    .in('id', vehicleIds)
                for (const v of (vRows || []) as { id: string; metadata: Record<string, unknown> | null; daily_price_eur: number | null }[]) {
                    const meta = v.metadata as { image?: string; price_per_day?: number } | null
                    detailMap.set(v.id, {
                        image: meta?.image || undefined,
                        prezzo: Number(meta?.price_per_day) || Number(v.daily_price_eur) || undefined,
                    })
                }
            }
            const enriched: VehicleRow[] = vehicles.map(v => {
                const det = v.id ? detailMap.get(v.id) : undefined
                const standard = det?.prezzo
                const sconto = 30  // sconto medio del template (visibile nella UI)
                const suggerito = standard ? Math.round(standard * (100 - sconto) / 100) : undefined
                const probabilita = 50 + Math.min(40, (v.gap_hours || 0))  // proxy semplice
                return {
                    id: v.id || '',
                    name: v.name || '—',
                    plate: v.plate || '—',
                    gap_date: v.gap_date || '',
                    gap_hours: v.gap_hours,
                    image: det?.image || null,
                    prezzoStandard: standard,
                    prezzoSuggerito: suggerito,
                    sconto,
                    probabilita,
                    stato: 'da_inviare',
                }
            })
            setGapVehicles(enriched)
            toast.success(`Rilevati ${enriched.length} gap`)
        } catch (err) {
            toast.error('Rilevamento fallito: ' + (err instanceof Error ? err.message : String(err)))
        } finally {
            setDetecting(false)
        }
    }, [])

    useEffect(() => { loadSettings() }, [loadSettings])
    useEffect(() => { loadStats() }, [loadStats])
    // Auto-detect dei gap al primo mount: cosi' la tab non mostra zeri vuoti
    // appena entri. Si rilancia comunque cliccando "Aggiorna gap".
    useEffect(() => { detectGaps() }, [detectGaps])

    async function saveSettings() {
        if (draftMode === 'pilot' && !draftPhone.trim()) {
            toast.error('Inserisci il numero pilota')
            return
        }
        setSavingSettings(true)
        try {
            const payload = { id: 1, mode: draftMode, pilot_phone: draftMode === 'pilot' ? draftPhone.trim() : null, updated_at: new Date().toISOString() }
            const { error } = await supabase.from('maxi_promo_settings').upsert(payload, { onConflict: 'id' })
            if (error) throw error
            toast.success('Impostazioni salvate')
            await loadSettings()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err))
        } finally {
            setSavingSettings(false)
        }
    }

    async function runTestSend() {
        if (!phone.trim()) {
            toast.error('Inserisci un numero di telefono di test')
            return
        }
        if (!confirm(`Inviare i messaggi MAXI PROMO al numero ${phone.trim()}?`)) return
        setLoading(true)
        const toastId = toast.loading('Invio in corso...')
        try {
            const res = await authFetch('/.netlify/functions/maxi-promo-gap-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phone.trim() }),
            })
            const data = await res.json()
            toast.dismiss(toastId)
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
            if (data.gapsFound === 0) toast('Nessun gap di 1 giorno per domani', { icon: 'ℹ️' })
            else toast.success(`${data.sent}/${data.gapsFound} messaggi inviati a ${data.recipient}`)
            await loadStats()
        } catch (err) {
            toast.dismiss(toastId)
            toast.error(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }

    // KPI
    const gapRilevatiOggi = gapVehicles.length
    const valorePotenziale = gapVehicles.reduce((s, v) => s + (v.prezzoSuggerito || 0), 0)
    const messaggiInviati = sentLog.length
    const tassoRiempimento = messaggiInviati > 0 ? Math.round((convertedCount / messaggiInviati) * 100) : 0

    // Trend: messaggi inviati per giorno nel periodo
    const trendData = useMemo(() => {
        const map = new Map<string, number>()
        for (const log of sentLog) {
            const day = log.sent_at.split('T')[0]
            map.set(day, (map.get(day) || 0) + 1)
        }
        const days: { day: string; count: number }[] = []
        const cur = new Date(periodRange.start)
        while (cur <= periodRange.end) {
            const key = cur.toISOString().split('T')[0]
            days.push({ day: key, count: map.get(key) || 0 })
            cur.setDate(cur.getDate() + 1)
        }
        return days
    }, [sentLog, periodRange.start, periodRange.end])

    // Top veicoli per gap riempiti (proxy: count distinct gap_date per vehicle nei log)
    const topVeicoli = useMemo(() => {
        const map = new Map<string, { vehicleId: string; count: number }>()
        for (const log of sentLog) {
            const cur = map.get(log.vehicle_id) || { vehicleId: log.vehicle_id, count: 0 }
            cur.count++
            map.set(log.vehicle_id, cur)
        }
        return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 5)
    }, [sentLog])

    return (
        <div className="space-y-4 p-3 sm:p-6">
            {/* HEADER */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-theme-text-primary">Maxi Promo Gap Marketing</h2>
                    <p className="text-xs text-theme-text-muted">Rileva automaticamente i gap di 1 giorno e massimizza il riempimento.</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex gap-1 bg-theme-bg-tertiary rounded p-1 text-xs">
                        {(['7gg', '30gg', '90gg', 'mese'] as Range[]).map(r => (
                            <button key={r} onClick={() => setRange(r)}
                                className={`px-3 py-1 rounded ${range === r ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:text-theme-text-primary'}`}>
                                {r === '7gg' ? '7 giorni' : r === '30gg' ? '30 giorni' : r === '90gg' ? '90 giorni' : 'Mese'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* TOP KPI ROW */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiTile label="Gap Rilevati Domani" value={detecting ? '…' : String(gapRilevatiOggi)} sub={gapRilevatiOggi > 0 ? 'opportunita\' aperte' : 'nessun gap rilevato'} tone="amber" icon="warn" />
                <KpiTile label="Valore Potenziale" value={eur(valorePotenziale)} sub={gapRilevatiOggi > 0 ? `${gapRilevatiOggi} veicoli scontati` : 'attendi gap di 1 giorno'} tone="emerald" icon="euro" />
                <KpiTile label="Messaggi Inviati" value={String(messaggiInviati)} sub={messaggiInviati > 0 ? `nel periodo (${range})` : 'cron ancora inattivo'} tone="sky" icon="send" />
                <KpiTile label="Conversioni" value={String(convertedCount)} sub={convertedCount > 0 ? 'prenotazioni post-msg' : 'nessuna conv. tracciata'} tone="primary" icon="check" />
                <KpiTile label="Tasso Riempimento" value={messaggiInviati > 0 ? `${tassoRiempimento}%` : '—'} sub={messaggiInviati > 0 ? 'conv / inviati' : 'serve almeno 1 invio'} tone={tassoRiempimento >= 20 ? 'emerald' : 'amber'} icon="trend" />
                <KpiTile label="Fatturato Generato" value={eur(convertedRevenue)} sub={convertedRevenue > 0 ? 'da maxi promo' : 'nessuna conv. ancora'} tone="emerald" icon="cash" />
            </div>

            {/* HINT quando il cron e' OFF e niente dati */}
            {settings?.mode === 'off' && messaggiInviati === 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3">
                    <span>
                        Il cron Maxi Promo Gap e' attualmente <strong>OFF</strong>: nessun messaggio viene inviato e i KPI restano vuoti.
                        Per popolare il report, attiva <strong>Pilot</strong> o <strong>Broadcast</strong> nel pannello "Automazione Intelligente" qui sotto.
                    </span>
                </div>
            )}

            {/* MAIN GRID: table + sidebar */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
                <div className="space-y-4">
                    {/* GAP TABLE */}
                    <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4">
                        <div className="flex items-baseline justify-between mb-3">
                            <h3 className="text-base font-semibold text-theme-text-primary">Gap Rilevati - Opportunità di Riempimento</h3>
                            <button onClick={detectGaps} disabled={detecting}
                                className="text-xs px-3 py-1.5 rounded bg-dr7-gold text-black font-semibold hover:opacity-90 disabled:opacity-50">
                                {detecting ? 'Rilevamento…' : 'Aggiorna gap'}
                            </button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="text-theme-text-muted text-xs">
                                    <tr className="border-b border-theme-border">
                                        <th className="text-left py-2 font-medium">Veicolo</th>
                                        <th className="text-left py-2 font-medium">Gap Date</th>
                                        <th className="text-center py-2 font-medium">Durata</th>
                                        <th className="text-right py-2 font-medium">Standard</th>
                                        <th className="text-right py-2 font-medium">Suggerito</th>
                                        <th className="text-center py-2 font-medium">Prob.</th>
                                        <th className="text-center py-2 font-medium">Stato</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-theme-border/50">
                                    {gapVehicles.length === 0 && (
                                        <tr><td colSpan={7} className="py-8 text-center text-theme-text-muted">
                                            {detecting ? 'Rilevamento…' : 'Nessun gap rilevato. Clicca "Aggiorna gap" per cercare.'}
                                        </td></tr>
                                    )}
                                    {gapVehicles.map(v => (
                                        <tr key={`${v.id}-${v.gap_date}`} className="hover:bg-theme-bg-tertiary/30">
                                            <td className="py-2">
                                                <div className="flex items-center gap-2">
                                                    {v.image ? (
                                                        <img src={v.image} alt={v.name} className="w-12 h-9 object-cover rounded border border-theme-border flex-shrink-0" />
                                                    ) : (
                                                        <div className="w-12 h-9 rounded border border-theme-border bg-theme-bg-tertiary flex items-center justify-center text-[9px] text-theme-text-muted flex-shrink-0">no img</div>
                                                    )}
                                                    <div>
                                                        <div className="font-medium text-theme-text-primary text-xs">{v.name}</div>
                                                        <div className="text-[10px] text-theme-text-muted font-mono">{v.plate}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-2 text-xs">{fmtDateIT(v.gap_date)}</td>
                                            <td className="py-2 text-center text-xs">1 giorno</td>
                                            <td className="py-2 text-right text-xs">{eur(v.prezzoStandard ?? null)}</td>
                                            <td className="py-2 text-right">
                                                <div className="text-xs font-semibold text-emerald-500">{eur(v.prezzoSuggerito ?? null)}</div>
                                                {v.sconto && <div className="text-[10px] text-theme-text-muted">-{v.sconto}%</div>}
                                            </td>
                                            <td className="py-2 text-center">
                                                <ProbCircle pct={v.probabilita || 0} />
                                            </td>
                                            <td className="py-2 text-center">
                                                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Da inviare</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* BOTTOM WIDGETS */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <ChartCard title="Performance Maxi Promo Gap" subtitle={`Messaggi inviati per giorno (${range})`}>
                            <TrendBars data={trendData} />
                        </ChartCard>
                        <ChartCard title="Top Veicoli per Gap" subtitle="Periodo selezionato">
                            <TopVeicoliBars data={topVeicoli} />
                        </ChartCard>
                    </div>
                </div>

                {/* RIGHT SIDEBAR */}
                <div className="space-y-3">
                    {/* AUTOMAZIONE INTELLIGENTE */}
                    <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-theme-text-primary">Automazione Intelligente</h3>
                            {settings && <ModeBadge m={settings.mode} />}
                        </div>
                        <div className="space-y-2 text-xs">
                            {(['off', 'pilot', 'broadcast'] as Mode[]).map(m => (
                                <button key={m} onClick={() => setDraftMode(m)}
                                    className={`w-full px-3 py-2 rounded-lg text-left transition-colors ${draftMode === m ? 'bg-dr7-gold text-black font-semibold' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}>
                                    <div className="font-medium">{m === 'off' ? 'OFF' : m === 'pilot' ? 'Pilot (1 numero)' : 'Broadcast (tutti)'}</div>
                                    <div className="text-[10px] opacity-75 mt-0.5">
                                        {m === 'off' && 'Cron in pausa'}
                                        {m === 'pilot' && 'Solo numero pilota'}
                                        {m === 'broadcast' && 'Tutti i clienti'}
                                    </div>
                                </button>
                            ))}
                        </div>
                        {draftMode === 'pilot' && (
                            <div className="mt-3">
                                <input type="tel" value={draftPhone} onChange={e => setDraftPhone(e.target.value)}
                                    placeholder="+39 347 281 7258"
                                    className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded text-xs text-theme-text-primary" />
                            </div>
                        )}
                        <button onClick={saveSettings} disabled={savingSettings}
                            className="mt-3 w-full px-3 py-2 bg-dr7-gold text-black rounded font-semibold text-xs hover:opacity-90 disabled:opacity-50">
                            {savingSettings ? 'Salvataggio…' : 'Salva impostazioni'}
                        </button>
                    </div>

                    {/* ANTEPRIMA WHATSAPP */}
                    <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4">
                        <h3 className="text-sm font-semibold text-theme-text-primary mb-2">Anteprima Messaggio WhatsApp</h3>
                        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-lg p-3 text-xs text-theme-text-primary">
                            <p className="font-mono whitespace-pre-line leading-relaxed">
                                {`Ciao {first_name},

abbiamo un'offerta speciale per te:

Auto: {vehicle_specs}
Disponibile il {date_gap_long}
-30% sul prezzo standard

Prenota ora — 1 giorno di esperienza in DR7.`}
                            </p>
                        </div>
                        <p className="text-[10px] text-theme-text-muted mt-2">
                            Body modificabile in <span className="text-dr7-gold">Messaggi di Sistema Pro → MAXI PROMO GAP 1GG</span>
                        </p>
                    </div>

                    {/* TEST RAPIDO */}
                    <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4">
                        <h3 className="text-sm font-semibold text-theme-text-primary mb-2">Test Rapido</h3>
                        <p className="text-[10px] text-theme-text-muted mb-2">Numero per ricevere un test ora</p>
                        <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                            placeholder="+39 345 790 5205"
                            className="w-full px-3 py-2 bg-theme-bg-tertiary border border-theme-border rounded text-xs text-theme-text-primary mb-2" />
                        <button onClick={runTestSend} disabled={loading}
                            className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold text-xs disabled:opacity-50">
                            {loading ? 'Invio…' : '↗ Invia Test'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ─── COMPONENTS ────────────────────────────────────────────────────────

type Tone = 'emerald' | 'amber' | 'sky' | 'primary' | 'muted'
type Icon = 'warn' | 'euro' | 'send' | 'check' | 'trend' | 'cash'

function KpiTile({ label, value, sub, tone, icon }: { label: string; value: string; sub?: string; tone: Tone; icon: Icon }) {
    const toneStyles = {
        emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', txt: 'text-emerald-600 dark:text-emerald-400' },
        amber: { bg: 'bg-amber-50 dark:bg-amber-950/30', txt: 'text-amber-600 dark:text-amber-400' },
        sky: { bg: 'bg-sky-50 dark:bg-sky-950/30', txt: 'text-sky-600 dark:text-sky-400' },
        primary: { bg: 'bg-theme-bg-tertiary/40', txt: 'text-theme-text-primary' },
        muted: { bg: 'bg-theme-bg-tertiary/30', txt: 'text-theme-text-muted' },
    }[tone]
    return (
        <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-3">
            <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-md ${toneStyles.bg} ${toneStyles.txt} flex items-center justify-center`}>
                    <KpiIcon name={icon} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-theme-text-muted uppercase tracking-wider truncate">{label}</div>
                </div>
            </div>
            <div className={`text-xl font-bold mt-2 ${toneStyles.txt}`}>{value}</div>
            {sub && <div className="text-[10px] text-theme-text-muted mt-0.5 truncate">{sub}</div>}
        </div>
    )
}

function KpiIcon({ name }: { name: Icon }) {
    const M: Record<Icon, React.ReactElement> = {
        warn: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
        euro: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
        send: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
        check: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
        trend: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
        cash: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>,
    }
    return M[name]
}

function ProbCircle({ pct }: { pct: number }) {
    const color = pct >= 70 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444'
    return (
        <div className="inline-flex items-center justify-center">
            <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90">
                <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="4" />
                <circle cx="18" cy="18" r="14" fill="none" stroke={color} strokeWidth="4"
                    strokeDasharray={`${pct * 0.88} 88`} strokeLinecap="round" />
            </svg>
            <span className="absolute text-[10px] font-bold text-theme-text-primary">{pct}%</span>
        </div>
    )
}

function ModeBadge({ m }: { m: Mode }) {
    const map = {
        off: { label: 'OFF', cls: 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-300' },
        pilot: { label: 'PILOT', cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
        broadcast: { label: 'BROADCAST', cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
    }[m]
    return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${map.cls}`}>{map.label}</span>
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4">
            <div className="flex items-baseline justify-between mb-3">
                <h4 className="text-sm font-semibold text-theme-text-primary">{title}</h4>
                {subtitle && <span className="text-[10px] text-theme-text-muted">{subtitle}</span>}
            </div>
            {children}
        </div>
    )
}

function TrendBars({ data }: { data: { day: string; count: number }[] }) {
    if (data.length === 0) return <div className="text-theme-text-muted text-sm py-4 text-center">Nessun dato.</div>
    const max = Math.max(...data.map(d => d.count), 1)
    return (
        <div className="flex items-end gap-1 h-32">
            {data.map(d => {
                const h = (d.count / max) * 100
                return (
                    <div key={d.day} className="flex-1 flex flex-col items-center justify-end min-w-0" title={`${d.day}: ${d.count} inviati`}>
                        <div className="w-full bg-sky-500/70 hover:bg-sky-500 rounded-t transition-colors" style={{ height: `${h}%`, minHeight: '2px' }} />
                        {data.length <= 14 && <div className="text-[8px] text-theme-text-muted mt-1 truncate">{fmtDateShort(d.day)}</div>}
                    </div>
                )
            })}
        </div>
    )
}

function TopVeicoliBars({ data }: { data: { vehicleId: string; count: number }[] }) {
    if (data.length === 0) return <div className="text-theme-text-muted text-sm py-4 text-center">Nessun dato.</div>
    const max = Math.max(...data.map(d => d.count), 1)
    return (
        <div className="space-y-2">
            {data.map((d, i) => {
                const pct = (d.count / max) * 100
                return (
                    <div key={d.vehicleId}>
                        <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-theme-text-secondary truncate pr-2">#{i + 1} {d.vehicleId.slice(0, 8)}…</span>
                            <span className="text-theme-text-muted whitespace-nowrap text-[10px]">{d.count} inviati</span>
                        </div>
                        <div className="h-2 bg-theme-bg-tertiary rounded-full overflow-hidden">
                            <div className="h-full bg-dr7-gold" style={{ width: `${pct}%` }} />
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
