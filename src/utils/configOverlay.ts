/**
 * Config Overlay — Reads pricing from rental_extras_config and builds
 * the same constant shapes that ReservationsTab uses.
 * Falls back to hardcoded defaults if config is missing/incomplete.
 */

import type { RentalConfig } from '../types/rentalConfig'

interface InsuranceOpt {
  id: string
  label: string
  pricePerDay: number
}

interface SforoRule {
  match: (name: string) => boolean
  sforo: string
  label: string
}

export interface ConfigOverlay {
  insuranceTier1: InsuranceOpt[]
  insuranceTier2: InsuranceOpt[]
  urbanInsurance: InsuranceOpt[]
  utilitaireInsurance: InsuranceOpt[]
  furgoneInsurance: InsuranceOpt[]
  sforoDefaults: SforoRule[]
  defaultSforo: string
  lavaggioFee: number
  noCauzionePerDay: number
  unlimitedKmTier1: number
  unlimitedKmTier2: number
  secondDriverTier1: number
  secondDriverTier2: number
  dr7FlexPerDay: number
  deliveryPerKm: number
  maggiorazionePct: number
  defaultExpiryHours: number
  depositDefaults: { UTILITAIRE: number; FURGONE: number; SUPERCAR: number }
  experienceServices: { id: string; name: string; price: number; unit: string; tierOnly?: string | null }[]
}

/** Build overlay from config. Any missing section falls back to hardcoded defaults. */
export function buildConfigOverlay(config: RentalConfig | null): ConfigOverlay {
  if (!config) return getHardcodedDefaults()

  // Insurance — convert from config format to admin format
  const exoticT1 = (config.insurance?.exotic as Record<string, { id: string; name: string; daily_price: number }[]>)?.TIER_1
  const exoticT2 = (config.insurance?.exotic as Record<string, { id: string; name: string; daily_price: number }[]>)?.TIER_2
  const urbanIns = (config.insurance?.urban as Record<string, { id: string; name: string; daily_price: number }[]>)?._all_tiers
  const aziendaliIns = (config.insurance?.aziendali as Record<string, { id: string; name: string; daily_price: number }[]>)?._all_tiers
  const utilIns = aziendaliIns || (config.insurance?.utilitaire as Record<string, { id: string; name: string; daily_price: number }[]>)?._all_tiers
  const furgIns = aziendaliIns || (config.insurance?.furgone as Record<string, { id: string; name: string; daily_price: number }[]>)?._all_tiers

  const toOpts = (arr: { id: string; name: string; daily_price: number }[] | undefined): InsuranceOpt[] | null => {
    if (!arr || arr.length === 0) return null
    return arr.map(o => ({ id: o.id, label: o.name, pricePerDay: o.daily_price }))
  }

  // Sforo — build from config category overrides + vehicle overrides
  const sforoRules: SforoRule[] = []
  // config.sforo_km?.vehicle_overrides available for per-vehicle sforo lookup
  // Vehicle-level overrides first (highest priority)
  // These are handled separately via vehicleId lookup, not name match
  // Category-level rules
  if (config.sforo_km?.category) {
    const catSforo = config.sforo_km.category
    if (catSforo.exotic) {
      sforoRules.push({
        match: (n) => !n.includes('ducato') && !n.includes('vito') && !n.includes('furgone') && !n.includes('ncc') && !n.includes('tourer') && !n.includes('panda') && !n.includes('captur') && !n.includes('clio'),
        sforo: String(catSforo.exotic),
        label: 'Supercar',
      })
    }
    if (catSforo.aziendali || catSforo.furgone) {
      sforoRules.push({
        match: (n) => n.includes('ducato') || n.includes('vito') || n.includes('furgone') || n.includes('ncc') || n.includes('tourer'),
        sforo: String(catSforo.aziendali ?? catSforo.furgone),
        label: 'Aziendali',
      })
    }
  }

  const defaults = getHardcodedDefaults()

  return {
    insuranceTier1: toOpts(exoticT1) || defaults.insuranceTier1,
    insuranceTier2: toOpts(exoticT2) || defaults.insuranceTier2,
    urbanInsurance: toOpts(urbanIns) || defaults.urbanInsurance,
    utilitaireInsurance: toOpts(utilIns) || defaults.utilitaireInsurance,
    furgoneInsurance: toOpts(furgIns) || defaults.furgoneInsurance,
    sforoDefaults: sforoRules.length > 0 ? sforoRules : defaults.sforoDefaults,
    defaultSforo: config.sforo_km?._global != null ? String(config.sforo_km._global) : defaults.defaultSforo,
    lavaggioFee: config.lavaggio?.fee ?? defaults.lavaggioFee,
    noCauzionePerDay: config.no_cauzione_surcharge?.per_day ?? defaults.noCauzionePerDay,
    unlimitedKmTier1: config.unlimited_km?.exotic?.TIER_1?.per_day ?? defaults.unlimitedKmTier1,
    unlimitedKmTier2: config.unlimited_km?.exotic?.TIER_2?.per_day ?? defaults.unlimitedKmTier2,
    secondDriverTier1: config.second_driver?.TIER_1 ?? defaults.secondDriverTier1,
    secondDriverTier2: config.second_driver?.TIER_2 ?? defaults.secondDriverTier2,
    dr7FlexPerDay: config.dr7_flex?.daily_price ?? defaults.dr7FlexPerDay,
    deliveryPerKm: config.delivery?.price_per_km ?? defaults.deliveryPerKm,
    maggiorazionePct: config.preventivi?.maggiorazione_pct ?? defaults.maggiorazionePct,
    defaultExpiryHours: config.preventivi?.default_expiry_hours ?? defaults.defaultExpiryHours,
    depositDefaults: {
      UTILITAIRE: config.deposits?.category_defaults?.utilitaire ?? defaults.depositDefaults.UTILITAIRE,
      FURGONE: config.deposits?.category_defaults?.furgone ?? defaults.depositDefaults.FURGONE,
      SUPERCAR: config.deposits?.category_defaults?.exotic ?? defaults.depositDefaults.SUPERCAR,
    },
    experienceServices: (config.experience_services || [])
      .filter(s => s.is_active)
      .map(s => ({ id: s.id, name: s.name, price: s.price, unit: s.unit, tierOnly: s.tier_only })),
  }
}

/** Vehicle-specific sforo override lookup */
export function getVehicleSforoOverride(config: RentalConfig | null, vehicleId: string): string | null {
  if (!config?.sforo_km?.vehicle_overrides) return null
  const override = config.sforo_km.vehicle_overrides[vehicleId]
  return override != null ? String(override) : null
}

function getHardcodedDefaults(): ConfigOverlay {
  return {
    insuranceTier1: [
      { id: 'RCA', label: 'RCA Compresa (no Kasko)', pricePerDay: 0 },
      { id: 'KASKO_BASE', label: 'Kasko Base', pricePerDay: 119 },
    ],
    insuranceTier2: [
      { id: 'RCA', label: 'RCA Compresa (no Kasko)', pricePerDay: 0 },
      { id: 'KASKO_BASE', label: 'Kasko Base', pricePerDay: 89 },
      { id: 'KASKO_BLACK', label: 'Kasko Black', pricePerDay: 149 },
      { id: 'KASKO_SIGNATURE', label: 'Kasko Signature', pricePerDay: 189 },
      { id: 'DR7', label: 'Kasko DR7', pricePerDay: 289 },
    ],
    urbanInsurance: [
      { id: 'KASKO_BASE', label: 'Kasko Base', pricePerDay: 15 },
      { id: 'DR7', label: 'Kasko DR7', pricePerDay: 45 },
    ],
    utilitaireInsurance: [
      { id: 'RCA', label: 'RCA Compresa (no Kasko)', pricePerDay: 0 },
      { id: 'KASKO_BASE', label: 'Kasko Base', pricePerDay: 45 },
      { id: 'KASKO_BLACK', label: 'Kasko Black', pricePerDay: 65 },
      { id: 'KASKO_SIGNATURE', label: 'Kasko Signature', pricePerDay: 80 },
      { id: 'DR7', label: 'Kasko DR7', pricePerDay: 90 },
    ],
    furgoneInsurance: [
      { id: 'RCA', label: 'RCA Compresa (no Kasko)', pricePerDay: 0 },
      { id: 'KASKO_BASE', label: 'Kasko Base', pricePerDay: 45 },
    ],
    sforoDefaults: [
      { match: (n: string) => n.includes('rs3') || n.includes('macan') || n.includes('test'), sforo: '0.89', label: 'RS3/Macan/Test' },
      { match: (n: string) => n.includes('ducato') || n.includes('vito') || n.includes('furgone') || n.includes('ncc') || n.includes('tourer'), sforo: '0.49', label: 'Furgone/NCC' },
    ],
    defaultSforo: '1.80',
    lavaggioFee: 9.90,
    noCauzionePerDay: 49,
    unlimitedKmTier1: 289,
    unlimitedKmTier2: 189,
    secondDriverTier1: 20,
    secondDriverTier2: 10,
    dr7FlexPerDay: 19.90,
    deliveryPerKm: 3,
    maggiorazionePct: 0,
    defaultExpiryHours: 24,
    depositDefaults: { UTILITAIRE: 1000, FURGONE: 2500, SUPERCAR: 10000 },
    experienceServices: [
      { id: 'bouquet', name: 'Bouquet di rose', price: 7.90, unit: 'per_item', tierOnly: null },
      { id: 'wedding', name: 'Allestimento matrimonio interno/esterno', price: 150, unit: 'flat', tierOnly: null },
      { id: 'personal_driver', name: 'Autista personale', price: 150, unit: 'per_hour', tierOnly: null },
      { id: 'restaurant', name: 'Prenotazione ristorante', price: 10, unit: 'flat', tierOnly: null },
      { id: 'video_drone', name: 'Video Maker + Drone shooting', price: 200, unit: 'per_hour', tierOnly: null },
      { id: 'premium_24h', name: 'Assistenza premium 24h dedicata', price: 19.90, unit: 'per_day', tierOnly: null },
      { id: 'vehicle_replacement', name: 'Sostituzione immediata veicolo', price: 19.90, unit: 'per_day', tierOnly: 'TIER_2' },
      { id: 'chauffeur_vip', name: 'Noleggio con autista + itinerario VIP', price: 189, unit: 'per_hour', tierOnly: null },
    ],
  }
}
