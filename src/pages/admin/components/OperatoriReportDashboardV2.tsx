import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { REPORT_RESTRICTED_EMAILS } from '../../../utils/reportAccess'
import OperatorProfileModal from './OperatorProfileModal'
import InviteOperatoreModal from './InviteOperatoreModal'

/**
 * OperatoriReportDashboardV2 — dashboard a vista singola "tutto in uno",
 * ispirata al mockup richiesto. Affiancata al vecchio
 * OperatoriReportDashboard (selezionabile dal tab Operatori).
 *
 * Sezioni:
 *  - Header con range date e bottone "Genera Report"
 *  - 8 KPI cards (Operatori, Attivi Oggi, Fatturato, Profitto, Noleggi,
 *    Lavaggi, Ore Lavorate, Produttivita)
 *  - 4 widget centrali (trend team, top fatturato, top produttivita,
 *    distribuzione dipartimenti)
 *  - Rilevazione Orari Giornaliera (tabella)
 *  - Summary cards (Presenti, Assenti, Ore Totali, etc.)
 *  - 4 panel finali (presenze settimanali, obiettivi, valutazione, costi)
 *  - Sidebar destra (Azioni Rapide, Alert & Critica, Insight, Download)
 */

const ROME_TZ = 'Europe/Rome'
function toRomeDate(d: Date = new Date()): string {
    return d.toLocaleDateString('en-CA', { timeZone: ROME_TZ })
}
function fmtMin(min: number): string {
    if (!min || min <= 0) return '0h 00m'
    const h = Math.floor(min / 60)
    const m = min % 60
    return `${h}h ${String(m).padStart(2, '0')}m`
}
function eur(n: number): string {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0)
}
function fmtTime(iso: string | null): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleTimeString('it-IT', { timeZone: ROME_TZ, hour: '2-digit', minute: '2-digit' })
}
const AVATAR_TONES = ['bg-emerald-600', 'bg-blue-600', 'bg-amber-600', 'bg-rose-600', 'bg-violet-600', 'bg-cyan-600', 'bg-fuchsia-600', 'bg-orange-600']
function avatarTone(seed: string): string {
    let h = 0
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
    return AVATAR_TONES[h % AVATAR_TONES.length]
}

interface Operatore {
    id: string
    nome: string
    cognome: string | null
    email: string
    ruolo: string | null
    ore_target_giornaliere: number
    avatar_url: string | null
    // 2026-05-22: target ore con granularita' esplicita dal contratto.
    // gran = 'giornaliera' | 'settimanale' | 'mensile' | 'none'
    // value = ore (intere) della granularita' scelta dall'admin.
    // Se admin entra SOLO weekly = 47, gran='settimanale', value=47,
    // NON inventiamo un daily fake.
    _target_gran?: 'giornaliera' | 'settimanale' | 'mensile' | 'none'
    _target_value_h?: number
    // 2026-05-23: campi extra dal contratto cosi' il report riflette
    // esattamente il contratto attivo (tipo rapporto, giorni lavorativi
    // settimana per convertire weekly→daily correttamente).
    _tipo_rapporto?: string | null
    _giorni_settimana?: number | null
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

type RangePreset = 'oggi' | '7gg' | '30gg' | 'mese' | 'quarter' | 'anno' | 'custom'

function rangeFromPreset(preset: RangePreset): { from: string; to: string } {
    const today = new Date()
    const to = toRomeDate(today)
    if (preset === 'oggi') return { from: to, to }
    if (preset === '7gg') {
        const d = new Date(); d.setDate(d.getDate() - 6)
        return { from: toRomeDate(d), to }
    }
    if (preset === '30gg') {
        const d = new Date(); d.setDate(d.getDate() - 29)
        return { from: toRomeDate(d), to }
    }
    if (preset === 'mese') {
        const start = new Date(today.getFullYear(), today.getMonth(), 1)
        return { from: toRomeDate(start), to }
    }
    if (preset === 'quarter') {
        const q = Math.floor(today.getMonth() / 3)
        const start = new Date(today.getFullYear(), q * 3, 1)
        return { from: toRomeDate(start), to }
    }
    if (preset === 'anno') {
        const start = new Date(today.getFullYear(), 0, 1)
        return { from: toRomeDate(start), to }
    }
    return { from: to, to }
}

function KpiCard({ label, value, sub, accent, icon, delta }: {
    label: string; value: string | number; sub?: string;
    accent?: 'gold' | 'emerald' | 'sky' | 'violet' | 'rose' | 'amber' | 'cyan' | 'lime'
    icon?: string
    delta?: number  // % change vs previous period — green if positive, red if negative
}) {
    const dotColor: Record<NonNullable<typeof accent>, string> = {
        gold: 'bg-amber-400',
        emerald: 'bg-emerald-400',
        sky: 'bg-sky-400',
        violet: 'bg-violet-400',
        rose: 'bg-rose-400',
        amber: 'bg-amber-400',
        cyan: 'bg-cyan-400',
        lime: 'bg-lime-400',
    }
    const dot = dotColor[accent || 'gold']
    const deltaCls = delta == null ? '' : delta >= 0 ? 'text-emerald-400' : 'text-rose-400'
    const deltaStr = delta == null ? null : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`
    return (
        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                <span className="text-[10px] uppercase tracking-wider text-theme-text-muted">{label}</span>
                {icon && <span className="ml-auto text-xs text-theme-text-muted">{icon}</span>}
            </div>
            <div className="text-2xl font-bold text-theme-text-primary tabular-nums">{value}</div>
            <div className="flex items-center justify-between mt-1 gap-2">
                {sub && <div className="text-[10px] text-theme-text-muted truncate">{sub}</div>}
                {deltaStr && <div className={`text-[10px] font-semibold tabular-nums ${deltaCls}`}>{deltaStr}</div>}
            </div>
        </div>
    )
}

function Sparkline({ values, color = '#fbbf24' }: { values: number[]; color?: string }) {
    if (values.length < 2) return <div className="h-24 flex items-center justify-center text-theme-text-muted text-xs">Dati insufficienti</div>
    const max = Math.max(...values, 1)
    const min = Math.min(...values, 0)
    const range = max - min || 1
    const w = 100, h = 40
    const step = w / (values.length - 1)
    const pts = values.map((v, i) => `${(i * step).toFixed(2)},${(h - ((v - min) / range) * h).toFixed(2)}`).join(' ')
    return (
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-24">
            <polyline fill="none" stroke={color} strokeWidth="1.2" points={pts} />
            <polyline fill={`${color}22`} stroke="none" points={`0,${h} ${pts} ${w},${h}`} />
        </svg>
    )
}

function DonutChart({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
    const size = 140, stroke = 22, radius = (size - stroke) / 2
    const circ = 2 * Math.PI * radius
    let offset = 0
    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
                <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
                {data.filter(d => d.value > 0).map((d, i) => {
                    const frac = total > 0 ? d.value / total : 0
                    const dash = circ * frac
                    const el = (
                        <circle key={i} cx={size / 2} cy={size / 2} r={radius} fill="none"
                            stroke={d.color} strokeWidth={stroke}
                            strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset}
                        />
                    )
                    offset += dash
                    return el
                })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-2xl font-bold text-theme-text-primary">{total}</div>
                <div className="text-[10px] uppercase tracking-wider text-theme-text-muted">Totale</div>
            </div>
        </div>
    )
}

type OperatoriView = 'dashboard' | 'rilevazione' | 'payroll' | 'audit' | 'contratti'

interface OperatoriReportDashboardV2Props {
    onSwitchView?: (view: OperatoriView) => void
}

// 2026-05-23: Report Operatori — Salvatore vede solo la propria riga
// del report, nonostante ROLE_FAILSAFE lo marchi 'direzione' per gli
// altri tab (decisione direzione 2026-05-23, sostituisce richiesta
// 2026-05-18 che gli dava pieno accesso al Report Operatori).
// Tutti gli altri admin (Valerio, Ilenia, Ophe, eventuali futuri
// 'direzione') mantengono la team-view classica.
// 2026-06-03: aggiunti i 2 lavaggisti — vedono solo il proprio report
// (ore, produttivita') nonostante abbiano permission 'operatori'.
// 2026-06-20: lista spostata in src/utils/reportAccess.ts (condivisa con
// PayrollPeriodoView, cosi' anche la Busta Paga e' "solo mia" per Salvatore).

export default function OperatoriReportDashboardV2({ onSwitchView }: OperatoriReportDashboardV2Props = {}) {
    const { hasRole, adminEmail } = useAdminRole()
    const lowerAdminEmail = (adminEmail || '').toLowerCase()
    const isRestrictedToOwn = REPORT_RESTRICTED_EMAILS.has(lowerAdminEmail)
    const isDirezione = (hasRole('direzione') || hasRole('developer')) && !isRestrictedToOwn

    const [preset, setPreset] = useState<RangePreset>('mese')
    const [{ from: rangeFrom, to: rangeTo }, setRange] = useState(() => rangeFromPreset('mese'))
    const [customFrom, setCustomFrom] = useState<string>(rangeFrom)
    const [customTo, setCustomTo] = useState<string>(rangeTo)

    useEffect(() => {
        if (preset !== 'custom') {
            const r = rangeFromPreset(preset)
            setRange(r)
            setCustomFrom(r.from); setCustomTo(r.to)
        } else {
            setRange({ from: customFrom, to: customTo })
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [preset])

    useEffect(() => {
        if (preset === 'custom') setRange({ from: customFrom, to: customTo })
    }, [customFrom, customTo, preset])

    const [loading, setLoading] = useState(true)
    const [operatori, setOperatori] = useState<Operatore[]>([])
    const [todayRows, setTodayRows] = useState<DayRow[]>([])
    // Operatore selezionato per la modale di profilo (stesso component
    // usato dal Dashboard classico — KPI, trend, pause analytics).
    const [profileOp, setProfileOp] = useState<Operatore | null>(null)
    const [inviteOpen, setInviteOpen] = useState(false)
    const [kpi, setKpi] = useState({
        fatturatoGenerale: 0,
        bookingsCount: 0,
        noleggiCount: 0,
        lavaggiCount: 0,
        oreLavorate: 0,
        oreTarget: 0,
    })
    const [trendDaily, setTrendDaily] = useState<{ day: string; revenue: number }[]>([])
    const [topFatturato, setTopFatturato] = useState<{ name: string; value: number }[]>([])
    const [costiPersonale, setCostiPersonale] = useState({ totale: 0, stipendi: 0, contributi: 0 })

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const today = toRomeDate(new Date())

            // 0. Backfill: ogni admin con stato='Attivo' (o null) DEVE avere
            //    una riga operatori_persone, altrimenti non appare qui.
            //    Pre-22/05/2026 invite-operator non scriveva su operatori_persone
            //    e admin aggiunti in passato (es. primewash@dr7.app) restavano
            //    invisibili nel report. Allineiamo anche `attivo` con admins.stato
            //    cosi' chi e' Sospeso/Inattivo non riappare se gia' esisteva.
            try {
                const { data: adminsRaw } = await supabase
                    .from('admins')
                    .select('id, email, nome, stato')
                const adminsList = (adminsRaw || []) as Array<{ id: string; email: string | null; nome: string | null; stato: string | null }>
                const { data: existingOps } = await supabase
                    .from('operatori_persone')
                    .select('id, email, attivo')
                const existingByEmail = new Map<string, { id: string; attivo: boolean }>()
                for (const o of (existingOps || []) as Array<{ id: string; email: string | null; attivo: boolean }>) {
                    if (o.email) existingByEmail.set(o.email.toLowerCase(), { id: o.id, attivo: o.attivo })
                }
                const inserts: Array<{ email: string; nome: string | null; cognome: null; ruolo: null; avatar_url: null; ore_target_giornaliere: number; attivo: boolean }> = []
                const reactivates: string[] = []
                const deactivates: string[] = []
                for (const a of adminsList) {
                    if (!a.email) continue
                    const shouldBeActive = !a.stato || a.stato.toLowerCase() === 'attivo'
                    const existing = existingByEmail.get(a.email.toLowerCase())
                    if (!existing) {
                        // Manca del tutto → backfill (solo se admin è Attivo)
                        if (shouldBeActive) {
                            inserts.push({
                                email: a.email,
                                nome: a.nome,
                                cognome: null,
                                ruolo: null,
                                avatar_url: null,
                                ore_target_giornaliere: 8,
                                attivo: true,
                            })
                        }
                    } else if (existing.attivo !== shouldBeActive) {
                        if (shouldBeActive) reactivates.push(existing.id)
                        else deactivates.push(existing.id)
                    }
                }
                if (inserts.length > 0) {
                    await supabase.from('operatori_persone').insert(inserts)
                }
                if (reactivates.length > 0) {
                    await supabase.from('operatori_persone').update({ attivo: true }).in('id', reactivates)
                }
                if (deactivates.length > 0) {
                    await supabase.from('operatori_persone').update({ attivo: false }).in('id', deactivates)
                }
            } catch (syncErr) {
                console.warn('[OperatoriReport] admins→operatori_persone sync failed (non-fatal):', syncErr)
            }

            // 1. Operatori attivi
            // 2026-05-23: Salvatore (e ogni altra email in
            // REPORT_RESTRICTED_EMAILS) vede solo la propria riga del report.
            // 2026-06-16: Salvatore declassato da 'direzione' per forzare l'OTP
            // (deve chiedere il codice a Valerio/Ilenia). La query "team" qui
            // sotto dipendeva dalla read RLS che il ruolo direzione garantiva:
            // senza direzione tornava vuota e il suo report personale spariva
            // (vedeva solo ore totali + grafico). Per gli utenti restricted-own
            // carichiamo quindi la SOLA riga propria via user_id (RLS self-read,
            // stesso pattern di RilevazioneOrariTab), con fallback su email —
            // cosi' il report torna visibile SENZA ridargli 'direzione', e l'OTP
            // resta invariato. Per tutti gli altri admin la lista resta completa.
            let opListRaw: Operatore[] = []
            if (isRestrictedToOwn) {
                const { data: { user } } = await supabase.auth.getUser()
                let own: Operatore[] = []
                if (user?.id) {
                    const { data: byId } = await supabase
                        .from('operatori_persone')
                        .select('id, nome, cognome, email, ruolo, ore_target_giornaliere, avatar_url, attivo')
                        .eq('attivo', true)
                        .eq('user_id', user.id)
                    own = (byId || []) as Operatore[]
                }
                if (own.length === 0 && lowerAdminEmail) {
                    const { data: byEmail } = await supabase
                        .from('operatori_persone')
                        .select('id, nome, cognome, email, ruolo, ore_target_giornaliere, avatar_url, attivo')
                        .eq('attivo', true)
                        .ilike('email', lowerAdminEmail)
                    own = (byEmail || []) as Operatore[]
                }
                opListRaw = own
            } else {
                const { data: ops } = await supabase
                    .from('operatori_persone')
                    .select('id, nome, cognome, email, ruolo, ore_target_giornaliere, avatar_url, attivo')
                    .eq('attivo', true)
                    .order('cognome', { ascending: true })
                opListRaw = (ops || []) as Operatore[]
            }

            // 2026-05-22: target ore proviene dal CONTRATTO attivo, non
            // dal vecchio operatori_persone.ore_target_giornaliere.
            // Bug riportato: admin elimina ore giornaliere dal contratto e
            // mette 47h/settimana, ma il dashboard continua a mostrare 7h
            // perche' legge il vecchio campo legacy. Adesso:
            //   1. Per ogni operatore, carichiamo il contratto attivo.
            //   2. effective_daily =
            //        contract.ore_target_giornaliere
            //        || contract.ore_target_settimanali / 5  (giorni lavorativi)
            //        || contract.ore_target_mensili / 22     (giorni/mese)
            //        || op.ore_target_giornaliere || 8       (fallback)
            const opIds = opListRaw.map(o => o.id)
            const contractsByOp = new Map<string, { giornaliere: number | null; settimanali: number | null; mensili: number | null; giorni_settimana: number | null; tipo_rapporto: string | null }>()
            // 2026-07-21: pausa OBBLIGATORIA per operatore (Contratto > pause_config).
            // mandatoryPauseByOp = minuti/giorno da scalare SOLO se pausa NON pagata.
            // Vuoto per operatori senza config -> nessuna deduzione (es. Salvatore).
            const mandatoryPauseByOp = new Map<string, number>()
            if (opIds.length > 0) {
                const { data: contracts } = await supabase
                    .from('operatore_contratto')
                    // 2026-05-23: pull tipo_rapporto + giorni_lavorativi_settimana
                    // cosi' il report riflette esattamente il contratto attivo.
                    .select('operatore_id, ore_target_giornaliere, ore_target_settimanali, ore_target_mensili, giorni_lavorativi_settimana, tipo_rapporto, attivo')
                    .in('operatore_id', opIds)
                    .eq('attivo', true)
                for (const c of (contracts || []) as Array<{
                    operatore_id: string
                    ore_target_giornaliere: number | null
                    ore_target_settimanali: number | null
                    ore_target_mensili: number | null
                    giorni_lavorativi_settimana: number | null
                    tipo_rapporto: string | null
                }>) {
                    contractsByOp.set(c.operatore_id, {
                        giornaliere: c.ore_target_giornaliere,
                        settimanali: c.ore_target_settimanali,
                        mensili: c.ore_target_mensili,
                        giorni_settimana: c.giorni_lavorativi_settimana,
                        tipo_rapporto: c.tipo_rapporto,
                    })
                }
                // Query SEPARATA e RESILIENTE per pause_config: se la colonna non
                // esiste ancora (migration non eseguita) NON deve rompere il report.
                try {
                    const { data: pcRows, error: pcErr } = await supabase
                        .from('operatore_contratto')
                        .select('operatore_id, pause_config')
                        .in('operatore_id', opIds)
                        .eq('attivo', true)
                    if (!pcErr) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        for (const r of (pcRows || []) as Array<{ operatore_id: string; pause_config: any }>) {
                            const pc = r.pause_config
                            if (pc && pc.pagata === false) {
                                const fasceMin = Array.isArray(pc.fasce) ? pc.fasce.reduce((s: number, f: { da?: string; a?: string }) => {
                                    const [dh, dm] = String(f?.da || '').split(':').map(Number)
                                    const [ah, am] = String(f?.a || '').split(':').map(Number)
                                    const mins = ((Number.isFinite(ah) ? ah * 60 + (am || 0) : 0) - (Number.isFinite(dh) ? dh * 60 + (dm || 0) : 0))
                                    return s + Math.max(0, mins || 0)
                                }, 0) : 0
                                const mand = (Number(pc.durata_min) || 0) + fasceMin
                                if (mand > 0) mandatoryPauseByOp.set(r.operatore_id, mand)
                            }
                        }
                    }
                } catch { /* colonna assente: nessuna deduzione, report resta ok */ }
            }
            const computeTarget = (op: Operatore): { gran: 'giornaliera' | 'settimanale' | 'mensile' | 'none'; value: number } => {
                const c = contractsByOp.get(op.id)
                if (c) {
                    if (c.giornaliere && c.giornaliere > 0) return { gran: 'giornaliera', value: c.giornaliere }
                    if (c.settimanali && c.settimanali > 0) return { gran: 'settimanale', value: c.settimanali }
                    if (c.mensili && c.mensili > 0) return { gran: 'mensile', value: c.mensili }
                }
                if (op.ore_target_giornaliere && op.ore_target_giornaliere > 0) {
                    return { gran: 'giornaliera', value: op.ore_target_giornaliere }
                }
                return { gran: 'none', value: 0 }
            }
            const opList: Operatore[] = opListRaw.map(o => {
                const t = computeTarget(o)
                const c = contractsByOp.get(o.id)
                return {
                    ...o,
                    _target_gran: t.gran,
                    _target_value_h: t.value,
                    _tipo_rapporto: c?.tipo_rapporto || null,
                    _giorni_settimana: c?.giorni_settimana || null,
                }
            })
            setOperatori(opList)

            // 2. Timesheet di oggi
            const { data: todayEntries } = await supabase
                .from('timesheet_entries')
                .select('operatore_id, tipo, timestamp')
                .eq('data', today)
                .order('timestamp', { ascending: true })

            const byOpToday = new Map<string, { entrata: string | null; uscita: string | null; pi: string[]; pf: string[]; lastTipo: string | null }>()
            for (const e of (todayEntries || []) as { operatore_id: string; tipo: string; timestamp: string }[]) {
                const cur = byOpToday.get(e.operatore_id) || { entrata: null, uscita: null, pi: [], pf: [], lastTipo: null }
                if (e.tipo === 'entrata') cur.entrata = e.timestamp
                else if (e.tipo === 'uscita') cur.uscita = e.timestamp
                else if (e.tipo === 'pausa_inizio') cur.pi.push(e.timestamp)
                else if (e.tipo === 'pausa_fine') cur.pf.push(e.timestamp)
                cur.lastTipo = e.tipo
                byOpToday.set(e.operatore_id, cur)
            }
            const rows: DayRow[] = opList.map(op => {
                const t = byOpToday.get(op.id) || { entrata: null, uscita: null, pi: [], pf: [], lastTipo: null }
                let minLav = 0, minPausa = 0
                if (t.entrata) {
                    const end = t.uscita ? new Date(t.uscita).getTime() : Date.now()
                    const rawWorked = Math.max(0, Math.round((end - new Date(t.entrata).getTime()) / 60000))
                    let loggedPausa = 0
                    for (let i = 0; i < t.pi.length; i++) {
                        const start = new Date(t.pi[i]).getTime()
                        const fin = t.pf[i] ? new Date(t.pf[i]).getTime() : Date.now()
                        loggedPausa += Math.max(0, Math.round((fin - start) / 60000))
                    }
                    // 2026-07-21: pausa OBBLIGATORIA da contratto (solo per chi ce l'ha).
                    // Si scala il MASSIMO tra pausa registrata e pausa obbligatoria,
                    // cosi' l'operatore non deve inserirla a mano ogni giorno.
                    const mand = mandatoryPauseByOp.get(op.id) || 0
                    minPausa = Math.max(loggedPausa, mand)
                    minLav = Math.max(0, rawWorked - minPausa)
                }
                let stato: DayRow['stato'] = 'fuori'
                if (t.lastTipo === 'entrata' || t.lastTipo === 'pausa_fine') stato = 'lavoro'
                else if (t.lastTipo === 'pausa_inizio') stato = 'pausa'
                else if (t.lastTipo === 'uscita') stato = 'finito'
                return { operatore: op, entrata: t.entrata, uscita: t.uscita, pausa_inizi: t.pi, pausa_fini: t.pf, minuti_lavorati: minLav, minuti_pausa: minPausa, stato }
            })
            setTodayRows(rows)

            // 3. KPI fatturato + counts (solo direzione/developer)
            if (isDirezione) {
                const { data: rawBookings } = await supabase
                    .from('bookings')
                    .select('id, price_total, service_type, status, payment_status, pickup_date')
                    .gte('pickup_date', rangeFrom)
                    .lte('pickup_date', `${rangeTo}T23:59:59`)
                    .not('status', 'in', '("cancelled","annullata")')
                const bookings = (rawBookings || []) as Array<{ id: string; price_total: number | null; service_type: string | null; status: string | null; payment_status: string | null; pickup_date: string | null }>
                let fatturato = 0
                const noleggi: string[] = []
                const lavaggi: string[] = []
                const dailyMap = new Map<string, number>()
                for (const b of bookings) {
                    const eurAmt = (b.price_total || 0) / 100
                    fatturato += eurAmt
                    const t = (b.service_type || '').toLowerCase()
                    if (t === 'car_wash' || t === 'carwash' || t === 'mechanical') lavaggi.push(b.id)
                    else noleggi.push(b.id)
                    if (b.pickup_date) {
                        const day = b.pickup_date.slice(0, 10)
                        dailyMap.set(day, (dailyMap.get(day) || 0) + eurAmt)
                    }
                }
                // Daily trend
                const daysOrdered: string[] = []
                {
                    const startD = new Date(`${rangeFrom}T00:00:00`)
                    const endD = new Date(`${rangeTo}T00:00:00`)
                    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
                        daysOrdered.push(toRomeDate(new Date(d)))
                        if (daysOrdered.length > 366) break
                    }
                }
                setTrendDaily(daysOrdered.map(d => ({ day: d, revenue: Math.round((dailyMap.get(d) || 0) * 100) / 100 })))
                setKpi(prev => ({
                    ...prev,
                    fatturatoGenerale: Math.round(fatturato),
                    bookingsCount: bookings.length,
                    noleggiCount: noleggi.length,
                    lavaggiCount: lavaggi.length,
                }))
            }

            // 4. Ore lavorate nel range.
            // 2026-06-03: filtra per operatore_id quando l'utente loggato e' in
            // REPORT_RESTRICTED_EMAILS. Prima la query prendeva TUTTE le righe
            // timesheet — l'opList era filtrato a 1 persona ma totMinLav
            // accumulava le ore dell'intero team. Risultato: ad Aleks (che non
            // ha mai timbrato) usciva "330h lavorate / 240h target = 138%
            // produttivita" perche' 330h era il totale di tutti gli altri.
            const restrictedOpIds = (isRestrictedToOwn ? opIds : null)
            let timesheetQuery = supabase
                .from('timesheet_entries')
                .select('operatore_id, tipo, timestamp, data')
                .gte('data', rangeFrom)
                .lte('data', rangeTo)
                .order('timestamp', { ascending: true })
            if (restrictedOpIds && restrictedOpIds.length > 0) {
                timesheetQuery = timesheetQuery.in('operatore_id', restrictedOpIds)
            }
            const { data: rangeEntries } = await timesheetQuery
            const byOpDay = new Map<string, Map<string, { entrata: string | null; uscita: string | null; pi: string[]; pf: string[] }>>()
            for (const e of (rangeEntries || []) as { operatore_id: string; tipo: string; timestamp: string; data: string }[]) {
                if (!byOpDay.has(e.operatore_id)) byOpDay.set(e.operatore_id, new Map())
                const dayMap = byOpDay.get(e.operatore_id)!
                const cur = dayMap.get(e.data) || { entrata: null, uscita: null, pi: [], pf: [] }
                if (e.tipo === 'entrata') cur.entrata = e.timestamp
                else if (e.tipo === 'uscita') cur.uscita = e.timestamp
                else if (e.tipo === 'pausa_inizio') cur.pi.push(e.timestamp)
                else if (e.tipo === 'pausa_fine') cur.pf.push(e.timestamp)
                dayMap.set(e.data, cur)
            }
            let totMinLav = 0
            const perOpMin = new Map<string, number>()
            byOpDay.forEach((dayMap, opId) => {
                let opTot = 0
                const mand = mandatoryPauseByOp.get(opId) || 0
                dayMap.forEach(t => {
                    if (!t.entrata) return
                    const end = t.uscita ? new Date(t.uscita).getTime() : new Date(t.entrata).getTime()
                    const rawWorked = Math.max(0, Math.round((end - new Date(t.entrata).getTime()) / 60000))
                    let loggedPausa = 0
                    for (let i = 0; i < t.pi.length; i++) {
                        const start = new Date(t.pi[i]).getTime()
                        const fin = t.pf[i] ? new Date(t.pf[i]).getTime() : start
                        loggedPausa += Math.max(0, Math.round((fin - start) / 60000))
                    }
                    // 2026-07-21: scala il MAX tra pausa registrata e pausa obbligatoria da contratto.
                    opTot += Math.max(0, rawWorked - Math.max(loggedPausa, mand))
                })
                perOpMin.set(opId, opTot)
                totMinLav += opTot
            })
            // 2026-05-22: target rispetta la granularita' entrata dall'admin.
            //   giornaliera → value × N
            //   settimanale → value × (N/7)
            //   mensile     → value × (N/30)
            //   none        → 0 (no target)
            // Niente "daily fake" se admin ha inserito solo weekly.
            const daysCount = (() => {
                const a = new Date(`${rangeFrom}T00:00:00`).getTime()
                const b = new Date(`${rangeTo}T00:00:00`).getTime()
                return Math.max(1, Math.round((b - a) / 86400000) + 1)
            })()
            // 2026-05-23: usa giorni_lavorativi_settimana dal contratto
            // per convertire weekly→daily. Es. 40h/sett con 5gg lavorativi
            // = 8h/g, non 40/7 = 5.7h/g.
            const targetMinForOp = (op: Operatore, days: number): number => {
                const v = (op._target_value_h || 0) * 60
                if (op._target_gran === 'giornaliera') return Math.round(v * days)
                if (op._target_gran === 'settimanale') {
                    const giorni = op._giorni_settimana && op._giorni_settimana > 0 ? op._giorni_settimana : 5
                    // ore/sett × (giorni periodo × giorni_lav/7) / giorni_lav = ore tot
                    // Semplificato: weekly_hours × days/7 dato che il target settimanale
                    // si distribuisce sui 7 giorni del periodo proporzionalmente
                    // (se hai contratto 40h/sett, in 14gg fanno 80h indipendentemente
                    // da quanti sono i lavorativi).
                    void giorni
                    return Math.round(v * (days / 7))
                }
                if (op._target_gran === 'mensile') return Math.round(v * (days / 30))
                return 0
            }
            const totTargetMin = opList.reduce((s, o) => s + targetMinForOp(o, daysCount), 0)
            setKpi(prev => ({ ...prev, oreLavorate: totMinLav, oreTarget: totTargetMin }))

            // Top 5 per Ore Lavorate — il widget si chiama "Top 5 per Ore
            // Lavorate" quindi DEVE ordinare per minuti lavorati nel periodo,
            // non per pct produttivita. Bug 2026-05-22: prima ordinava per
            // pct ma mostrava i minuti, e siccome chi non ha mai timbrato
            // ha pct=0 con sort stabile usciva primo alfabeticamente
            // (Michele) anche con 0 minuti reali. Escludo anche chi ha 0
            // minuti per non riempire la classifica di gente che non ha
            // mai lavorato nel range.
            const topProd = opList.map(o => {
                const m = perOpMin.get(o.id) || 0
                return { name: `${o.nome} ${o.cognome || ''}`.trim(), value: m }
            }).filter(t => t.value > 0)
              .sort((a, b) => b.value - a.value)
              .slice(0, 5)
            setTopFatturato(topProd)

            // 5. Costi del personale — dai contratti REALI di ogni operatore.
            //    Schema corretto (vedi 20260511_operatore_contratto.sql):
            //      - attivo BOOLEAN (NON "stato='attivo'")
            //      - stipendio_mensile_eur (mensilita' fissa)
            //      - paga_oraria_eur (tariffa oraria per chi non e' a stipendio)
            //      - straordinario_abilitato + paga_straordinario_eur + ore_soglia_straordinario
            //    Vecchia versione leggeva 'stipendio_lordo' / 'contributi_inps'
            //    che NON ESISTONO -> totale sempre 0. Adesso:
            //      stipendi = sum(stipendio_mensile × daysCount/30)            (prorated)
            //               + sum(paga_oraria × ore_lavorate_periodo)         (orari)
            //               + sum(paga_straord × ore_oltre_soglia)            (overtime)
            //      contributi = stipendi × 30% (stima INPS+IRAP, etichettata come stima)
            const { data: contratti } = await supabase
                .from('operatore_contratto')
                .select('operatore_id, stipendio_mensile_eur, paga_oraria_eur, paga_straordinario_eur, straordinario_abilitato, ore_soglia_straordinario, ore_target_giornaliere, ore_target_settimanali, ore_target_mensili, giorni_lavorativi_settimana')
                .eq('attivo', true)
                .in('operatore_id', opIds.length ? opIds : ['00000000-0000-0000-0000-000000000000'])

            // Soglia DAILY in ore per ogni operatore. La logica e' la stessa
            // di "Calcola Paga" nel profilo operatore: lo straordinario si
            // calcola per-giorno (ore oltre la soglia in quel giorno), NON
            // sul totale del periodo. Esempio: 40h/settimana su 6 giorni =
            // soglia giornaliera 40/6 ≈ 6.67h. Se l'operatore lavora 8h in
            // un giorno, 6.67h sono ordinarie e 1.33h straordinario, anche
            // se la sua settimana e' sotto le 40h.
            //
            // Priorita' per derivare la soglia giornaliera:
            //   1. ore_soglia_straordinario (esplicita)
            //   2. ore_target_giornaliere
            //   3. ore_target_settimanali / giorni_lavorativi_settimana (default 5)
            //   4. ore_target_mensili / (avg 22 giorni lavorativi/mese)
            const dailySoglia = (c: {
                ore_soglia_straordinario: number | null
                ore_target_giornaliere: number | null
                ore_target_settimanali: number | null
                ore_target_mensili: number | null
                giorni_lavorativi_settimana: number | null
            }): number => {
                if (c.ore_soglia_straordinario && c.ore_soglia_straordinario > 0) return Number(c.ore_soglia_straordinario)
                if (c.ore_target_giornaliere && c.ore_target_giornaliere > 0) return Number(c.ore_target_giornaliere)
                if (c.ore_target_settimanali && c.ore_target_settimanali > 0) {
                    const gg = Number(c.giorni_lavorativi_settimana) || 5
                    return Number(c.ore_target_settimanali) / Math.max(1, gg)
                }
                if (c.ore_target_mensili && c.ore_target_mensili > 0) {
                    return Number(c.ore_target_mensili) / 22
                }
                return 0
            }

            // Minuti lavorati per (operatore, giorno) — riutilizziamo byOpDay
            // gia' calcolato sopra invece di rifare la query timesheet.
            const minOnDay = (opId: string, day: string): number => {
                const dayEntries = byOpDay.get(opId)?.get(day)
                if (!dayEntries?.entrata) return 0
                const end = dayEntries.uscita ? new Date(dayEntries.uscita).getTime() : new Date(dayEntries.entrata).getTime()
                let m = Math.max(0, Math.round((end - new Date(dayEntries.entrata).getTime()) / 60000))
                for (let i = 0; i < dayEntries.pi.length; i++) {
                    const start = new Date(dayEntries.pi[i]).getTime()
                    const fin = dayEntries.pf[i] ? new Date(dayEntries.pf[i]).getTime() : start
                    m -= Math.max(0, Math.round((fin - start) / 60000))
                }
                return Math.max(0, m)
            }

            let stipendiTot = 0
            for (const c of (contratti || []) as Array<{
                operatore_id: string
                stipendio_mensile_eur: number | null
                paga_oraria_eur: number | null
                paga_straordinario_eur: number | null
                straordinario_abilitato: boolean | null
                ore_soglia_straordinario: number | null
                ore_target_giornaliere: number | null
                ore_target_settimanali: number | null
                ore_target_mensili: number | null
                giorni_lavorativi_settimana: number | null
            }>) {
                // Mensile: prorata al range selezionato.
                const monthly = Number(c.stipendio_mensile_eur) || 0
                if (monthly > 0) stipendiTot += monthly * (daysCount / 30)

                // Orario: split per-giorno tra ordinarie e straord, come
                // Calcola Paga. La soglia e' SEMPRE giornaliera (derivata
                // dalla granularita' del contratto).
                const hourly = Number(c.paga_oraria_eur) || 0
                if (hourly > 0) {
                    const sogliaHDay = dailySoglia(c)
                    const sogliaMinDay = sogliaHDay * 60
                    const straordOn = !!c.straordinario_abilitato && (Number(c.paga_straordinario_eur) || 0) > 0
                    const dayMap = byOpDay.get(c.operatore_id)
                    if (!dayMap) continue

                    let ordMin = 0
                    let strMin = 0
                    dayMap.forEach((_t, day) => {
                        const m = minOnDay(c.operatore_id, day)
                        if (m <= 0) return
                        if (!straordOn || sogliaMinDay <= 0) {
                            ordMin += m
                        } else {
                            ordMin += Math.min(m, sogliaMinDay)
                            strMin += Math.max(0, m - sogliaMinDay)
                        }
                    })
                    stipendiTot += hourly * (ordMin / 60)
                    stipendiTot += (Number(c.paga_straordinario_eur) || 0) * (strMin / 60)
                }
            }

            // Contributi: stima approssimativa 30% del lordo (INPS + IRAP).
            // L'etichetta UI segnala che e' una stima, non un valore reale.
            const contribTot = stipendiTot * 0.30
            setCostiPersonale({ totale: stipendiTot + contribTot, stipendi: Math.round(stipendiTot * 100) / 100, contributi: Math.round(contribTot * 100) / 100 })
        } catch (err) {
            console.error('[OperatoriReportDashboardV2] load error', err)
        } finally {
            setLoading(false)
        }
    }, [rangeFrom, rangeTo, isDirezione, isRestrictedToOwn, lowerAdminEmail])

    useEffect(() => { load() }, [load])

    // Derivati
    const operatoriTotali = operatori.length
    const attiviOggi = todayRows.filter(r => r.stato !== 'fuori').length
    const assentiOggi = todayRows.filter(r => r.stato === 'fuori').length
    const produttivitaMedia = kpi.oreTarget > 0 ? Math.round((kpi.oreLavorate / kpi.oreTarget) * 100) : 0
    const oreTotaliOggi = todayRows.reduce((s, r) => s + r.minuti_lavorati, 0)
    const pauseTotaliOggi = todayRows.reduce((s, r) => s + r.minuti_pausa, 0)
    const pauseCount = todayRows.reduce((s, r) => s + r.pausa_inizi.length, 0)
    const pauseMedia = pauseCount > 0 ? Math.round(pauseTotaliOggi / pauseCount) : 0
    const ritardiOggi = todayRows.filter(r => {
        if (!r.entrata) return false
        const h = new Date(r.entrata).getHours()
        return h >= 10 // arbitrario: chi entra dopo le 10
    }).length

    const dipartimenti = useMemo(() => {
        const map = new Map<string, number>()
        for (const o of operatori) {
            const k = (o.ruolo || 'Non assegnato').trim()
            map.set(k, (map.get(k) || 0) + 1)
        }
        const palette = ['#fbbf24', '#10b981', '#3b82f6', '#a855f7', '#ec4899', '#06b6d4', '#84cc16']
        return Array.from(map.entries()).map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }))
    }, [operatori])

    const profittoDiretto = Math.round(kpi.fatturatoGenerale * 0.65) // stima 65% margine
    const oreLavorateH = Math.floor(kpi.oreLavorate / 60)

    return (
        <div className="space-y-4">
            {/* HEADER — 2026-05-22: redesign vicino al mockup */}
            <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="w-1 h-6 rounded-full bg-rose-500" />
                        <h2 className="text-xl font-bold text-theme-text-primary">Report Operatori &amp; Collaboratori</h2>
                    </div>
                    <p className="text-xs text-theme-text-muted mt-1">Analisi completa delle performance del team, produttivita e rilevazione orari</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <input type="date" value={customFrom} max={customTo}
                        onChange={(e) => { setPreset('custom'); setCustomFrom(e.target.value) }}
                        className="bg-theme-bg-tertiary border border-theme-border rounded px-2 py-1 text-xs text-theme-text-primary" />
                    <span className="text-theme-text-muted text-xs">→</span>
                    <input type="date" value={customTo} min={customFrom}
                        onChange={(e) => { setPreset('custom'); setCustomTo(e.target.value) }}
                        className="bg-theme-bg-tertiary border border-theme-border rounded px-2 py-1 text-xs text-theme-text-primary" />
                    <div className="inline-flex rounded-full border border-theme-border bg-theme-bg-tertiary p-0.5 text-xs">
                        {(['oggi', '7gg', '30gg', 'mese', 'quarter', 'anno', 'custom'] as RangePreset[]).map(p => (
                            <button key={p} onClick={() => setPreset(p)}
                                className={`px-3 py-1 rounded-full ${preset === p ? 'bg-dr7-gold text-black font-semibold' : 'text-theme-text-secondary hover:bg-theme-bg-hover'}`}>
                                {p === 'oggi' ? 'Oggi' : p === '7gg' ? '7 Giorni' : p === '30gg' ? '30 Giorni' : p === 'mese' ? 'Questo Mese' : p === 'quarter' ? 'Trimestre' : p === 'anno' ? 'Anno' : 'Custom'}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        title="Confronta col periodo precedente (coming soon)"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-theme-border bg-theme-bg-tertiary text-xs font-medium text-theme-text-primary hover:bg-theme-bg-hover">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m-4 6H4m0 0l4 4m-4-4l4-4" /></svg>
                        Confronta
                    </button>
                    <button
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        Genera Report
                    </button>
                </div>
            </div>

            {/* LAYOUT: main + sidebar */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4">
                {/* MAIN COLUMN */}
                <div className="space-y-4">
                    {/* KPI ROW — 2026-05-22 allineata al mockup: 8 cards con
                        Pratiche Gestite al posto di Profitto, delta opzionali. */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                        <KpiCard label="Operatori Totali" value={operatoriTotali} sub={attiviOggi < operatoriTotali ? `${operatoriTotali - attiviOggi} non attivi` : 'tutti attivi'} accent="emerald" />
                        <KpiCard label="Attivi Oggi" value={attiviOggi} sub={`di ${operatoriTotali}`} accent="lime" />
                        <KpiCard label="Fatturato Generato" value={isDirezione ? eur(kpi.fatturatoGenerale) : '—'} sub={isDirezione ? `${kpi.bookingsCount} prenotazioni` : 'permesso richiesto'} accent="gold" />
                        <KpiCard label="Pratiche Gestite" value={isDirezione ? kpi.bookingsCount : '—'} sub="noleggi + lavaggi" accent="amber" />
                        <KpiCard label="Noleggi Gestiti" value={isDirezione ? kpi.noleggiCount : '—'} accent="sky" />
                        <KpiCard label="Lavaggi Gestiti" value={isDirezione ? kpi.lavaggiCount : '—'} sub="& meccanica" accent="cyan" />
                        <KpiCard label="Ore Lavorate" value={`${oreLavorateH}h`} sub={`Target: ${Math.round(kpi.oreTarget / 60)}h`} accent="violet" />
                        <KpiCard label="Produttivita Media" value={`${produttivitaMedia}%`} accent={produttivitaMedia >= 80 ? 'emerald' : 'rose'} />
                    </div>
                    {/* Profitto Stimato — riga separata per direzione, fuori dal mockup
                        ma utile per chi gestisce i costi. Sopprimere se non serve. */}
                    {isDirezione && profittoDiretto > 0 && (
                        <div className="text-[10px] text-theme-text-muted -mt-2">
                            Profitto stimato: <span className="text-emerald-400 font-semibold">{eur(profittoDiretto)}</span> · margine ~65%
                        </div>
                    )}

                    {/* 4 WIDGETS ROW */}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                            <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Andamento Performance Team</div>
                            <Sparkline values={trendDaily.map(d => d.revenue)} color="#fbbf24" />
                            <div className="text-[10px] text-theme-text-muted mt-1">{rangeFrom} → {rangeTo}</div>
                        </div>
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                            <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Top 5 per Ore Lavorate</div>
                            <div className="space-y-1.5">
                                {topFatturato.length === 0 && <div className="text-[11px] text-theme-text-muted">Nessun dato</div>}
                                {topFatturato.map((t, i) => {
                                    const max = Math.max(...topFatturato.map(x => x.value), 1)
                                    const pct = Math.round((t.value / max) * 100)
                                    // Match operator by name to enable click → profile modal
                                    const op = operatori.find(o => `${o.nome} ${o.cognome || ''}`.trim() === t.name)
                                    return (
                                        <div key={i}
                                            onClick={() => op && setProfileOp(op)}
                                            className={op ? 'cursor-pointer hover:bg-theme-bg-hover/40 -mx-1 px-1 rounded' : ''}>
                                            <div className="flex justify-between text-[11px]">
                                                <span className="text-theme-text-primary truncate">{t.name}</span>
                                                <span className="text-theme-text-muted tabular-nums">{fmtMin(t.value)}</span>
                                            </div>
                                            <div className="h-1.5 bg-theme-bg-tertiary rounded overflow-hidden mt-0.5">
                                                <div className="h-full bg-dr7-gold" style={{ width: `${pct}%` }} />
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                            <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Top 5 per Produttivita</div>
                            <div className="space-y-1.5">
                                {operatori.slice(0, 5).map((o) => {
                                    const m = todayRows.find(r => r.operatore.id === o.id)?.minuti_lavorati || 0
                                    // Per "oggi" usiamo ratio giornaliera dal contratto.
                                    // Se gran='settimanale' → target oggi = value/7
                                    // Se gran='mensile' → target oggi = value/30
                                    // Se gran='none' → tgt=0 (no comparazione possibile)
                                    const tgtH = (() => {
                                        if (o._target_gran === 'giornaliera') return o._target_value_h || 0
                                        if (o._target_gran === 'settimanale') return (o._target_value_h || 0) / 7
                                        if (o._target_gran === 'mensile') return (o._target_value_h || 0) / 30
                                        return 0
                                    })()
                                    const tgt = Math.round(tgtH * 60)
                                    const pct = tgt > 0 ? Math.min(100, Math.round((m / tgt) * 100)) : 0
                                    return (
                                        <div key={o.id}
                                            onClick={() => setProfileOp(o)}
                                            className="cursor-pointer hover:bg-theme-bg-hover/40 -mx-1 px-1 rounded">
                                            <div className="flex justify-between text-[11px]">
                                                <span className="text-theme-text-primary truncate">{o.nome} {o.cognome}</span>
                                                <span className="text-theme-text-muted tabular-nums">{pct}%</span>
                                            </div>
                                            <div className="h-1.5 bg-theme-bg-tertiary rounded overflow-hidden mt-0.5">
                                                <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                                            </div>
                                        </div>
                                    )
                                })}
                                {operatori.length === 0 && <div className="text-[11px] text-theme-text-muted">Nessun operatore</div>}
                            </div>
                        </div>
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                            <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Distribuzione per Ruolo</div>
                            <div className="flex items-center gap-3">
                                <DonutChart data={dipartimenti} total={operatoriTotali} />
                                <div className="flex-1 space-y-1 text-[11px]">
                                    {dipartimenti.slice(0, 6).map((d, i) => (
                                        <div key={i} className="flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full inline-block" style={{ background: d.color }} />
                                            <span className="text-theme-text-primary truncate">{d.label}</span>
                                            <span className="ml-auto text-theme-text-muted tabular-nums">{d.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* RILEVAZIONE ORARI GIORNALIERA */}
                    <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-bold text-theme-text-primary">Rilevazione Orari Giornaliera — {toRomeDate(new Date())}</h3>
                            <span className="text-[10px] text-theme-text-muted">{attiviOggi} attivi · {assentiOggi} assenti</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-theme-text-muted text-[10px] uppercase">
                                        <th className="text-left py-1 px-2">Operatore</th>
                                        <th className="text-left py-1 px-2">Ruolo</th>
                                        <th className="text-left py-1 px-2">Entrata</th>
                                        <th className="text-left py-1 px-2">Uscita Pausa</th>
                                        <th className="text-left py-1 px-2">Rientro Pausa</th>
                                        <th className="text-left py-1 px-2">Uscita</th>
                                        <th className="text-center py-1 px-2">Pause</th>
                                        <th className="text-right py-1 px-2">Ore Lav.</th>
                                        <th className="text-center py-1 px-2">Stato</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {todayRows.map(r => {
                                        const tone = avatarTone(r.operatore.email || r.operatore.id)
                                        const initials = `${(r.operatore.nome || '').charAt(0)}${(r.operatore.cognome || '').charAt(0)}`.toUpperCase()
                                        // Straord indicator: solo se gran=giornaliera (l'admin
                                        // ha esplicitamente fissato un target di giornata).
                                        // Niente "daily fake" da weekly/mensile — quel calcolo
                                        // appartiene alla soglia in Buste Paga, non a questo
                                        // banner informativo per-riga.
                                        const target = r.operatore._target_gran === 'giornaliera'
                                            ? Math.round((r.operatore._target_value_h || 0) * 60)
                                            : 0
                                        const straord = target > 0 ? Math.max(0, r.minuti_lavorati - target) : 0
                                        return (
                                            <tr key={r.operatore.id}
                                                onClick={() => setProfileOp(r.operatore)}
                                                className="border-t border-theme-border/30 hover:bg-theme-bg-hover/30 cursor-pointer">
                                                <td className="py-1.5 px-2">
                                                    <span className="inline-flex items-center gap-2">
                                                        {r.operatore.avatar_url
                                                            ? <img src={r.operatore.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                                                            : <span className={`w-6 h-6 rounded-full ${tone} flex items-center justify-center text-white text-[10px] font-bold`}>{initials}</span>}
                                                        <span className="text-theme-text-primary underline-offset-2 hover:underline">{r.operatore.nome} {r.operatore.cognome}</span>
                                                    </span>
                                                </td>
                                                {/* 2026-05-23: ruolo + tipo contratto (dipendente/collaboratore/...)
                                                    cosi' il report riflette esattamente cio' che c'e' nel contratto */}
                                                <td className="py-1.5 px-2 text-theme-text-muted">
                                                    <div>{r.operatore.ruolo || '—'}</div>
                                                    {r.operatore._tipo_rapporto && (
                                                        <div className="text-[9px] uppercase tracking-wider text-theme-text-muted/70 mt-0.5">
                                                            {r.operatore._tipo_rapporto}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="py-1.5 px-2 font-mono text-theme-text-primary">{fmtTime(r.entrata)}</td>
                                                <td className="py-1.5 px-2 font-mono text-theme-text-muted">{fmtTime(r.pausa_inizi[0] || null)}</td>
                                                <td className="py-1.5 px-2 font-mono text-theme-text-muted">{fmtTime(r.pausa_fini[0] || null)}</td>
                                                <td className="py-1.5 px-2 font-mono text-theme-text-primary">{fmtTime(r.uscita)}</td>
                                                <td className="py-1.5 px-2 text-center text-theme-text-muted">{r.pausa_inizi.length}</td>
                                                <td className="py-1.5 px-2 text-right">
                                                    <span className="text-theme-text-primary tabular-nums">{fmtMin(r.minuti_lavorati)}</span>
                                                    {straord > 0 && <span className="text-amber-400 text-[10px] ml-1">+{fmtMin(straord)}</span>}
                                                </td>
                                                <td className="py-1.5 px-2 text-center">
                                                    {r.stato === 'lavoro' && <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400">Al lavoro</span>}
                                                    {r.stato === 'pausa' && <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-400">In pausa</span>}
                                                    {r.stato === 'finito' && <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-500/20 text-sky-400">Finito</span>}
                                                    {r.stato === 'fuori' && <span className="px-1.5 py-0.5 rounded text-[10px] bg-theme-bg-tertiary text-theme-text-muted">Assente</span>}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                    {todayRows.length === 0 && (
                                        <tr><td colSpan={9} className="text-center py-4 text-theme-text-muted">Nessun operatore caricato</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* SUMMARY CARDS */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3 text-center">
                            <div className="text-[10px] uppercase text-theme-text-muted">Presenti</div>
                            <div className="text-2xl font-bold text-emerald-400">{attiviOggi}</div>
                        </div>
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3 text-center">
                            <div className="text-[10px] uppercase text-theme-text-muted">Assenti</div>
                            <div className="text-2xl font-bold text-rose-400">{assentiOggi}</div>
                        </div>
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3 text-center">
                            <div className="text-[10px] uppercase text-theme-text-muted">Ore Lav. Oggi</div>
                            <div className="text-lg font-bold text-theme-text-primary">{fmtMin(oreTotaliOggi)}</div>
                        </div>
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3 text-center">
                            <div className="text-[10px] uppercase text-theme-text-muted">Pause Tot.</div>
                            <div className="text-lg font-bold text-amber-400">{fmtMin(pauseTotaliOggi)}</div>
                        </div>
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3 text-center">
                            <div className="text-[10px] uppercase text-theme-text-muted">Pausa Media</div>
                            <div className="text-lg font-bold text-theme-text-primary">{pauseMedia} min</div>
                        </div>
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3 text-center">
                            <div className="text-[10px] uppercase text-theme-text-muted">Ritardi Oggi</div>
                            <div className="text-2xl font-bold text-rose-400">{ritardiOggi}</div>
                        </div>
                    </div>

                    {/* 4 BOTTOM PANELS */}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                            <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Presenze & Ore Lavorate</div>
                            <Sparkline values={trendDaily.slice(-7).map(d => d.revenue)} color="#10b981" />
                            <div className="text-[10px] text-theme-text-muted mt-1">Ultimi 7 giorni</div>
                        </div>
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                            <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Obiettivi vs Risultati</div>
                            <div className="space-y-2 mt-2">
                                <div>
                                    <div className="flex justify-between text-[11px] mb-1"><span className="text-theme-text-muted">Ore Target</span><span className="text-theme-text-primary">{produttivitaMedia}%</span></div>
                                    <div className="h-2 bg-theme-bg-tertiary rounded"><div className="h-full bg-emerald-500 rounded" style={{ width: `${Math.min(100, produttivitaMedia)}%` }} /></div>
                                </div>
                                <div>
                                    <div className="flex justify-between text-[11px] mb-1"><span className="text-theme-text-muted">Presenze</span><span className="text-theme-text-primary">{operatoriTotali > 0 ? Math.round((attiviOggi / operatoriTotali) * 100) : 0}%</span></div>
                                    <div className="h-2 bg-theme-bg-tertiary rounded"><div className="h-full bg-sky-500 rounded" style={{ width: `${operatoriTotali > 0 ? (attiviOggi / operatoriTotali) * 100 : 0}%` }} /></div>
                                </div>
                                <div>
                                    <div className="flex justify-between text-[11px] mb-1"><span className="text-theme-text-muted">Fatturato/Target</span><span className="text-theme-text-primary">—</span></div>
                                    <div className="h-2 bg-theme-bg-tertiary rounded"><div className="h-full bg-amber-500 rounded" style={{ width: `0%` }} /></div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                            <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Valutazione Performance</div>
                            <div className="text-center mt-2">
                                {/* 2026-06-03: clamp a 5 stelle max. Prima
                                    produttivita 138% → 6.9/5 stelle (impossibile).
                                    Ora oltre target = 5/5 stelle piene + nota
                                    "(oltre target X%)" cosi' il bonus over-target
                                    resta visibile senza rompere la scala. */}
                                {(() => {
                                    const stars = Math.min(5, produttivitaMedia / 20)
                                    return (
                                        <>
                                            <div className="text-3xl font-bold text-amber-400">
                                                {stars.toFixed(1)}<span className="text-base text-theme-text-muted">/5</span>
                                            </div>
                                            <div className="text-[10px] text-theme-text-muted mt-1">
                                                {produttivitaMedia > 100
                                                    ? `Basata su produttivita team (${produttivitaMedia}%, oltre target)`
                                                    : 'Basata su produttivita team'}
                                            </div>
                                            <div className="flex justify-center gap-0.5 mt-1">
                                                {[1, 2, 3, 4, 5].map(i => {
                                                    const filled = stars >= i
                                                    return <span key={i} className={filled ? 'text-amber-400' : 'text-theme-text-muted'}>★</span>
                                                })}
                                            </div>
                                        </>
                                    )
                                })()}
                            </div>
                        </div>
                        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                            <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Costi del Personale</div>
                            {isDirezione ? (
                                <div className="space-y-1 text-[11px] mt-2">
                                    <div className="flex justify-between"><span className="text-theme-text-muted">Stipendi (lordi periodo)</span><span className="text-theme-text-primary tabular-nums">{eur(costiPersonale.stipendi)}</span></div>
                                    <div className="flex justify-between"><span className="text-theme-text-muted">Contributi (stima 30%)</span><span className="text-theme-text-primary tabular-nums">{eur(costiPersonale.contributi)}</span></div>
                                    <div className="flex justify-between pt-1 border-t border-theme-border"><span className="text-theme-text-primary font-semibold">Totale</span><span className="text-amber-400 font-bold tabular-nums">{eur(costiPersonale.totale)}</span></div>
                                    <div className="text-[10px] text-theme-text-muted mt-1">Da contratti attivi · mensile prorata + orario × ore lavorate + straordinario</div>
                                </div>
                            ) : <div className="text-[11px] text-theme-text-muted mt-2">Accesso riservato direzione</div>}
                        </div>
                    </div>
                </div>

                {/* SIDEBAR */}
                <div className="space-y-3">
                    {/* Azioni Rapide */}
                    <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                        <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Azioni Rapide</div>
                        <div className="space-y-1.5 text-xs">
                            <button
                                type="button"
                                onClick={() => setInviteOpen(true)}
                                className="w-full text-left px-2 py-1.5 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
                            >
                                + Nuovo Operatore
                            </button>
                            <button
                                type="button"
                                onClick={() => onSwitchView?.('payroll')}
                                className="w-full text-left px-2 py-1.5 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
                            >
                                Genera Buste Paga
                            </button>
                            <button
                                type="button"
                                onClick={() => onSwitchView?.('rilevazione')}
                                className="w-full text-left px-2 py-1.5 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
                            >
                                Calendario Presenze
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const headers = ['Nome', 'Cognome', 'Email', 'Ruolo', 'Stato']
                                    const rows = operatori.map(o => [
                                        String(o.nome || ''),
                                        String((o as { cognome?: string }).cognome || ''),
                                        String((o as { email?: string }).email || ''),
                                        String((o as { ruolo?: string }).ruolo || (o as { role?: string }).role || ''),
                                        String((o as { stato?: string }).stato || ''),
                                    ])
                                    const csv = [headers, ...rows]
                                        .map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(','))
                                        .join('\n')
                                    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
                                    const url = URL.createObjectURL(blob)
                                    const a = document.createElement('a')
                                    a.href = url
                                    a.download = `operatori_${new Date().toISOString().slice(0, 10)}.csv`
                                    a.click()
                                    setTimeout(() => URL.revokeObjectURL(url), 1000)
                                }}
                                className="w-full text-left px-2 py-1.5 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
                            >
                                Export CSV
                            </button>
                        </div>
                    </div>
                    {/* Alert & Critica */}
                    <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                        <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Alert & Critica</div>
                        <div className="space-y-1.5 text-[11px]">
                            {assentiOggi > 0 && <div className="flex items-start gap-1.5"><span className="text-rose-400">⚠</span><span className="text-theme-text-primary">{assentiOggi} operatori assenti oggi</span></div>}
                            {ritardiOggi > 0 && <div className="flex items-start gap-1.5"><span className="text-amber-400">🕐</span><span className="text-theme-text-primary">{ritardiOggi} ritardi oggi</span></div>}
                            {produttivitaMedia < 60 && <div className="flex items-start gap-1.5"><span className="text-rose-400">↓</span><span className="text-theme-text-primary">Produttivita sotto target ({produttivitaMedia}%)</span></div>}
                            {assentiOggi === 0 && ritardiOggi === 0 && produttivitaMedia >= 60 && (
                                <div className="text-emerald-400">✓ Nessuna criticita</div>
                            )}
                        </div>
                    </div>
                    {/* Insight Intelligenti */}
                    <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                        <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Insight</div>
                        <div className="space-y-1.5 text-[11px]">
                            <div className="text-theme-text-primary">
                                <strong className="text-amber-400">Top performer</strong>
                                {/* Bug 2026-05-22: prima mostrava operatori[0] cioe'
                                    il primo alfabetico per cognome (Michele Collu)
                                    a prescindere dalle ore lavorate. Adesso usa la
                                    classifica gia' calcolata in topFatturato (top
                                    per ore lavorate nel range, con filtro >0). */}
                                <div className="text-theme-text-muted">{topFatturato[0]?.name || '—'}</div>
                            </div>
                            <div className="text-theme-text-primary pt-1 border-t border-theme-border">
                                <strong className="text-sky-400">Media ore/giorno</strong>
                                <div className="text-theme-text-muted">{operatoriTotali > 0 ? fmtMin(Math.round(kpi.oreLavorate / operatoriTotali)) : '—'}</div>
                            </div>
                            <div className="text-theme-text-primary pt-1 border-t border-theme-border">
                                <strong className="text-emerald-400">Tasso presenza</strong>
                                <div className="text-theme-text-muted">{operatoriTotali > 0 ? `${Math.round((attiviOggi / operatoriTotali) * 100)}%` : '—'}</div>
                            </div>
                        </div>
                    </div>
                    {/* Download Report */}
                    <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                        <div className="text-xs uppercase tracking-wider text-theme-text-muted mb-2">Download Report</div>
                        <div className="space-y-1.5 text-xs">
                            <button className="w-full text-left px-2 py-1.5 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary">📄 PDF</button>
                            <button className="w-full text-left px-2 py-1.5 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary">📊 Excel</button>
                            <button className="w-full text-left px-2 py-1.5 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary">📑 CSV</button>
                        </div>
                    </div>
                </div>
            </div>

            {loading && <div className="text-center text-theme-text-muted text-xs py-2">Caricamento dati...</div>}

            {/* Modale profilo operatore — stesso component usato dal
                Dashboard classico. Si apre cliccando su un operatore
                nella tabella Rilevazione, nei Top 5, ovunque. */}
            {profileOp && (
                <OperatorProfileModal
                    operatore={profileOp}
                    onClose={() => setProfileOp(null)}
                />
            )}
            <InviteOperatoreModal
                open={inviteOpen}
                onClose={() => setInviteOpen(false)}
                onCreated={() => { setInviteOpen(false); /* dashboard list reloads on its own polling */ }}
            />
        </div>
    )
}
