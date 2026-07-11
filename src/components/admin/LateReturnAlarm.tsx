import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import type { Session } from '@supabase/supabase-js';

interface LateBooking {
    id: string;
    vehicle_name: string;
    customer_name: string;
    customer_phone: string;
    dropoff_date: string;
    minutesLate: number;
}

// Only ring for returns that are LATE but still realistic to chase (fresh).
// Bookings overdue by days/weeks are almost certainly returned in real life
// and were never marked `completata`; they would spam the alarm forever.
const MIN_LATE_MINUTES = 10;              // grace period after dropoff_date
const MAX_LATE_MINUTES = 24 * 60;         // stop ringing after 24h overdue

const LateReturnAlarm: React.FC = () => {
    const [lateBookings, setLateBookings] = useState<LateBooking[]>([]);
    const [stoppedAlarms, setStoppedAlarms] = useState<Set<string>>(new Set());
    const [session, setSession] = useState<Session | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const oscillatorRef = useRef<OscillatorNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const pulseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Track auth state
    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });
        return () => subscription.unsubscribe();
    }, []);

    // Load stopped alarms from localStorage on mount
    useEffect(() => {
        const stored = localStorage.getItem('stoppedAlarms');
        if (stored) {
            try {
                setStoppedAlarms(new Set(JSON.parse(stored)));
            } catch (e) {
                console.error('Failed to parse stopped alarms:', e);
            }
        }
    }, []);

    // Check for late bookings every 30 seconds — only when authenticated
    useEffect(() => {
        if (!session) return;
        const checkLateBookings = async () => {
            try {
                const now = new Date();
                const maxLateCutoff = new Date(now.getTime() - MAX_LATE_MINUTES * 60 * 1000);
                const minLateCutoff = new Date(now.getTime() - MIN_LATE_MINUTES * 60 * 1000);

                // Only ring for ACTIVE rentals whose dropoff_date falls in the
                // [now - MAX_LATE_MINUTES, now - MIN_LATE_MINUTES] window.
                // Older than MAX → stale, almost certainly returned IRL.
                // Also skip test vehicles and "Lavaggio Rientro" internal rows.
                const { data: bookings, error } = await supabase
                    .from('bookings')
                    .select('id, vehicle_name, customer_name, customer_phone, dropoff_date, status, booking_details')
                    // 2026-07-11 FIX: prima filtrava SOLO service_type='car_rental',
                    // ma molti noleggi hanno service_type NULL o 'rental' (default
                    // storico) → l'allarme ritardo NON suonava mai per quelle
                    // prenotazioni. Ora accettiamo car_rental / rental / NULL
                    // (car_wash, mechanical, uscita_straordinaria restano esclusi
                    // perche' hanno un service_type esplicito diverso).
                    .or('service_type.eq.car_rental,service_type.eq.rental,service_type.is.null')
                    .not('status', 'in', '("returned","completed","completata","cancelled","annullata")')
                    .not('dropoff_date', 'is', null)
                    .gte('dropoff_date', maxLateCutoff.toISOString())
                    .lte('dropoff_date', minLateCutoff.toISOString())
                    .not('customer_name', 'eq', 'Lavaggio Rientro')
                    .not('vehicle_name', 'ilike', 'test%');

                if (error) {
                    console.error('Error fetching bookings:', error);
                    return;
                }

                const late: LateBooking[] = [];
                bookings?.forEach((booking) => {
                    if (stoppedAlarms.has(booking.id)) return;
                    const dropoffTime = new Date(booking.dropoff_date);
                    const minutesLate = Math.floor((now.getTime() - dropoffTime.getTime()) / (60 * 1000));
                    // Safety: enforce the window client-side too (in case of TZ weirdness).
                    if (minutesLate < MIN_LATE_MINUTES || minutesLate > MAX_LATE_MINUTES) return;
                    late.push({
                        id: booking.id,
                        vehicle_name: booking.vehicle_name,
                        customer_name: booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A',
                        customer_phone: booking.customer_phone || booking.booking_details?.customer?.phone || '-',
                        dropoff_date: booking.dropoff_date,
                        minutesLate,
                    });
                });
                late.sort((a, b) => b.minutesLate - a.minutesLate);
                setLateBookings(late);
            } catch (err) {
                console.error('Error checking late bookings:', err);
            }
        };

        checkLateBookings();
        const interval = setInterval(checkLateBookings, 30000);
        return () => clearInterval(interval);
    }, [stoppedAlarms, session]);

    useEffect(() => {
        if (lateBookings.length > 0) {
            startAlarm();
        } else {
            stopAlarm();
        }
        return () => stopAlarm();
    }, [lateBookings.length]);

    const startAlarm = () => {
        if (oscillatorRef.current) return;
        try {
            const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            gainNode.gain.setValueAtTime(0.25, audioContext.currentTime);

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            oscillator.start();

            if (pulseIntervalRef.current) clearInterval(pulseIntervalRef.current);
            pulseIntervalRef.current = setInterval(() => {
                if (!oscillatorRef.current || !gainNodeRef.current) {
                    if (pulseIntervalRef.current) clearInterval(pulseIntervalRef.current);
                    return;
                }
                gainNode.gain.setValueAtTime(0.25, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
                gainNode.gain.setValueAtTime(0.25, audioContext.currentTime + 0.5);
            }, 1000);

            audioContextRef.current = audioContext;
            oscillatorRef.current = oscillator;
            gainNodeRef.current = gainNode;
        } catch (err) {
            console.error('Failed to start alarm audio:', err);
        }
    };

    const stopAlarm = () => {
        if (pulseIntervalRef.current) {
            clearInterval(pulseIntervalRef.current);
            pulseIntervalRef.current = null;
        }
        if (oscillatorRef.current) {
            try { oscillatorRef.current.stop(); oscillatorRef.current.disconnect(); } catch { /* noop */ }
            oscillatorRef.current = null;
        }
        if (audioContextRef.current) {
            try { audioContextRef.current.close(); } catch { /* noop */ }
            audioContextRef.current = null;
        }
        gainNodeRef.current = null;
    };

    const silenceAll = () => {
        const next = new Set(stoppedAlarms);
        lateBookings.forEach((b) => next.add(b.id));
        setStoppedAlarms(next);
        localStorage.setItem('stoppedAlarms', JSON.stringify(Array.from(next)));
        setLateBookings([]);
    };

    const silenceOne = (id: string) => {
        const next = new Set(stoppedAlarms);
        next.add(id);
        setStoppedAlarms(next);
        localStorage.setItem('stoppedAlarms', JSON.stringify(Array.from(next)));
        setLateBookings((prev) => prev.filter((b) => b.id !== id));
    };

    const markReturned = async (bookingId: string) => {
        setBusyId(bookingId);
        try {
            const { data, error } = await supabase
                .from('bookings')
                .update({ status: 'completata' })
                .eq('id', bookingId)
                .select('id');

            if (error) {
                toast.error(`Errore: ${error.message || 'impossibile aggiornare'}`, { duration: 6000 });
                return;
            }
            if (!data || data.length === 0) {
                toast.error('Prenotazione non aggiornata — controlla i permessi', { duration: 6000 });
                return;
            }
            setLateBookings((prev) => prev.filter((b) => b.id !== bookingId));
            toast.success('Prenotazione segnata come rientrata');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            toast.error(`Errore: ${msg}`, { duration: 6000 });
        } finally {
            setBusyId(null);
        }
    };

    const fmtLate = (mins: number) => {
        if (mins < 60) return `${mins} min in ritardo`;
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m > 0 ? `${h}h ${m}m in ritardo` : `${h}h in ritardo`;
    };

    if (lateBookings.length === 0) return null;

    return (
        <AnimatePresence>
            <motion.div
                key="late-alarm-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={silenceAll}
                className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm"
            />
            <motion.div
                key="late-alarm-card"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.18 }}
                className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none"
            >
                <div className="pointer-events-auto bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                    {/* Accent strip */}
                    <div className="h-1.5 w-full bg-red-500" />

                    {/* Header */}
                    <div className="px-6 pt-5 pb-4 border-b border-gray-100">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-[11px] font-bold uppercase tracking-wider text-red-600 flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                    Rientro in ritardo
                                </div>
                                <h2 className="text-lg font-bold text-gray-900 mt-0.5">
                                    {lateBookings.length === 1
                                        ? '1 noleggio scaduto'
                                        : `${lateBookings.length} noleggi scaduti`}
                                </h2>
                            </div>
                            <button
                                onClick={silenceAll}
                                aria-label="Silenzia tutto"
                                className="shrink-0 w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Body: list */}
                    <div className="px-4 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
                        {lateBookings.map((b) => (
                            <div
                                key={b.id}
                                className="rounded-xl border border-gray-200 bg-white overflow-hidden"
                            >
                                <div className="px-4 py-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[15px] font-semibold text-gray-900 truncate">{b.vehicle_name || 'Veicolo'}</div>
                                            <div className="text-sm text-gray-700 truncate">{b.customer_name}</div>
                                            {b.customer_phone && b.customer_phone !== '-' && (
                                                <div className="text-xs text-gray-500 truncate">{b.customer_phone}</div>
                                            )}
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 text-red-700 text-[11px] font-bold tabular-nums">
                                                {fmtLate(b.minutesLate)}
                                            </div>
                                            <div className="text-[11px] text-gray-500 mt-1 tabular-nums">
                                                {new Date(b.dropoff_date).toLocaleString('it-IT', {
                                                    day: '2-digit', month: '2-digit', year: '2-digit',
                                                    hour: '2-digit', minute: '2-digit',
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-px bg-gray-100">
                                    <button
                                        onClick={() => markReturned(b.id)}
                                        disabled={busyId === b.id}
                                        className="bg-white hover:bg-green-50 disabled:bg-gray-50 disabled:text-gray-400 text-green-700 text-sm font-semibold py-2.5 transition-colors"
                                    >
                                        {busyId === b.id ? 'Aggiornamento…' : 'Segna rientrato'}
                                    </button>
                                    <button
                                        onClick={() => silenceOne(b.id)}
                                        className="bg-white hover:bg-gray-50 text-gray-600 text-sm font-medium py-2.5 transition-colors"
                                    >
                                        Silenzia
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                        <span className="text-[11px] text-gray-500">
                            Aggiornato ogni 30s · max 24h di ritardo
                        </span>
                        <button
                            onClick={silenceAll}
                            className="text-sm font-medium text-gray-700 hover:text-gray-900"
                        >
                            Silenzia tutto
                        </button>
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};

export default LateReturnAlarm;
