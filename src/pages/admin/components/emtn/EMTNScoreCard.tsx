/**
 * EMTN Score — scheda laterale del cliente.
 *
 * 01/10/2026 (direzione): sostituisce "Mobility Trust Status", che mostrava
 * numeri inventati ("Score noleggi" = score x noleggi / 35, "Recenti" sempre
 * 0, data di oggi come "Aggiornato il", 85/60/30 se mancava lo score).
 * Tutto quello che si vede qui arriva dal motore (src/utils/emtnScore):
 * score, confidence, livello, trend, fattori, flag, spiegazione e storico
 * dei ricalcoli. La direzione puo' intervenire a mano, sempre con motivo.
 */
import { useState } from 'react'
import { authFetch } from '../../../../utils/authFetch'

export interface EMTNScoreUI {
    versione: string
    score: number
    scoreCalcolato: number
    confidence: number
    livello: 'Very Low' | 'Low' | 'Moderate' | 'High' | 'Critical'
    band: 'green' | 'yellow' | 'red'
    level: 1 | 2 | 3
    trend: 'Improving' | 'Stable' | 'Deteriorating'
    scorePrecedente6Mesi: number | null
    profiloInCostruzione: boolean
    revisioneManuale: boolean
    flag: Array<{ codice: string; label: string; tetto: number }>
    positivi: string[]
    rischi: string[]
    spiegazione: string
    override: { id?: string; tipo: string; valore: number | null; motivo: string; operatore: string | null; creato_il: string } | null
    dettaglio: {
        noleggiConclusi: number
        noleggiRegolari: number
        eventiConsiderati: number
        eventiInRevisione: number
        nonSaldati: number
        residuo: number
    }
    storico?: Array<{
        score_precedente: number | null
        score: number
        confidence: number
        livello: string
        causa: string
        versione: string
        created_at: string
        operatore_email: string | null
    }>
}

const LIVELLI: Record<EMTNScoreUI['livello'], string> = {
    'Very Low': 'Rischio molto basso',
    Low: 'Rischio basso',
    Moderate: 'Rischio moderato',
    High: 'Rischio alto',
    Critical: 'Rischio critico',
}
const TREND: Record<EMTNScoreUI['trend'], string> = {
    Improving: 'In miglioramento',
    Stable: 'Stabile',
    Deteriorating: 'In peggioramento',
}
const TIPI_OVERRIDE: Array<{ id: string; label: string }> = [
    { id: 'limite_massimo', label: 'Limite massimo' },
    { id: 'score_fisso', label: 'Score fisso' },
    { id: 'flag_critico', label: 'Flag critico (tetto)' },
]

function tono(band: EMTNScoreUI['band']) {
    return band === 'green'
        ? { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-600 dark:text-emerald-400', stroke: '#10b981' }
        : band === 'yellow'
            ? { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-600 dark:text-amber-400', stroke: '#f59e0b' }
            : { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-600 dark:text-red-400', stroke: '#ef4444' }
}

function dataOra(v: string): string {
    const d = new Date(v)
    if (!Number.isFinite(d.getTime())) return '—'
    return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' })
}

function Gauge({ score, stroke }: { score: number; stroke: string }) {
    const r = 30
    const c = 2 * Math.PI * r
    const pct = Math.max(0, Math.min(100, score))
    return (
        <svg width="76" height="76" viewBox="0 0 76 76" className="shrink-0">
            <circle cx="38" cy="38" r={r} fill="none" strokeWidth="6" className="stroke-theme-bg-tertiary" stroke="currentColor" />
            <circle cx="38" cy="38" r={r} fill="none" stroke={stroke} strokeWidth="6" strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 38 38)" />
        </svg>
    )
}

export default function EMTNScoreCard({ score, clientId, isDirezione, onAggiornato }: {
    score: EMTNScoreUI | undefined
    clientId: string
    isDirezione: boolean
    onAggiornato: () => void
}) {
    const [apriStorico, setApriStorico] = useState(false)
    const [apriOverride, setApriOverride] = useState(false)
    const [tipo, setTipo] = useState('limite_massimo')
    const [valore, setValore] = useState('')
    const [motivo, setMotivo] = useState('')
    const [salvando, setSalvando] = useState(false)
    const [errore, setErrore] = useState<string | null>(null)

    if (!score) {
        return (
            <section className="rounded-2xl border border-theme-border bg-theme-bg-secondary p-4">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">EMTN Score</h3>
                <p className="text-xs text-theme-text-muted mt-2">Score non disponibile per questa ricerca.</p>
            </section>
        )
    }

    const t = tono(score.band)

    async function invia(body: Record<string, unknown>) {
        setSalvando(true)
        setErrore(null)
        try {
            const res = await authFetch('/.netlify/functions/emtn-score-override', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            const j = await res.json()
            if (!res.ok) throw new Error(j.error || 'Operazione non riuscita')
            setApriOverride(false)
            setMotivo('')
            setValore('')
            onAggiornato()
        } catch (e) {
            setErrore((e as Error).message)
        } finally {
            setSalvando(false)
        }
    }

    return (
        <section className={`rounded-2xl border ${t.border} ${t.bg} p-4 space-y-3`}>
            <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">EMTN Score</h3>
                <span className={`text-[10px] font-semibold ${t.text}`}>{LIVELLI[score.livello]}</span>
            </div>

            <div className="flex items-center gap-3">
                <div className="relative">
                    <Gauge score={score.score} stroke={t.stroke} />
                    <div className="absolute inset-0 grid place-items-center">
                        <p className="text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider">{score.level === 1 ? 'Liv. 1' : score.level === 2 ? 'Liv. 2' : 'Liv. 3'}</p>
                    </div>
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                    <p className={`text-2xl font-bold tabular-nums leading-none ${t.text}`}>
                        {score.score}<span className="text-sm text-theme-text-muted font-medium">/100</span>
                    </p>
                    <p className="text-[11px] text-theme-text-secondary">
                        Attendibilita' <span className="font-semibold text-theme-text-primary tabular-nums">{score.confidence}%</span>
                        {' · '}{TREND[score.trend]}
                        {score.scorePrecedente6Mesi != null && score.trend !== 'Stable' && (
                            <span className="text-theme-text-muted"> (6 mesi fa {score.scorePrecedente6Mesi})</span>
                        )}
                    </p>
                    <div className="h-1.5 rounded-full bg-theme-bg-tertiary overflow-hidden">
                        {/* Attendibilita' = quantita' di dati, non rischio: colore neutro. */}
                        <div className="h-full bg-cyan-600 dark:bg-cyan-400" style={{ width: `${score.confidence}%` }} />
                    </div>
                </div>
            </div>

            {score.profiloInCostruzione && (
                <p className="text-[11px] rounded-lg border border-theme-border bg-theme-bg-secondary px-2.5 py-1.5 text-theme-text-secondary">
                    Profilo in costruzione: storico insufficiente. L'assenza di problemi non e' ancora prova di affidabilita'.
                </p>
            )}

            {score.flag.length > 0 && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Flag critici · revisione manuale</p>
                    {score.flag.map((f, i) => (
                        <p key={i} className="text-[11px] text-theme-text-primary">{f.label} <span className="text-theme-text-muted">(max {f.tetto})</span></p>
                    ))}
                </div>
            )}

            <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-theme-border bg-theme-bg-secondary py-2">
                    <p className="text-base font-bold text-theme-text-primary tabular-nums">{score.dettaglio.noleggiConclusi}</p>
                    <p className="text-[10px] text-theme-text-muted">Noleggi conclusi</p>
                </div>
                <div className="rounded-lg border border-theme-border bg-theme-bg-secondary py-2">
                    <p className="text-base font-bold text-theme-text-primary tabular-nums">{score.dettaglio.eventiConsiderati}</p>
                    <p className="text-[10px] text-theme-text-muted">Eventi documentati</p>
                </div>
                <div className="rounded-lg border border-theme-border bg-theme-bg-secondary py-2">
                    <p className="text-base font-bold text-theme-text-primary tabular-nums">{score.dettaglio.nonSaldati}</p>
                    <p className="text-[10px] text-theme-text-muted">Non saldati</p>
                </div>
            </div>
            {score.dettaglio.eventiInRevisione > 0 && (
                <p className="text-[11px] text-theme-text-muted">
                    {score.dettaglio.eventiInRevisione} segnalazioni in revisione: non pesano finche' la direzione non decide.
                </p>
            )}

            {score.positivi.length > 0 && (
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Fattori positivi</p>
                    <ul className="space-y-0.5">
                        {score.positivi.map((p, i) => <li key={i} className="text-[11px] text-theme-text-primary">+ {p}</li>)}
                    </ul>
                </div>
            )}
            {score.rischi.length > 0 && (
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Fattori di rischio</p>
                    <ul className="space-y-0.5">
                        {score.rischi.map((r, i) => <li key={i} className="text-[11px] text-theme-text-primary">- {r}</li>)}
                    </ul>
                </div>
            )}

            <div className="pt-2 border-t border-theme-border">
                <p className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1">Spiegazione</p>
                <p className="text-[11px] text-theme-text-secondary leading-relaxed">{score.spiegazione}</p>
            </div>

            {score.override && (
                <p className="text-[11px] rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1.5 text-theme-text-primary">
                    Intervento manuale ({score.override.operatore || 'direzione'}, {dataOra(score.override.creato_il)}): {score.override.motivo}.
                    Score calcolato dal motore: {score.scoreCalcolato}.
                </p>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
                <button type="button" onClick={() => setApriStorico(v => !v)}
                    className="text-[11px] font-medium text-cyan-600 dark:text-cyan-400 hover:underline">
                    {apriStorico ? 'Nascondi storico' : 'Storico dello score'}
                </button>
                {isDirezione && (
                    <button type="button" onClick={() => setApriOverride(v => !v)}
                        className="text-[11px] font-medium text-theme-text-secondary hover:text-theme-text-primary">
                        {apriOverride ? 'Annulla' : 'Intervento manuale'}
                    </button>
                )}
            </div>

            {apriStorico && (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {(score.storico || []).length === 0 && <p className="text-[11px] text-theme-text-muted">Nessun ricalcolo registrato.</p>}
                    {(score.storico || []).map((r, i) => (
                        <div key={i} className="rounded-lg border border-theme-border bg-theme-bg-secondary px-2.5 py-1.5">
                            <p className="text-[11px] text-theme-text-primary tabular-nums">
                                {r.score_precedente != null ? `${r.score_precedente} → ` : ''}<span className="font-semibold">{r.score}</span>
                                <span className="text-theme-text-muted"> · attendibilita' {r.confidence}% · {dataOra(r.created_at)}</span>
                            </p>
                            <p className="text-[10px] text-theme-text-muted">{r.causa} · {r.versione}</p>
                        </div>
                    ))}
                </div>
            )}

            {apriOverride && isDirezione && (
                <div className="space-y-2 rounded-lg border border-theme-border bg-theme-bg-secondary p-2.5">
                    <div className="flex gap-2">
                        <select value={tipo} onChange={e => setTipo(e.target.value)}
                            className="flex-1 rounded-md border border-theme-border bg-theme-bg-primary text-theme-text-primary text-xs px-2 py-1.5">
                            {TIPI_OVERRIDE.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                        <input value={valore} onChange={e => setValore(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
                            inputMode="numeric" placeholder={tipo === 'flag_critico' ? 'Tetto 0-100' : '0-100'}
                            className="w-20 rounded-md border border-theme-border bg-theme-bg-primary text-theme-text-primary text-xs px-2 py-1.5" />
                    </div>
                    <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                        placeholder="Motivo (obbligatorio, resta nello storico)"
                        className="w-full rounded-md border border-theme-border bg-theme-bg-primary text-theme-text-primary text-xs px-2 py-1.5" />
                    {errore && <p className="text-[11px] text-red-600 dark:text-red-400">{errore}</p>}
                    <div className="flex items-center justify-between gap-2">
                        <span />
                        <div className="flex gap-2">
                            {score.override?.id && (
                                <button type="button" disabled={salvando}
                                    onClick={() => invia({ azione: 'revoca', overrideId: score.override!.id })}
                                    className="px-3 py-1.5 rounded-md border border-theme-border text-xs text-theme-text-secondary hover:bg-theme-bg-hover disabled:opacity-50">
                                    Revoca intervento
                                </button>
                            )}
                            <button type="button" disabled={salvando || motivo.trim().length < 10 || valore === '' || Number(valore) > 100}
                                onClick={() => invia({ azione: 'crea', clientId, tipo, valore: valore === '' ? null : Number(valore), motivo: motivo.trim() })}
                                className="px-3 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold disabled:opacity-50">
                                {salvando ? 'Salvataggio...' : 'Applica'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <p className="text-[10px] text-theme-text-muted">Algoritmo {score.versione}. Calcolato a ogni consultazione dai dati documentati.</p>
        </section>
    )
}
