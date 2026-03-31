/**
 * Centralina Unica — Config Lookup Helpers
 * Priority chain: vehicle override > category > global default
 * IMPORTANT: Keep in sync with website copy at utils/configLookup.ts
 */

import type { RentalConfig, InsuranceOption, ExperienceService, DepositOption, DriverTier } from '../types/rentalConfig'

/** Get sforo KM for a vehicle. Priority: vehicle > category > global */
export function getSforoKm(config: RentalConfig, vehicleId: string, category: string): number {
  return config.sforo_km.vehicle_overrides?.[vehicleId]
    ?? config.sforo_km.category?.[category]
    ?? config.sforo_km._global
}

/** Get insurance options for a category + tier */
export function getInsuranceOptions(config: RentalConfig, category: string, tier: DriverTier): InsuranceOption[] {
  const catConfig = config.insurance?.[category]
  if (!catConfig) return []
  if (tier === 'BLOCKED') return []
  return (catConfig as Record<string, InsuranceOption[]>)[tier]
    ?? (catConfig as Record<string, InsuranceOption[]>)._all_tiers
    ?? []
}

/** Get KM included for a number of rental days + vehicle category */
export function getKmIncluded(config: RentalConfig, days: number, category: string): number | 'unlimited' {
  const catConfig = config.km_included?.[category]

  // Category has unlimited KM (e.g., urban)
  if (catConfig && 'unlimited' in catConfig && catConfig.unlimited) {
    return 'unlimited'
  }

  // Use category-specific table or fall back to global
  const entry = (catConfig && 'table' in catConfig) ? catConfig : config.km_included._global
  if (!entry || !('table' in entry)) return 0

  const table = entry.table
  const maxTableDay = Math.max(...Object.keys(table).map(Number))

  if (days <= maxTableDay) {
    // Direct lookup from table
    return table[String(days)] ?? table[String(maxTableDay)] ?? 0
  }

  // Beyond table: last value + extra per day for each additional day
  const lastValue = table[String(maxTableDay)] ?? 0
  const extraDays = days - maxTableDay
  return lastValue + (extraDays * (entry.extra_per_day || 0))
}

/** Get unlimited KM price per day for a category + tier */
export function getUnlimitedKmPrice(config: RentalConfig, category: string, tier: DriverTier): number {
  const catConfig = config.unlimited_km?.[category]
  if (!catConfig) return 0

  // Check tier-specific price first
  if (tier !== 'BLOCKED' && catConfig[tier]) {
    return catConfig[tier]!.per_day ?? 0
  }

  // Fall back to _all_tiers
  if (catConfig._all_tiers) {
    return catConfig._all_tiers.flat ?? catConfig._all_tiers.per_day ?? 0
  }

  return 0
}

/** Get second driver price per day for a tier */
export function getSecondDriverPrice(config: RentalConfig, tier: DriverTier): number {
  if (tier === 'BLOCKED') return 0
  return config.second_driver?.[tier] ?? 10
}

/** Get no cauzione surcharge per day */
export function getNoCauzioneSurcharge(config: RentalConfig): number {
  return config.no_cauzione_surcharge?.per_day ?? 49
}

/** Check if no cauzione is available for a given tier + insurance */
export function isNoCauzioneAvailable(config: RentalConfig, tier: DriverTier, insuranceId: string): boolean {
  const restriction = config.no_cauzione_surcharge?.tier_restriction
  if (restriction && tier !== restriction) return false
  if (config.no_cauzione_surcharge?.requires_kasko && insuranceId === 'RCA') return false
  return true
}

/** Get experience services filtered by tier */
export function getExperienceServicesForTier(config: RentalConfig, tier: DriverTier): ExperienceService[] {
  if (tier === 'BLOCKED') return []
  return (config.experience_services || []).filter(s => {
    if (!s.is_active) return false
    if (s.tier_only && s.tier_only !== tier) return false
    return true
  })
}

/** Check if DR7 Flex is available for a tier */
export function isDr7FlexAvailable(config: RentalConfig, tier: DriverTier): boolean {
  const restriction = config.dr7_flex?.tier_restriction
  if (!restriction) return true
  return tier === restriction
}

/** Get deposit options for a tier + residency combo */
export function getDepositOptions(config: RentalConfig, tier: DriverTier, isResident: boolean): DepositOption[] {
  if (tier === 'BLOCKED') return []
  const key = `${tier}_${isResident ? 'RESIDENT' : 'NON_RESIDENT'}` as keyof typeof config.deposits
  return (config.deposits?.[key] as DepositOption[]) ?? []
}

/** Get default deposit amount for a vehicle category */
export function getCategoryDepositDefault(config: RentalConfig, category: string): number {
  return config.deposits?.category_defaults?.[category] ?? 0
}

/** Get lavaggio fee */
export function getLavaggioFee(config: RentalConfig): number {
  return config.lavaggio?.fee ?? 9.90
}

/** Get delivery price per km */
export function getDeliveryPricePerKm(config: RentalConfig): number {
  return config.delivery?.price_per_km ?? 3
}

/** Get DR7 Flex daily price */
export function getDr7FlexPrice(config: RentalConfig): number {
  return config.dr7_flex?.daily_price ?? 19.90
}
