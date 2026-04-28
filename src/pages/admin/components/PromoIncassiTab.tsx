import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../../utils/authFetch'
import { supabase } from '../../../supabaseClient'

/**
 * Promo Incassi.
 *
 * Body del messaggio: vive in Messaggi di Sistema Pro → "PROMO INCASSI".
 * Variabili: {vehicle}, {coefficiente}, {incasso_attuale}, {soglia},
 *            {month}, {year}, {year_month}.
 *
 * Modalità (salvate nella tabella promo_incassi_settings):
 *   - off       → il cron non invia nulla
 *   - pilot     → invia SOLO al numero pilota indicato qui
 *   - broadcast → invia a tutti i clienti con telefono in customers_extended
 *
 * Trigger del cron: ogni giorno alle 09:00 e 17:00 Europe/Rome. Per ogni
 * veicolo con obiettivo configurato in Centralina Pro, calcola l'incasso
 * del mese e invia la promo se il coefficiente attivo è ≤ threshold
 * (default 0.8). Dedup per (veicolo, mese, coefficiente, destinatario).
 */
type Mode = 'off' | 'pilot' | 'broadcast'

interface Settings {
    mode: Mode
    pilot_phone: string | null
    threshold_coeff: number
    updated_at: string
}

export default function PromoIncassiTab() {
    const [settings, setSettings] = useState<Settings | null>(null)
    const [draftMode, setDraftMode] = useState<Mode>('off')
    const [draftPhone, setDraftPhone] = useState('')
    const [draftThreshold, setDraftThreshold] = useState<string>('0.8')
    const [savingSettings, setSavingSettings] = useState(false)

    const [phone, setPhone] = useState('')
    const [loading, setLoading] = useState(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [lastResult, setLastResult] = useState<any | null>(null)

    useEffect(() => {
        loadSettings()
    }, [])

    async function loadSettings() {
        const { data } = await supabase
            .from('promo_incassi_settings')
            .select('mode, pilot_phone, threshold_coeff, updated_at')
            .eq('id', 1)
            .maybeSingle()
        if (data) {
            setSettings(data as Settings)
            setDraftMode((data.mode as Mode) || 'off')
            setDraftPhone(data.pilot_phone || '')
            setDraftThreshold(String(data.threshold_coeff ?? 0.8))
        } else {
            setSettings({ mode: 'off', pilot_phone: null, threshold_coeff: 0.8, updated_at: '' })
        }
    }

    async function saveSettings() {
        if (draftMode === 'pilot' && !draftPhone.trim()) {
            toast.error('Inserisci il numero pilota')
            return
        }
        const thr = parseFloat(draftThreshold)
        if (!Number.isFinite(thr) || thr <= 0 || thr > 1) {
            toast.error('Threshold non valido (deve essere tra 0 e 1, es. 0.8)')
            return
        }
        setSavingSettings(true)
        try {
            const payload = {
                id: 1,
                mode: draftMode,
                pilot_phone: draftMode === 'pilot' ? draftPhone.trim() : null,
                threshold_coeff: thr,
                updated_at: new Date().toISOString(),
            }
            const { error } = await supabase
                .from('promo_incassi_settings')
                .upsert(payload, { onConflict: 'id' })
            if (error) throw error
            toast.success('Impostazioni salvate')
            await loadSettings()
        } catch (err) {
            const msg = err instanceof Error
                ? err.message
                : (err && typeof err === 'object'
                    ? ((err as { message?: string; error?: string; details?: string; hint?: string }).message
                        || (err as { error?: string }).error
                        || (err as { details?: string }).details
                        || (err as { hint?: string }).hint
                        || JSON.stringify(err))
                    : String(err))
            toast.error(msg)
        } finally {
            setSavingSettings(false)
        }
    }

    async function runDryRun() {
        setLoading(true)
        setLastResult(null)
        try {
            const res = await authFetch('/.netlify/functions/promo-incassi-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dryRun: true }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
            setLastResult(data)
            toast.success(`${data.count} veicoli sotto soglia ${data.threshold_coeff} per ${data.year_month}`)
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            toast.error(msg)
        } finally {
            setLoading(false)
        }
    }

    async function runTestSend() {
        if (!phone.trim()) {
            toast.error('Inserisci un numero di telefono di test')
            return
        }
        if (!confirm(`Inviare PROMO INCASSI al numero ${phone.trim()}?\n\nIl messaggio verrà letto da Messaggi di Sistema Pro (template PROMO INCASSI).`)) return

        setLoading(true)
        setLastResult(null)
        const toastId = toast.loading('Calcolo incassi + invio in corso...')
        try {
            const res = await authFetch('/.netlify/functions/promo-incassi-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phone.trim() }),
            })
            const data = await res.json()
            toast.dismiss(toastId)
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
            setLastResult(data)
            if (data.vehiclesFound === 0) {
                toast(`Nessun veicolo sotto soglia ${data.threshold_coeff} per ${data.year_month}`, { icon: 'ℹ️' })
            } else if (data.sent === data.vehiclesFound) {
                toast.success(`${data.sent}/${data.vehiclesFound} messaggi inviati a ${data.recipient}`)
            } else {
                toast.error(`Inviati ${data.sent}/${data.vehiclesFound} (${data.failed} falliti)`)
            }
        } catch (err) {
            toast.dismiss(toastId)
            toast.error(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }

    const modeBadge = (m: Mode) => {
        const map: Record<Mode, { label: string; cls: string }> = {
            off: { label: 'OFF', cls: 'bg-gray-600/30 text-gray-300' },
            pilot: { label: 'PILOT', cls: 'bg-amber-500/20 text-amber-300 border border-amber-500/40' },
            broadcast: { label: 'BROADCAST', cls: 'bg-green-600/20 text-green-300 border border-green-600/40' },
        }
        const c = map[m]
        return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${c.cls}`}>{c.label}</span>
    }

    return (
        <div className="p-3 sm:p-6">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-theme-text-primary mb-1">Promo Incassi</h2>
                <p className="text-sm text-theme-text-muted">
                    Quando un veicolo raggiunge il coefficiente soglia (default <span className="text-dr7-gold font-medium">0.8</span>) del proprio
                    obiettivo mensile, parte automaticamente la promo. Il body del messaggio si gestisce in&nbsp;
                    <span className="text-dr7-gold font-medium">Messaggi di Sistema Pro</span> →
                    template <span className="text-dr7-gold font-medium">PROMO INCASSI</span>.
                    Variabili supportate:&nbsp;
                    <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-dr7-gold">{'{vehicle}'}</code>,&nbsp;
                    <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-dr7-gold">{'{coefficiente}'}</code>,&nbsp;
                    <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-dr7-gold">{'{incasso_attuale}'}</code>,&nbsp;
                    <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-dr7-gold">{'{soglia}'}</code>.
                </p>
            </div>

            {/* AUTOMAZIONE */}
            <div className="bg-theme-bg-secondary border border-theme-border rounded-3xl p-6 max-w-2xl mb-6">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h3 className="text-lg font-bold text-theme-text-primary">Automazione cron</h3>
                    {settings && modeBadge(settings.mode)}
                </div>
                <p className="text-xs text-theme-text-muted mb-4">
                    Il cron parte ogni giorno alle <span className="text-dr7-gold font-medium">09:00</span> e <span className="text-dr7-gold font-medium">17:00</span> Europe/Rome.
                    Per ogni veicolo con obiettivo in Centralina Pro, controlla l'incasso del mese corrente e — se il coefficiente
                    attivo è ≤ soglia — invia la promo. Dedup automatico per (veicolo, mese, coefficiente, destinatario): mai due volte
                    lo stesso messaggio.
                </p>

                <div className="space-y-3">
                    <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">Modalità</label>
                        <div className="flex gap-2 flex-wrap">
                            {(['off', 'pilot', 'broadcast'] as Mode[]).map(m => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setDraftMode(m)}
                                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${draftMode === m ? 'bg-dr7-gold text-white' : 'bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover'}`}
                                >
                                    {m === 'off' ? 'Off' : m === 'pilot' ? 'Pilot (1 numero)' : 'Broadcast (tutti i clienti)'}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-theme-text-muted mt-2">
                            {draftMode === 'off' && 'Il cron non invia nulla. Usa questa modalità per mettere in pausa.'}
                            {draftMode === 'pilot' && 'Invia SOLO al numero pilota qui sotto. Niente broadcast.'}
                            {draftMode === 'broadcast' && 'Invia a tutti i clienti con telefono in customers_extended (blacklist inclusa). Lista caricata automaticamente, NON serve inserirli a mano.'}
                        </p>
                    </div>

                    {draftMode === 'pilot' && (
                        <div>
                            <label className="block text-sm font-semibold text-theme-text-primary mb-2">Numero pilota</label>
                            <input
                                type="tel"
                                value={draftPhone}
                                onChange={(e) => setDraftPhone(e.target.value)}
                                placeholder="es. +39 347 281 7258"
                                className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-semibold text-theme-text-primary mb-2">Coefficiente soglia</label>
                        <input
                            type="number"
                            step="0.05"
                            min="0.1"
                            max="1"
                            value={draftThreshold}
                            onChange={(e) => setDraftThreshold(e.target.value)}
                            className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                        />
                        <p className="text-xs text-theme-text-muted mt-2">
                            La promo parte quando il coefficiente attivo del veicolo è ≤ a questo valore. Default <span className="text-dr7-gold">0.8</span>.
                        </p>
                    </div>

                    <div className="flex gap-3 justify-end">
                        <button
                            onClick={saveSettings}
                            disabled={savingSettings}
                            className="px-5 py-2.5 bg-dr7-gold text-white rounded-full font-semibold hover:bg-[#247a6f] transition-colors disabled:opacity-50"
                        >
                            {savingSettings ? 'Salvataggio...' : 'Salva impostazioni cron'}
                        </button>
                    </div>
                </div>
            </div>

            {/* TEST manuale */}
            <div className="bg-theme-bg-secondary border border-theme-border rounded-3xl p-6 max-w-2xl">
                <h3 className="text-lg font-bold text-theme-text-primary mb-3">Test manuale</h3>
                <p className="text-xs text-theme-text-muted mb-4">
                    Invio una-tantum a un singolo numero — utile per provare il body del messaggio
                    senza modificare la modalità del cron qui sopra.
                </p>
                <div className="mb-4">
                    <label className="block text-sm font-semibold text-theme-text-primary mb-2">
                        Numero di test
                    </label>
                    <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="es. +39 345 790 5205"
                        className="w-full px-4 py-3 bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary focus:outline-none focus:border-dr7-gold transition-colors"
                    />
                </div>

                <div className="flex gap-3 flex-wrap">
                    <button
                        onClick={runDryRun}
                        disabled={loading}
                        className="px-5 py-2.5 bg-theme-bg-tertiary text-theme-text-secondary rounded-full font-medium hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
                    >
                        {loading ? '...' : 'Rileva (senza inviare)'}
                    </button>
                    <button
                        onClick={runTestSend}
                        disabled={loading}
                        className="px-5 py-2.5 bg-green-600 text-white rounded-full font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                        {loading ? 'Invio...' : 'Rileva e invia test'}
                    </button>
                </div>
            </div>

            {lastResult && (
                <div className="mt-6 bg-theme-bg-secondary border border-theme-border rounded-3xl p-6 max-w-3xl">
                    <h3 className="text-lg font-bold text-theme-text-primary mb-3">Esito ultimo run</h3>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                        <Stat label="Veicoli sotto soglia" value={lastResult.count ?? lastResult.vehiclesFound ?? 0} color="text-dr7-gold" />
                        <Stat label="Inviati" value={lastResult.sent ?? '—'} color="text-green-400" />
                        <Stat label="Falliti" value={lastResult.failed ?? '—'} color="text-red-400" />
                        <Stat label="Mese" value={lastResult.year_month || '—'} small />
                    </div>

                    {Array.isArray(lastResult.vehicles) && lastResult.vehicles.length > 0 && (
                        <div>
                            <h4 className="text-sm font-semibold text-theme-text-primary mb-2">Veicoli rilevati</h4>
                            <ul className="text-sm space-y-1">
                                {lastResult.vehicles.map((v: { id: string; name: string; plate?: string | null; monthly_revenue: number; active_coeff: number; threshold_min: number }, i: number) => (
                                    <li key={i} className="px-3 py-1.5 rounded-lg bg-theme-bg-tertiary text-theme-text-primary flex flex-wrap gap-x-3 gap-y-1 items-baseline">
                                        <span className="font-medium">{v.name}</span>
                                        {v.plate && <span className="text-theme-text-muted text-xs">{v.plate}</span>}
                                        <span className="ml-auto inline-flex items-center gap-2 text-xs">
                                            <span className="text-theme-text-muted">Incasso:</span>
                                            <span className="text-dr7-gold font-medium tabular-nums">€{v.monthly_revenue.toFixed(0)}</span>
                                            <span className="text-theme-text-muted">· coeff</span>
                                            <span className="text-dr7-gold font-medium tabular-nums">{v.active_coeff}</span>
                                            <span className="text-theme-text-muted">· soglia €{v.threshold_min}</span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {Array.isArray(lastResult.results) && lastResult.results.length > 0 && (
                        <div className="mt-4">
                            <h4 className="text-sm font-semibold text-theme-text-primary mb-2">Dettaglio invii</h4>
                            <ul className="text-sm space-y-1">
                                {lastResult.results.map((r: { vehicle: string; ok: boolean; reason?: string }, i: number) => (
                                    <li key={i} className={`px-3 py-1.5 rounded-lg ${r.ok ? 'bg-green-900/20 text-green-300' : 'bg-red-900/20 text-red-300'}`}>
                                        <span className="font-medium">{r.vehicle}</span>
                                        {r.ok ? ' · inviato' : ` · ${r.reason || 'fallito'}`}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

function Stat({ label, value, color, small }: { label: string; value: number | string; color?: string; small?: boolean }) {
    return (
        <div className="bg-theme-bg-tertiary border border-theme-border rounded-2xl p-3">
            <div className="text-xs text-theme-text-muted">{label}</div>
            <div className={`${small ? 'text-sm' : 'text-2xl'} font-bold ${color || 'text-theme-text-primary'} truncate`}>{value}</div>
        </div>
    )
}
