import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'
import toast from 'react-hot-toast'
import type { Session } from '@supabase/supabase-js'
import { logger } from '../utils/logger'

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

interface AlarmConfigRow {
    id: string
    is_enabled: boolean
    threshold_value: number
    threshold_unit: 'minutes_before' | 'minutes_after' | 'km' | 'days'
}

interface AlarmState {
    activeAlarm: AlarmBooking | null
    isPlaying: boolean
    audioEnabled: boolean
}

interface VehicleAlarmContextType {
    alarmState: AlarmState
    enableAudio: () => void
    disableAudio: () => void
    stopAlarm: (bookingId: string) => void
    markReturned: (bookingId: string) => Promise<{ ok: boolean; error?: string }>
}

const VehicleAlarmContext = createContext<VehicleAlarmContextType | undefined>(undefined)

// eslint-disable-next-line react-refresh/only-export-components
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

    const [session, setSession] = useState<Session | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)

    // Mirror audioEnabled in a ref so the polling closure (frozen at
    // session-set time) sees the current value when the user toggles it
    // mid-session. Without this, clicking "Attiva audio" silently does
    // nothing for the running interval.
    const audioEnabledRef = useRef<boolean>(alarmState.audioEnabled)
    useEffect(() => { audioEnabledRef.current = alarmState.audioEnabled }, [alarmState.audioEnabled])

    // Live admin-editable alarm config from public.system_alarms.
    // Falls back to hardcoded defaults (10 min / 1000 km / 7 days) if the
    // table is empty or unreachable so the alarm system always works.
    const alarmConfigRef = useRef<Map<string, AlarmConfigRow>>(new Map())
    const getAlarmCfg = (id: string, defaultValue: number, defaultUnit: AlarmConfigRow['threshold_unit']): AlarmConfigRow => {
        const fromDb = alarmConfigRef.current.get(id)
        if (fromDb) return fromDb
        return { id, is_enabled: true, threshold_value: defaultValue, threshold_unit: defaultUnit }
    }
    const triggeredAlarmsRef = useRef<Set<string>>((() => {
        try {
            const stored = JSON.parse(localStorage.getItem('triggered_alarms') || '[]')
            const now = Date.now()
            const DAY_MS = 24 * 60 * 60 * 1000
            if (Array.isArray(stored) && stored.length > 0 && typeof stored[0] === 'object') {
                const valid = stored.filter((entry: { id: string; ts: number }) => now - entry.ts < DAY_MS)
                localStorage.setItem('triggered_alarms', JSON.stringify(valid))
                return new Set(valid.map((entry: { id: string }) => entry.id))
            } else {
                localStorage.setItem('triggered_alarms', '[]')
                return new Set<string>()
            }
        } catch {
            return new Set<string>()
        }
    })())

    // Helper: add alarm to triggered set with timestamp for cleanup
    const markAlarmTriggered = (trackingId: string, bookingId?: string) => {
        triggeredAlarmsRef.current.add(trackingId)
        try {
            const stored = JSON.parse(localStorage.getItem('triggered_alarms') || '[]')
            stored.push({ id: trackingId, ts: Date.now() })
            localStorage.setItem('triggered_alarms', JSON.stringify(stored))
        } catch { /* ignore storage errors */ }

        // Persist DB-side so other admin sessions / browser reloads won't re-ring
        // the same booking. Only for real booking IDs (skip fleet maintenance etc).
        if (bookingId && !trackingId.startsWith('fleet_')) {
            supabase.from('bookings')
                .update({ alarm_triggered_at: new Date().toISOString() })
                .eq('id', bookingId)
                .then(({ error }) => {
                    if (error) console.warn('[alarm] failed to persist alarm_triggered_at:', error)
                })
        }
    }

    // Track auth state — only run alarms when logged in
    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session)
        })
        return () => subscription.unsubscribe()
    }, [])

    // Load alarm config + subscribe to changes. Admin edits in
    // AlarmInventoryModal flow through this realtime channel so the
    // next polling tick uses the new thresholds without a reload.
    useEffect(() => {
        if (!session) return
        let cancelled = false
        const apply = (rows: AlarmConfigRow[] | null | undefined) => {
            const map = new Map<string, AlarmConfigRow>()
            for (const r of rows || []) map.set(r.id, r)
            alarmConfigRef.current = map
        }
        ;(async () => {
            const { data } = await supabase
                .from('system_alarms')
                .select('id, is_enabled, threshold_value, threshold_unit')
            if (cancelled) return
            apply(data as AlarmConfigRow[] | null)
        })()
        const channel = supabase
            .channel('system-alarms-config')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'system_alarms' }, async () => {
                const { data } = await supabase
                    .from('system_alarms')
                    .select('id, is_enabled, threshold_value, threshold_unit')
                if (!cancelled) apply(data as AlarmConfigRow[] | null)
            })
            .subscribe()
        return () => {
            cancelled = true
            supabase.removeChannel(channel)
        }
    }, [session])

    // Enable audio alerts
    const enableAudio = async () => {
        // Prevent multiple simultaneous attempts
        if (alarmState.audioEnabled) {
            toast.success('Sound alerts are already enabled!')
            return
        }

        try {
            // Simple approach: just enable it
            localStorage.setItem('audioAlertsEnabled', 'true')
            setAlarmState(prev => ({ ...prev, audioEnabled: true }))

            // Try to unlock audio with AudioContext (reuse single instance)
            try {
                if (!audioContextRef.current) {
                    audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
                }
                if (audioContextRef.current.state === 'suspended') {
                    await audioContextRef.current.resume()
                }

                // Play a very short, quiet beep to unlock
                const oscillator = audioContextRef.current.createOscillator()
                const gainNode = audioContextRef.current.createGain()
                oscillator.connect(gainNode)
                gainNode.connect(audioContextRef.current.destination)
                gainNode.gain.value = 0.01
                oscillator.frequency.value = 440
                oscillator.start(audioContextRef.current.currentTime)
                oscillator.stop(audioContextRef.current.currentTime + 0.01)
            } catch {
                // Ignore unlock errors
            }

            toast.success('Sound alerts enabled! You will hear an alarm when vehicles are due for return.')
            // Audio alerts enabled
        } catch (err) {
            console.error('Failed to enable audio:', err)
            toast.error('Failed to enable sound alerts. Please try again.')
        }
    }

    // Disable audio entirely (counterpart to enableAudio).
    // Stops any current alarm sound and clears the localStorage flag so
    // future browser sessions also start with audio off.
    const disableAudio = () => {
        if (audioRef.current) {
            audioRef.current.pause()
            audioRef.current.currentTime = 0
        }
        localStorage.setItem('audioAlertsEnabled', 'false')
        setAlarmState(prev => ({ ...prev, audioEnabled: false, isPlaying: false }))
        toast.success('Allarmi audio disattivati. Le notifiche visive restano attive.')
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

        // IMMEDIATE session-level block — every tracking-ID variant for this booking
        // gets added to the in-memory set + localStorage, so the alarm cannot
        // re-trigger in the current tab even if the DB update below fails.
        const ids = [
            bookingId,
            `return_before_${bookingId}`,
            `return_after_${bookingId}`,
            `deposit_${bookingId}`,
            `unpaid_${bookingId}`,
            `car_wash_${bookingId}`,
        ]
        try {
            const stored = JSON.parse(localStorage.getItem('triggered_alarms') || '[]')
            const now = Date.now()
            for (const id of ids) {
                triggeredAlarmsRef.current.add(id)
                stored.push({ id, ts: now })
            }
            localStorage.setItem('triggered_alarms', JSON.stringify(stored))
        } catch { /* ignore storage errors */ }

        // Persist DB-side so other sessions and page reloads stay quiet.
        // Fire-and-forget — if the column is missing or RLS blocks, the localStorage
        // block above still keeps this tab silent until the row actually returns.
        try {
            const { error } = await supabase
                .from('bookings')
                .update({ alarm_triggered_at: new Date().toISOString() })
                .eq('id', bookingId)
            if (error) console.warn('[alarm] stopAlarm DB update failed:', error.message)
        } catch (error) {
            console.error('Failed to update alarm status:', error)
        }
    }

    // Mark booking as returned: status='completata' + alarm off in one action.
    // The bookings_status_check DB constraint accepts 'completata' (Italian)
    // not 'completed' — matching the rest of the project's status vocabulary.
    // First attempt 'completata'; if a future tenant uses 'completed', fall
    // back so we don't block the admin.
    const markReturned = async (bookingId: string): Promise<{ ok: boolean; error?: string }> => {
        // Silence the alarm locally first (so user sees it stop even if DB hiccups)
        await stopAlarm(bookingId)
        const tryStatus = async (status: 'completata' | 'completed') => {
            return supabase
                .from('bookings')
                .update({
                    status,
                    actual_return_date: new Date().toISOString(),
                    alarm_triggered_at: new Date().toISOString(),
                })
                .eq('id', bookingId)
        }
        try {
            let { error } = await tryStatus('completata')
            if (error && /bookings_status_check|check constraint/i.test(error.message)) {
                console.warn('[alarm] completata rejected by check constraint, trying completed')
                ;({ error } = await tryStatus('completed'))
            }
            if (error) {
                console.warn('[alarm] markReturned DB update failed:', error.message)
                return { ok: false, error: error.message }
            }
            return { ok: true }
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error)
            console.error('markReturned failed:', msg)
            return { ok: false, error: msg }
        }
    }

    // Play alarm sound
    const playAlarm = (booking: AlarmBooking) => {
        // Triggering alarm

        // Read from ref — `alarmState.audioEnabled` is a stale closure
        // when this is invoked from the polling interval set up at
        // session-establishment time.
        if (!audioEnabledRef.current) {
            // Audio not enabled, visual notification only
        } else {
            try {
                // Create or reuse audio element
                if (!audioRef.current) {
                    logger.log('Creating new Audio element for alarm')
                    audioRef.current = new Audio('/alarm.mp3')
                    audioRef.current.loop = true
                    audioRef.current.volume = 0.8 // Set volume to 80%

                    audioRef.current.addEventListener('error', () => {
                        // Audio load error — will fall through to visual notification
                    })
                }

                // Reset and play
                audioRef.current.currentTime = 0
                audioRef.current.play()
                    .then(() => {
                        // Alarm playing
                    })
                    .catch(() => {
                        // Try to resume AudioContext if suspended (reuse existing)
                        if (audioContextRef.current?.state === 'suspended') {
                            audioContextRef.current.resume().then(() => {
                                audioRef.current?.play().catch(() => {})
                            })
                        }
                    })
            } catch {
                // Error setting up alarm audio
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

            // Per-alarm thresholds come from public.system_alarms (admin
            // editable). Fall back to the historical defaults if the
            // table hasn't been seeded yet.
            const cfgCarWash       = getAlarmCfg('car_wash',       10, 'minutes_before')
            const cfgReturnBefore  = getAlarmCfg('return_before',  10, 'minutes_before')
            const cfgReturnAfter   = getAlarmCfg('return_after',   10, 'minutes_after')
            const cfgDeposit       = getAlarmCfg('deposit',        10, 'minutes_before')
            const cfgUnpaidPickup  = getAlarmCfg('unpaid_pickup',  10, 'minutes_before')

            const returnAfterMs   = cfgReturnAfter.threshold_value * 60000
            const tenMinutesAgo = new Date(now.getTime() - returnAfterMs)
            const tenMinutesAgoISO = tenMinutesAgo.toISOString()

            // "Future" window is per-alarm (each can have its own lead time).
            // Default fallback: cfgReturnBefore.threshold_value.
            const futureLeadMinReturn = cfgReturnBefore.threshold_value
            const futureLeadMinDeposit = cfgDeposit.threshold_value
            const futureLeadMinUnpaid = cfgUnpaidPickup.threshold_value
            const futureLeadMinCarWash = cfgCarWash.threshold_value
            // Pre-compute the most common (return) future window for the SQL queries below.
            const tenMinutesFuture = new Date(now.getTime() + futureLeadMinReturn * 60000)
            const tenMinutesFutureISO = tenMinutesFuture.toISOString()

            // --- 0. CHECK CAR WASH (lead-time mins BEFORE appointment) ---
            // ONLY for external client washes, NOT rientro/internal washes
            if (!cfgCarWash.is_enabled) { /* skip */ } else {
            const todayISO = now.toISOString().split('T')[0]
            const { data: carWash, error: carWashError } = await supabase
                .from('bookings')
                .select('id, customer_name, vehicle_name, service_name, appointment_date, appointment_time, status, booking_details, booking_source, price_total')
                .eq('service_type', 'car_wash')
                .in('status', ['confirmed', 'confermata', 'in_corso', 'active'])
                .eq('appointment_date', todayISO)

            if (!carWashError && carWash && carWash.length > 0) {
                for (const booking of carWash) {
                    if (!booking.appointment_date || !booking.appointment_time) continue

                    // Skip internal/rientro washes
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const details = (booking.booking_details || {}) as any
                    if (details.internal === true) continue
                    if (details.createdBy === 'automatic_system') continue
                    if (booking.vehicle_name && booking.vehicle_name.toUpperCase().startsWith('INTERNO')) continue
                    // Rientri (auto-created on rental return) have customer_name='Lavaggio Rientro'
                    if ((booking.customer_name || '').trim().toLowerCase() === 'lavaggio rientro') continue
                    // Zero-price washes are likely internal
                    if (!booking.price_total || booking.price_total === 0) continue
                    const source = (details.source || '').toLowerCase()
                    const notes = (details.notes || '').toLowerCase()
                    const bookingSource = (booking.booking_source || '').toLowerCase()
                    const serviceName = (booking.service_name || '').toLowerCase()
                    const vehicleName = (booking.vehicle_name || '').toLowerCase()
                    const combined = source + ' ' + notes + ' ' + bookingSource + ' ' + serviceName + ' ' + vehicleName
                    const rientroKeywords = ['reintegration', 'reint', 'internal', 'reconditioning', 'automatico', 'auto-wash', 'rientro', 'interno']
                    if (rientroKeywords.some(kw => combined.includes(kw))) continue

                    const appointmentDateTime = new Date(`${booking.appointment_date}T${booking.appointment_time}`)

                    const trackingId = `car_wash_${booking.id}`
                    if (triggeredAlarmsRef.current.has(trackingId)) continue

                    // Level detection: fire whenever the appointment is within
                    // the next `leadMs` window (and still in the future) and
                    // hasn't been triggered yet. Edge detection (exact-minute
                    // match) silently dropped alarms when the polling tick
                    // happened to miss that minute.
                    const diff = appointmentDateTime.getTime() - now.getTime()
                    const leadMs = futureLeadMinCarWash * 60000
                    if (diff >= 0 && diff <= leadMs) {
                        markAlarmTriggered(trackingId, booking.id)

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
            } /* end if cfgCarWash.is_enabled */

            // --- 1A. CHECK RETURNS - lead-time mins BEFORE return ---
            // Only active rentals (not completed, not car wash), and only if
            // alarm_triggered_at is null — ie. no admin has dismissed it yet.
            if (!cfgReturnBefore.is_enabled) { /* skip */ } else {
            // Level detection: any active rental whose dropoff is within the
            // next `futureLeadMinReturn` minutes and hasn't been alarmed yet.
            const { data: returnsBefore, error: returnsBeforeError } = await supabase
                .from('bookings')
                .select('id, customer_name, vehicle_name, dropoff_date, status, alarm_triggered_at, service_type')
                .in('status', ['confirmed', 'confermata', 'in_corso', 'active'])
                .not('service_type', 'eq', 'car_wash')
                .not('customer_name', 'eq', 'Lavaggio Rientro')
                .not('vehicle_name', 'ilike', 'test%')
                .is('alarm_triggered_at', null)
                .gte('dropoff_date', now.toISOString())
                .lte('dropoff_date', tenMinutesFutureISO)

            if (!returnsBeforeError && returnsBefore && returnsBefore.length > 0) {
                for (const booking of returnsBefore) {
                    const trackingId = `return_before_${booking.id}`
                    if (triggeredAlarmsRef.current.has(trackingId)) continue

                    const returnTime = new Date(booking.dropoff_date)
                    returnTime.setSeconds(0, 0)

                    {
                        markAlarmTriggered(trackingId, booking.id)

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
            } /* end if cfgReturnBefore.is_enabled */

            // --- 1B. CHECK RETURNS - lead-time mins AFTER return ---
            // Only active rentals (not completed, not car wash), and only if
            // alarm_triggered_at is null (same gating as §1A).
            if (!cfgReturnAfter.is_enabled) { /* skip */ } else {
            // Level detection: any active rental whose dropoff was at least
            // `cfgReturnAfter.threshold_value` minutes ago and hasn't been
            // alarmed yet. A car that's been late since yesterday will alarm
            // on the very next polling tick — edge detection silently lost
            // those because the tick had to land exactly on the threshold
            // minute.
            const { data: returnsAfter, error: returnsAfterError } = await supabase
                .from('bookings')
                .select('id, customer_name, vehicle_name, dropoff_date, status, alarm_triggered_at, service_type')
                .in('status', ['confirmed', 'confermata', 'in_corso', 'active'])
                .not('service_type', 'eq', 'car_wash')
                .not('customer_name', 'eq', 'Lavaggio Rientro')
                .not('vehicle_name', 'ilike', 'test%')
                .is('alarm_triggered_at', null)
                .lte('dropoff_date', tenMinutesAgoISO)

            if (!returnsAfterError && returnsAfter && returnsAfter.length > 0) {
                for (const booking of returnsAfter) {
                    const trackingId = `return_after_${booking.id}`
                    if (triggeredAlarmsRef.current.has(trackingId) || triggeredAlarmsRef.current.has(booking.id)) continue

                    const returnTime = new Date(booking.dropoff_date)
                    returnTime.setSeconds(0, 0)

                    markAlarmTriggered(trackingId, booking.id)

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
            } /* end if cfgReturnAfter.is_enabled */

            // --- 2. CHECK DEPOSITS (lead-time mins BEFORE pickup time) ---
            if (!cfgDeposit.is_enabled) { /* skip */ } else {
            // Level detection: any pickup within the next `futureLeadMinDeposit`
            // minutes that has a non-zero deposit and hasn't been alarmed.
            const depositFuture = new Date(now.getTime() + futureLeadMinDeposit * 60000)
            const depositFutureISO = depositFuture.toISOString()

            const { data: pickups, error: pickupsError } = await supabase
                .from('bookings')
                .select('id, customer_name, vehicle_name, pickup_date, status, booking_details, service_type')
                .in('status', ['confirmed', 'confermata', 'in_corso', 'active'])
                .not('service_type', 'eq', 'car_wash')
                .gte('pickup_date', now.toISOString())
                .lte('pickup_date', depositFutureISO)

            if (!pickupsError && pickups && pickups.length > 0) {
                for (const booking of pickups) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const details = booking.booking_details as any
                    const deposit = details?.deposit ? Number(details.deposit) : 0

                    if (deposit <= 0) continue

                    const trackingId = `deposit_${booking.id}`
                    if (triggeredAlarmsRef.current.has(trackingId)) continue

                    const pickupTime = new Date(booking.pickup_date)
                    pickupTime.setSeconds(0, 0)

                    markAlarmTriggered(trackingId, booking.id)

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
            } /* end if cfgDeposit.is_enabled */

            // --- 3. CHECK UNPAID PICKUP (lead-time mins BEFORE pickup) ---
            if (!cfgUnpaidPickup.is_enabled) { /* skip */ } else {
            // Level detection: any unpaid pickup within the next
            // `futureLeadMinUnpaid` minutes (or already past) that hasn't
            // been alarmed yet. Three payment values count as paid:
            // paid, completed, succeeded (project rule).
            const unpaidFuture = new Date(now.getTime() + futureLeadMinUnpaid * 60000)
            const unpaidFutureISO = unpaidFuture.toISOString()

            const { data: unpaidPickups, error: unpaidError } = await supabase
                .from('bookings')
                .select('id, customer_name, vehicle_name, pickup_date, status, payment_status, price_total, booking_details, service_type')
                .in('status', ['confirmed', 'confermata', 'in_corso', 'active'])
                .not('payment_status', 'in', '("paid","completed","succeeded")')
                .not('service_type', 'eq', 'car_wash')
                .lte('pickup_date', unpaidFutureISO)

            if (!unpaidError && unpaidPickups && unpaidPickups.length > 0) {
                for (const booking of unpaidPickups) {
                    const trackingId = `unpaid_${booking.id}`
                    if (triggeredAlarmsRef.current.has(trackingId)) continue

                    const pickupTime = new Date(booking.pickup_date)
                    pickupTime.setSeconds(0, 0)

                    markAlarmTriggered(trackingId, booking.id)

                    playAlarm({
                        bookingId: booking.id,
                        vehicleName: booking.vehicle_name || 'Unknown Vehicle',
                        returnTime: pickupTime.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
                        customerName: booking.customer_name || 'Unknown',
                        type: 'unpaid_pickup',
                        deposit: booking.price_total / 100
                    })
                    return
                }
            }
            } /* end if cfgUnpaidPickup.is_enabled */

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

            // Per-alarm config (admin editable). Falls back to historical
            // defaults (1000 km / 7 days) if a row is missing.
            const cfgService     = getAlarmCfg('fleet_service',      1000, 'km')
            const cfgTiresFront  = getAlarmCfg('fleet_tires_front',  1000, 'km')
            const cfgTiresRear   = getAlarmCfg('fleet_tires_rear',   1000, 'km')
            const cfgBrakesFront = getAlarmCfg('fleet_brakes_front', 1000, 'km')
            const cfgBrakesRear  = getAlarmCfg('fleet_brakes_rear',  1000, 'km')
            const cfgInsurance   = getAlarmCfg('fleet_insurance',    7,    'days')
            const cfgTax         = getAlarmCfg('fleet_tax',          7,    'days')
            const cfgInspection  = getAlarmCfg('fleet_inspection',   7,    'days')
            const now = new Date()

            for (const vehicle of vehicles) {
                const currentKm = vehicle.current_km || 0
                const vehicleId = vehicle.id

                // Check Service (Tagliando)
                if (cfgService.is_enabled && vehicle.maintenance_service_interval_km) {
                    const lastService = vehicle.last_service_km || 0
                    const nextService = lastService + vehicle.maintenance_service_interval_km
                    const remaining = nextService - currentKm

                    if (remaining <= cfgService.threshold_value) {
                        const trackingId = `fleet_service_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        markAlarmTriggered(trackingId)

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
                if (cfgTiresFront.is_enabled && vehicle.maintenance_tires_interval_km) {
                    const lastTiresFront = vehicle.last_tire_change_front_km || vehicle.last_tire_change_km || 0
                    const nextTiresFront = lastTiresFront + vehicle.maintenance_tires_interval_km
                    const remainingFront = nextTiresFront - currentKm

                    if (remainingFront <= cfgTiresFront.threshold_value) {
                        const trackingId = `fleet_tires_front_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        markAlarmTriggered(trackingId)

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
                if (cfgTiresRear.is_enabled && vehicle.maintenance_tires_interval_km) {
                    const lastTiresRear = vehicle.last_tire_change_rear_km || vehicle.last_tire_change_km || 0
                    const nextTiresRear = lastTiresRear + vehicle.maintenance_tires_interval_km
                    const remainingRear = nextTiresRear - currentKm

                    if (remainingRear <= cfgTiresRear.threshold_value) {
                        const trackingId = `fleet_tires_rear_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        markAlarmTriggered(trackingId)

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
                if (cfgBrakesFront.is_enabled && vehicle.maintenance_brake_interval_km) {
                    const lastBrakesFront = vehicle.last_brake_change_front_km || vehicle.last_brake_change_km || 0
                    const nextBrakesFront = lastBrakesFront + vehicle.maintenance_brake_interval_km
                    const remainingFront = nextBrakesFront - currentKm

                    if (remainingFront <= cfgBrakesFront.threshold_value) {
                        const trackingId = `fleet_brakes_front_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        markAlarmTriggered(trackingId)

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
                if (cfgBrakesRear.is_enabled && vehicle.maintenance_brake_interval_km) {
                    const lastBrakesRear = vehicle.last_brake_change_rear_km || vehicle.last_brake_change_km || 0
                    const nextBrakesRear = lastBrakesRear + vehicle.maintenance_brake_interval_km
                    const remainingRear = nextBrakesRear - currentKm

                    if (remainingRear <= cfgBrakesRear.threshold_value) {
                        const trackingId = `fleet_brakes_rear_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        markAlarmTriggered(trackingId)

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
                if (cfgInsurance.is_enabled && vehicle.insurance_expiry) {
                    const expiryDate = new Date(vehicle.insurance_expiry)
                    const daysRemaining = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

                    if (daysRemaining <= cfgInsurance.threshold_value) {
                        const trackingId = `fleet_insurance_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        markAlarmTriggered(trackingId)

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
                if (cfgTax.is_enabled && vehicle.tax_expiry) {
                    const expiryDate = new Date(vehicle.tax_expiry)
                    const daysRemaining = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

                    if (daysRemaining <= cfgTax.threshold_value) {
                        const trackingId = `fleet_tax_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        markAlarmTriggered(trackingId)

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
                if (cfgInspection.is_enabled && vehicle.inspection_expiry) {
                    const expiryDate = new Date(vehicle.inspection_expiry)
                    const daysRemaining = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

                    if (daysRemaining <= cfgInspection.threshold_value) {
                        const trackingId = `fleet_inspection_${vehicleId}`
                        if (triggeredAlarmsRef.current.has(trackingId)) continue

                        markAlarmTriggered(trackingId)

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

    // Poll every 60 seconds — only when authenticated and tab is visible
    useEffect(() => {
        if (!session) return

        let interval: ReturnType<typeof setInterval> | null = null
        let isRunning = false

        const runChecks = async () => {
            if (isRunning) return
            isRunning = true
            try {
                await Promise.all([checkAlarms(), checkFleetMaintenanceAlarms()])
            } finally {
                isRunning = false
            }
        }

        const startPolling = () => {
            runChecks()
            interval = setInterval(runChecks, 60000)
        }

        const stopPolling = () => {
            if (interval) {
                clearInterval(interval)
                interval = null
            }
        }

        // Pause polling when tab is hidden to save resources
        const handleVisibilityChange = () => {
            if (document.hidden) {
                stopPolling()
            } else {
                startPolling()
            }
        }

        startPolling()
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            stopPolling()
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session])

    // Cleanup audio on unmount
    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause()
                audioRef.current = null
            }
            if (audioContextRef.current) {
                audioContextRef.current.close().catch(() => {})
                audioContextRef.current = null
            }
        }
    }, [])

    return (
        <VehicleAlarmContext.Provider value={{ alarmState, enableAudio, disableAudio, stopAlarm, markReturned }}>
            {children}
        </VehicleAlarmContext.Provider>
    )
}
