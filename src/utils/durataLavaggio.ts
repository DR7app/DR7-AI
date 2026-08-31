/**
 * Durate dei servizi di lavaggio, in minuti.
 *
 * Erano definite dentro CarWashCalendarTab: le stesse durate servono anche
 * alla scheda di dettaglio aperta dalla lista Prenotazioni Lavaggio, quindi
 * stanno qui una volta sola. Nessun valore e' cambiato nello spostamento.
 */

// Service durations in minutes by vehicle category
export const SERVICE_DURATIONS_URBAN: Record<string, number> = {
  interior: 40,
  exterior: 30,
  full_clean: 80,
  full_clean_n2: 80,
  top_shine: 120,
  vip: 140,
  luxury: 220,
}

export const SERVICE_DURATIONS_MAXI: Record<string, number> = {
  interior: 45,
  exterior: 40,
  full_clean: 90,
  full_clean_n2: 90,
  top_shine: 130,
  vip: 150,
  luxury: 280,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getServiceDuration = (serviceName: string, vehicleCategory?: string, bookingDetails?: any): number => {
  // Prefer totalDuration saved at booking time (always in sync with catalog)
  if (bookingDetails?.totalDuration && bookingDetails.totalDuration > 0) {
    return bookingDetails.totalDuration
  }

  const name = serviceName.toLowerCase()
  const isMaxi = vehicleCategory?.toLowerCase() === 'maxi'
  const durations = isMaxi ? SERVICE_DURATIONS_MAXI : SERVICE_DURATIONS_URBAN

  // Scooter/Moto — fixed short duration
  if (name.includes('scooter')) return 15
  if (name.includes('moto')) return 20

  // Match service patterns (check more specific patterns first)
  if (name.includes('absolute')) return isMaxi ? 480 : 480
  if (name.includes('luxury') || name.includes('dr7')) return durations.luxury
  if (name.includes('vip')) return durations.vip
  if (name.includes('top')) return durations.top_shine
  if (name.includes('full clean n2') || name.includes('completo n2')) return durations.full_clean_n2
  if (name.includes('full clean') || name.includes('completo')) return durations.full_clean
  if (name.includes('interior') || name.includes('solo interno') || name.includes('interno')) return durations.interior
  if (name.includes('exterior') || name.includes('solo esterno') || name.includes('esterno')) return durations.exterior

  // Default to 60 minutes if no match
  return 60
}

export const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins} min`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}min`
}
