import { useState } from 'react'
import { useVehicleAlarm } from '../contexts/VehicleAlarmContext'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

export default function AlarmNotification() {
    const { alarmState, stopAlarm, snoozeAlarm, markReturned } = useVehicleAlarm()
    const navigate = useNavigate()
    const [busy, setBusy] = useState<'returned' | 'snooze' | 'postpone' | null>(null)

    if (!alarmState.activeAlarm) return null

    const { bookingId, vehicleName, returnTime, customerName, type } = alarmState.activeAlarm
    const isReturn = type === 'return'
    const isFleet = type === 'fleet_maintenance_km' || type === 'fleet_maintenance_date'
    // 2026-05-20: includi sempre il tipo di manutenzione/scadenza nel
    // titolo e nel banner "SCADUTO" — prima diceva solo "SCADUTO" senza
    // specificare cosa fosse scaduto (Bollo? Revisione? Assicurazione?).
    const maintenanceType = alarmState.activeAlarm.maintenanceType || ''
    const mtSuffix = maintenanceType ? ` · ${maintenanceType}` : ''

    const meta = (() => {
        switch (type) {
            case 'deposit': return { title: 'Cauzione richiesta', accent: 'bg-yellow-500', accentText: 'text-yellow-700', timeLabel: 'Ritiro' }
            case 'unpaid_pickup': return { title: 'Da saldare prima del ritiro', accent: 'bg-red-500', accentText: 'text-red-700', timeLabel: 'Ritiro' }
            case 'car_wash': return { title: 'Lavaggio tra poco', accent: 'bg-blue-500', accentText: 'text-blue-700', timeLabel: 'Orario' }
            case 'fleet_maintenance_km': return { title: (alarmState.activeAlarm.urgent ? 'Manutenzione urgente' : 'Manutenzione richiesta') + mtSuffix, accent: 'bg-orange-500', accentText: 'text-orange-700', timeLabel: 'Scadenza' }
            case 'fleet_maintenance_date': return { title: (alarmState.activeAlarm.urgent ? 'Scadenza amministrativa' : 'Rinnovo richiesto') + mtSuffix, accent: 'bg-yellow-500', accentText: 'text-yellow-700', timeLabel: 'Scadenza' }
            default: return { title: 'Rientro veicolo', accent: 'bg-red-500', accentText: 'text-red-700', timeLabel: 'Previsto' }
        }
    })()

    const handleOpenBooking = () => {
        if (isFleet) {
            navigate('/admin?tab=fleet&vehicle=' + alarmState.activeAlarm?.vehicleId)
        } else {
            navigate('/admin?tab=reservations&highlight=' + bookingId)
        }
        stopAlarm(bookingId)
    }

    const handleMarkReturned = async () => {
        setBusy('returned')
        const res = await markReturned(bookingId)
        setBusy(null)
        if (res.ok) toast.success('Prenotazione marcata come rientrata')
        else toast.error('Errore: ' + (res.error || 'operazione fallita'))
    }

    const handleSnooze = async () => {
        setBusy('snooze')
        await stopAlarm(bookingId)
        setBusy(null)
        toast.success('Allarme silenziato')
    }

    // Posticipa: silenzia per 10 min, poi l'allarme torna a suonare se la
    // condizione è ancora valida. Diversamente da "Silenzia" (che chiude
    // permanentemente per la prenotazione corrente), questo è temporaneo.
    const handlePostpone = () => {
        setBusy('postpone')
        snoozeAlarm(bookingId, 10)
        setBusy(null)
        toast.success('Allarme posticipato di 10 minuti')
    }

    return (
        <>
            {/* Dim backdrop — click to snooze */}
            <div
                className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm"
                onClick={handleSnooze}
                aria-label="Chiudi allarme"
            />

            {/* Centered card */}
            <div
                className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none"
                role="dialog"
                aria-live="assertive"
            >
                <div className="pointer-events-auto bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-[scaleIn_0.2s_ease-out]">
                    {/* Accent strip */}
                    <div className={`h-1.5 w-full ${meta.accent}`} />

                    <div className="p-6 sm:p-7">
                        {/* Header */}
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className={`text-[11px] font-bold uppercase tracking-wider ${meta.accentText}`}>
                                    {meta.title}
                                </div>
                                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mt-1 leading-tight">
                                    {isFleet ? vehicleName : (vehicleName || 'Veicolo')}
                                </h2>
                            </div>
                            <button
                                onClick={handleSnooze}
                                className="shrink-0 w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors"
                                aria-label="Chiudi"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Body */}
                        <div className="mt-5 space-y-2.5">
                            {!isFleet && customerName && (
                                <Row label="Cliente" value={customerName} />
                            )}
                            {!isFleet && (
                                <Row label="Prenotazione" value={`#${bookingId.slice(0, 8).toUpperCase()}`} mono />
                            )}
                            <Row label={meta.timeLabel} value={returnTime} strong />

                            {isFleet && maintenanceType && (
                                <Row label="Tipo scadenza" value={maintenanceType} strong />
                            )}
                            {isFleet && (
                                <Row
                                    label={type === 'fleet_maintenance_km' ? 'KM attuali' : 'Data attuale'}
                                    value={
                                        typeof alarmState.activeAlarm.currentValue === 'number'
                                            ? alarmState.activeAlarm.currentValue.toLocaleString()
                                            : String(alarmState.activeAlarm.currentValue ?? '—')
                                    }
                                />
                            )}

                            {/* Amount for deposit/unpaid */}
                            {(type === 'deposit' || type === 'unpaid_pickup') && alarmState.activeAlarm.deposit != null && (
                                <Row
                                    label={type === 'deposit' ? 'Cauzione' : 'Da pagare'}
                                    value={`€ ${Number(alarmState.activeAlarm.deposit).toLocaleString('it-IT', { minimumFractionDigits: 2 })}`}
                                    strong
                                />
                            )}

                            {/* Maintenance remaining */}
                            {isFleet && (
                                <Row
                                    label="Stato"
                                    value={
                                        alarmState.activeAlarm.urgent
                                            ? `SCADUTO${maintenanceType ? ` — ${maintenanceType}` : ''}`
                                            : type === 'fleet_maintenance_km'
                                                ? `${alarmState.activeAlarm.remaining} km rimanenti`
                                                : `${alarmState.activeAlarm.remaining} giorni rimanenti`
                                    }
                                    strong
                                />
                            )}
                        </div>

                        {/* Actions */}
                        <div className="mt-6 grid gap-2">
                            {isReturn && (
                                <button
                                    onClick={handleMarkReturned}
                                    disabled={busy !== null}
                                    className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                                >
                                    {busy === 'returned' ? (
                                        <span>Aggiornamento...</span>
                                    ) : (
                                        <>
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                            Segna come rientrato
                                        </>
                                    )}
                                </button>
                            )}
                            <button
                                onClick={handleOpenBooking}
                                className="w-full px-4 py-2.5 bg-gray-900 hover:bg-black text-white font-medium rounded-xl transition-colors text-sm"
                            >
                                {isFleet ? 'Apri flotta' : 'Apri prenotazione'}
                            </button>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={handlePostpone}
                                    disabled={busy !== null}
                                    className="px-4 py-2.5 bg-amber-100 hover:bg-amber-200 text-amber-900 font-semibold rounded-xl transition-colors text-sm border border-amber-200"
                                    title="Silenzia per 10 min, poi l'allarme tornerà a suonare se la condizione è ancora valida"
                                >
                                    {busy === 'postpone' ? 'Posticipo...' : 'Posticipa 10 min'}
                                </button>
                                <button
                                    onClick={handleSnooze}
                                    disabled={busy !== null}
                                    className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium rounded-xl transition-colors text-sm"
                                    title="Silenzia definitivamente questo allarme"
                                >
                                    {busy === 'snooze' ? 'Silenzio...' : 'Silenzia'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

function Row({ label, value, strong, mono }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-gray-500 shrink-0">{label}</span>
            <span className={`text-right ${strong ? 'font-bold text-gray-900' : 'font-medium text-gray-800'} ${mono ? 'font-mono text-xs' : ''}`}>
                {value}
            </span>
        </div>
    )
}
