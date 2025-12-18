import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'

interface AlarmBooking {
    bookingId: string
    vehicleName: string
    returnTime: string
    customerName: string
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

    // Check for due returns
    const checkDueReturns = async () => {
        try {
            // Get current time (rounded to minute)
            const now = new Date()
            now.setSeconds(0, 0)
            const nowISO = now.toISOString()

            // Query bookings due for return in the current minute
            // Only check bookings that haven't been returned and haven't triggered alarm
            const { data: bookings, error } = await supabase
                .from('bookings')
                .select('id, customer_name, vehicle_name, dropoff_date, status, alarm_triggered_at')
                .is('alarm_triggered_at', null)
                .neq('status', 'returned')
                .neq('status', 'cancelled')
                .gte('dropoff_date', nowISO)
                .lt('dropoff_date', new Date(now.getTime() + 60000).toISOString()) // Within next minute

            if (error) {
                console.error('Failed to check due returns:', error)
                return
            }

            if (!bookings || bookings.length === 0) {
                return
            }

            // Check each booking
            for (const booking of bookings) {
                // Skip if already triggered in this session
                if (triggeredAlarmsRef.current.has(booking.id)) {
                    continue
                }

                // Parse return time and compare to current time (minute precision)
                const returnTime = new Date(booking.dropoff_date)
                returnTime.setSeconds(0, 0)

                // If times match (same minute), trigger alarm
                if (returnTime.getTime() === now.getTime()) {
                    console.log('🚨 ALARM TRIGGERED for booking:', booking.id)

                    // Mark as triggered
                    triggeredAlarmsRef.current.add(booking.id)
                    localStorage.setItem(
                        'triggered_alarms',
                        JSON.stringify([...triggeredAlarmsRef.current])
                    )

                    // Trigger alarm
                    playAlarm({
                        bookingId: booking.id,
                        vehicleName: booking.vehicle_name || 'Unknown Vehicle',
                        returnTime: returnTime.toLocaleTimeString('it-IT', {
                            hour: '2-digit',
                            minute: '2-digit'
                        }),
                        customerName: booking.customer_name || 'Unknown Customer'
                    })

                    // Only trigger one alarm at a time
                    break
                }
            }
        } catch (error) {
            console.error('Error checking due returns:', error)
        }
    }

    // Poll for due returns every 30 seconds
    useEffect(() => {
        // Initial check
        checkDueReturns()

        // Set up polling interval
        const interval = setInterval(checkDueReturns, 30000) // 30 seconds

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
