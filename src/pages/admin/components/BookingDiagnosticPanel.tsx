import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'

interface ConsistencyIssue {
    issue_type: string
    booking_id: string
    vehicle_id: string | null
    vehicle_name: string
    vehicle_plate: string | null
    current_vehicle_plate: string | null
    details: string
}

export default function BookingDiagnosticPanel() {
    const [issues, setIssues] = useState<ConsistencyIssue[]>([])
    const [loading, setLoading] = useState(true)
    const [fixing, setFixing] = useState<string | null>(null)

    useEffect(() => {
        loadConsistencyReport()
    }, [])

    async function loadConsistencyReport() {
        setLoading(true)
        try {
            const { data, error } = await supabase
                .rpc('verify_booking_calendar_consistency')

            if (error) {
                console.error('Error loading consistency report:', error)
                throw error
            }

            setIssues(data || [])
        } catch (error) {
            console.error('Failed to load consistency report:', error)
            alert('Errore nel caricamento del report di consistenza')
        } finally {
            setLoading(false)
        }
    }

    async function fixMissingPlate(bookingId: string, vehicleId: string) {
        setFixing(bookingId)
        try {
            // Get the current vehicle plate
            const { data: vehicle, error: vehicleError } = await supabase
                .from('vehicles')
                .select('plate')
                .eq('id', vehicleId)
                .single()

            if (vehicleError || !vehicle) {
                throw new Error('Veicolo non trovato')
            }

            // Update the booking with the current vehicle plate
            const { error: updateError } = await supabase
                .from('bookings')
                .update({ vehicle_plate: vehicle.plate })
                .eq('id', bookingId)

            if (updateError) throw updateError

            alert('✅ Targa aggiornata con successo!')
            await loadConsistencyReport()
        } catch (error) {
            console.error('Error fixing plate:', error)
            alert('Errore nell\'aggiornamento della targa: ' + (error as Error).message)
        } finally {
            setFixing(null)
        }
    }

    async function fixPlateMismatch(bookingId: string, vehicleId: string) {
        setFixing(bookingId)
        try {
            const confirmed = confirm(
                'Vuoi aggiornare la targa della prenotazione con la targa attuale del veicolo?\n\n' +
                'Questo aggiornerà la prenotazione per riflettere la targa corrente del veicolo.'
            )

            if (!confirmed) {
                setFixing(null)
                return
            }

            // Get the current vehicle plate
            const { data: vehicle, error: vehicleError } = await supabase
                .from('vehicles')
                .select('plate')
                .eq('id', vehicleId)
                .single()

            if (vehicleError || !vehicle) {
                throw new Error('Veicolo non trovato')
            }

            // Update the booking with the current vehicle plate
            const { error: updateError } = await supabase
                .from('bookings')
                .update({ vehicle_plate: vehicle.plate })
                .eq('id', bookingId)

            if (updateError) throw updateError

            alert('✅ Targa aggiornata con successo!')
            await loadConsistencyReport()
        } catch (error) {
            console.error('Error fixing plate mismatch:', error)
            alert('Errore nell\'aggiornamento: ' + (error as Error).message)
        } finally {
            setFixing(null)
        }
    }

    const getIssueIcon = (type: string) => {
        switch (type) {
            case 'MISSING_VEHICLE_ID': return '🔴'
            case 'ORPHANED_BOOKING': return '💀'
            case 'PLATE_MISMATCH': return '⚠️'
            case 'NAME_MISMATCH': return '📝'
            case 'MISSING_PLATE': return '🟡'
            default: return '❓'
        }
    }

    const getIssueSeverity = (type: string) => {
        switch (type) {
            case 'MISSING_VEHICLE_ID': return 'high'
            case 'ORPHANED_BOOKING': return 'critical'
            case 'PLATE_MISMATCH': return 'medium'
            case 'NAME_MISMATCH': return 'low'
            case 'MISSING_PLATE': return 'low'
            default: return 'low'
        }
    }

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'critical': return 'bg-red-900/30 border-red-500'
            case 'high': return 'bg-orange-900/30 border-orange-500'
            case 'medium': return 'bg-yellow-900/30 border-yellow-500'
            case 'low': return 'bg-blue-900/30 border-blue-500'
            default: return 'bg-gray-900/30 border-gray-500'
        }
    }

    const groupedIssues = issues.reduce((acc, issue) => {
        if (!acc[issue.issue_type]) {
            acc[issue.issue_type] = []
        }
        acc[issue.issue_type].push(issue)
        return acc
    }, {} as Record<string, ConsistencyIssue[]>)

    if (loading) {
        return (
            <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-dr7-gold mx-auto mb-4"></div>
                <p className="text-white">Caricamento report di consistenza...</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-gradient-to-br from-gray-900/95 to-black/95 backdrop-blur-xl rounded-2xl border border-white/10 p-6 shadow-2xl">
                <div className="flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-light text-white mb-2">Diagnostica Prenotazioni-Calendario</h2>
                        <p className="text-gray-400 text-sm">
                            Verifica la consistenza dei collegamenti tra prenotazioni e calendario
                        </p>
                    </div>
                    <button
                        onClick={loadConsistencyReport}
                        className="px-4 py-2 bg-dr7-gold text-black rounded-full font-semibold hover:bg-dr7-gold/90 transition-colors"
                    >
                        🔄 Aggiorna
                    </button>
                </div>

                {/* Summary */}
                <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white/5 rounded-full p-4 border border-white/10">
                        <div className="text-3xl font-bold text-white">{issues.length}</div>
                        <div className="text-gray-400 text-sm">Problemi Totali</div>
                    </div>
                    <div className="bg-white/5 rounded-full p-4 border border-white/10">
                        <div className="text-3xl font-bold text-red-400">
                            {issues.filter(i => getIssueSeverity(i.issue_type) === 'critical' || getIssueSeverity(i.issue_type) === 'high').length}
                        </div>
                        <div className="text-gray-400 text-sm">Critici/Alti</div>
                    </div>
                    <div className="bg-white/5 rounded-full p-4 border border-white/10">
                        <div className="text-3xl font-bold text-yellow-400">
                            {issues.filter(i => getIssueSeverity(i.issue_type) === 'medium' || getIssueSeverity(i.issue_type) === 'low').length}
                        </div>
                        <div className="text-gray-400 text-sm">Medi/Bassi</div>
                    </div>
                </div>
            </div>

            {/* Issues by Type */}
            {issues.length === 0 ? (
                <div className="bg-green-900/20 border border-green-500/30 rounded-full p-8 text-center">
                    <div className="text-6xl mb-4">✅</div>
                    <h3 className="text-2xl font-semibold text-green-400 mb-2">Nessun Problema Rilevato</h3>
                    <p className="text-gray-400">
                        Tutti i collegamenti tra prenotazioni e calendario sono consistenti!
                    </p>
                </div>
            ) : (
                Object.entries(groupedIssues).map(([type, typeIssues]) => (
                    <div key={type} className="bg-gray-900/50 rounded-full border border-white/10 overflow-hidden">
                        <div className={`p-4 border-l-4 ${getSeverityColor(getIssueSeverity(type))}`}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className="text-2xl">{getIssueIcon(type)}</span>
                                    <div>
                                        <h3 className="text-lg font-semibold text-white">
                                            {type.replace(/_/g, ' ')}
                                        </h3>
                                        <p className="text-sm text-gray-400">{typeIssues.length} prenotazioni</p>
                                    </div>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getIssueSeverity(type) === 'critical' ? 'bg-red-500 text-white' :
                                        getIssueSeverity(type) === 'high' ? 'bg-orange-500 text-white' :
                                            getIssueSeverity(type) === 'medium' ? 'bg-yellow-500 text-black' :
                                                'bg-blue-500 text-white'
                                    }`}>
                                    {getIssueSeverity(type).toUpperCase()}
                                </span>
                            </div>
                        </div>

                        <div className="divide-y divide-white/10">
                            {typeIssues.map((issue) => (
                                <div key={issue.booking_id} className="p-4 hover:bg-white/5 transition-colors">
                                    <div className="flex justify-between items-start">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="text-white font-mono text-sm">
                                                    DR7-{issue.booking_id.substring(0, 8).toUpperCase()}
                                                </span>
                                                <span className="text-gray-400">•</span>
                                                <span className="text-dr7-gold">{issue.vehicle_name}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4 text-sm mb-2">
                                                <div>
                                                    <span className="text-gray-400">Targa Prenotazione:</span>
                                                    <span className="text-white ml-2">{issue.vehicle_plate || 'N/A'}</span>
                                                </div>
                                                <div>
                                                    <span className="text-gray-400">Targa Attuale:</span>
                                                    <span className="text-white ml-2">{issue.current_vehicle_plate || 'N/A'}</span>
                                                </div>
                                            </div>
                                            <p className="text-gray-400 text-sm">{issue.details}</p>
                                        </div>

                                        {/* Action Buttons */}
                                        <div className="ml-4">
                                            {issue.issue_type === 'MISSING_PLATE' && issue.vehicle_id && (
                                                <button
                                                    onClick={() => fixMissingPlate(issue.booking_id, issue.vehicle_id!)}
                                                    disabled={fixing === issue.booking_id}
                                                    className="px-3 py-1 bg-blue-600 text-white rounded-full text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {fixing === issue.booking_id ? '⏳' : '🔧'} Correggi
                                                </button>
                                            )}
                                            {issue.issue_type === 'PLATE_MISMATCH' && issue.vehicle_id && (
                                                <button
                                                    onClick={() => fixPlateMismatch(issue.booking_id, issue.vehicle_id!)}
                                                    disabled={fixing === issue.booking_id}
                                                    className="px-3 py-1 bg-yellow-600 text-white rounded-full text-sm hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {fixing === issue.booking_id ? '⏳' : '🔧'} Aggiorna
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))
            )}

            {/* Help Section */}
            <div className="bg-blue-900/20 border border-blue-500/30 rounded-full p-6">
                <h3 className="text-lg font-semibold text-blue-400 mb-3">ℹ️ Guida ai Problemi</h3>
                <div className="space-y-2 text-sm text-gray-300">
                    <p><strong>MISSING_VEHICLE_ID:</strong> La prenotazione non ha un vehicle_id. Usa solo nome/targa per il matching.</p>
                    <p><strong>ORPHANED_BOOKING:</strong> La prenotazione riferisce un veicolo che non esiste più.</p>
                    <p><strong>PLATE_MISMATCH:</strong> La targa nella prenotazione non corrisponde alla targa attuale del veicolo.</p>
                    <p><strong>NAME_MISMATCH:</strong> Il nome del veicolo è cambiato dopo la creazione della prenotazione.</p>
                    <p><strong>MISSING_PLATE:</strong> La prenotazione non ha una targa salvata (può causare problemi di matching).</p>
                </div>
            </div>
        </div>
    )
}
