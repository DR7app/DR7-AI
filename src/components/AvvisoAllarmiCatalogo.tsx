import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useVehicleAlarm } from '../contexts/VehicleAlarmContext'
import { useAdminRole } from '../hooks/useAdminRole'
import { posticipaEvento, risolviEvento } from '../utils/alarmEngine'
import { PRIORITY_LABEL, PRIORITY_STYLE } from '../data/alarmCatalog'

/**
 * 02/10/2026: gli allarmi del catalogo (Centralina Pro > Allarmi) comparivano
 * come toast in alto a destra, che spariva da solo dopo 15 secondi. La
 * direzione: "ca doit etre le pop up fenetre au milieu". Stessa finestra
 * centrale del popup storico (AlarmNotification): resta aperta finche'
 * qualcuno non la chiude, il clic sullo sfondo non basta.
 *
 * Risolto / Posticipa scrivono su `alarm_events` come il pannello Aperti,
 * quindi tutti gli operatori vedono la stessa cosa.
 */
export default function AvvisoAllarmiCatalogo() {
    const { avvisoCatalogo, chiudiAvvisoCatalogo, alarmState } = useVehicleAlarm()
    const { adminName } = useAdminRole()
    const navigate = useNavigate()
    const [fatti, setFatti] = useState<Record<string, string>>({})
    const [inCorso, setInCorso] = useState<string | null>(null)

    // Il popup storico (rientro, cauzione...) ha la precedenza: uno alla volta.
    if (!avvisoCatalogo || alarmState.activeAlarm) return null
    const righe = avvisoCatalogo.righe

    const chiudi = () => {
        setFatti({})
        chiudiAvvisoCatalogo()
    }

    const azione = async (id: string, fn: () => PromiseLike<{ error: unknown } | unknown>, esito: string) => {
        setInCorso(id)
        try {
            const res = await fn() as { error?: { message?: string } | null } | undefined
            if (res && res.error) throw new Error(res.error.message || 'operazione fallita')
            const next = { ...fatti, [id]: esito }
            setFatti(next)
            // Tutte le righe sistemate: la finestra si chiude da sola.
            if (righe.every(r => next[r.evento.id])) setTimeout(chiudi, 600)
        } catch (e) {
            toast.error('Errore: ' + (e as Error).message)
        } finally {
            setInCorso(null)
        }
    }

    const apriElenco = () => {
        navigate('/admin?tab=centralina-pro')
        window.dispatchEvent(new CustomEvent('admin:navigate-tab', { detail: { tab: 'centralina-pro' } }))
        // La tab si monta dopo il cambio: la sezione si chiede quando c'e'.
        for (const ms of [50, 300, 800]) {
            setTimeout(() => window.dispatchEvent(new CustomEvent('centralina:goto-section', { detail: { section: 'allarmi' } })), ms)
        }
        chiudi()
    }

    return (
        <>
            <div className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm" aria-hidden="true" />

            <div
                className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none"
                role="dialog"
                aria-live="assertive"
            >
                <div className="pointer-events-auto bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden animate-[scaleIn_0.2s_ease-out]">
                    <div className="h-1.5 w-full bg-red-500 shrink-0" />

                    <div className="p-6 sm:p-7 flex flex-col min-h-0">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-[11px] font-bold uppercase tracking-wider text-red-700 dark:text-red-400">
                                    Allarme
                                </div>
                                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mt-1 leading-tight">
                                    {righe.length === 1 ? righe[0].label : `${righe.length} allarmi aperti`}
                                </h2>
                            </div>
                            <button
                                onClick={chiudi}
                                className="shrink-0 w-8 h-8 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                                aria-label="Chiudi"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <ul className="mt-5 space-y-2.5 overflow-y-auto min-h-0">
                            {righe.map(({ evento: e, label }) => {
                                const stile = PRIORITY_STYLE[e.priority] || PRIORITY_STYLE.attenzione
                                const fatto = fatti[e.id]
                                const busy = inCorso === e.id
                                return (
                                    <li key={e.id} className={`rounded-xl border px-4 py-3 ${fatto ? 'border-gray-200 dark:border-zinc-700 opacity-60' : 'border-gray-200 dark:border-zinc-700'}`}>
                                        <div className="flex items-start gap-3">
                                            <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${stile.dot}`} />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex flex-wrap items-baseline gap-x-2">
                                                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{label}</span>
                                                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${stile.text}`}>
                                                        {PRIORITY_LABEL[e.priority]}
                                                    </span>
                                                </div>
                                                {e.entita && <div className="text-[13px] text-gray-600 dark:text-gray-300 mt-0.5">{e.entita}</div>}
                                                {e.nota && <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">{e.nota}</div>}
                                            </div>
                                        </div>
                                        <div className="mt-2.5 flex justify-end gap-1.5">
                                            {fatto ? (
                                                <span className="text-[12px] font-semibold text-gray-500 dark:text-gray-400">{fatto}</span>
                                            ) : (
                                                <>
                                                    <button
                                                        type="button"
                                                        disabled={busy}
                                                        onClick={() => azione(e.id, () => posticipaEvento(e.id, 10), 'Posticipato di 10 min')}
                                                        className="px-3 py-1.5 rounded-full text-[12px] font-semibold bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-200 dark:bg-amber-500/15 dark:hover:bg-amber-500/25 dark:text-amber-200 dark:border-amber-500/40 disabled:opacity-50"
                                                    >
                                                        Posticipa 10 min
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={busy}
                                                        onClick={() => azione(e.id, () => risolviEvento(e.id, adminName || 'Operatore'), 'Risolto')}
                                                        className="px-3 py-1.5 rounded-full text-[12px] font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                                                    >
                                                        Risolto
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>

                        <div className="mt-6 grid grid-cols-2 gap-2 shrink-0">
                            <button
                                onClick={apriElenco}
                                className="px-4 py-2.5 bg-gray-900 hover:bg-black text-white dark:bg-white dark:hover:bg-gray-200 dark:text-gray-900 font-medium rounded-xl transition-colors text-sm"
                            >
                                Apri allarmi
                            </button>
                            <button
                                onClick={chiudi}
                                className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-gray-100 font-medium rounded-xl transition-colors text-sm"
                            >
                                Chiudi
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}
