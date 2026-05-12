import React, { useEffect, useState, useMemo, useCallback } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'
import Button from './Button'
import OperatorProfileModal from './OperatorProfileModal'

interface Operatore {
    id: string
    user_id: string | null
    nome: string
    cognome: string | null
    email: string
    ruolo: string | null
    ore_target_giornaliere: number
    attivo: boolean
    avatar_url: string | null
}

interface DayRow {
    operatore: Operatore
    entrata: string | null
    uscita: string | null
    pausa_inizi: string[]
    pausa_fini: string[]
    minuti_lavorati: number
    minuti_pausa: number
    stato: 'fuori' | 'lavoro' | 'pausa' | 'finito'
}

const ROME_TZ = 'Europe/Rome'
const MS_PER_DAY = 86400000

function toRomeDate(d: Date): string {
    return d.toLocaleDateString('en-CA', { timeZone: ROME_TZ })
}
function fmtTime(iso: string | null): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleTimeString('it-IT', { timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit' })
}
function fmtMin(min: number): string {
    if (min === 0) return '—'
    const h = Math.floor(min / 60)
    const m = min % 60
    return `${h}h ${String(m).padStart(2, '0')}m`
}
function fmtMinShort(min: number): string {
    if (min === 0) return '—'
    return `${min} min`
}

/**
 * OperatoreAvatar — round avatar shown next to every operatore in
 * tables and detail panels. Renders the uploaded picture when
 * present, otherwise a colored circle with the operatore's initials
 * (deterministic color per name so the same person always gets the
 * same tile color).
 */
const AVATAR_TONES = ['bg-emerald-600', 'bg-blue-600', 'bg-amber-600', 'bg-rose-600', 'bg-violet-600', 'bg-cyan-600', 'bg-fuchsia-600', 'bg-orange-600']
function avatarTone(seed: string): string {
    let h = 0
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
    return AVATAR_TONES[h % AVATAR_TONES.length]
}
/**
 * AvatarUploader — replaces the avatar tile with a clickable label
 * that opens the file picker. On select, uploads to operator-avatars
 * bucket (path: {operatorId}/{timestamp}.{ext}), writes the public
 * URL back on operatori_persone.avatar_url, and calls onUploaded so
 * the parent can refresh.
 */
async function uploadOperatoreAvatar(operatorId: string, file: File): Promise<string | null> {
    if (!file.type.startsWith('image/')) {
        toast.error('Carica un\'immagine (jpg, png, webp).')
        return null
    }
    if (file.size > 2 * 1024 * 1024) {
        toast.error('File troppo grande (max 2 MB).')
        return null
    }
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${operatorId}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
        .from('operator-avatars')
        .upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) {
        toast.error('Upload fallito: ' + upErr.message)
        return null
    }
    const { data: pub } = supabase.storage.from('operator-avatars').getPublicUrl(path)
    const url = pub.publicUrl
    const { error: dbErr } = await supabase.from('operatori_persone').update({ avatar_url: url }).eq('id', operatorId)
    if (dbErr) {
        toast.error('Salvataggio URL avatar fallito: ' + dbErr.message)
        return null
    }
    toast.success('Foto profilo aggiornata')
    return url
}

function OperatoreAvatar({ op, size = 32 }: { op: { nome?: string | null; cognome?: string | null; email?: string | null; avatar_url?: string | null }; size?: number }) {
    const initials = `${(op.nome || '').charAt(0)}${(op.cognome || '').charAt(0)}`.toUpperCase() || (op.email || '?').charAt(0).toUpperCase()
    const tone = avatarTone(op.email || op.nome || op.cognome || '?')
    const cls = `inline-flex items-center justify-center rounded-full text-white font-semibold flex-shrink-0 overflow-hidden`
    const style = { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px` }
    if (op.avatar_url) {
        return (
            <span className={`${cls} bg-theme-bg-tertiary border border-theme-border`} style={style}>
                <img src={op.avatar_url} alt="" className="w-full h-full object-cover" />
            </span>
        )
    }
    return (
        <span className={`${cls} ${tone}`} style={style}>{initials}</span>
    )
}

type ViewMode = 'giornaliera' | 'settimanale' | 'mensile'

/**
 * Rilevazione Orari — admin tab.
 *
 * Logic:
 * - Admin logs in once (existing admin auth).
 * - The currently-logged-in user is identified as an operatore via
 *   operatori_persone.user_id = auth.uid().
 * - At the top: a self clock-in widget — only the current user can clock
 *   in / out / break. Buttons reflect their live state.
 * - Below: team table — all operators visible, but RLS allows writes only
 *   on own rows. Other rows are read-only.
 */
export default function RilevazioneOrariTab() {
    const { hasRole } = useAdminRole()
    // Direzione (Valerio, Ilenia) + ophe (developer/manutentrice del
    // sistema) vedono i report di TUTTI gli operatori. Tutti gli altri
    // admin vedono solo i propri orari. La detail-row del singolo
    // operatore (timeline + tutte le pause + KPI) è abilitata per
    // chiunque rientri in questa allowlist.
    // Direzione (failsafe valerio/ilenia, oppure ruolo `role:direzione`) o
    // developer (failsafe ophe) vedono i report di tutti gli operatori.
    const isValerioOrIlenia = hasRole('direzione') || hasRole('developer')

    const [me, setMe] = useState<Operatore | null>(null)
    const [view, setView] = useState<ViewMode>('giornaliera')
    const [refDate, setRefDate] = useState(new Date())
    const [loading, setLoading] = useState(true)
    const [showAddOp, setShowAddOp] = useState(false)
    const [editMyDay, setEditMyDay] = useState(false)
    const [, setNow] = useState(new Date())

    const [dailyRows, setDailyRows] = useState<DayRow[]>([])
    const [periodRows, setPeriodRows] = useState<{ operatore: Operatore; daysData: Map<string, number> }[]>([])

    // Expanded operator row in the daily table — shows full timeline of
    // the day with EVERY pause window (start, end, duration), plus
    // per-operator info (role, target hours, email) and a stack of
    // performance metrics. Direzione/admin can expand any row to see
    // EVERYTHING; everyone else can still expand their own row.
    const [expandedId, setExpandedId] = useState<string | null>(null)
    // Full-profile modal — opened from the "Profilo completo" button
    // inside the expanded row. Renders per-operator KPIs, trend chart,
    // pause analytics and a per-day breakdown of all pauses.
    const [profileOp, setProfileOp] = useState<Operatore | null>(null)

    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 30000)
        return () => clearInterval(t)
    }, [])

    const periodRange = useMemo(() => {
        if (view === 'giornaliera') {
            const d = toRomeDate(refDate)
            return { start: d, end: d, days: [d] }
        }
        if (view === 'settimanale') {
            const d = new Date(refDate)
            const day = d.getDay() || 7
            d.setDate(d.getDate() - day + 1)
            const days: string[] = []
            for (let i = 0; i < 7; i++) {
                days.push(toRomeDate(new Date(d.getTime() + i * MS_PER_DAY)))
            }
            return { start: days[0], end: days[6], days }
        }
        const y = refDate.getFullYear()
        const m = refDate.getMonth()
        const first = new Date(y, m, 1)
        const last = new Date(y, m + 1, 0)
        const days: string[] = []
        for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
            days.push(toRomeDate(new Date(d)))
        }
        return { start: days[0], end: days[days.length - 1], days }
    }, [view, refDate])

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()

            let opList: Operatore[] = []

            if (isValerioOrIlenia) {
                // Direzione: vede TUTTI gli operatori
                const { data: ops } = await supabase
                    .from('operatori_persone')
                    .select('id, user_id, nome, cognome, email, ruolo, ore_target_giornaliere, attivo, avatar_url')
                    .eq('attivo', true)
                    .order('cognome', { ascending: true })
                opList = (ops || []) as Operatore[]
            } else if (user) {
                const { data: byId } = await supabase
                    .from('operatori_persone')
                    .select('id, user_id, nome, cognome, email, ruolo, ore_target_giornaliere, attivo, avatar_url')
                    .eq('attivo', true)
                    .eq('user_id', user.id)
                opList = (byId || []) as Operatore[]
                if (opList.length === 0 && user.email) {
                    const { data: byEmail } = await supabase
                        .from('operatori_persone')
                        .select('id, user_id, nome, cognome, email, ruolo, ore_target_giornaliere, attivo, avatar_url')
                        .eq('attivo', true)
                        .ilike('email', user.email)
                    opList = (byEmail || []) as Operatore[]
                    const linkable = opList.find(o => !o.user_id)
                    if (linkable) {
                        await supabase.from('operatori_persone').update({ user_id: user.id }).eq('id', linkable.id)
                    }
                }
                // auto-create se non esiste (prova admins.nome, fallback email-local)
                if (opList.length === 0 && user.email) {
                    let fullName = ''
                    try {
                        const { data: adminRow } = await supabase
                            .from('admins')
                            .select('nome')
                            .ilike('email', user.email)
                            .maybeSingle()
                        fullName = (adminRow?.nome || '').trim()
                    } catch { /* admins RLS-blocked: ignoro */ }

                    const local = user.email.split('@')[0]
                    const fallback = local.charAt(0).toUpperCase() + local.slice(1).toLowerCase()
                    const [nome, ...rest] = (fullName || fallback).split(/\s+/)
                    const cognome = rest.join(' ') || null

                    const { data: created } = await supabase
                        .from('operatori_persone')
                        .insert({
                            nome: nome || fallback,
                            cognome,
                            email: user.email.toLowerCase(),
                            user_id: user.id,
                            ore_target_giornaliere: 8,
                            attivo: true,
                        })
                        .select('id, user_id, nome, cognome, email, ruolo, ore_target_giornaliere, attivo, avatar_url')
                        .single()
                    if (created) opList = [created as Operatore]
                }
            }

            const myRow = user
                ? (opList.find(o => o.user_id === user.id)
                    || (user.email ? opList.find(o => (o.email || '').toLowerCase() === user.email!.toLowerCase()) : null)
                    || null)
                : null
            setMe(myRow)

            if (view === 'giornaliera') {
                const d = periodRange.start
                const { data: entries } = await supabase
                    .from('timesheet_entries')
                    .select('operatore_id, tipo, timestamp')
                    .eq('data', d)
                    .order('timestamp', { ascending: true })
                const byOp = new Map<string, { entrata: string | null; uscita: string | null; pi: string[]; pf: string[]; lastTipo: string | null }>()
                for (const e of (entries || []) as { operatore_id: string; tipo: string; timestamp: string }[]) {
                    const cur = byOp.get(e.operatore_id) || { entrata: null, uscita: null, pi: [], pf: [], lastTipo: null }
                    if (e.tipo === 'entrata') cur.entrata = e.timestamp
                    else if (e.tipo === 'uscita') cur.uscita = e.timestamp
                    else if (e.tipo === 'pausa_inizio') cur.pi.push(e.timestamp)
                    else if (e.tipo === 'pausa_fine') cur.pf.push(e.timestamp)
                    cur.lastTipo = e.tipo
                    byOp.set(e.operatore_id, cur)
                }
                const rows: DayRow[] = []
                for (const op of opList) {
                    const data = byOp.get(op.id)
                    let minuti = 0
                    let pausaMin = 0
                    if (data) {
                        const { data: m } = await supabase.rpc('operatore_minuti_lavorati', { p_operatore_id: op.id, p_data: d })
                        minuti = Number(m) || 0
                        // Pairing: pausa_inizi[i] con pausa_fini[i] (entrambi ordinati
                        // ASC per timestamp). Math.round per evitare di perdere un
                        // minuto se i secondi salvati attraversano un boundary
                        // (es. 10:57:30 -> 11:00:29 = 2.98 min -> floor 2 con bug).
                        for (let i = 0; i < Math.min(data.pi.length, data.pf.length); i++) {
                            const diff = new Date(data.pf[i]).getTime() - new Date(data.pi[i]).getTime()
                            if (diff > 0) pausaMin += Math.round(diff / 60000)
                        }
                    }
                    let stato: DayRow['stato'] = 'fuori'
                    if (data?.lastTipo === 'entrata' || data?.lastTipo === 'pausa_fine') stato = 'lavoro'
                    else if (data?.lastTipo === 'pausa_inizio') stato = 'pausa'
                    else if (data?.lastTipo === 'uscita') stato = 'finito'
                    rows.push({
                        operatore: op,
                        entrata: data?.entrata || null,
                        uscita: data?.uscita || null,
                        pausa_inizi: data?.pi || [],
                        pausa_fini: data?.pf || [],
                        minuti_lavorati: minuti,
                        minuti_pausa: pausaMin,
                        stato,
                    })
                }
                setDailyRows(rows)
            } else {
                const rows: { operatore: Operatore; daysData: Map<string, number> }[] = []
                for (const op of opList) {
                    const map = new Map<string, number>()
                    for (const d of periodRange.days) {
                        const { data: m } = await supabase.rpc('operatore_minuti_lavorati', { p_operatore_id: op.id, p_data: d })
                        const min = Number(m) || 0
                        if (min > 0) map.set(d, min)
                    }
                    rows.push({ operatore: op, daysData: map })
                }
                setPeriodRows(rows)
            }
        } catch (err) {
            console.error('[rilevazione-orari] load error', err)
        } finally {
            setLoading(false)
        }
    }, [view, periodRange.start, periodRange.days])

    useEffect(() => { load() }, [load])

    const myRow = dailyRows.find(r => r.operatore.id === me?.id) || null
    const myStato: DayRow['stato'] = myRow?.stato || 'fuori'

    function downloadCsv() {
        if (view === 'giornaliera') {
            const headers = ['Operatore', 'Ruolo', 'Stato', 'Entrata', 'Uscita Pausa', 'Rientro Pausa', 'Uscita', 'Pause #', 'Ore Lavorate', 'Pausa Tot']
            const rows = dailyRows.map(r => [
                `${r.operatore.nome} ${r.operatore.cognome || ''}`.trim(),
                r.operatore.ruolo || '',
                r.stato,
                fmtTime(r.entrata),
                fmtTime(r.pausa_inizi[0] || null),
                fmtTime(r.pausa_fini[0] || null),
                fmtTime(r.uscita),
                String(r.pausa_inizi.length),
                fmtMin(r.minuti_lavorati),
                fmtMin(r.minuti_pausa),
            ])
            exportCsv(`orari_${periodRange.start}.csv`, headers, rows)
        } else {
            const headers = ['Operatore', 'Ruolo', 'Target/giorno', ...periodRange.days, 'Totale ore', 'Saldo']
            const rows = periodRows.map(r => {
                const total = Array.from(r.daysData.values()).reduce((s, n) => s + n, 0)
                const targetTotal = Math.round(r.operatore.ore_target_giornaliere * 60) * periodRange.days.length
                const saldo = total - targetTotal
                return [
                    `${r.operatore.nome} ${r.operatore.cognome || ''}`.trim(),
                    r.operatore.ruolo || '',
                    String(r.operatore.ore_target_giornaliere),
                    ...periodRange.days.map(d => fmtMin(r.daysData.get(d) || 0)),
                    fmtMin(total),
                    (saldo >= 0 ? '+' : '-') + fmtMin(Math.abs(saldo)),
                ]
            })
            exportCsv(`orari_${view}_${periodRange.start}_${periodRange.end}.csv`, headers, rows)
        }
    }

    function shiftRef(delta: number) {
        const d = new Date(refDate)
        if (view === 'giornaliera') d.setDate(d.getDate() + delta)
        else if (view === 'settimanale') d.setDate(d.getDate() + 7 * delta)
        else d.setMonth(d.getMonth() + delta)
        setRefDate(d)
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-semibold text-theme-text-primary">Rilevazione Orari</h2>
                    <p className="text-xs text-theme-text-muted">Vedi solo i tuoi orari. Nessun altro può vedere il tuo report.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setShowAddOp(true)}>+ Operatore</Button>
                    <Button variant="secondary" onClick={downloadCsv}>Scarica CSV</Button>
                </div>
            </div>

            {/* Self profile card — theme-aware (bg-theme-bg-secondary) per
                seguire il tema globale; accento DR7-gold sul bordo per
                mantenere la "tua riga" riconoscibile in dark e light. */}
            {me ? (
                <div
                    onClick={() => setEditMyDay(true)}
                    className="bg-theme-bg-secondary rounded-xl border border-dr7-gold/40 p-5 cursor-pointer hover:shadow-md transition"
                    title="Clicca per inserire i tuoi orari"
                >
                    <div className="flex items-center gap-4">
                        <div className="flex-shrink-0 w-14 h-14 rounded-full bg-dr7-gold text-black flex items-center justify-center text-xl font-bold">
                            {(me.nome[0] || '?').toUpperCase()}{(me.cognome?.[0] || '').toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-theme-text-secondary">I tuoi orari di oggi — clicca per inserire/modificare</p>
                            <p className="text-xl font-bold text-theme-text-primary">{me.nome} {me.cognome || ''}</p>
                            <div className="flex flex-wrap gap-3 mt-1 text-xs text-theme-text-muted">
                                <span>Entrata: <strong className="font-mono text-theme-text-primary">{fmtTime(myRow?.entrata || null)}</strong></span>
                                <span>Pause: <strong className="text-theme-text-primary">{myRow?.pausa_inizi.length || 0}</strong></span>
                                <span>Uscita: <strong className="font-mono text-theme-text-primary">{fmtTime(myRow?.uscita || null)}</strong></span>
                                <span>Ore: <strong className="text-theme-text-primary">{fmtMin(myRow?.minuti_lavorati || 0)}</strong></span>
                            </div>
                        </div>
                        <div className="text-right flex flex-col items-end gap-2">
                            <StatoLabel s={myStato} large />
                            <span className="text-xs text-dr7-gold underline">Inserisci orari →</span>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="bg-theme-bg-secondary rounded-lg border border-theme-border p-4 text-center">
                    <p className="text-sm text-theme-text-muted">Il tuo account non è collegato a nessun operatore. Crea il tuo profilo con "+ Operatore" usando la stessa email del login.</p>
                </div>
            )}

            {/* View toggle + period nav */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-theme-bg-secondary p-3 rounded border border-theme-border">
                <div className="flex gap-1 bg-theme-bg-tertiary rounded p-1">
                    {(['giornaliera', 'settimanale', 'mensile'] as ViewMode[]).map(v => (
                        <button key={v} onClick={() => setView(v)}
                            className={`text-sm px-3 py-1 rounded ${view === v ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:text-theme-text-primary'}`}>
                            {v[0].toUpperCase() + v.slice(1)}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => shiftRef(-1)} className="px-3 py-1 rounded bg-theme-bg-tertiary text-theme-text-primary">←</button>
                    <span className="text-sm text-theme-text-primary font-semibold min-w-[180px] text-center">
                        {view === 'giornaliera' && new Date(periodRange.start).toLocaleDateString('it-IT', { timeZone: ROME_TZ, weekday: 'long', day: 'numeric', month: 'long' })}
                        {view === 'settimanale' && `${periodRange.start} → ${periodRange.end}`}
                        {view === 'mensile' && new Date(periodRange.start).toLocaleDateString('it-IT', { timeZone: ROME_TZ, month: 'long', year: 'numeric' })}
                    </span>
                    <button onClick={() => shiftRef(+1)} className="px-3 py-1 rounded bg-theme-bg-tertiary text-theme-text-primary">→</button>
                    <button onClick={() => setRefDate(new Date())} className="text-xs px-3 py-1 rounded bg-theme-bg-tertiary text-theme-text-secondary">Oggi</button>
                </div>
            </div>

            {loading && <p className="text-theme-text-muted text-sm">Caricamento…</p>}

            {!loading && view === 'giornaliera' && (() => {
                const presentiCount = dailyRows.filter(r => r.stato !== 'fuori').length
                const assentiCount = dailyRows.filter(r => r.stato === 'fuori').length
                const totMinLavorati = dailyRows.reduce((s, r) => s + r.minuti_lavorati, 0)
                const totMinPausa = dailyRows.reduce((s, r) => s + r.minuti_pausa, 0)
                const totStraordinari = dailyRows.reduce((s, r) => {
                    const target = Math.round((r.operatore.ore_target_giornaliere || 8) * 60)
                    return s + Math.max(0, r.minuti_lavorati - target)
                }, 0)
                return <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
                    <KpiCard label="Presenti" value={String(presentiCount)} tone="emerald" />
                    <KpiCard label="Assenti" value={String(assentiCount)} tone="muted" />
                    <KpiCard label="Ore Lavorate Oggi" value={fmtMin(totMinLavorati)} sub={fmtMinShort(totMinLavorati)} tone="primary" />
                    <KpiCard label="Pausa Totale" value={fmtMin(totMinPausa)} sub={fmtMinShort(totMinPausa)} tone="amber" />
                    <KpiCard label="Straordinari" value={fmtMin(totStraordinari)} sub={fmtMinShort(totStraordinari)} tone={totStraordinari > 0 ? 'sky' : 'muted'} />
                </div>
                {/* Mobile card list */}
                <div className="sm:hidden space-y-2">
                    {dailyRows.length === 0 && (
                        <p className="text-center py-6 text-theme-text-muted text-xs">Nessun operatore attivo.</p>
                    )}
                    {dailyRows.map(r => {
                        const isMine = r.operatore.id === me?.id
                        const target = Math.round((r.operatore.ore_target_giornaliere || 8) * 60)
                        const straord = Math.max(0, r.minuti_lavorati - target)
                        return (
                            <button
                                key={r.operatore.id}
                                type="button"
                                onClick={() => setProfileOp(r.operatore)}
                                className={`w-full text-left rounded-xl border border-theme-border bg-theme-bg-secondary p-3 active:scale-[0.99] transition-transform ${isMine ? 'ring-1 ring-dr7-gold/50' : ''}`}
                            >
                                <div className="flex items-center gap-3">
                                    <OperatoreAvatar op={r.operatore} size={40} />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-semibold text-theme-text-primary truncate">
                                                {r.operatore.nome} {r.operatore.cognome || ''}
                                            </span>
                                            {isMine && <span className="text-[9px] px-1.5 py-0.5 rounded bg-dr7-gold text-black">tu</span>}
                                        </div>
                                        <div className="text-[11px] text-theme-text-muted truncate">{r.operatore.ruolo || '—'}</div>
                                    </div>
                                    <StatoLabel s={r.stato} />
                                </div>
                                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                                    <div>
                                        <div className="text-[9px] uppercase text-theme-text-muted">Entrata</div>
                                        <div className="font-mono text-theme-text-primary">{fmtTime(r.entrata)}</div>
                                    </div>
                                    <div>
                                        <div className="text-[9px] uppercase text-theme-text-muted">Uscita</div>
                                        <div className="font-mono text-theme-text-primary">{fmtTime(r.uscita)}</div>
                                    </div>
                                    <div>
                                        <div className="text-[9px] uppercase text-theme-text-muted">Pause</div>
                                        <div className="font-mono text-theme-text-primary">{r.pausa_inizi.length}</div>
                                    </div>
                                </div>
                                <div className="mt-3 flex items-center justify-between rounded-lg bg-theme-bg-primary/40 px-3 py-2">
                                    <div>
                                        <div className="text-[9px] uppercase text-theme-text-muted">Ore Lav.</div>
                                        <div className="text-base font-bold text-emerald-400 tabular-nums">{fmtMin(r.minuti_lavorati)}</div>
                                    </div>
                                    {straord > 0 && (
                                        <div className="text-right">
                                            <div className="text-[9px] uppercase text-theme-text-muted">Straord.</div>
                                            <div className="text-sm font-semibold text-sky-400 tabular-nums">{fmtMin(straord)}</div>
                                        </div>
                                    )}
                                    <span className="text-[10px] px-2 py-1 rounded-full bg-dr7-gold text-black font-semibold">
                                        Vedi report →
                                    </span>
                                </div>
                            </button>
                        )
                    })}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block bg-theme-bg-secondary rounded border border-theme-border overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-theme-bg-tertiary text-theme-text-secondary">
                            <tr>
                                <th className="text-left px-3 py-2">Operatore</th>
                                <th className="text-left px-3 py-2">Stato</th>
                                <th className="text-left px-3 py-2">Entrata</th>
                                <th className="text-left px-3 py-2">Pausa Out</th>
                                <th className="text-left px-3 py-2">Pausa In</th>
                                <th className="text-left px-3 py-2">Uscita</th>
                                <th className="text-center px-3 py-2">Pause</th>
                                <th className="text-right px-3 py-2">Ore Lav.</th>
                                <th className="text-right px-3 py-2">Pausa</th>
                                <th className="text-right px-3 py-2">Straord.</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-border">
                            {dailyRows.length === 0 && (
                                <tr><td colSpan={10} className="text-center py-6 text-theme-text-muted">Nessun operatore attivo.</td></tr>
                            )}
                            {dailyRows.map(r => {
                                const isMine = r.operatore.id === me?.id
                                const target = Math.round((r.operatore.ore_target_giornaliere || 8) * 60)
                                const straord = Math.max(0, r.minuti_lavorati - target)
                                const deficit = Math.max(0, target - r.minuti_lavorati)
                                const isExpanded = expandedId === r.operatore.id
                                // Build the full set of pause windows (start, end, duration).
                                // We pair pausa_inizi[i] with pausa_fini[i]; an unmatched
                                // start (operator currently on break) gets end=null.
                                const pauseWindows = r.pausa_inizi.map((start, i) => {
                                    const end = r.pausa_fini[i] || null
                                    let durMin = 0
                                    if (end) durMin = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000))
                                    else if (r.stato === 'pausa') durMin = Math.max(0, Math.round((Date.now() - new Date(start).getTime()) / 60000))
                                    return { start, end, durMin, idx: i + 1 }
                                })
                                return (
                                    <React.Fragment key={r.operatore.id}>
                                    <tr className={`${isMine ? 'bg-dr7-gold/10' : ''} ${isExpanded ? 'bg-theme-bg-tertiary/40' : ''} cursor-pointer hover:bg-theme-bg-tertiary/30`}
                                        onClick={() => setProfileOp(r.operatore)}
                                        title="Apri il report completo dell'operatore (come lo vede lui)">
                                        <td className="px-3 py-2 text-theme-text-primary font-semibold">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : r.operatore.id) }}
                                                    className={`inline-block transition-transform ${isExpanded ? 'rotate-90' : ''} text-theme-text-muted hover:text-theme-text-primary text-xs`}
                                                    title={isExpanded ? 'Chiudi dettaglio inline' : 'Apri dettaglio inline'}
                                                >▶</button>
                                                <OperatoreAvatar op={r.operatore} size={32} />
                                                <div>
                                                    {r.operatore.nome} {r.operatore.cognome || ''}
                                                    {isMine && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-dr7-gold text-black">tu</span>}
                                                    <div className="text-xs text-theme-text-muted">{r.operatore.ruolo || '—'}</div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); setProfileOp(r.operatore) }}
                                                    className="ml-auto text-[11px] px-2 py-1 rounded bg-dr7-gold text-black hover:opacity-90 font-semibold whitespace-nowrap"
                                                    title={`Apri il report di ${r.operatore.nome} con grafico e KPI`}
                                                >Vedi report</button>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2"><StatoLabel s={r.stato} /></td>
                                        <td className="px-3 py-2 font-mono text-xs">{fmtTime(r.entrata)}</td>
                                        <td className="px-3 py-2 font-mono text-xs">{fmtTime(r.pausa_inizi[0] || null)}</td>
                                        <td className="px-3 py-2 font-mono text-xs">{fmtTime(r.pausa_fini[0] || null)}</td>
                                        <td className="px-3 py-2 font-mono text-xs">{fmtTime(r.uscita)}</td>
                                        <td className="px-3 py-2 text-center text-xs">{r.pausa_inizi.length}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            <div className="font-semibold">{fmtMin(r.minuti_lavorati)}</div>
                                            <div className="text-[10px] text-theme-text-muted">{r.minuti_lavorati} min</div>
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            <div className="text-theme-text-muted text-xs">{fmtMin(r.minuti_pausa)}</div>
                                            <div className="text-[10px] text-theme-text-muted">{r.minuti_pausa} min</div>
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            <div className={straord > 0 ? 'text-sky-500 font-semibold' : 'text-theme-text-muted text-xs'}>{fmtMin(straord)}</div>
                                            {straord > 0 && <div className="text-[10px] text-theme-text-muted">{straord} min</div>}
                                        </td>
                                    </tr>
                                    {isExpanded && (
                                        <tr className="bg-theme-bg-tertiary/20 border-b-2 border-dr7-gold/30">
                                            <td colSpan={10} className="px-4 py-4">
                                                <DailyOperatorDetail
                                                    row={r}
                                                    pauseWindows={pauseWindows}
                                                    target={target}
                                                    straord={straord}
                                                    deficit={deficit}
                                                    onOpenProfile={() => setProfileOp(r.operatore)}
                                                />
                                            </td>
                                        </tr>
                                    )}
                                    </React.Fragment>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                </>
            })()}

            {!loading && view !== 'giornaliera' && (() => {
                const totMin = periodRows.reduce((s, r) => s + Array.from(r.daysData.values()).reduce((a, b) => a + b, 0), 0)
                const targetMin = periodRows.reduce((s, r) => s + Math.round((r.operatore.ore_target_giornaliere || 8) * 60) * periodRange.days.length, 0)
                const saldoMin = totMin - targetMin
                const giornateAttive = periodRows.reduce((s, r) => s + Array.from(r.daysData.values()).filter(v => v > 0).length, 0)
                // Trend: minuti totali per giorno (sommati su tutti gli operatori visibili)
                const trendData = periodRange.days.map(d => ({
                    day: d,
                    minutes: periodRows.reduce((s, r) => s + (r.daysData.get(d) || 0), 0),
                }))
                // Top operatori per ore lavorate (utile solo per direzione: Ophe vede una sola riga)
                const topData = [...periodRows]
                    .map(r => ({
                        nome: `${r.operatore.nome} ${r.operatore.cognome || ''}`.trim(),
                        minutes: Array.from(r.daysData.values()).reduce((a, b) => a + b, 0),
                    }))
                    .filter(x => x.minutes > 0)
                    .sort((a, b) => b.minutes - a.minutes)
                    .slice(0, 5)
                // Distribuzione per ruolo
                const ruoloMap = new Map<string, number>()
                for (const r of periodRows) {
                    const min = Array.from(r.daysData.values()).reduce((a, b) => a + b, 0)
                    if (min === 0) continue
                    const k = (r.operatore.ruolo || '—').trim() || '—'
                    ruoloMap.set(k, (ruoloMap.get(k) || 0) + min)
                }
                const ruoloData = Array.from(ruoloMap.entries()).map(([nome, minutes]) => ({ nome, minutes }))
                const showTeamCharts = periodRows.length > 1
                return <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    <KpiCard label="Ore Totali" value={fmtMin(totMin)} sub={fmtMinShort(totMin)} tone="primary" />
                    <KpiCard label="Target Periodo" value={fmtMin(targetMin)} sub={fmtMinShort(targetMin)} tone="muted" />
                    <KpiCard label="Saldo" value={(saldoMin >= 0 ? '+' : '-') + fmtMin(Math.abs(saldoMin))} sub={fmtMinShort(Math.abs(saldoMin))} tone={saldoMin >= 0 ? 'emerald' : 'amber'} />
                    <KpiCard label="Giornate Attive" value={String(giornateAttive)} tone="sky" />
                </div>

                <div className={`grid grid-cols-1 ${showTeamCharts ? 'lg:grid-cols-2' : ''} gap-3 mb-3`}>
                    <ChartCard title="Andamento ore" subtitle="Ore lavorate per giorno nel periodo">
                        <TrendLineChart data={trendData} />
                    </ChartCard>
                    {showTeamCharts && (
                        <ChartCard title="Top operatori" subtitle="Per ore lavorate nel periodo">
                            <TopBarsChart data={topData} />
                        </ChartCard>
                    )}
                </div>

                {showTeamCharts && ruoloData.length > 1 && (
                    <div className="mb-3">
                        <ChartCard title="Distribuzione per ruolo" subtitle="Ore lavorate raggruppate per ruolo">
                            <DonutChart data={ruoloData} />
                        </ChartCard>
                    </div>
                )}
                <div className="bg-theme-bg-secondary rounded border border-theme-border overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-theme-bg-tertiary text-theme-text-secondary">
                            <tr>
                                <th className="text-left px-3 py-2 sticky left-0 bg-theme-bg-tertiary">Operatore</th>
                                {periodRange.days.map(d => (
                                    <th key={d} className="text-center px-2 py-2 text-xs">
                                        {new Date(d).toLocaleDateString('it-IT', { timeZone: ROME_TZ, day: '2-digit', month: '2-digit' })}
                                    </th>
                                ))}
                                <th className="text-right px-3 py-2">Tot</th>
                                <th className="text-right px-3 py-2">Saldo</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-theme-border">
                            {periodRows.map(r => {
                                const total = Array.from(r.daysData.values()).reduce((s, n) => s + n, 0)
                                const targetTotal = Math.round(r.operatore.ore_target_giornaliere * 60) * periodRange.days.length
                                const saldo = total - targetTotal
                                const isMine = r.operatore.id === me?.id
                                return (
                                    <tr key={r.operatore.id} className={isMine ? 'bg-dr7-gold/10' : ''}>
                                        <td className="px-3 py-2 text-theme-text-primary font-semibold sticky left-0 bg-theme-bg-secondary">
                                            {r.operatore.nome} {r.operatore.cognome || ''}
                                            {isMine && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-dr7-gold text-black">tu</span>}
                                        </td>
                                        {periodRange.days.map(d => (
                                            <td key={d} className="px-2 py-2 text-center font-mono text-xs">
                                                {fmtMin(r.daysData.get(d) || 0)}
                                            </td>
                                        ))}
                                        <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtMin(total)}</td>
                                        <td className={`px-3 py-2 text-right font-bold tabular-nums ${saldo >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {(saldo >= 0 ? '+' : '-')}{fmtMin(Math.abs(saldo))}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                </>
            })()}

            {showAddOp && (
                <AddOperatoreModal onClose={() => setShowAddOp(false)} onSaved={() => { setShowAddOp(false); load(); toast.success('Operatore aggiunto') }} />
            )}
            {profileOp && (
                <OperatorProfileModal operatore={profileOp} onClose={() => setProfileOp(null)} />
            )}

            {editMyDay && me && (
                <MyDayEditorModal
                    operatore={me}
                    data={toRomeDate(refDate)}
                    onClose={() => setEditMyDay(false)}
                    onSaved={() => { setEditMyDay(false); load(); toast.success('Orari aggiornati') }}
                />
            )}
        </div>
    )
}

/**
 * DailyOperatorDetail — full breakdown of an operator's day.
 *
 * Renders inside the expanded row. Shows:
 *   - Operator profile: nome, ruolo, email, target ore/giorno
 *   - Visual timeline: a horizontal bar from 00:00 to 23:59 with the
 *     work segments (entrata→pausa1, pausa1→pausa2, …, ultima→uscita)
 *     and the pause segments overlaid in orange. Hover = exact times.
 *   - All pause windows listed: #N · 13:00 → 13:30 · 30 min
 *   - Performance KPIs: Lavorate, Pausa Tot, Straordinari, Deficit,
 *     Target, % Compimento.
 *
 * For "see EVERYTHING" admin view: nothing is hidden — entrata,
 * uscita, every pause start/end, durations to the minute.
 */
function DailyOperatorDetail({
    row,
    pauseWindows,
    target,
    straord,
    deficit,
    onOpenProfile,
}: {
    row: DayRow
    pauseWindows: { start: string; end: string | null; durMin: number; idx: number }[]
    target: number
    straord: number
    deficit: number
    onOpenProfile?: () => void
}) {
    const op = row.operatore
    const fmtFull = (iso: string | null) => {
        if (!iso) return '—'
        return new Date(iso).toLocaleTimeString('it-IT', {
            timeZone: ROME_TZ,
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        })
    }

    // Day-bar positions in % (0-100) from 00:00 → 24:00.
    const minOfDay = (iso: string | null): number | null => {
        if (!iso) return null
        const d = new Date(iso)
        if (isNaN(d.getTime())) return null
        // Convert to Rome local time.
        const rome = new Date(d.toLocaleString('en-US', { timeZone: ROME_TZ }))
        return rome.getHours() * 60 + rome.getMinutes()
    }
    const TOTAL_MIN = 24 * 60
    const entrataMin = minOfDay(row.entrata)
    // Per operatori ancora in lavoro/pausa il bar si ferma a "adesso"
    // (non a mezzanotte): cosi' la timeline rappresenta veramente le
    // ore lavorate al momento dello sguardo.
    const nowMinRome = (() => {
        const rome = new Date(new Date().toLocaleString('en-US', { timeZone: ROME_TZ }))
        return rome.getHours() * 60 + rome.getMinutes()
    })()
    const uscitaMin = minOfDay(row.uscita)
        ?? (row.stato === 'fuori' ? null : nowMinRome)
    const pct = (m: number | null) => m === null ? 0 : (m / TOTAL_MIN) * 100

    const completionPct = target > 0 ? Math.min(100, Math.round((row.minuti_lavorati / target) * 100)) : 0

    return (
        <div className="space-y-4">
            {/* Profile header with avatar + change-photo button */}
            <div className="flex items-start gap-4">
                <div className="relative flex-shrink-0">
                    <OperatoreAvatar op={op} size={72} />
                    <label className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-dr7-gold text-black flex items-center justify-center cursor-pointer hover:opacity-90 shadow-md" title="Cambia foto">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} strokeLinecap="round" d="M3 9a2 2 0 012-2h2.5L9 5h6l1.5 2H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><circle cx="12" cy="13" r="3" strokeWidth={2}/></svg>
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            className="hidden"
                            onChange={async (e) => {
                                const file = e.target.files?.[0]
                                if (!file) return
                                const url = await uploadOperatoreAvatar(op.id, file)
                                if (url) {
                                    // Trigger a hard refresh of the table.
                                    window.location.reload()
                                }
                                e.target.value = ''
                            }}
                        />
                    </label>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs flex-1">
                    <div>
                        <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Operatore</div>
                        <div className="text-sm font-semibold text-theme-text-primary">{op.nome} {op.cognome || ''}</div>
                    </div>
                    <div>
                        <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Ruolo</div>
                        <div className="text-sm text-theme-text-primary">{op.ruolo || '—'}</div>
                    </div>
                    <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Email</div>
                        <div className="text-sm text-theme-text-primary truncate" title={op.email}>{op.email || '—'}</div>
                    </div>
                    <div>
                        <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Target ore</div>
                        <div className="text-sm text-theme-text-primary">{op.ore_target_giornaliere}h / giorno</div>
                    </div>
                </div>
                {onOpenProfile && (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpenProfile() }}
                        className="text-xs px-3 py-1.5 rounded-full bg-dr7-gold text-black font-semibold hover:opacity-90 whitespace-nowrap"
                    >
                        Profilo completo
                    </button>
                )}
            </div>

            {/* Timeline 00–24 */}
            {entrataMin !== null && uscitaMin !== null && (
                <div>
                    <div className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">Timeline (00:00 → 24:00, ora di Roma)</div>
                    <div className="relative h-8 bg-theme-bg-tertiary rounded overflow-hidden border border-theme-border">
                        {/* Work segment (entrata → uscita) */}
                        <div
                            className="absolute h-full bg-emerald-500/40 border-l border-r border-emerald-500"
                            style={{ left: `${pct(entrataMin)}%`, width: `${Math.max(0, pct(uscitaMin) - pct(entrataMin))}%` }}
                            title={`Lavoro: ${fmtTime(row.entrata)} → ${fmtTime(row.uscita)}`}
                        />
                        {/* Pause segments overlaid in orange */}
                        {pauseWindows.map((p) => {
                            const ps = minOfDay(p.start)
                            const pe = p.end ? minOfDay(p.end) : ps
                            if (ps === null || pe === null) return null
                            return (
                                <div
                                    key={p.idx}
                                    className="absolute h-full bg-amber-500/70 border-l border-r border-amber-600"
                                    style={{ left: `${pct(ps)}%`, width: `${Math.max(0.5, pct(pe) - pct(ps))}%` }}
                                    title={`Pausa #${p.idx}: ${fmtTime(p.start)} → ${p.end ? fmtTime(p.end) : 'in corso'} (${p.durMin} min)`}
                                />
                            )
                        })}
                        {/* Hour ticks */}
                        {Array.from({ length: 13 }).map((_, i) => (
                            <div key={i} className="absolute top-0 bottom-0 border-l border-theme-border/40" style={{ left: `${(i * 2 / 24) * 100}%` }}>
                                <span className="absolute top-full mt-0.5 -translate-x-1/2 text-[9px] text-theme-text-muted">{i * 2}h</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-theme-text-muted mt-4">
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-emerald-500/70" />Lavoro</span>
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-amber-500/70" />Pausa</span>
                    </div>
                </div>
            )}

            {/* All pause windows */}
            <div>
                <div className="text-[10px] uppercase tracking-wider text-theme-text-muted mb-2">
                    Pause della giornata ({pauseWindows.length})
                </div>
                {pauseWindows.length === 0 ? (
                    <p className="text-xs text-theme-text-muted italic">Nessuna pausa registrata oggi.</p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {pauseWindows.map((p) => (
                            <div key={p.idx} className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] uppercase tracking-wider text-amber-400">Pausa #{p.idx}</span>
                                    <span className="text-xs font-semibold text-theme-text-primary tabular-nums">{p.durMin} min</span>
                                </div>
                                <div className="font-mono text-xs text-theme-text-secondary">
                                    {fmtFull(p.start)} → {p.end ? fmtFull(p.end) : <span className="text-amber-400">in corso</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* KPI grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Entrata</div>
                    <div className="font-mono text-sm text-theme-text-primary">{fmtFull(row.entrata)}</div>
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Uscita</div>
                    <div className="font-mono text-sm text-theme-text-primary">{fmtFull(row.uscita)}</div>
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Lavorate</div>
                    <div className="font-semibold text-emerald-400">{fmtMin(row.minuti_lavorati)}</div>
                    <div className="text-[10px] text-theme-text-muted">{row.minuti_lavorati} min</div>
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Pausa Tot</div>
                    <div className="font-semibold text-amber-400">{fmtMin(row.minuti_pausa)}</div>
                    <div className="text-[10px] text-theme-text-muted">{row.minuti_pausa} min</div>
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Straordinari</div>
                    <div className={`font-semibold ${straord > 0 ? 'text-sky-400' : 'text-theme-text-muted'}`}>{fmtMin(straord)}</div>
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Deficit</div>
                    <div className={`font-semibold ${deficit > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{deficit > 0 ? fmtMin(deficit) : '—'}</div>
                </div>
            </div>

            {/* Completion bar */}
            <div>
                <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-theme-text-muted mb-1">
                    <span>Completamento target</span>
                    <span className="tabular-nums text-theme-text-primary">{completionPct}% di {fmtMin(target)}</span>
                </div>
                <div className="h-2 bg-theme-bg-tertiary rounded-full overflow-hidden">
                    <div className={`h-full transition-all ${completionPct >= 100 ? 'bg-emerald-500' : completionPct >= 75 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${completionPct}%` }} />
                </div>
            </div>
        </div>
    )
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

function TrendLineChart({ data }: { data: { day: string; minutes: number }[] }) {
    if (data.length === 0) return <div className="text-theme-text-muted text-sm py-6 text-center">Nessun dato.</div>
    const max = Math.max(...data.map(d => d.minutes), 60)
    const W = 600
    const H = 160
    const PAD = 28
    const stepX = (W - PAD * 2) / Math.max(1, data.length - 1)
    const points = data.map((d, i) => {
        const x = PAD + i * stepX
        const y = H - PAD - ((d.minutes / max) * (H - PAD * 2))
        return { x, y, day: d.day, min: d.minutes }
    })
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
    const areaPath = `${path} L ${points[points.length - 1].x} ${H - PAD} L ${points[0].x} ${H - PAD} Z`
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44" role="img" aria-label="Andamento ore">
            <defs>
                <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#19C2D6" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#19C2D6" stopOpacity="0" />
                </linearGradient>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
                const y = H - PAD - t * (H - PAD * 2)
                return <line key={i} x1={PAD} x2={W - PAD} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.08" strokeDasharray="2 3" />
            })}
            <path d={areaPath} fill="url(#trendGrad)" />
            <path d={path} fill="none" stroke="#19C2D6" strokeWidth="2" />
            {points.map((p, i) => (
                <g key={i}>
                    <circle cx={p.x} cy={p.y} r={3} fill="#19C2D6" />
                    <title>{`${p.day}: ${fmtMin(p.min)} (${p.min} min)`}</title>
                </g>
            ))}
            {points.map((p, i) => i % Math.ceil(points.length / 8) === 0 ? (
                <text key={`l-${i}`} x={p.x} y={H - 8} fontSize="9" textAnchor="middle" fill="currentColor" fillOpacity="0.5">
                    {p.day.slice(5)}
                </text>
            ) : null)}
            <text x={PAD - 4} y={PAD} fontSize="9" textAnchor="end" fill="currentColor" fillOpacity="0.5">{fmtMin(max)}</text>
            <text x={PAD - 4} y={H - PAD + 3} fontSize="9" textAnchor="end" fill="currentColor" fillOpacity="0.5">0</text>
        </svg>
    )
}

function TopBarsChart({ data }: { data: { nome: string; minutes: number }[] }) {
    if (data.length === 0) return <div className="text-theme-text-muted text-sm py-6 text-center">Nessun dato.</div>
    const max = Math.max(...data.map(d => d.minutes), 1)
    return (
        <div className="space-y-2">
            {data.map(d => {
                const pct = (d.minutes / max) * 100
                return (
                    <div key={d.nome}>
                        <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-theme-text-secondary truncate pr-2">{d.nome}</span>
                            <span className="text-theme-text-muted whitespace-nowrap">{fmtMin(d.minutes)} <span className="opacity-60">· {d.minutes} min</span></span>
                        </div>
                        <div className="h-2 bg-theme-bg-tertiary rounded-full overflow-hidden">
                            <div className="h-full bg-dr7-gold transition-all" style={{ width: `${pct}%` }} />
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

function DonutChart({ data }: { data: { nome: string; minutes: number }[] }) {
    const total = data.reduce((s, d) => s + d.minutes, 0)
    if (total === 0) return <div className="text-theme-text-muted text-sm py-6 text-center">Nessun dato.</div>
    const PALETTE = ['#19C2D6', '#F59E0B', '#10B981', '#8B5CF6', '#EF4444', '#3B82F6', '#EC4899', '#06B6D4']
    const R_OUTER = 70, R_INNER = 42, CX = 90, CY = 90
    let startAngle = -Math.PI / 2
    const arcs = data.map((d, i) => {
        const angle = (d.minutes / total) * Math.PI * 2
        const endAngle = startAngle + angle
        const x1 = CX + R_OUTER * Math.cos(startAngle), y1 = CY + R_OUTER * Math.sin(startAngle)
        const x2 = CX + R_OUTER * Math.cos(endAngle), y2 = CY + R_OUTER * Math.sin(endAngle)
        const x3 = CX + R_INNER * Math.cos(endAngle), y3 = CY + R_INNER * Math.sin(endAngle)
        const x4 = CX + R_INNER * Math.cos(startAngle), y4 = CY + R_INNER * Math.sin(startAngle)
        const large = angle > Math.PI ? 1 : 0
        const path = `M ${x1} ${y1} A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${R_INNER} ${R_INNER} 0 ${large} 0 ${x4} ${y4} Z`
        const arc = { path, color: PALETTE[i % PALETTE.length], nome: d.nome, minutes: d.minutes, pct: (d.minutes / total) * 100 }
        startAngle = endAngle
        return arc
    })
    return (
        <div className="flex items-center gap-4">
            <svg viewBox="0 0 180 180" className="w-40 h-40 flex-shrink-0">
                {arcs.map((a, i) => (
                    <path key={i} d={a.path} fill={a.color}>
                        <title>{`${a.nome}: ${fmtMin(a.minutes)} (${a.pct.toFixed(0)}%)`}</title>
                    </path>
                ))}
                <text x={CX} y={CY - 4} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.6">Totale</text>
                <text x={CX} y={CY + 12} textAnchor="middle" fontSize="13" fontWeight="bold" fill="currentColor">{fmtMin(total)}</text>
            </svg>
            <div className="flex-1 space-y-1.5 text-xs">
                {arcs.map((a, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: a.color }} />
                        <span className="text-theme-text-secondary flex-1 truncate">{a.nome}</span>
                        <span className="text-theme-text-muted whitespace-nowrap">{fmtMin(a.minutes)} <span className="opacity-60">({a.pct.toFixed(0)}%)</span></span>
                    </div>
                ))}
            </div>
        </div>
    )
}

type KpiTone = 'emerald' | 'amber' | 'sky' | 'primary' | 'muted'
function KpiCard({ label, value, sub, tone = 'primary' }: { label: string; value: string; sub?: string; tone?: KpiTone }) {
    const ring = {
        emerald: 'border-emerald-300 dark:border-emerald-800',
        amber: 'border-amber-300 dark:border-amber-800',
        sky: 'border-sky-300 dark:border-sky-800',
        primary: 'border-theme-border',
        muted: 'border-theme-border',
    }[tone]
    const valueColor = {
        emerald: 'text-emerald-500',
        amber: 'text-amber-500',
        sky: 'text-sky-500',
        primary: 'text-theme-text-primary',
        muted: 'text-theme-text-muted',
    }[tone]
    return (
        <div className={`bg-theme-bg-secondary rounded-lg border ${ring} p-3 text-center`}>
            <div className="text-[10px] text-theme-text-muted uppercase tracking-wider">{label}</div>
            <div className={`text-base font-bold mt-1 ${valueColor}`}>{value}</div>
            {sub && <div className="text-[10px] text-theme-text-muted mt-0.5">{sub}</div>}
        </div>
    )
}

function StatoLabel({ s, large }: { s: DayRow['stato']; large?: boolean }) {
    const map = {
        fuori: { label: 'Fuori', cls: 'bg-theme-bg-tertiary text-theme-text-muted' },
        lavoro: { label: 'Lavoro', cls: 'bg-emerald-900 text-emerald-200' },
        pausa: { label: 'Pausa', cls: 'bg-amber-900 text-amber-200' },
        finito: { label: 'Uscito', cls: 'bg-blue-900 text-blue-200' },
    }
    const m = map[s]
    return <span className={`px-2 py-0.5 rounded ${large ? 'text-sm font-semibold' : 'text-xs'} ${m.cls}`}>{m.label}</span>
}

function AddOperatoreModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const [nome, setNome] = useState('')
    const [cognome, setCognome] = useState('')
    const [email, setEmail] = useState('')
    const [ruolo, setRuolo] = useState('')
    const [oreTarget, setOreTarget] = useState('8')
    const [linkSelf, setLinkSelf] = useState(true)
    const [saving, setSaving] = useState(false)
    // Local preview before upload: data: URL of the file the operator
    // picked. Uploaded to storage AFTER the row is inserted so the path
    // can include the operator id.
    const [avatarFile, setAvatarFile] = useState<File | null>(null)
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
    const [uploading, setUploading] = useState(false)

    function handleAvatarPick(file: File | null) {
        if (!file) {
            setAvatarFile(null)
            setAvatarPreview(null)
            return
        }
        if (!file.type.startsWith('image/')) {
            alert('Carica un\'immagine (jpg, png, webp).')
            return
        }
        if (file.size > 2 * 1024 * 1024) {
            alert('File troppo grande (max 2 MB).')
            return
        }
        setAvatarFile(file)
        const reader = new FileReader()
        reader.onload = () => setAvatarPreview(String(reader.result))
        reader.readAsDataURL(file)
    }

    async function handleSave() {
        if (!nome.trim() || !email.trim()) { alert('Nome e email obbligatori'); return }
        setSaving(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            const { data: inserted, error } = await supabase.from('operatori_persone').insert({
                nome: nome.trim(),
                cognome: cognome.trim() || null,
                email: email.trim().toLowerCase(),
                ruolo: ruolo.trim() || null,
                ore_target_giornaliere: parseFloat(oreTarget) || 8,
                user_id: linkSelf ? user?.id || null : null,
            }).select('id').single()
            if (error) throw error

            // Upload avatar (if any) AFTER row creation so we have the id
            // for a stable storage path: operatore-{id}-{timestamp}.{ext}.
            if (avatarFile && inserted?.id) {
                setUploading(true)
                const ext = avatarFile.name.split('.').pop()?.toLowerCase() || 'jpg'
                const path = `${inserted.id}/${Date.now()}.${ext}`
                const { error: upErr } = await supabase.storage
                    .from('operator-avatars')
                    .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type })
                if (upErr) {
                    console.error('[AddOperatoreModal] avatar upload failed:', upErr)
                    toast.error('Operatore creato, ma upload foto fallito: ' + upErr.message)
                } else {
                    const { data: pub } = supabase.storage.from('operator-avatars').getPublicUrl(path)
                    await supabase.from('operatori_persone').update({ avatar_url: pub.publicUrl }).eq('id', inserted.id)
                }
            }

            onSaved()
        } catch (err) {
            alert('Errore: ' + (err instanceof Error ? err.message : String(err)))
        } finally {
            setSaving(false)
            setUploading(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                <h3 className="text-xl font-semibold text-theme-text-primary mb-4">Nuovo Operatore</h3>

                {/* Avatar upload */}
                <div className="flex items-center gap-4 mb-4">
                    <div className="w-20 h-20 rounded-full bg-theme-bg-tertiary border-2 border-dashed border-theme-border flex items-center justify-center overflow-hidden">
                        {avatarPreview ? (
                            <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <span className="text-3xl text-theme-text-muted">+</span>
                        )}
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="px-3 py-1.5 rounded-full bg-dr7-gold text-black text-xs font-semibold cursor-pointer hover:opacity-90 inline-block w-fit">
                            {avatarFile ? 'Cambia foto' : 'Carica foto'}
                            <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                className="hidden"
                                onChange={e => handleAvatarPick(e.target.files?.[0] || null)}
                            />
                        </label>
                        {avatarFile && (
                            <button
                                type="button"
                                onClick={() => handleAvatarPick(null)}
                                className="text-[11px] text-theme-text-muted hover:text-rose-400"
                            >
                                Rimuovi
                            </button>
                        )}
                        <span className="text-[10px] text-theme-text-muted">jpg/png/webp · max 2 MB</span>
                    </div>
                </div>

                <div className="space-y-3">
                    <Field label="Nome *" value={nome} onChange={setNome} />
                    <Field label="Cognome" value={cognome} onChange={setCognome} />
                    <Field label="Email *" value={email} onChange={setEmail} type="email" />
                    <Field label="Ruolo" value={ruolo} onChange={setRuolo} placeholder="Es: Receptionist, Operativo" />
                    <Field label="Ore target/giorno" value={oreTarget} onChange={setOreTarget} type="number" />
                    <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                        <input type="checkbox" checked={linkSelf} onChange={e => setLinkSelf(e.target.checked)} />
                        Sono io (collega all'account login attualmente connesso)
                    </label>
                </div>
                <p className="text-xs text-theme-text-muted mt-3">
                    Se questo operatore è qualcun altro, lascia il flag spento. L'admin dovrà poi collegare l'user_id Supabase Auth (UPDATE operatori_persone SET user_id = ... WHERE email = ...).
                </p>
                <div className="flex justify-end gap-2 mt-4">
                    <Button variant="secondary" onClick={onClose}>Annulla</Button>
                    <Button onClick={handleSave} disabled={saving || uploading}>{uploading ? 'Upload…' : saving ? 'Salvataggio…' : 'Crea'}</Button>
                </div>
            </div>
        </div>
    )
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
    label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
    return (
        <label className="block">
            <span className="text-xs text-theme-text-secondary">{label}</span>
            <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
                className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-sm text-theme-text-primary" />
        </label>
    )
}

interface BreakSlot { id?: string; pausa_inizio?: string; pausa_fine?: string }

/**
 * Modal — l'utente connesso edita i propri orari del giorno.
 * Carica gli eventi esistenti, permette di modificare gli orari (HH:MM),
 * aggiungere/rimuovere pause, salvare.
 */
export function MyDayEditorModal({ operatore, data, onClose, onSaved }: {
    operatore: { id: string; nome: string; cognome: string | null }
    data: string  // YYYY-MM-DD
    onClose: () => void
    onSaved: () => void
}) {
    const [entrata, setEntrata] = useState('')
    const [uscita, setUscita] = useState('')
    const [pause, setPause] = useState<BreakSlot[]>([])
    const [note, setNote] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        ;(async () => {
            const { data: entries } = await supabase
                .from('timesheet_entries')
                .select('id, tipo, timestamp')
                .eq('operatore_id', operatore.id)
                .eq('data', data)
                .order('timestamp', { ascending: true })
            const list = (entries || []) as { id: string; tipo: string; timestamp: string }[]

            const isoToHHMM = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit' })

            const e = list.find(x => x.tipo === 'entrata')
            if (e) setEntrata(isoToHHMM(e.timestamp))
            const u = [...list].reverse().find(x => x.tipo === 'uscita')
            if (u) setUscita(isoToHHMM(u.timestamp))

            const pInizi = list.filter(x => x.tipo === 'pausa_inizio')
            const pFini = list.filter(x => x.tipo === 'pausa_fine')
            const slots: BreakSlot[] = []
            for (let i = 0; i < Math.max(pInizi.length, pFini.length); i++) {
                slots.push({
                    pausa_inizio: pInizi[i] ? isoToHHMM(pInizi[i].timestamp) : '',
                    pausa_fine: pFini[i] ? isoToHHMM(pFini[i].timestamp) : '',
                })
            }
            if (slots.length === 0) slots.push({ pausa_inizio: '', pausa_fine: '' })
            setPause(slots)

            // Day note
            const { data: noteRow } = await supabase
                .from('timesheet_day_notes')
                .select('nota')
                .eq('operatore_id', operatore.id)
                .eq('data', data)
                .maybeSingle()
            if (noteRow?.nota) setNote(noteRow.nota)

            setLoading(false)
        })()
    }, [operatore.id, data])

    function hhmmToISO(hhmm: string, dateStr: string): string | null {
        if (!/^\d{2}:\d{2}$/.test(hhmm)) return null
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
        const [h, m] = hhmm.split(':').map(Number)
        const [year, month, day] = dateStr.split('-').map(Number)
        const utcGuess = new Date(Date.UTC(year, month - 1, day, h, m, 0))
        const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: ROME_TZ,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
        })
        const parts = Object.fromEntries(fmt.formatToParts(utcGuess).map(p => [p.type, p.value]))
        const romeHour = parts.hour === '24' ? 0 : parseInt(parts.hour, 10)
        const romeAsUTC = Date.UTC(
            parseInt(parts.year, 10),
            parseInt(parts.month, 10) - 1,
            parseInt(parts.day, 10),
            romeHour,
            parseInt(parts.minute, 10),
            parseInt(parts.second, 10),
        )
        const offsetMs = romeAsUTC - utcGuess.getTime()
        return new Date(utcGuess.getTime() - offsetMs).toISOString()
    }

    async function handleSave() {
        setSaving(true)
        try {
            // Cancello tutto e re-inserisco — semplice e atomico per l'utente.
            const { error: delErr } = await supabase
                .from('timesheet_entries')
                .delete()
                .eq('operatore_id', operatore.id)
                .eq('data', data)
            if (delErr) throw delErr

            const inserts: { operatore_id: string; tipo: string; timestamp: string }[] = []
            if (entrata) {
                const ts = hhmmToISO(entrata, data)
                if (ts) inserts.push({ operatore_id: operatore.id, tipo: 'entrata', timestamp: ts })
            }
            for (const p of pause) {
                if (p.pausa_inizio) {
                    const ts = hhmmToISO(p.pausa_inizio, data)
                    if (ts) inserts.push({ operatore_id: operatore.id, tipo: 'pausa_inizio', timestamp: ts })
                }
                if (p.pausa_fine) {
                    const ts = hhmmToISO(p.pausa_fine, data)
                    if (ts) inserts.push({ operatore_id: operatore.id, tipo: 'pausa_fine', timestamp: ts })
                }
            }
            if (uscita) {
                const ts = hhmmToISO(uscita, data)
                if (ts) inserts.push({ operatore_id: operatore.id, tipo: 'uscita', timestamp: ts })
            }
            if (inserts.length > 0) {
                const { error: insErr } = await supabase.from('timesheet_entries').insert(inserts)
                if (insErr) throw insErr
            }

            // Note del giorno (upsert)
            if (note.trim()) {
                const { error: noteErr } = await supabase
                    .from('timesheet_day_notes')
                    .upsert({ operatore_id: operatore.id, data, nota: note.trim() }, { onConflict: 'operatore_id,data' })
                if (noteErr) console.warn('[my-day] note save error', noteErr)
            } else {
                await supabase.from('timesheet_day_notes')
                    .delete()
                    .eq('operatore_id', operatore.id)
                    .eq('data', data)
            }

            onSaved()
        } catch (err) {
            alert('Errore: ' + (err instanceof Error ? err.message : String(err)))
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
            <div className="bg-theme-bg-secondary rounded-lg border border-theme-border max-w-lg w-full p-6 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
                <h3 className="text-xl font-semibold text-theme-text-primary mb-1">I miei orari — {operatore.nome} {operatore.cognome || ''}</h3>
                <p className="text-xs text-theme-text-muted mb-4">{new Date(data).toLocaleDateString('it-IT', { timeZone: ROME_TZ, weekday: 'long', day: 'numeric', month: 'long' })}</p>

                {loading ? (
                    <p className="text-theme-text-muted">Caricamento…</p>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <label className="block">
                                <span className="text-xs text-theme-text-secondary">Entrata</span>
                                <input type="time" value={entrata} onChange={e => setEntrata(e.target.value)}
                                    className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary" />
                            </label>
                            <label className="block">
                                <span className="text-xs text-theme-text-secondary">Uscita</span>
                                <input type="time" value={uscita} onChange={e => setUscita(e.target.value)}
                                    className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary" />
                            </label>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-semibold text-theme-text-primary">Pause</span>
                                <button onClick={() => setPause([...pause, { pausa_inizio: '', pausa_fine: '' }])}
                                    className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary text-theme-text-secondary hover:text-theme-text-primary">
                                    + Aggiungi pausa
                                </button>
                            </div>
                            <div className="space-y-2">
                                {pause.map((p, i) => (
                                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                                        <label className="block">
                                            <span className="text-xs text-theme-text-muted">Inizio pausa {i + 1}</span>
                                            <input type="time" value={p.pausa_inizio || ''} onChange={e => {
                                                const next = [...pause]
                                                next[i] = { ...next[i], pausa_inizio: e.target.value }
                                                setPause(next)
                                            }} className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary" />
                                        </label>
                                        <label className="block">
                                            <span className="text-xs text-theme-text-muted">Fine pausa {i + 1}</span>
                                            <input type="time" value={p.pausa_fine || ''} onChange={e => {
                                                const next = [...pause]
                                                next[i] = { ...next[i], pausa_fine: e.target.value }
                                                setPause(next)
                                            }} className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary" />
                                        </label>
                                        <button onClick={() => setPause(pause.filter((_, j) => j !== i))}
                                            className="px-2 py-2 text-red-400 hover:text-red-300" title="Rimuovi">×</button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <label className="block">
                            <span className="text-xs text-theme-text-secondary">Note (opzionale)</span>
                            <textarea value={note} onChange={e => setNote(e.target.value)}
                                rows={2} placeholder="Es: Lavoro da casa / Ferie / Permesso medico"
                                className="mt-1 w-full bg-theme-bg-tertiary border border-theme-border rounded px-3 py-2 text-theme-text-primary text-sm" />
                        </label>
                    </div>
                )}

                <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-theme-border">
                    <Button variant="secondary" onClick={onClose} disabled={saving}>Annulla</Button>
                    <Button onClick={handleSave} disabled={loading || saving}>
                        {saving ? 'Salvataggio…' : 'Salva orari'}
                    </Button>
                </div>
            </div>
        </div>
    )
}

function exportCsv(filename: string, headers: string[], rows: string[][]) {
    const csv = [headers, ...rows]
        .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}
