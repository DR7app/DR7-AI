/**
 * Empty rental config — structural shape only, zero prices.
 * Centralina Pro is the single source of truth for all prices.
 * If you see €0 anywhere, Centralina Pro has not been configured for that field.
 */

import type { RentalConfig } from '../types/rentalConfig'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DEFAULT_RENTAL_CONFIG: RentalConfig = {
  schema_version: 2,

  // Age / license rules are policy constants (not prices) — kept so classifyDriverTier works before config loads.
  tier_rules: {
    blocked: { min_age: 21, max_age: 70, min_license_years: 3 },
    TIER_1: { label: 'Fascia B', age_range: [21, 25], license_years_range: [3, 4] },
    TIER_2: { label: 'Fascia A', min_age: 26, max_age: 69, min_license_years: 5 },
  },

  vehicle_categories: {
    exotic: { label: 'Supercar / Exotic' },
    urban: { label: 'Urban' },
    utilitaire: { label: 'Utilitaria / Aziendali' },
    furgone: { label: 'Furgone / NCC' },
  },

  insurance: ({
    exotic: { TIER_1: [], TIER_2: [] },
    urban: { _all_tiers: [] },
    utilitaire: { _all_tiers: [] },
    furgone: { _all_tiers: [] },
    eligibility: {},
    deductibles: {},
  }) as RentalConfig['insurance'],

  km_included: {
    _global: { table: {}, extra_per_day: 0 },
    urban: { unlimited: false, table: {}, extra_per_day: 0 },
    furgone: { table: {}, extra_per_day: 0 },
  },

  sforo_km: {
    _global: 0,
    category: {},
    vehicle_overrides: {},
  },

  unlimited_km: {
    exotic: { TIER_1: { per_day: 0 }, TIER_2: { per_day: 0 } },
    furgone: { _all_tiers: { per_day: 0 } },
    urban: { _all_tiers: { per_day: 0 } },
  },

  deposits: {
    TIER_1_RESIDENT: [],
    TIER_2_RESIDENT: [],
    TIER_1_NON_RESIDENT: [],
    TIER_2_NON_RESIDENT: [],
    category_defaults: {},
  },

  second_driver: { TIER_1: 0, TIER_2: 0 },

  lavaggio: { fee: 0, mandatory: false },

  delivery: { price_per_km: 0, by_category: {} },

  pickup_locations: [],

  no_cauzione_surcharge: { per_day: 0, tier_restriction: 'TIER_2', requires_kasko: true },

  experience_services: [],

  dr7_flex: {
    daily_price: 0,
    refund_percent: 0,
    tier_restriction: 'TIER_2',
    description: '',
  },

  rental_day_rates: {},

  payment_modes: [],

  preventivi: {
    maggiorazione_pct: 0,
    default_expiry_hours: 24,
    whatsapp_footer: '',
  },
}
