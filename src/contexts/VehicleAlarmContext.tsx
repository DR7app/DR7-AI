import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'

interface AlarmBooking {
    bookingId: string
    vehicleName: string
    returnTime: string
    customerName: string
    type?: 'return' | 'deposit'
    deposit?: number
}

interface AlarmState {
    activeAlarm: AlarmBooking | null
    isPlaying: boolean
    audioEnabled: boolean
}

interface VehicleAlarmContextType {
    alarmState: AlarmState
    enableAudio: () => void
    stopAlarm: (bookingId: string) => void
}

const VehicleAlarmContext = createContext<VehicleAlarmContextType | undefined>(undefined)

export function useVehicleAlarm() {
    const context = useContext(VehicleAlarmContext)
    if (!context) {
        throw new Error('useVehicleAlarm must be used within VehicleAlarmProvider')
    }
    return context
}

export function VehicleAlarmProvider({ children }: { children: React.ReactNode }) {
    const [alarmState, setAlarmState] = useState<AlarmState>({
        activeAlarm: null,
        isPlaying: false,
        audioEnabled: localStorage.getItem('audioAlertsEnabled') === 'true'
    })

    const audioRef = useRef<HTMLAudioElement | null>(null)
    const triggeredAlarmsRef = useRef<Set<string>>(
        new Set(JSON.parse(localStorage.getItem('triggered_alarms') || '[]'))
    )

    // Enable audio alerts
    const enableAudio = async () => {
        // Prevent multiple simultaneous attempts
        if (alarmState.audioEnabled) {
            alert('✅ Sound alerts are already enabled!')
            return
        }

        try {
            // Simple approach: just enable it
            localStorage.setItem('audioAlertsEnabled', 'true')
            setAlarmState(prev => ({ ...prev, audioEnabled: true }))

            // Try to unlock audio with AudioContext
            try {
                const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
                if (audioContext.state === 'suspended') {
                    await audioContext.resume()
                }

                // Play a very short, quiet beep
                const oscillator = audioContext.createOscillator()
                const gainNode = audioContext.createGain()
                oscillator.connect(gainNode)
                gainNode.connect(audioContext.destination)
                gainNode.gain.value = 0.01
                oscillator.frequency.value = 440
                oscillator.start(audioContext.currentTime)
                oscillator.stop(audioContext.currentTime + 0.01)
            } catch (audioErr) {
                // Ignore unlock errors
                console.log('Audio unlock:', audioErr)
            }

            alert('✅ Sound alerts enabled! You will hear an alarm when vehicles are due for return.')
            console.log('✅ Audio alerts enabled')
        } catch (err) {
            console.error('Failed to enable audio:', err)
            alert('❌ Failed to enable sound alerts. Please try again.')
        }
    }

    // Stop alarm
    const stopAlarm = async (bookingId: string) => {
        // Stop audio
        if (audioRef.current) {
            audioRef.current.pause()
            audioRef.current.currentTime = 0
        }

        // Clear active alarm
        setAlarmState(prev => ({
            ...prev,
            activeAlarm: null,
            isPlaying: false
        }))

        // Mark as triggered in database
        try {
            await supabase
                .from('bookings')
                .update({ alarm_triggered_at: new Date().toISOString() })
                .eq('id', bookingId)
        } catch (error) {
            console.error('Failed to update alarm status:', error)
        }
    }

    // Play alarm sound
    const playAlarm = (booking: AlarmBooking) => {
        console.log('🚨 TRIGGERING ALARM for booking:', booking.bookingId)

        if (!alarmState.audioEnabled) {
            console.warn('⚠️ Audio not enabled, showing visual notification only')
        } else {
            try {
                // Create or reuse audio element
                if (!audioRef.current) {
                    console.log('Creating new Audio element for alarm')
                    audioRef.current = new Audio('/alarm.mp3')
                    audioRef.current.loop = true
                    audioRef.current.volume = 0.8 // Set volume to 80%

                    // Add event listeners for debugging
                    audioRef.current.addEventListener('canplay', () => {
                        console.log('✅ Alarm audio ready to play')
                    })
                    audioRef.current.addEventListener('error', (e) => {
                        console.error('❌ Alarm audio error:', e)
                    })
                }

                // Reset and play
                audioRef.current.currentTime = 0
                audioRef.current.play()
                    .then(() => {
                        console.log('✅ Alarm sound playing!')
                    })
                    .catch(err => {
                        console.error('❌ Failed to play alarm:', err)
                        // Try to resume AudioContext if suspended
                        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
                        if (audioContext.state === 'suspended') {
                            audioContext.resume().then(() => {
                                console.log('Resumed AudioContext, retrying alarm...')
                                audioRef.current?.play().catch(e => console.error('Retry failed:', e))
                            })
                        }
                    })
            } catch (error) {
                console.error('❌ Error setting up alarm audio:', error)
            }
        }

        // Always show visual notification
        setAlarmState(prev => ({
            ...prev,
            activeAlarm: booking,
            isPlaying: true
        }))
    }

    // Check for alarms (Returns & Deposits)
    const checkAlarms = async () => {
        try {
            const now = new Date()
            now.setSeconds(0, 0)

            // --- 1. CHECK RETURNS (10 mins AFTER due time) ---
            // Triggers if return_date was 10 mins ago
            const tenMinutesAgo = new Date(now.getTime() - 10 * 60000)
            const tenMinutesAgoISO = tenMinutesAgo.toISOString()
            const tenMinutesAgoPlusOne = new Date(tenMinutesAgo.getTime() + 60000).toISOString()

            const { data: returns, error: returnsError } = await supabase
                .from('bookings')
                .select('id, customer_name, vehicle_name, dropoff_date, status, alarm_triggered_at')
                .is('alarm_triggered_at', null)
                .neq('status', 'returned')
                .neq('status', 'cancelled')
                .gte('dropoff_date', tenMinutesAgoISO)
                .lt('dropoff_date', tenMinutesAgoPlusOne)

            if (!returnsError && returns && returns.length > 0) {
                for (const booking of returns) {
                    const trackingId = `return_${booking.id}`
                    if (triggeredAlarmsRef.current.has(trackingId) || triggeredAlarmsRef.current.has(booking.id)) continue

                    // Check exact minute match locally
                    const returnTime = new Date(booking.dropoff_date)
                    returnTime.setSeconds(0, 0)

                    if (returnTime.getTime() === tenMinutesAgo.getTime()) {
                        triggeredAlarmsRef.current.add(trackingId)
                        localStorage.setItem('triggered_alarms', JSON.stringify([...triggeredAlarmsRef.current]))

                        playAlarm({
                            bookingId: booking.id,
                            vehicleName: booking.vehicle_name || 'Unknown Vehicle',
                            returnTime: returnTime.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
                            customerName: booking.customer_name || 'Unknown Customer',
                            type: 'return'
                        })
                        return // Trigger one at a time
                    }
                }
            }

            // --- 2. CHECK DEPOSITS (10 mins BEFORE pickup time) ---
            // Triggers if pickup_date is 10 mins in FUTURE
            const tenMinutesFuture = new Date(now.getTime() + 10 * 60000)
            const tenMinutesFutureISO = tenMinutesFuture.toISOString()
            const tenMinutesFuturePlusOne = new Date(tenMinutesFuture.getTime() + 60000).toISOString()

            // We need to fetch bookings starting soon and check deposit in JS/JSON field
            const { data: pickups, error: pickupsError } = await supabase
                .from('bookings')
                .select('id, customer_name, vehicle_name, pickup_date, status, booking_details')
                .neq('status', 'cancelled')
                .gte('pickup_date', tenMinutesFutureISO)
                .lt('pickup_date', tenMinutesFuturePlusOne)

            if (!pickupsError && pickups && pickups.length > 0) {
                for (const booking of pickups) {
                    // Check if deposit exists and > 0
                    const details = booking.booking_details as any
                    const deposit = details?.deposit ? Number(details.deposit) : 0

                    if (deposit <= 0) continue

                    const trackingId = `deposit_${booking.id}`
                    if (triggeredAlarmsRef.current.has(trackingId)) continue

                    // Check exact minute match locally
                    const pickupTime = new Date(booking.pickup_date)
                    pickupTime.setSeconds(0, 0)

                    if (pickupTime.getTime() === tenMinutesFuture.getTime()) {
                        triggeredAlarmsRef.current.add(trackingId)
                        localStorage.setItem('triggered_alarms', JSON.stringify([...triggeredAlarmsRef.current]))

                        playAlarm({
                            bookingId: booking.id,
                            vehicleName: booking.vehicle_name || 'Unknown Vehicle',
                            returnTime: pickupTime.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
                            customerName: booking.customer_name || 'Unknown Customer',
                            type: 'deposit',
                            deposit: deposit
                        })
                        return // Trigger one at a time
                    }
                }
            }

        } catch (error) {
            console.error('Error checking alarms:', error)
        }
    }

    // Poll every 30 seconds
    useEffect(() => {
        checkAlarms()
        const interval = setInterval(checkAlarms, 30000)
        return () => clearInterval(interval)
    }, []) // Empty deps - runs once on mount

    // Cleanup audio on unmount
    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause()
                audioRef.current = null
            }
        }
    }, [])

    return (
        <VehicleAlarmContext.Provider value={{ alarmState, enableAudio, stopAlarm }}>
            {children}
        </VehicleAlarmContext.Provider>
    )
}
