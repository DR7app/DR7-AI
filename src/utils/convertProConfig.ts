/**
 * Converts Centralina Pro config (centralina_pro_config table)
 * to the legacy RentalConfig format used by all consumers.
 *
 * Category mapping:  Pro supercars → DB exotic, Pro aziendali → DB aziendali
 * Fascia mapping:    Pro A → TIER_2, Pro B → TIER_1
 */

import type { RentalConfig, InsuranceCategoryConfig, KmIncludedEntry, DepositOption, ExperienceService, PickupLocation, DayRateTable } from '../types/rentalConfig'
import { DEFAULT_RENTAL_CONFIG } from '../hooks/rentalConfigDefaults'

// Pro config types (mirror CentralinaProTab.tsx)
interface ProCategory { id: string; label: string }
interface ProFascia { id: string; label: string; description: string; min_age: number | ''; max_age: number | ''; min_license_years: number | '' }
interface ProInsuranceOption { id: string; name: string; daily_price: number | ''; mandatory_deposit: number | ''; deductible_fixed: number | ''; deductible_percent: number | ''; is_active?: boolean }
interface ProInsuranceCategoryConfig { id: string; label: string; mode: 'per_fascia' | 'all_tiers'; byFascia: Record<string, ProInsuranceOption[]>; all: ProInsuranceOption[] }
interface ProKmConfig {
  id: string;
  label: string;
  table: Record<string, number | ''>;
  extraPerDay: number | '';
  sforo: number | '';
  unlimitedPerDay: number | '';
  // Per-fascia unlimited KM pricing (A = TIER_2 / Fascia A, B = TIER_1 / Fascia B).
  // Present when admin sets "Per fascia" mode in Centralina Pro.
  unlimitedMode?: 'all_tiers' | 'per_fascia';
  unlimitedByFascia?: Record<string, number | ''>;
}
interface ProDepositOption { id: string; label: string; amount: number | ''; surcharge_per_day: number | ''; is_active?: boolean }
interface ProDepositFasciaConfig { residente: ProDepositOption[]; non_residente: ProDepositOption[] }
interface ProExperienceService { id: string; name: string; price: number | ''; unit: 'per_day' | 'per_hour' | 'per_item' | 'flat' | 'per_km'; is_active: boolean; tier_only: string }
interface ProPickupLocation { id: string; label: string; km: number | ''; is_active: boolean }
interface ProServiziConfig {
  experience: ProExperienceService[]
  pickup_locations?: ProPickupLocation[]
  dr7_flex: { daily_price: number | ''; refund_percent: number | ''; tier_restriction: string; description: string }
  lavaggio: { fee: number | ''; mandatory: boolean }
  delivery: { price_per_km: number | '' }
  second_driver: Record<string, number | ''>
}
interface ProTariffaGiornaliera { id: string; label: string; mode: 'unica' | 'per_residenza'; days: string[]; unica: Record<string, number | ''>; residente: Record<string, number | ''>; non_residente: Record<string, number | ''>; extraPerDay: number | '' }
interface ProPreventiviConfig { maggiorazione_pct: number | ''; scadenza_default_ore: number | ''; messaggi?: unknown[] }

export interface ProSnapshot {
  categories?: ProCategory[]
  fasce?: ProFascia[]
  insurance?: ProInsuranceCategoryConfig[]
  km?: ProKmConfig[]
  deposits?: Record<string, ProDepositFasciaConfig>
  servizi?: ProServiziConfig
  prezzoDinamico?: { tariffe?: ProTariffaGiornaliera[]; dynamic?: unknown }
  preventivi?: ProPreventiviConfig
}

// Map Pro category IDs to vehicle DB category values
const PRO_TO_DB_CATEGORY: Record<string, string> = {
  supercars: 'exotic',
  urban: 'urban',
  aziendali: 'aziendali',
}

// Map Pro fascia IDs to legacy tier keys
const PRO_TO_TIER: Record<string, string> = {
  A: 'TIER_2',
  B: 'TIER_1',
}

function num(v: number | string | '' | undefined | null): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    // Accept both English ("0.89") and Italian ("0,89") decimal separators.
    // Without this, sforo / prices typed in Centralina Pro that get
    // serialized as strings (instead of numbers) silently became 0 on the
    // booking side — e.g. supercar sforo 0,89 → 0.
    const cleaned = v.replace(/\s/g, '').replace(',', '.')
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function numRecord(rec: Record<string, number | ''> | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  if (!rec) return out
  for (const [k, v] of Object.entries(rec)) {
    if (typeof v === 'number') out[k] = v
  }
  return out
}

export function convertProToRentalConfig(pro: ProSnapshot): RentalConfig {
  const config: RentalConfig = JSON.parse(JSON.stringify(DEFAULT_RENTAL_CONFIG))

  // ── Categories ──
  if (pro.categories) {
    config.vehicle_categories = {}
    for (const cat of pro.categories) {
      const dbCat = PRO_TO_DB_CATEGORY[cat.id] || cat.id
      config.vehicle_categories[dbCat] = { label: cat.label }
    }
  }

  // ── Tier Rules ──
  if (pro.fasce) {
    const fasciaA = pro.fasce.find(f => f.id === 'A')
    const fasciaB = pro.fasce.find(f => f.id === 'B')
    if (fasciaA) {
      config.tier_rules.TIER_2 = {
        label: fasciaA.label,
        min_age: num(fasciaA.min_age),
        max_age: num(fasciaA.max_age),
        min_license_years: num(fasciaA.min_license_years),
      }
    }
    if (fasciaB) {
      config.tier_rules.TIER_1 = {
        label: fasciaB.label,
        age_range: [num(fasciaB.min_age), num(fasciaB.max_age)],
        license_years_range: [num(fasciaB.min_license_years), 4],
      }
    }
  }

  // ── Insurance ──
  if (pro.insurance) {
    // 2026-05-15: filtra opzioni con is_active === false. Cosi' i nuovi
    // booking/preventivi (admin + website) non vedono mai le opzioni
    // disattivate. Default is_active=undefined → trattata come attiva
    // (backwards compat per opzioni create prima del flag).
    const isActive = (o: { is_active?: boolean }) => o.is_active !== false
    const ins: Record<string, InsuranceCategoryConfig> = {}
    for (const catIns of pro.insurance) {
      const dbCat = PRO_TO_DB_CATEGORY[catIns.id] || catIns.id
      const converted: InsuranceCategoryConfig = {}

      if (catIns.mode === 'per_fascia' && catIns.byFascia) {
        for (const [fasciaId, options] of Object.entries(catIns.byFascia)) {
          const tier = PRO_TO_TIER[fasciaId] || fasciaId
          converted[tier as keyof InsuranceCategoryConfig] = options.filter(isActive).map(o => ({
            id: o.id,
            name: o.name,
            daily_price: num(o.daily_price),
            mandatory_deposit: num(o.mandatory_deposit),
            deductible_fixed: num(o.deductible_fixed),
            deductible_percent: num(o.deductible_percent),
          }))
        }
      } else if (catIns.all) {
        converted._all_tiers = catIns.all.filter(isActive).map(o => ({
          id: o.id,
          name: o.name,
          daily_price: num(o.daily_price),
          mandatory_deposit: num(o.mandatory_deposit),
          deductible_fixed: num(o.deductible_fixed),
          deductible_percent: num(o.deductible_percent),
        }))
      }
      ins[dbCat] = converted
    }
    config.insurance = ins
  }

  // ── KM Included + Sforo + Unlimited KM ──
  if (pro.km) {
    const kmInc: Record<string, KmIncludedEntry | { unlimited: boolean }> = {
      _global: config.km_included._global,
    }
    const sforoCat: Record<string, number> = {}
    const unlimitedKm: Record<string, Record<string, { per_day: number }>> = {}

    for (const kmCfg of pro.km) {
      const dbCat = PRO_TO_DB_CATEGORY[kmCfg.id] || kmCfg.id
      const table = numRecord(kmCfg.table)

      // If table is empty (all zeroes/blanks), category has unlimited KM (e.g., urban)
      const hasKmLimits = Object.values(table).some(v => v > 0)
      if (!hasKmLimits && num(kmCfg.extraPerDay) === 0) {
        kmInc[dbCat] = { unlimited: true }
      } else {
        kmInc[dbCat] = { table, extra_per_day: num(kmCfg.extraPerDay) }
      }

      // Sforo
      if (num(kmCfg.sforo) > 0) {
        sforoCat[dbCat] = num(kmCfg.sforo)
      }

      // Unlimited KM price: per-fascia (A=TIER_2, B=TIER_1) oppure tutte le fasce.
      // Fix: prima leggeva solo unlimitedPerDay, ignorando unlimitedByFascia — il
      // risultato era che la modalità "Per fascia" in Centralina Pro non arrivava
      // al booking admin (supercar Fascia B sempre 189 invece di 289).
      const unlMode = kmCfg.unlimitedMode || 'all_tiers'
      if (unlMode === 'per_fascia' && kmCfg.unlimitedByFascia) {
        const faA = num(kmCfg.unlimitedByFascia.A)
        const faB = num(kmCfg.unlimitedByFascia.B)
        const entry: Record<string, { per_day: number }> = {}
        if (faA > 0) entry.TIER_2 = { per_day: faA }
        if (faB > 0) entry.TIER_1 = { per_day: faB }
        if (Object.keys(entry).length > 0) {
          unlimitedKm[dbCat] = entry as (typeof unlimitedKm)[string]
        }
      } else if (num(kmCfg.unlimitedPerDay) > 0) {
        unlimitedKm[dbCat] = { _all_tiers: { per_day: num(kmCfg.unlimitedPerDay) } }
      }
    }

    config.km_included = kmInc as RentalConfig['km_included']
    config.sforo_km.category = sforoCat
    config.unlimited_km = unlimitedKm
  }

  // ── Deposits ──
  if (pro.deposits) {
    const deps = config.deposits
    let noCauzioneSurcharge = 0
    for (const [fasciaId, fasciaDeposits] of Object.entries(pro.deposits)) {
      const tier = PRO_TO_TIER[fasciaId]
      if (!tier) continue

      // 2026-05-15: filtra opzioni con is_active === false (toggle ON/OFF
      // in Centralina Pro). Default true per backwards compat.
      const mapOptions = (opts: ProDepositOption[]): DepositOption[] =>
        opts.filter(o => o.is_active !== false).map(o => ({ id: o.id, label: o.label, amount: num(o.amount), surcharge_per_day: num(o.surcharge_per_day) }))

      const resKey = `${tier}_RESIDENT` as keyof typeof deps
      const nonResKey = `${tier}_NON_RESIDENT` as keyof typeof deps
      const resOpts = mapOptions(fasciaDeposits.residente || [])
      const nonResOpts = mapOptions(fasciaDeposits.non_residente || [])
      ;(deps as unknown as Record<string, DepositOption[]>)[resKey] = resOpts
      ;(deps as unknown as Record<string, DepositOption[]>)[nonResKey] = nonResOpts

      // Extract no_cauzione surcharge — take the first non-zero we find across fasce.
      // configOverlay.noCauzionePerDay reads from config.no_cauzione_surcharge.per_day.
      for (const opt of [...resOpts, ...nonResOpts]) {
        const s = opt.surcharge_per_day ?? 0
        if (opt.id === 'no_deposit' && s > 0 && noCauzioneSurcharge === 0) {
          noCauzioneSurcharge = s
        }
      }
    }
    if (noCauzioneSurcharge > 0) {
      config.no_cauzione_surcharge = {
        ...(config.no_cauzione_surcharge || {}),
        per_day: noCauzioneSurcharge,
      } as RentalConfig['no_cauzione_surcharge']
    }
  }

  // ── Services ──
  if (pro.servizi) {
    const s = pro.servizi

    // Experience services
    if (s.experience) {
      config.experience_services = s.experience.map((e): ExperienceService => ({
        id: e.id,
        name: e.name,
        price: num(e.price),
        unit: e.unit,
        is_active: e.is_active,
        tier_only: e.tier_only ? (PRO_TO_TIER[e.tier_only] || e.tier_only) : null,
      }))
    }

    // Pickup locations (airports, etc.) — fee = km × delivery.price_per_km
    if (s.pickup_locations) {
      config.pickup_locations = s.pickup_locations.map((p): PickupLocation => ({
        id: p.id,
        label: p.label,
        km: num(p.km),
        is_active: p.is_active,
      }))
    }

    // DR7 Flex
    if (s.dr7_flex) {
      config.dr7_flex = {
        daily_price: num(s.dr7_flex.daily_price),
        refund_percent: num(s.dr7_flex.refund_percent),
        tier_restriction: PRO_TO_TIER[s.dr7_flex.tier_restriction] || s.dr7_flex.tier_restriction || '',
        description: s.dr7_flex.description || '',
      }
    }

    // Lavaggio
    if (s.lavaggio) {
      config.lavaggio = { fee: num(s.lavaggio.fee), mandatory: s.lavaggio.mandatory }
    }

    // Delivery
    if (s.delivery) {
      config.delivery = { price_per_km: num(s.delivery.price_per_km) }
    }

    // Second driver — map fascia IDs to tier keys
    if (s.second_driver) {
      const sd: Record<string, number> = {}
      for (const [fasciaId, price] of Object.entries(s.second_driver)) {
        const tier = PRO_TO_TIER[fasciaId] || fasciaId
        sd[tier] = num(price)
      }
      config.second_driver = sd
    }
  }

  // ── Tariffe (Prezzo Dinamico) ──
  if (pro.prezzoDinamico?.tariffe) {
    const rates: Record<string, DayRateTable> = {}
    for (const tariff of pro.prezzoDinamico.tariffe) {
      const dbCat = PRO_TO_DB_CATEGORY[tariff.id] || tariff.id
      const dayRate: DayRateTable = { extrapolation: 'day7_average' }

      if (tariff.mode === 'per_residenza') {
        dayRate.resident = numRecord(tariff.residente)
        dayRate.non_resident = numRecord(tariff.non_residente)
      } else {
        dayRate.flat = numRecord(tariff.unica)
      }

      rates[dbCat] = dayRate
    }
    config.rental_day_rates = rates
  }

  // ── Preventivi ──
  if (pro.preventivi) {
    config.preventivi = {
      maggiorazione_pct: num(pro.preventivi.maggiorazione_pct),
      default_expiry_hours: num(pro.preventivi.scadenza_default_ore),
      whatsapp_footer: config.preventivi?.whatsapp_footer || '',
    }
  }

  return config
}
