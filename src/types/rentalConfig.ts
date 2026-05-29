/**
 * Centralina Unica — Rental Configuration Types
 * These types mirror the JSONB structure in rental_extras_config.config
 * IMPORTANT: Keep in sync with website copy at types/rentalConfig.ts
 */

export interface InsuranceOption {
  id: string
  name: string
  daily_price: number
  mandatory_deposit?: number
  deductible?: string
  deductible_fixed?: number
  deductible_percent?: number
  coverage?: string
}

export interface InsuranceCategoryConfig {
  TIER_1?: InsuranceOption[]
  TIER_2?: InsuranceOption[]
  _all_tiers?: InsuranceOption[]
}

export interface InsuranceEligibility {
  min_age: number
  min_license_years: number
}

export interface InsuranceDeductible {
  fixed: number
  percent: number
}

export interface KmIncludedEntry {
  table: Record<string, number>  // "1": 100, "2": 180, etc.
  extra_per_day: number
  unlimited?: boolean
}

export interface DepositOption {
  id: string
  label: string
  amount: number
  surcharge_per_day?: number
  requires_vehicle_2020?: boolean
  description?: string
}

export interface ExperienceService {
  id: string
  name: string
  price: number
  unit: 'per_day' | 'per_hour' | 'per_item' | 'flat' | 'per_km'
  is_active: boolean
  tier_only: string | null
  description?: string
}

export interface PickupLocation {
  id: string
  label: string
  km: number
  is_active: boolean
}

export interface DayRateTable {
  resident?: Record<string, number>
  non_resident?: Record<string, number>
  flat?: Record<string, number>
  extrapolation: 'day7_average' | 'interpolate_7_30'
}

export interface PaymentMode {
  id: string
  label: string
  surcharge_percent: number
  description?: string
}

export interface RentalConfig {
  schema_version: number

  tier_rules: {
    blocked: {
      min_age: number
      max_age: number
      min_license_years: number
    }
    TIER_1: {
      label: string
      age_range: [number, number]
      license_years_range: [number, number]
    }
    TIER_2: {
      label: string
      min_age: number
      max_age: number
      min_license_years: number
    }
  }

  vehicle_categories: Record<string, { label: string }>

  insurance: {
    [category: string]: InsuranceCategoryConfig
  } & {
    eligibility?: Record<string, InsuranceEligibility>
    deductibles?: Record<string, InsuranceDeductible>
    category_labels?: Record<string, string>
  }

  km_included: {
    _global: KmIncludedEntry
    [category: string]: KmIncludedEntry | { unlimited: boolean }
  }

  sforo_km: {
    _global: number
    category: Record<string, number>
    vehicle_overrides: Record<string, number>
  }

  unlimited_km: {
    [category: string]: {
      TIER_1?: { per_day: number }
      TIER_2?: { per_day: number }
      _all_tiers?: { per_day: number; flat?: number }
    }
  }

  deposits: {
    TIER_1_RESIDENT: DepositOption[]
    TIER_2_RESIDENT: DepositOption[]
    TIER_1_NON_RESIDENT: DepositOption[]
    TIER_2_NON_RESIDENT: DepositOption[]
    category_defaults: Record<string, number>
  }

  second_driver: Record<string, number>

  lavaggio: {
    fee: number
    mandatory: boolean
  }

  delivery: {
    /**
     * Tariffa di default €/km. Usata SOLO come fallback quando manca un
     * valore in `by_category` per la categoria del veicolo. Source of
     * truth per il calcolo e' `by_category`.
     */
    price_per_km: number
    /**
     * Per-category override: `categoryId → €/km`. Aggiunta 2026-05-29:
     * il prezzo consegna a domicilio cambia per categoria (es. urban
     * costa meno di supercars). Configurato in Centralina Pro >
     * Servizi > Consegna a Domicilio. Quando una categoria manca da
     * questo map, i caller decidono se fallback su price_per_km (default
     * per richieste senza categoria definita) o bloccare con OTP.
     */
    by_category?: Record<string, number>
  }

  /**
   * Configurable pickup locations (e.g. airports). Fee is computed
   * dynamically as `km × delivery.price_per_km`. Built-in `dr7_office`
   * and `domicilio` stay outside this list — they're added in code
   * (office is fee 0, domicilio uses the per-booking delivery_fee).
   */
  pickup_locations: PickupLocation[]

  no_cauzione_surcharge: {
    per_day: number
    tier_restriction: string
    requires_kasko: boolean
  }

  experience_services: ExperienceService[]

  dr7_flex: {
    daily_price: number
    refund_percent: number
    tier_restriction: string
    description: string
  }

  rental_day_rates: Record<string, DayRateTable>

  payment_modes: PaymentMode[]

  preventivi: {
    maggiorazione_pct: number
    default_expiry_hours: number
    whatsapp_footer: string
  }
}

/** Type for the driver tier */
export type DriverTier = 'TIER_1' | 'TIER_2' | 'BLOCKED'
