import { useVehicleAlarm } from '../../contexts/VehicleAlarmContext'

/**
 * 01/10/2026: avviso fisso quando l'audio degli allarmi e' spento.
 *
 * Il browser fa suonare una pagina solo dopo un click dell'utente, e il
 * comando "Attiva Allarmi" stava in fondo al menu utente (e per qualcuno era
 * persino nascosto). Risultato: allarmi accesi in Centralina Pro che non
 * facevano nessun rumore, senza che nessuno lo sapesse. Finche' l'audio e'
 * spento, questo bottone resta in vista.
 */
export default function AudioAllarmiSpento() {
    const { alarmState, enableAudio } = useVehicleAlarm()
    if (alarmState.audioEnabled) return null
    return (
        <button
            type="button"
            onClick={() => enableAudio()}
            className="fixed bottom-4 left-4 z-[60] flex items-center gap-2 px-3.5 py-2.5 rounded-full border border-amber-500/60 bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200 shadow-lg text-[13px] font-semibold hover:bg-amber-100 dark:hover:bg-amber-500/25 transition-colors"
            title="Il browser suona solo dopo un click: attiva l'audio degli allarmi"
        >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
            Audio allarmi spento - Attiva
        </button>
    )
}
