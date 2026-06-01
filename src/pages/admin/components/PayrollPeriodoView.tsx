import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'
import OperatorProfileModal from './OperatorProfileModal'

/**
 * PayrollPeriodoView — vista riassuntiva "buste paga del periodo".
 * L'utente sceglie Da/A e vede la lista di TUTTI gli operatori attivi
 * con: ore lavorate, paga ordinaria, paga straordinaria, correzione
 * ore_a_recuperare, totale dovuto. Click su riga → apre il modale
 * dettagliato dell'operatore.
 *
 * Accesso: direzione / developer.
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
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n || 0)
}
const AVATAR_TONES = ['bg-emerald-600', 'bg-blue-600', 'bg-amber-600', 'bg-rose-600', 'bg-violet-600', 'bg-cyan-600', 'bg-fuchsia-600', 'bg-orange-600']
function avatarTone(seed: string): string {
    let h = 0
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
    return AVATAR_TONES[h % AVATAR_TONES.length]
}

interface Operatore {
    id: string
    user_id: string | null
    nome: string
    cognome: string | null
    email: string
    ruolo: string | null
    ore_target_giornaliere: number
    ore_target_settimanali: number | null
    ore_target_mensili: number | null
    avatar_url: string | null
    ore_a_recuperare_min: number | null
}

interface Contratto {
    operatore_id: string
    stipendio_mensile_eur: number | null
    stipendio_frequenza: 'settimanale' | 'mensile' | null
    paga_oraria_eur: number | null
    paga_straordinario_eur: number | null
    straordinario_abilitato: boolean | null
    ore_soglia_straordinario: number | null
    attivo: boolean
}

interface PayrollRow {
    operatore: Operatore
    contratto: Contratto | null
    minLavorati: number
    minOrdinari: number
    minStraord: number
    pagaOrd: number
    pagaStraord: number
    correzione: number
    totale: number
    hasContract: boolean
}

export default function PayrollPeriodoView() {
    const { hasRole } = useAdminRole()
    const isDirezione = hasRole('direzione') || hasRole('developer')

    const [from, setFrom] = useState<string>(() => {
        const d = new Date(); d.setDate(d.getDate() - 29)
        return toRomeDate(d)
    })
    const [to, setTo] = useState<string>(() => toRomeDate(new Date()))
    const [loading, setLoading] = useState(true)
    const [rows, setRows] = useState<PayrollRow[]>([])
    const [profileOp, setProfileOp] = useState<Operatore | null>(null)
    const [sortKey, setSortKey] = useState<'name' | 'hours' | 'total'>('total')
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

    const load = useCallback(async () => {
        if (!isDirezione) { setLoading(false); return }
        setLoading(true)
        try {
            // 1. Operatori attivi
            const { data: ops } = await supabase
                .from('operatori_persone')
                .select('id, user_id, nome, cognome, email, ruolo, ore_target_giornaliere, ore_target_settimanali, ore_target_mensili, avatar_url, ore_a_recuperare_min, attivo')
                .eq('attivo', true)
                .order('cognome', { ascending: true })
            const opList = (ops || []) as Operatore[]

            // 2. Contratti attivi
            // 2026-05-22: include ore_target_giornaliere/settimanali/mensili
            // del contratto. Servono per calcolare la soglia straordinari
            // effettiva quando l'admin ha inserito SOLO 47h/settimana (es.):
            //   soglia_giornaliera_implicita = settimanali/5 = 9.4h
            const { data: contracts } = await supabase
                .from('operatore_contratto')
                .select('operatore_id, stipendio_mensile_eur, stipendio_frequenza, paga_oraria_eur, paga_straordinario_eur, straordinario_abilitato, ore_soglia_straordinario, ore_target_giornaliere, ore_target_settimanali, ore_target_mensili, attivo')
                .eq('attivo', true)
            const contractByOp = new Map<string, Contratto & { ore_target_giornaliere?: number | null; ore_target_settimanali?: number | null; ore_target_mensili?: number | null }>()
            for (const c of (contracts || []) as Array<Contratto & { ore_target_giornaliere?: number | null; ore_target_settimanali?: number | null; ore_target_mensili?: number | null }>) {
                contractByOp.set(c.operatore_id, c)
            }

            // 3. Timesheet del range
            const { data: entries } = await supabase
                .from('timesheet_entries')
                .select('operatore_id, tipo, timestamp, data')
                .gte('data', from)
                .lte('data', to)
                .order('timestamp', { ascending: true })

            // Group entries by operator → day
            const byOpDay = new Map<string, Map<string, { entrata: string | null; uscita: string | null; pi: string[]; pf: string[] }>>()
            for (const e of (entries || []) as { operatore_id: string; tipo: string; timestamp: string; data: string }[]) {
                if (!byOpDay.has(e.operatore_id)) byOpDay.set(e.operatore_id, new Map())
                const dayMap = byOpDay.get(e.operatore_id)!
                const cur = dayMap.get(e.data) || { entrata: null, uscita: null, pi: [], pf: [] }
                if (e.tipo === 'entrata') cur.entrata = e.timestamp
                else if (e.tipo === 'uscita') cur.uscita = e.timestamp
                else if (e.tipo === 'pausa_inizio') cur.pi.push(e.timestamp)
                else if (e.tipo === 'pausa_fine') cur.pf.push(e.timestamp)
                dayMap.set(e.data, cur)
            }

            // 4. Calcolo per ogni operatore
            const result: PayrollRow[] = opList.map(op => {
                const c = contractByOp.get(op.id) || null
                const dayMap = byOpDay.get(op.id)
                let totalMinLav = 0
                let minOrdinari = 0
                let minStraord = 0
                // 2026-05-22: paga oraria DERIVATA dal pacchetto contrattuale
                // se non c'e' paga_oraria_eur esplicita. Es. contratto
                // €1000/sett + 47h/sett → derived = 21.28€/h.
                const oraExplicit = Number(c?.paga_oraria_eur || 0)
                const stipendio = Number(c?.stipendio_mensile_eur || 0)
                const freq = c?.stipendio_frequenza
                const orariaDerived = (() => {
                    if (oraExplicit > 0) return 0
                    if (stipendio <= 0) return 0
                    const settH = Number(c?.ore_target_settimanali || 0)
                    const mensH = Number(c?.ore_target_mensili || 0)
                    const giornH = Number(c?.ore_target_giornaliere || 0)
                    if (freq === 'settimanale' && settH > 0) return stipendio / settH
                    if (freq === 'mensile' && mensH > 0) return stipendio / mensH
                    if (freq === 'mensile' && settH > 0) return stipendio / (settH * 4.33)
                    if (freq === 'mensile' && giornH > 0) return stipendio / (giornH * 22)
                    if (settH > 0) return stipendio / settH
                    if (mensH > 0) return stipendio / mensH
                    if (giornH > 0) return stipendio / (giornH * 22)
                    return 0
                })()
                const oraria = oraExplicit > 0 ? oraExplicit : orariaDerived
                const straord = Number(c?.paga_straordinario_eur || 0)
                // 2026-06-01: STRAORDINARIO = supera la soglia GIORNALIERA (8h)
                // OPPURE la SETTIMANALE (40h) — qualunque venga superata, senza
                // doppio conteggio. Stesso calcolo del CalcolaPagaSection del
                // profilo operatore (devono coincidere). Prima qui si usava SOLO
                // una soglia giornaliera implicita (settimanali/5) per-giorno:
                // per Salvatore (40h/sett, 6×8h=48h) dava 0 straord — sbagliato,
                // la settimana supera 40h ⇒ 8h di straordinario.
                const dailyCapMin = Math.round(
                    (c?.ore_soglia_straordinario
                        ?? c?.ore_target_giornaliere
                        ?? op.ore_target_giornaliere
                        ?? 8) * 60
                )
                const weeklyCapMin = (c?.ore_target_settimanali != null && c.ore_target_settimanali > 0)
                    ? Math.round(c.ore_target_settimanali * 60)
                    : 0
                const sogliaMin = weeklyCapMin > 0 ? weeklyCapMin : dailyCapMin
                const straordEnabled = c?.straordinario_abilitato !== false && straord > 0 && sogliaMin > 0

                // ISO week key (YYYY-Www) — raggruppa giorni nella stessa settimana
                const isoWeekKey = (dateStr: string): string => {
                    const d = new Date(dateStr + 'T12:00:00Z')
                    const day = d.getUTCDay() || 7
                    d.setUTCDate(d.getUTCDate() + 4 - day)
                    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
                    const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
                    return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
                }

                if (dayMap) {
                    // 1) minuti per giorno + straord giornaliero, raggruppati per settimana
                    const weekTotal = new Map<string, number>()
                    const weekDailyOT = new Map<string, number>()
                    dayMap.forEach((t, dataKey) => {
                        if (!t.entrata) return
                        const end = t.uscita ? new Date(t.uscita).getTime() : new Date(t.entrata).getTime()
                        let m = Math.max(0, Math.round((end - new Date(t.entrata).getTime()) / 60000))
                        for (let i = 0; i < t.pi.length; i++) {
                            const start = new Date(t.pi[i]).getTime()
                            const fin = t.pf[i] ? new Date(t.pf[i]).getTime() : start
                            m -= Math.max(0, Math.round((fin - start) / 60000))
                        }
                        m = Math.max(0, m)
                        totalMinLav += m
                        if (m <= 0) return
                        const wk = isoWeekKey(dataKey)
                        weekTotal.set(wk, (weekTotal.get(wk) || 0) + m)
                        if (straordEnabled && dailyCapMin > 0 && m > dailyCapMin) {
                            const dayOT = m - dailyCapMin
                            weekDailyOT.set(wk, (weekDailyOT.get(wk) || 0) + dayOT)
                            minStraord += dayOT
                        }
                    })
                    // 2) straord settimanale residuo (oltre 40h, tolto il daily-OT)
                    if (straordEnabled && weeklyCapMin > 0) {
                        for (const [wk, total] of weekTotal) {
                            const overWeek = total > weeklyCapMin ? total - weeklyCapMin : 0
                            const alreadyDaily = weekDailyOT.get(wk) || 0
                            minStraord += Math.max(0, overWeek - alreadyDaily)
                        }
                    }
                    minOrdinari = Math.max(0, totalMinLav - minStraord)
                }

                const pagaOrd = (minOrdinari / 60) * oraria
                const pagaStraord = (minStraord / 60) * straord
                const oreRec = Number(op.ore_a_recuperare_min || 0)
                const correzione = -(oreRec / 60) * oraria
                const totale = pagaOrd + pagaStraord + correzione

                return {
                    operatore: op,
                    contratto: c,
                    minLavorati: totalMinLav,
                    minOrdinari, minStraord,
                    pagaOrd, pagaStraord, correzione,
                    totale,
                    hasContract: !!c && (oraria > 0 || (Number(c?.stipendio_mensile_eur) || 0) > 0),
                }
            })
            setRows(result)
        } catch (err) {
            console.error('[PayrollPeriodoView] load error', err)
        } finally {
            setLoading(false)
        }
    }, [from, to, isDirezione])

    useEffect(() => { load() }, [load])

    const sortedRows = useMemo(() => {
        const out = [...rows]
        out.sort((a, b) => {
            let cmp = 0
            if (sortKey === 'name') {
                const an = `${a.operatore.cognome || ''} ${a.operatore.nome || ''}`.toLowerCase()
                const bn = `${b.operatore.cognome || ''} ${b.operatore.nome || ''}`.toLowerCase()
                cmp = an.localeCompare(bn)
            } else if (sortKey === 'hours') {
                cmp = a.minLavorati - b.minLavorati
            } else {
                cmp = a.totale - b.totale
            }
            return sortDir === 'asc' ? cmp : -cmp
        })
        return out
    }, [rows, sortKey, sortDir])

    const grandTotal = useMemo(() => ({
        operatori: rows.length,
        minLavorati: rows.reduce((s, r) => s + r.minLavorati, 0),
        pagaOrd: rows.reduce((s, r) => s + r.pagaOrd, 0),
        pagaStraord: rows.reduce((s, r) => s + r.pagaStraord, 0),
        correzione: rows.reduce((s, r) => s + r.correzione, 0),
        totale: rows.reduce((s, r) => s + r.totale, 0),
        senzaContratto: rows.filter(r => !r.hasContract).length,
    }), [rows])

    function applyPreset(p: 'oggi' | 'settimana' | 'mese' | '30gg' | 'mese_scorso') {
        const today = new Date()
        if (p === 'oggi') {
            const t = toRomeDate(today)
            setFrom(t); setTo(t); return
        }
        if (p === 'settimana') {
            const d = new Date(today); const day = d.getDay() || 7
            d.setDate(d.getDate() - day + 1)
            setFrom(toRomeDate(d)); setTo(toRomeDate(today)); return
        }
        if (p === 'mese') {
            const d = new Date(today.getFullYear(), today.getMonth(), 1)
            setFrom(toRomeDate(d)); setTo(toRomeDate(today)); return
        }
        if (p === '30gg') {
            const d = new Date(); d.setDate(d.getDate() - 29)
            setFrom(toRomeDate(d)); setTo(toRomeDate(today)); return
        }
        if (p === 'mese_scorso') {
            const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
            const end = new Date(today.getFullYear(), today.getMonth(), 0)
            setFrom(toRomeDate(start)); setTo(toRomeDate(end)); return
        }
    }

    function exportCsv() {
        const headers = ['Operatore', 'Ruolo', 'Ore Lavorate', 'Ore Ord.', 'Ore Straord.', 'Paga Ord.', 'Paga Straord.', 'Correzione', 'Totale']
        const data = sortedRows.map(r => [
            `${r.operatore.nome} ${r.operatore.cognome || ''}`.trim(),
            r.operatore.ruolo || '',
            fmtMin(r.minLavorati),
            fmtMin(r.minOrdinari),
            fmtMin(r.minStraord),
            r.pagaOrd.toFixed(2),
            r.pagaStraord.toFixed(2),
            r.correzione.toFixed(2),
            r.totale.toFixed(2),
        ])
        const csv = [headers, ...data].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `buste_paga_${from}_${to}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    function sortBy(key: 'name' | 'hours' | 'total') {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
        else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
    }

    if (!isDirezione) {
        return (
            <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-6 text-center text-theme-text-muted text-sm">
                Accesso riservato alla direzione.
            </div>
        )
    }

    return (
        <div className="space-y-3">
            {/* Header con range + preset */}
            <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-4 flex flex-wrap items-end gap-3">
                <div>
                    <h2 className="text-base font-bold text-theme-text-primary">Buste Paga del Periodo</h2>
                    <p className="text-xs text-theme-text-muted">Calcola in un colpo solo quanto pagare a ogni operatore in base ai contratti + ore registrate.</p>
                </div>
                <div className="flex flex-wrap items-end gap-2 ml-auto">
                    <label className="flex flex-col text-[10px] uppercase text-theme-text-muted">
                        Da
                        <input type="date" value={from} max={to}
                            onChange={(e) => setFrom(e.target.value || from)}
                            className="bg-theme-bg-tertiary border border-theme-border rounded px-2 py-1 text-xs text-theme-text-primary" />
                    </label>
                    <label className="flex flex-col text-[10px] uppercase text-theme-text-muted">
                        A
                        <input type="date" value={to} min={from}
                            onChange={(e) => setTo(e.target.value || to)}
                            className="bg-theme-bg-tertiary border border-theme-border rounded px-2 py-1 text-xs text-theme-text-primary" />
                    </label>
                    <div className="inline-flex rounded-full border border-theme-border bg-theme-bg-tertiary p-0.5 text-[11px]">
                        <button onClick={() => applyPreset('oggi')} className="px-2 py-1 rounded-full text-theme-text-secondary hover:bg-theme-bg-hover">Oggi</button>
                        <button onClick={() => applyPreset('settimana')} className="px-2 py-1 rounded-full text-theme-text-secondary hover:bg-theme-bg-hover">Settimana</button>
                        <button onClick={() => applyPreset('mese')} className="px-2 py-1 rounded-full text-theme-text-secondary hover:bg-theme-bg-hover">Mese</button>
                        <button onClick={() => applyPreset('mese_scorso')} className="px-2 py-1 rounded-full text-theme-text-secondary hover:bg-theme-bg-hover">Mese scorso</button>
                        <button onClick={() => applyPreset('30gg')} className="px-2 py-1 rounded-full text-theme-text-secondary hover:bg-theme-bg-hover">30gg</button>
                    </div>
                    <button onClick={exportCsv}
                        className="px-3 py-1.5 rounded bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs hover:bg-theme-bg-hover">
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Grand totals */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                    <div className="text-[10px] uppercase text-theme-text-muted">Operatori</div>
                    <div className="text-2xl font-bold text-theme-text-primary">{grandTotal.operatori}</div>
                    {grandTotal.senzaContratto > 0 && <div className="text-[10px] text-amber-400">{grandTotal.senzaContratto} senza contratto</div>}
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                    <div className="text-[10px] uppercase text-theme-text-muted">Ore Tot.</div>
                    <div className="text-lg font-bold text-theme-text-primary">{fmtMin(grandTotal.minLavorati)}</div>
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                    <div className="text-[10px] uppercase text-theme-text-muted">Paga Ord.</div>
                    <div className="text-lg font-bold text-emerald-400 tabular-nums">{eur(grandTotal.pagaOrd)}</div>
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                    <div className="text-[10px] uppercase text-theme-text-muted">Paga Straord.</div>
                    <div className="text-lg font-bold text-sky-400 tabular-nums">{eur(grandTotal.pagaStraord)}</div>
                </div>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-3">
                    <div className="text-[10px] uppercase text-theme-text-muted">Correzioni</div>
                    <div className={`text-lg font-bold tabular-nums ${grandTotal.correzione < 0 ? 'text-rose-400' : grandTotal.correzione > 0 ? 'text-emerald-400' : 'text-theme-text-muted'}`}>{grandTotal.correzione === 0 ? '—' : eur(grandTotal.correzione)}</div>
                </div>
                <div className="bg-dr7-gold/10 border border-dr7-gold/40 rounded-lg p-3">
                    <div className="text-[10px] uppercase text-theme-text-muted">Totale da Pagare</div>
                    <div className="text-xl font-bold text-dr7-gold tabular-nums">{eur(grandTotal.totale)}</div>
                </div>
            </div>

            {/* Tabella */}
            <div className="bg-theme-bg-secondary border border-theme-border rounded-lg overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="text-theme-text-muted text-[10px] uppercase">
                            <th onClick={() => sortBy('name')} className="text-left py-2 px-3 cursor-pointer hover:text-theme-text-primary">Operatore {sortKey === 'name' && (sortDir === 'asc' ? '↑' : '↓')}</th>
                            <th className="text-left py-2 px-3">Ruolo</th>
                            <th className="text-left py-2 px-3">Contratto</th>
                            <th onClick={() => sortBy('hours')} className="text-right py-2 px-3 cursor-pointer hover:text-theme-text-primary">Ore Lav. {sortKey === 'hours' && (sortDir === 'asc' ? '↑' : '↓')}</th>
                            <th className="text-right py-2 px-3">Ore Ord.</th>
                            <th className="text-right py-2 px-3">Straord.</th>
                            <th className="text-right py-2 px-3">Paga Ord.</th>
                            <th className="text-right py-2 px-3">Paga Straord.</th>
                            <th className="text-right py-2 px-3">Corr.</th>
                            <th onClick={() => sortBy('total')} className="text-right py-2 px-3 cursor-pointer hover:text-theme-text-primary">Totale {sortKey === 'total' && (sortDir === 'asc' ? '↑' : '↓')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={10} className="text-center py-4 text-theme-text-muted">Caricamento…</td></tr>
                        )}
                        {!loading && sortedRows.length === 0 && (
                            <tr><td colSpan={10} className="text-center py-4 text-theme-text-muted">Nessun operatore</td></tr>
                        )}
                        {!loading && sortedRows.map(r => {
                            const tone = avatarTone(r.operatore.email || r.operatore.id)
                            const initials = `${(r.operatore.nome || '').charAt(0)}${(r.operatore.cognome || '').charAt(0)}`.toUpperCase()
                            return (
                                <tr key={r.operatore.id}
                                    onClick={() => setProfileOp(r.operatore)}
                                    className="border-t border-theme-border/30 hover:bg-theme-bg-hover/30 cursor-pointer">
                                    <td className="py-1.5 px-3">
                                        <span className="inline-flex items-center gap-2">
                                            {r.operatore.avatar_url
                                                ? <img src={r.operatore.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                                                : <span className={`w-6 h-6 rounded-full ${tone} flex items-center justify-center text-white text-[10px] font-bold`}>{initials}</span>}
                                            <span className="text-theme-text-primary underline-offset-2 hover:underline">{r.operatore.nome} {r.operatore.cognome}</span>
                                        </span>
                                    </td>
                                    <td className="py-1.5 px-3 text-theme-text-muted">{r.operatore.ruolo || '—'}</td>
                                    <td className="py-1.5 px-3">
                                        {r.hasContract ? (
                                            <span className="text-theme-text-primary text-[11px]">€{Number(r.contratto?.paga_oraria_eur || 0).toFixed(2)}/h</span>
                                        ) : (
                                            <span className="text-amber-400 text-[11px]">No contratto</span>
                                        )}
                                    </td>
                                    <td className="py-1.5 px-3 text-right text-theme-text-primary tabular-nums">{fmtMin(r.minLavorati)}</td>
                                    <td className="py-1.5 px-3 text-right text-theme-text-muted tabular-nums">{fmtMin(r.minOrdinari)}</td>
                                    <td className="py-1.5 px-3 text-right text-theme-text-muted tabular-nums">{r.minStraord > 0 ? fmtMin(r.minStraord) : '—'}</td>
                                    <td className="py-1.5 px-3 text-right text-emerald-400 tabular-nums">{r.pagaOrd > 0 ? eur(r.pagaOrd) : '—'}</td>
                                    <td className="py-1.5 px-3 text-right text-sky-400 tabular-nums">{r.pagaStraord > 0 ? eur(r.pagaStraord) : '—'}</td>
                                    <td className={`py-1.5 px-3 text-right tabular-nums ${r.correzione < 0 ? 'text-rose-400' : r.correzione > 0 ? 'text-emerald-400' : 'text-theme-text-muted'}`}>{r.correzione === 0 ? '—' : eur(r.correzione)}</td>
                                    <td className="py-1.5 px-3 text-right font-bold tabular-nums text-dr7-gold">{eur(r.totale)}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            <div className="text-[10px] text-theme-text-muted">
                Click su una riga per aprire il dettaglio completo dell'operatore (modale con ore per giorno, contratto, calcolatrice).
                Le ore a recuperare aggiornate nel modale si riflettono qui al refresh.
            </div>

            {profileOp && (
                <OperatorProfileModal
                    operatore={profileOp}
                    onClose={() => { setProfileOp(null); load() }}
                />
            )}
        </div>
    )
}
