/**
 * Centralina Unica — Config Lookup Helpers
 * Priority chain: vehicle override > category > global default
 * IMPORTANT: Keep in sync with website copy at utils/configLookup.ts
 */

import type { RentalConfig, InsuranceOption, ExperienceService, DepositOption, DriverTier } from '../types/rentalConfig'

/** Resolve a category lookup against its alias set (handles "supercars"/"exotic" rename). */
function lookupByCategoryAlias<T>(
  bag: Record<string, T> | undefined,
  category: string,
): T | undefined {
  if (!bag) return undefined
  const candidates = (
    category === 'supercars' ? ['supercars', 'exotic'] :
    category === 'exotic' ? ['exotic', 'supercars'] :
    [category]
  )
  for (const cat of candidates) {
    if (bag[cat] != null) return bag[cat]
  }
  return undefined
}

/** Get sforo KM for a vehicle. Priority: vehicle > category > global */
export function getSforoKm(config: RentalConfig, vehicleId: string, category: string): number {
  return config.sforo_km.vehicle_overrides?.[vehicleId]
    ?? lookupByCategoryAlias(config.sforo_km.category, category)
    ?? config.sforo_km._global
}

/** Get insurance options for a category + tier */
export function getInsuranceOptions(config: RentalConfig, category: string, tier: DriverTier): InsuranceOption[] {
  const catConfig = lookupByCategoryAlias(config.insurance, category)
  if (!catConfig) return []
  if (tier === 'BLOCKED') return []
  return (catConfig as Record<string, InsuranceOption[]>)[tier]
    ?? (catConfig as Record<string, InsuranceOption[]>)._all_tiers
    ?? []
}

/** Find an insurance option's display name by id, searching every category + tier. */
export function getInsuranceNameById(config: RentalConfig | null | undefined, id: string): string | null {
  if (!config?.insurance || !id) return null
  for (const [catKey, catConfig] of Object.entries(config.insurance)) {
    if (catKey === 'eligibility' || catKey === 'deductibles' || catKey === 'category_labels') continue
    if (!catConfig || typeof catConfig !== 'object') continue
    for (const tierKey of ['TIER_1', 'TIER_2', '_all_tiers']) {
      const opts = (catConfig as Record<string, InsuranceOption[]>)[tierKey]
      if (!Array.isArray(opts)) continue
      const match = opts.find(o => o.id === id)
      if (match) return match.name
    }
  }
  return null
}

/** Get KM included for a number of rental days + vehicle category */
export function getKmIncluded(config: RentalConfig, days: number, category: string): number | 'unlimited' {
  if (!Number.isFinite(days) || days < 1) return 0

  // Centralina Pro renamed "exotic" to "supercars" (April 2026); convertProConfig
  // still writes the bucket under the legacy "exotic" key via PRO_TO_DB_CATEGORY.
  // Without alias resolution a vehicle saved with category="supercars" would
  // miss the bucket and fall through to an empty `_global`, producing NaN.
  const catConfig = lookupByCategoryAlias(config.km_included, category)

  // Category has unlimited KM (e.g., urban)
  if (catConfig && 'unlimited' in catConfig && catConfig.unlimited) {
    return 'unlimited'
  }

  // Use category-specific table or fall back to global
  const entry = (catConfig && 'table' in catConfig) ? catConfig : config.km_included._global
  if (!entry || !('table' in entry)) return 0

  const table = entry.table
  const tableKeys = Object.keys(table)
  // Empty/missing table: would otherwise produce Math.max() = -Infinity and
  // Infinity × extra_per_day = NaN downstream.
  if (tableKeys.length === 0) return 0

  const maxTableDay = Math.max(...tableKeys.map(Number))

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
  const catConfig = lookupByCategoryAlias(config.unlimited_km, category)
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
  return config.second_driver?.[tier] ?? 0
}

/** Get no cauzione surcharge per day */
export function getNoCauzioneSurcharge(config: RentalConfig): number {
  return config.no_cauzione_surcharge?.per_day ?? 0
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
  return config.lavaggio?.fee ?? 0
}

/** Get delivery price per km */
export function getDeliveryPricePerKm(config: RentalConfig): number {
  return config.delivery?.price_per_km ?? 0
}

/** Get DR7 Flex daily price */
export function getDr7FlexPrice(config: RentalConfig): number {
  return config.dr7_flex?.daily_price ?? 0
}
