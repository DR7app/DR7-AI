import type { Vehicle, VehicleMaintenance } from '../types'

export type VehicleStatus = 'OK' | 'ATTENZIONE' | 'URGENTE'
export type DeadlineType = 'tagliando' | 'gomme' | 'freni' | 'revisione' | 'assicurazione' | 'bollo' | 'altro'

export interface DeadlineInfo {
    type: DeadlineType
    label: string
    isDate: boolean
    value: number | string // km remaining or days remaining
    isUrgent: boolean
    isWarning: boolean
    isOverdue: boolean
    details?: string
}

// Thresholds
const DATE_WARNING_DAYS = 15
const SERVICE_WARNING_KM = 2000
const SERVICE_URGENT_KM = 500

export function calculateDaysRemaining(dateString?: string | null): number | null {
    if (!dateString) return null
    const targetDate = new Date(dateString)
    const today = new Date()
    const diffTime = targetDate.getTime() - today.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

export function getVehicleStatus(vehicle: Vehicle, maintenance?: VehicleMaintenance | null): {
    status: VehicleStatus,
    deadlines: DeadlineInfo[],
    nearestDeadline: DeadlineInfo | null
} {
    const deadlines: DeadlineInfo[] = []

    // 1. Check Date-based deadlines
    const checkDateDeadline = (date: string | undefined | null, type: DeadlineType, label: string) => {
        const days = calculateDaysRemaining(date)
        if (days !== null) {
            const isOverdue = days < 0
            const isUrgent = isOverdue // For dates, we mark overdue as urgent immediately
            const isWarning = !isUrgent && days <= DATE_WARNING_DAYS

            if (isWarning || isUrgent) {
                deadlines.push({
                    type,
                    label,
                    isDate: true,
                    value: days,
                    isUrgent,
                    isWarning,
                    isOverdue
                })
            }
        }
    }

    checkDateDeadline(vehicle.insurance_expiry, 'assicurazione', 'Assicurazione')
    checkDateDeadline(vehicle.tax_expiry, 'bollo', 'Bollo')
    checkDateDeadline(vehicle.inspection_expiry, 'revisione', 'Revisione')

    // 2. Check KM-based deadlines (requires maintenance record)
    if (vehicle.current_km && maintenance) {
        // Service
        if (maintenance.last_service_km) {
            const interval = maintenance.service_interval_km || 15000
            const nextServiceKm = maintenance.last_service_km + interval
            const remainingKm = nextServiceKm - (vehicle.current_km || 0)

            const isOverdue = remainingKm < 0
            const isUrgent = isOverdue || remainingKm <= SERVICE_URGENT_KM
            const isWarning = !isUrgent && remainingKm <= SERVICE_WARNING_KM

            if (isWarning || isUrgent) {
                deadlines.push({
                    type: 'tagliando',
                    label: 'Tagliando',
                    isDate: false,
                    value: remainingKm,
                    isUrgent,
                    isWarning,
                    isOverdue
                })
            }
        }

        // Tires (Front) - Only if interval is set
        // Logic: If maintenance has intervals, check them. 
        // If no interval is set, we typically don't show warnings unless we implement a default.
        // User MVP requirements say: "same logic only if interval is configured; otherwise manual history only."
    }

    // Determine overall status
    let status: VehicleStatus = 'OK'
    if (deadlines.some(d => d.isUrgent)) {
        status = 'URGENTE'
    } else if (deadlines.some(d => d.isWarning)) {
        status = 'ATTENZIONE'
    }

    // Find nearest deadline (Prioritize urgent, then warning. Prefer date over km if same urgency?)
    // User says: "Prefer date-based nearest by remaining days"
    // Let's sort all deadlines
    const nearestDeadline = deadlines.length > 0 ? deadlines.sort((a, b) => {
        // First by urgency (Urgent > Warning)
        if (a.isUrgent && !b.isUrgent) return -1
        if (!a.isUrgent && b.isUrgent) return 1

        // Then by raw "value" is hard because one is days, one is km.
        // Let's normalize urgency: Date overdue is very urgent.

        // Just pick the first one from our sorted list (which we haven't sorted yet for display)
        // Let's rely on the user rule: Date nearest first.
        if (a.isDate && !b.isDate) return -1
        if (!a.isDate && b.isDate) return 1

        // If both date, lower days first
        if (a.isDate && b.isDate) return (a.value as number) - (b.value as number)

        // If both km, lower km first
        return (a.value as number) - (b.value as number)
    })[0] : null

    return { status, deadlines, nearestDeadline }
}
