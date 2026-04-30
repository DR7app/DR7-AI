// Single source of truth for "test" vehicle plates that must be excluded
// from real-business calculations: stats, KPI, reports, calendar display, etc.
// Availability isolation is handled separately in vehicleAvailability.ts.
export const TEST_PLATES = ['TEST000', 'TEST002'] as const

// Postgrest filter fragment: append to a Supabase JS query with
//   query.not('vehicle_plate', 'in', TEST_PLATE_FILTER)
export const TEST_PLATE_FILTER = `(${TEST_PLATES.map(p => `"${p}"`).join(',')})`

export function isTestPlate(plate: string | null | undefined): boolean {
    if (!plate) return false
    const norm = plate.replace(/\s+/g, '').toUpperCase()
    return (TEST_PLATES as readonly string[]).includes(norm)
}
