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

const LateReturnAlarm: React.FC = () => {
    const [lateBookings, setLateBookings] = useState<LateBooking[]>([]);
    const [isAlarmActive, setIsAlarmActive] = useState(false);
    const [stoppedAlarms, setStoppedAlarms] = useState<Set<string>>(new Set());
    const [session, setSession] = useState<Session | null>(null);
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
                const { data: bookings, error } = await supabase
                    .from('bookings')
                    .select('id, vehicle_name, customer_name, customer_phone, dropoff_date, status, booking_details')
                    .eq('service_type', 'car_rental')
                    .neq('status', 'returned')
                    .not('dropoff_date', 'is', null);

                if (error) {
                    console.error('Error fetching bookings:', error);
                    return;
                }

                const now = new Date();
                const late: LateBooking[] = [];

                bookings?.forEach((booking) => {
                    const dropoffTime = new Date(booking.dropoff_date);
                    const tenMinutesLater = new Date(dropoffTime.getTime() + 10 * 60 * 1000);

                    if (now > tenMinutesLater && !stoppedAlarms.has(booking.id)) {
                        const minutesLate = Math.floor((now.getTime() - tenMinutesLater.getTime()) / (60 * 1000));
                        late.push({
                            id: booking.id,
                            vehicle_name: booking.vehicle_name,
                            customer_name: booking.customer_name || booking.booking_details?.customer?.fullName || 'N/A',
                            customer_phone: booking.customer_phone || booking.booking_details?.customer?.phone || '-',
                            dropoff_date: booking.dropoff_date,
                            minutesLate,
                        });
                    }
                });

                setLateBookings(late);
                setIsAlarmActive(late.length > 0);
            } catch (err) {
                console.error('Error checking late bookings:', err);
            }
        };

        checkLateBookings();
        const interval = setInterval(checkLateBookings, 30000);
        return () => clearInterval(interval);
    }, [stoppedAlarms, session]);

    useEffect(() => {
        if (isAlarmActive && lateBookings.length > 0) {
            startAlarm();
        } else {
            stopAlarm();
        }
        return () => stopAlarm();
    }, [isAlarmActive, lateBookings.length]);

    const startAlarm = () => {
        if (oscillatorRef.current) return;

        try {
            const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            oscillator.start();

            // Use setInterval instead of recursive setTimeout to allow proper cleanup
            if (pulseIntervalRef.current) clearInterval(pulseIntervalRef.current);
            pulseIntervalRef.current = setInterval(() => {
                if (!oscillatorRef.current || !gainNodeRef.current) {
                    if (pulseIntervalRef.current) clearInterval(pulseIntervalRef.current);
                    return;
                }
                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime + 0.5);
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
            try { oscillatorRef.current.stop(); oscillatorRef.current.disconnect(); } catch { // intentionally empty
            }
            oscillatorRef.current = null;
        }
        if (audioContextRef.current) {
            try { audioContextRef.current.close(); } catch { // intentionally empty
            }
            audioContextRef.current = null;
        }
        gainNodeRef.current = null;
    };

    const handleStopAlarm = () => {
        const newStoppedAlarms = new Set(stoppedAlarms);
        lateBookings.forEach((booking) => newStoppedAlarms.add(booking.id));
        setStoppedAlarms(newStoppedAlarms);
        localStorage.setItem('stoppedAlarms', JSON.stringify(Array.from(newStoppedAlarms)));
        setIsAlarmActive(false);
        setLateBookings([]);
    };

    const handleMarkAsReturned = async (bookingId: string) => {
        try {
            const { error } = await supabase.from('bookings').update({ status: 'returned' }).eq('id', bookingId);

            if (error) {
                console.error('Error marking booking as returned:', error);
                toast.error('Failed to mark booking as returned');
                return;
            }

            const updated = lateBookings.filter((b) => b.id !== bookingId);
            setLateBookings(updated);
            if (updated.length === 0) setIsAlarmActive(false);
        } catch (err) {
            console.error('Error updating booking:', err);
            toast.error('Failed to mark booking as returned');
        }
    };

    if (!isAlarmActive || lateBookings.length === 0) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[9999] flex items-center justify-center"
                style={{ backgroundColor: 'rgba(220, 38, 38, 0.95)' }}
            >
                <motion.div
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.9, y: 20 }}
                    className="bg-theme-text-primary rounded-lg shadow-2xl max-w-2xl w-full mx-4 p-8"
                >
                    <div className="text-center mb-6">
                        <h2 className="text-3xl font-bold text-red-600 mb-2">LATE RETURN ALERT</h2>
                        <p className="text-gray-600">The following rental(s) are overdue</p>
                    </div>

                    <div className="space-y-4 mb-6 max-h-96 overflow-y-auto">
                        {lateBookings.map((booking) => (
                            <div key={booking.id} className="border border-red-300 rounded-full p-4 bg-red-50">
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <h3 className="font-bold text-lg text-gray-900">{booking.vehicle_name}</h3>
                                        <p className="text-gray-700">{booking.customer_name}</p>
                                        <p className="text-gray-600 text-sm">{booking.customer_phone}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-red-600 font-bold text-xl">{booking.minutesLate} min late</p>
                                        <p className="text-gray-600 text-sm">
                                            Due: {new Date(booking.dropoff_date).toLocaleString('it-IT', {
                                                day: '2-digit',
                                                month: '2-digit',
                                                year: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleMarkAsReturned(booking.id)}
                                    className="w-full bg-green-600 hover:bg-green-700 text-theme-text-primary font-semibold py-2 px-4 rounded-full transition-colors"
                                >
                                    Mark as Returned
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="flex gap-4">
                        <button
                            onClick={handleStopAlarm}
                            className="flex-1 bg-theme-bg-tertiary hover:bg-theme-bg-secondary text-theme-text-primary font-semibold py-3 px-6 rounded-full transition-colors"
                        >
                            Stop Alarm
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default LateReturnAlarm;
