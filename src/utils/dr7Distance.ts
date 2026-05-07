/**
 * Distance helpers anchored on the DR7 office (Viale Marconi 229, Cagliari).
 * Used to compute pickup-location fees as `road km × delivery.price_per_km`
 * without requiring a paid routing API: we apply a 1.3× fudge factor to the
 * great-circle distance, which is a reasonable proxy for road distance in
 * Sardinia where major roads follow the coast and the SS-131.
 */

/** Approximate coordinates for DR7 Viale Marconi 229, 09131 Cagliari CA. */
export const DR7_OFFICE_COORDS = { lat: 39.2231, lon: 9.1374 } as const

/** Multiplier converting great-circle km to road km. */
const ROAD_FACTOR = 1.3

/** Earth radius in km used by haversine. */
const EARTH_RADIUS_KM = 6371

function toRad(deg: number): number {
    return (deg * Math.PI) / 180
}

/** Great-circle distance in km between two lat/lon points. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const dLat = toRad(b.lat - a.lat)
    const dLon = toRad(b.lon - a.lon)
    const lat1 = toRad(a.lat)
    const lat2 = toRad(b.lat)
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/**
 * Estimated road distance in km from DR7 office to a destination, rounded
 * to the nearest km. Returns 0 for invalid coordinates.
 */
export function kmFromDR7Office(dest: { lat?: number; lon?: number } | null | undefined): number {
    if (!dest || !Number.isFinite(dest.lat) || !Number.isFinite(dest.lon)) return 0
    const great = haversineKm(DR7_OFFICE_COORDS, { lat: dest.lat as number, lon: dest.lon as number })
    return Math.round(great * ROAD_FACTOR)
}
