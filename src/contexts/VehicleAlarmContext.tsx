import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'

interface AlarmBooking {
    bookingId: string
    vehicleName: string
    returnTime: string
    customerName: string
    type?: 'return' | 'deposit' | 'unpaid_pickup' | 'car_wash' | 'fleet_maintenance_km' | 'fleet_maintenance_date'
    deposit?: number
    // Fleet maintenance specific fields
    vehicleId?: string
    maintenanceType?: string
    currentValue?: number | string
    dueValue?: number | string
    remaining?: number
    urgent?: boolean
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
            // --- TIME CALCULATIONS ---
            const tenMinutesAgo = new Date(now.getTime() - 10 * 60000)
            const tenMinutesAgoISO = tenMinutesAgo.toISOString()
            const tenMinutesAgoPlusOne = new Date(tenMinutesAgo.getTime() + 60000).toISOString()

            const tenMinutesFuture = new Date(now.getTime() + 10 * 60000)
            const tenMinutesFutureISO = tenMinutesFuture.toISOString()
            const tenMinutesFuturePlusOne = new Date(tenMinutesFuture.getTime() + 60000).toISOString()

            // --- 0. CHECK CAR WASH (10 mins BEFORE appointment) ---
            // ONLY for external client washes, NOT rientro/internal washes

            const { data: carWash, error: carWashError } = await supabase
                .from('bookings')
                .select('id, customer_name, vehicle_name, service_name, appointment_date, appointment_time, status, booking_details, booking_source')
                .eq('service_type', 'car_wash')
                .neq('status', 'cancelled')
                .gte('appointment_date', tenMinutesFutureISO.split('T')[0])

            if (!carWashError && carWash && carWash.length > 0) {
                for (const booking of carWash) {
                    if (!booking.appointment_date || !booking.appointment_time) continue

                    // Skip internal/rientro washes
                    const details = (booking.booking_details || {}) as any
                    if (details.internal === true) continue
                    if (details.createdBy === 'automatic_system') continue
                    if (booking.vehicle_name && booking.vehicle_name.toUpperCase().startsWith('INTERNO')) continue
                    const source = (details.source || '').toLowerCase()
                    const notes = (details.notes || '').toLowerCase()
                    const bookingSource = (booking.booking_source || '').toLowerCase()
                    const combined = source + ' ' + notes + ' ' + bookingSource
                    const rientroKeywords = ['reintegration', 'reint', 'internal', 'reconditioning', 'automatico', 'auto-wash', 'rientro']
                    if (rientroKeywords.some(kw => combined.includes(kw))) continue

                    const appointmentDateTime = new Date(`${booking.appointment_date}T${booking.appointment_time}`)

                    const trackingId = `car_wash_${booking.id}`
                    if (triggeredAlarmsRef.current.has(trackingId)) continue

                    const diff = appointmentDateTime.getTime() - now.getTime()
                    if (diff >= 600000 && diff < 660000) {
                        triggeredAlarmsRef.current.add(trackingId)
                        localStorage.setItem('triggered_alarms', JSON.stringify([...triggeredAlarmsRef.current]))

                        playAlarm({
                            bookingId: booking.id,
                            vehicleName: booking.service_name || 'Lavaggio Auto',
                            returnTime: booking.appointment_time,
                            customerName: booking.customer_name || 'Unknown',
                            type: 'car_wash'
                        })
                        return
                    }
                }
            }

            // --- 1A. CHECK RETURNS - 10 mins BEFORE return (pre-return warning) ---
            const { data: returnsBefore, error: returnsBeforeError } = await supabase
                .from('bookings')
                .select('id, customer_name, vehicle_name, dropoff_date, status, alarm_triggered_at')
                .neq('status', 'returned')
                .neq('status', 'cancelled')
                .gte('dropoff_date', tenMinutesFutureISO)
                .lt('dropoff_date', tenMinutesFuturePlusOne)

            if (!returnsBeforeError && returnsBefore && returnsBefore.length > 0) {
                for (const booking of returnsBefore) {
                    const trackingId = `return_before_${booking.id}`
                    if (triggeredAlarmsRef.current.has(trackingId)) continue

                    // Check exact minute match locally
                    const returnTime = new Date(booking.dropoff_date)
                    returnTime.setSeconds(0, 0)

                    if (returnTime.getTime() === tenMinutesFuture.getTime()) {
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

            // --- 1B. CHECK RETURNS - 10 mins AFTER return (second alarm, independent of before-alarm) ---
            const { data: returnsAfter, error: returnsAfterError } = await supabase
                .from('bookings')
                .select('id, customer_name, vehicle_name, dropoff_date, status, alarm_triggered_at')
                .neq('status', 'returned')
                .neq('status', 'cancelled')
                .gte('dropoff_date', tenMinutesAgoISO)
                .lt('dropoff_date', tenMinutesAgoPlusOne)

            if (!returnsAfterError && returnsAfter && returnsAfter.length > 0) {
                for (const booking of returnsAfter) {
                    const trackingId = `return_after_${booking.id}`
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

            // --- 3. CHECK UNPAID PICKUP (10 mins BEFORE pickup) ---
            const { data: unpaidPickups, error: unpaidError } = await supabase
                .from('bookings')
                .select('id, customer_name, vehicle_name, pickup_date, status, payment_status, price_total, booking_details')
                .neq('status', 'cancelled')
                .neq('payment_status', 'paid')
                .gte('pickup_date', tenMinutesFutureISO)
                .lt('pickup_date', tenMinutesFuturePlusOne)

            if (!unpaidError && unpaidPickups && unpaidPickups.length > 0) {
                for (const booking of unpaidPickups) {
                    const trackingId = `unpaid_${booking.id}`
                    if (triggeredAlarmsRef.current.has(trackingId)) continue

                    const pickupTime = new Date(booking.pickup_date)
                    pickupTime.setSeconds(0, 0)

                    // Double check time match just in case
                    if (pickupTime.getTime() === tenMinutesFuture.getTime()) {
                        triggeredAlarmsRef.current.add(trackingId)
                        localStorage.setItem('triggered_alarms', JSON.stringify([...triggeredAlarmsRef.current]))

                        playAlarm({
                            bookingId: booking.id,
                            vehicleName: booking.vehicle_name || 'Unknown Vehicle',
                            returnTime: pickupTime.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
                            customerName: booking.customer_name || 'Unknown',
                            type: 'unpaid_pickup',
                            deposit: booking.price_total / 100 // Convert from cents to euros
                        })
                        return
                    }
                }
            }

        } catch (error) {
            console.error('Error checking alarms:', error)
        }
    }

    // Check for fleet maintenance alarms
    const checkFleetMaintenanceAlarms = async () => {
        try {
            const { data: vehicles, error } = await supabase
                .from('vehicles')
                .select('*')
                .eq('status', 'available')

            if (error || !vehicles) return

            const ALERT_THRESHOLD_KM = 1000
            const ALERT_THRESHOLD_DAYS = 7
            const now = new Date()

            for (const vehicle of vehicles) {
                const currentKm = vehicle.current_km || 0
                const vehicleId = vehicle.id

                // Check Service (Tagliando)
                if (vehicle.maintenance_service_interval_km) {
                    const lastService = vehicle.last_service_km || 0
                    const nextService = lastService + vehicle.maintenance_service_interval_km
                    const remaining = nextService - currentKm

                    if (remaining <= ALERT_THRESHOLD_KM) {
                        const trackingId = `fleet_service_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        triggeredAlarmsRef.current.add(trackingId)
                        localStorage.setItem('triggered_alarms', JSON.stringify([...triggeredAlarmsRef.current]))

                        playAlarm({
                            bookingId: vehicleId,
                            vehicleId: vehicleId,
                            vehicleName: vehicle.display_name || vehicle.plate || 'Unknown Vehicle',
                            returnTime: `${nextService.toLocaleString()} km`,
                            customerName: 'Fleet Maintenance',
                            type: 'fleet_maintenance_km',
                            maintenanceType: 'Tagliando',
                            currentValue: currentKm,
                            dueValue: nextService,
                            remaining: remaining,
                            urgent: remaining <= 0
                        })
                        return
                    }
                }

                // Check Front Tires
                if (vehicle.maintenance_tires_interval_km) {
                    const lastTiresFront = vehicle.last_tire_change_front_km || vehicle.last_tire_change_km || 0
                    const nextTiresFront = lastTiresFront + vehicle.maintenance_tires_interval_km
                    const remainingFront = nextTiresFront - currentKm

                    if (remainingFront <= ALERT_THRESHOLD_KM) {
                        const trackingId = `fleet_tires_front_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        triggeredAlarmsRef.current.add(trackingId)
                        localStorage.setItem('triggered_alarms', JSON.stringify([...triggeredAlarmsRef.current]))

                        playAlarm({
                            bookingId: vehicleId,
                            vehicleId: vehicleId,
                            vehicleName: vehicle.display_name || vehicle.plate || 'Unknown Vehicle',
                            returnTime: `${nextTiresFront.toLocaleString()} km`,
                            customerName: 'Fleet Maintenance',
                            type: 'fleet_maintenance_km',
                            maintenanceType: 'Gomme Anteriori',
                            currentValue: currentKm,
                            dueValue: nextTiresFront,
                            remaining: remainingFront,
                            urgent: remainingFront <= 0
                        })
                        return
                    }
                }

                // Check Rear Tires
                if (vehicle.maintenance_tires_interval_km) {
                    const lastTiresRear = vehicle.last_tire_change_rear_km || vehicle.last_tire_change_km || 0
                    const nextTiresRear = lastTiresRear + vehicle.maintenance_tires_interval_km
                    const remainingRear = nextTiresRear - currentKm

                    if (remainingRear <= ALERT_THRESHOLD_KM) {
                        const trackingId = `fleet_tires_rear_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        triggeredAlarmsRef.current.add(trackingId)
                        localStorage.setItem('triggered_alarms', JSON.stringify([...triggeredAlarmsRef.current]))

                        playAlarm({
                            bookingId: vehicleId,
                            vehicleId: vehicleId,
                            vehicleName: vehicle.display_name || vehicle.plate || 'Unknown Vehicle',
                            returnTime: `${nextTiresRear.toLocaleString()} km`,
                            customerName: 'Fleet Maintenance',
                            type: 'fleet_maintenance_km',
                            maintenanceType: 'Gomme Posteriori',
                            currentValue: currentKm,
                            dueValue: nextTiresRear,
                            remaining: remainingRear,
                            urgent: remainingRear <= 0
                        })
                        return
                    }
                }

                // Check Front Brakes
                if (vehicle.maintenance_brake_interval_km) {
                    const lastBrakesFront = vehicle.last_brake_change_front_km || vehicle.last_brake_change_km || 0
                    const nextBrakesFront = lastBrakesFront + vehicle.maintenance_brake_interval_km
                    const remainingFront = nextBrakesFront - currentKm

                    if (remainingFront <= ALERT_THRESHOLD_KM) {
                        const trackingId = `fleet_brakes_front_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        triggeredAlarmsRef.current.add(trackingId)
                        localStorage.setItem('triggered_alarms', JSON.stringify([...triggeredAlarmsRef.current]))

                        playAlarm({
                            bookingId: vehicleId,
                            vehicleId: vehicleId,
                            vehicleName: vehicle.display_name || vehicle.plate || 'Unknown Vehicle',
                            returnTime: `${nextBrakesFront.toLocaleString()} km`,
                            customerName: 'Fleet Maintenance',
                            type: 'fleet_maintenance_km',
                            maintenanceType: 'Pastiglie Freni Anteriori',
                            currentValue: currentKm,
                            dueValue: nextBrakesFront,
                            remaining: remainingFront,
                            urgent: remainingFront <= 0
                        })
                        return
                    }
                }

                // Check Rear Brakes
                if (vehicle.maintenance_brake_interval_km) {
                    const lastBrakesRear = vehicle.last_brake_change_rear_km || vehicle.last_brake_change_km || 0
                    const nextBrakesRear = lastBrakesRear + vehicle.maintenance_brake_interval_km
                    const remainingRear = nextBrakesRear - currentKm

                    if (remainingRear <= ALERT_THRESHOLD_KM) {
                        const trackingId = `fleet_brakes_rear_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        triggeredAlarmsRef.current.add(trackingId)
                        localStorage.setItem('triggered_alarms', JSON.stringify([...triggeredAlarmsRef.current]))

                        playAlarm({
                            bookingId: vehicleId,
                            vehicleId: vehicleId,
                            vehicleName: vehicle.display_name || vehicle.plate || 'Unknown Vehicle',
                            returnTime: `${nextBrakesRear.toLocaleString()} km`,
                            customerName: 'Fleet Maintenance',
                            type: 'fleet_maintenance_km',
                            maintenanceType: 'Pastiglie Freni Posteriori',
                            currentValue: currentKm,
                            dueValue: nextBrakesRear,
                            remaining: remainingRear,
                            urgent: remainingRear <= 0
                        })
                        return
                    }
                }

                // Check Insurance
                if (vehicle.insurance_expiry) {
                    const expiryDate = new Date(vehicle.insurance_expiry)
                    const daysRemaining = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

                    if (daysRemaining <= ALERT_THRESHOLD_DAYS) {
                        const trackingId = `fleet_insurance_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        triggeredAlarmsRef.current.add(trackingId)
                        localStorage.setItem('triggered_alarms', JSON.stringify([...triggeredAlarmsRef.current]))

                        playAlarm({
                            bookingId: vehicleId,
                            vehicleId: vehicleId,
                            vehicleName: vehicle.display_name || vehicle.plate || 'Unknown Vehicle',
                            returnTime: expiryDate.toLocaleDateString('it-IT'),
                            customerName: 'Fleet Maintenance',
                            type: 'fleet_maintenance_date',
                            maintenanceType: 'Assicurazione',
                            currentValue: now.toLocaleDateString('it-IT'),
                            dueValue: expiryDate.toLocaleDateString('it-IT'),
                            remaining: daysRemaining,
                            urgent: daysRemaining <= 0
                        })
                        return
                    }
                }

                // Check Tax (Bollo)
                if (vehicle.tax_expiry) {
                    const expiryDate = new Date(vehicle.tax_expiry)
                    const daysRemaining = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

                    if (daysRemaining <= ALERT_THRESHOLD_DAYS) {
                        const trackingId = `fleet_tax_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        triggeredAlarmsRef.current.add(trackingId)
                        localStorage.setItem('triggered_alarms', JSON.stringify([...triggeredAlarmsRef.current]))

                        playAlarm({
                            bookingId: vehicleId,
                            vehicleId: vehicleId,
                            vehicleName: vehicle.display_name || vehicle.plate || 'Unknown Vehicle',
                            returnTime: expiryDate.toLocaleDateString('it-IT'),
                            customerName: 'Fleet Maintenance',
                            type: 'fleet_maintenance_date',
                            maintenanceType: 'Bollo',
                            currentValue: now.toLocaleDateString('it-IT'),
                            dueValue: expiryDate.toLocaleDateString('it-IT'),
                            remaining: daysRemaining,
                            urgent: daysRemaining <= 0
                        })
                        return
                    }
                }

                // Check Inspection (Revisione)
                if (vehicle.inspection_expiry) {
                    const expiryDate = new Date(vehicle.inspection_expiry)
                    const daysRemaining = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

                    if (daysRemaining <= ALERT_THRESHOLD_DAYS) {
                        const trackingId = `fleet_inspection_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        triggeredAlarmsRef.current.add(trackingId)
                        localStorage.setItem('triggered_alarms', JSON.stringify([...triggeredAlarmsRef.current]))

                        playAlarm({
                            bookingId: vehicleId,
                            vehicleId: vehicleId,
                            vehicleName: vehicle.display_name || vehicle.plate || 'Unknown Vehicle',
                            returnTime: expiryDate.toLocaleDateString('it-IT'),
                            customerName: 'Fleet Maintenance',
                            type: 'fleet_maintenance_date',
                            maintenanceType: 'Revisione',
                            currentValue: now.toLocaleDateString('it-IT'),
                            dueValue: expiryDate.toLocaleDateString('it-IT'),
                            remaining: daysRemaining,
                            urgent: daysRemaining <= 0
                        })
                        return
                    }
                }
            }
        } catch (error) {
            console.error('Error checking fleet maintenance alarms:', error)
        }
    }

    // Poll every 30 seconds
    useEffect(() => {
        checkAlarms()
        checkFleetMaintenanceAlarms()
        const interval = setInterval(() => {
            checkAlarms()
            checkFleetMaintenanceAlarms()
        }, 30000)
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
