/**
 * Default rental config — matches the seed values in the SQL migration.
 * Used as fallback when Supabase fetch fails.
 */

import type { RentalConfig } from '../types/rentalConfig'

export const DEFAULT_RENTAL_CONFIG: RentalConfig = {
  schema_version: 2,

  tier_rules: {
    blocked: { min_age: 21, max_age: 70, min_license_years: 3 },
    TIER_1: { label: 'Fascia B — Conducente giovane o patente recente', age_range: [21, 25], license_years_range: [3, 4] },
    TIER_2: { label: 'Fascia A — Conducente esperto', min_age: 26, max_age: 69, min_license_years: 5 },
  },

  vehicle_categories: {
    exotic: { label: 'Supercar / Exotic' },
    urban: { label: 'Urban' },
    utilitaire: { label: 'Utilitaria / Aziendali' },
    furgone: { label: 'Furgone / NCC' },
  },

  insurance: {
    exotic: {
      TIER_1: [
        { id: 'RCA', name: 'RCA Compresa (no Kasko)', daily_price: 0, mandatory_deposit: 15000 },
        { id: 'KASKO_BASE', name: 'Kasko Base', daily_price: 119, deductible: '€5.000 + 30% del danno' },
      ],
      TIER_2: [
        { id: 'RCA', name: 'RCA Compresa (no Kasko)', daily_price: 0, mandatory_deposit: 10000 },
        { id: 'KASKO_BASE', name: 'Kasko Base', daily_price: 89, deductible: '€5.000 + 30% del danno' },
        { id: 'KASKO_BLACK', name: 'Kasko Black', daily_price: 149, deductible: '€5.000 + 10% del danno' },
        { id: 'KASKO_SIGNATURE', name: 'Kasko Signature', daily_price: 189, deductible: '€5.000 fisso' },
        { id: 'KASKO_DR7', name: 'Kasko DR7', daily_price: 289, deductible: '€0' },
      ],
    },
    urban: {
      _all_tiers: [
        { id: 'KASKO_BASE', name: 'Kasko Base', daily_price: 15 },
        { id: 'KASKO_DR7', name: 'Kasko DR7', daily_price: 45 },
      ],
    },
    utilitaire: {
      _all_tiers: [
        { id: 'KASKO_BASE', name: 'Kasko Base', daily_price: 45 },
        { id: 'KASKO_DR7', name: 'Kasko DR7', daily_price: 90 },
      ],
    },
    furgone: {
      _all_tiers: [
        { id: 'KASKO_BASE', name: 'Kasko Base', daily_price: 45 },
        { id: 'KASKO_DR7', name: 'Kasko DR7', daily_price: 90 },
      ],
    },
    eligibility: {
      RCA: { min_age: 18, min_license_years: 2 },
      KASKO_BASE: { min_age: 20, min_license_years: 2 },
      KASKO_BLACK: { min_age: 25, min_license_years: 5 },
      KASKO_SIGNATURE: { min_age: 30, min_license_years: 10 },
      KASKO_DR7: { min_age: 25, min_license_years: 3 },
    },
    deductibles: {
      urban: { fixed: 2000, percent: 30 },
      utilitaire: { fixed: 2000, percent: 30 },
      exotic: { fixed: 5000, percent: 30 },
    },
  },

  km_included: {
    _global: { table: { '1': 100, '2': 180, '3': 240, '4': 280, '5': 300 }, extra_per_day: 60 },
    urban: { unlimited: true, table: {}, extra_per_day: 0 },
    furgone: { table: { '1': 200, '2': 350, '3': 500, '4': 600, '5': 700 }, extra_per_day: 100 },
  },

  sforo_km: {
    _global: 1.80,
    category: { exotic: 0.89, furgone: 0.49, urban: 0.30 },
    vehicle_overrides: {},
  },

  unlimited_km: {
    exotic: { TIER_1: { per_day: 289 }, TIER_2: { per_day: 189 } },
    furgone: { _all_tiers: { per_day: 0, flat: 100 } },
    urban: { _all_tiers: { per_day: 0 } },
  },

  deposits: {
    TIER_1_RESIDENT: [
      { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20, requires_vehicle_2020: true },
      { id: 'credit_card', label: 'Carta di credito', amount: 2000 },
      { id: 'cash_prepaid', label: 'Contanti o prepagata', amount: 4999 },
    ],
    TIER_2_RESIDENT: [
      { id: 'no_deposit', label: 'Nessuna cauzione', amount: 0, surcharge_per_day: 49 },
      { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20, requires_vehicle_2020: true },
      { id: 'credit_card', label: 'Carta di credito', amount: 1000 },
      { id: 'cash_prepaid', label: 'Contanti o prepagata', amount: 4999 },
    ],
    TIER_1_NON_RESIDENT: [
      { id: 'credit_card', label: 'Carta di credito', amount: 5000 },
      { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20, requires_vehicle_2020: true },
    ],
    TIER_2_NON_RESIDENT: [
      { id: 'credit_card', label: 'Carta di credito', amount: 3500 },
      { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20, requires_vehicle_2020: true },
    ],
    category_defaults: { utilitaire: 1000, furgone: 2500, exotic: 10000 },
  },

  second_driver: { TIER_1: 20, TIER_2: 10 },

  lavaggio: { fee: 9.90, mandatory: true },

  delivery: { price_per_km: 3 },

  no_cauzione_surcharge: { per_day: 49, tier_restriction: 'TIER_2', requires_kasko: true },

  experience_services: [
    { id: 'bouquet', name: 'Bouquet di rose', price: 7.90, unit: 'per_item', is_active: true, tier_only: null },
    { id: 'wedding', name: 'Allestimento matrimonio interno/esterno', price: 150, unit: 'flat', is_active: true, tier_only: null },
    { id: 'personal_driver', name: 'Autista personale', price: 150, unit: 'per_hour', is_active: true, tier_only: null },
    { id: 'restaurant', name: 'Prenotazione ristorante', price: 10, unit: 'flat', is_active: true, tier_only: null },
    { id: 'video_drone', name: 'Video Maker + Drone shooting', price: 200, unit: 'per_hour', is_active: true, tier_only: null },
    { id: 'premium_24h', name: 'Assistenza premium 24h dedicata', price: 19.90, unit: 'per_day', is_active: true, tier_only: null },
    { id: 'vehicle_replacement', name: 'Sostituzione immediata veicolo', price: 19.90, unit: 'per_day', is_active: true, tier_only: 'TIER_2' },
    { id: 'chauffeur_vip', name: 'Noleggio con autista + itinerario VIP', price: 189, unit: 'per_hour', is_active: true, tier_only: null },
  ],

  dr7_flex: {
    daily_price: 19.90,
    refund_percent: 90,
    tier_restriction: 'TIER_2',
    description: 'Cancella fino al giorno del noleggio — rimborso del 90% come credito DR7 Wallet',
  },

  rental_day_rates: {
    exotic: {
      resident: { '1': 349, '2': 698, '3': 980, '4': 1290, '5': 1590, '6': 1990, '7': 2290 },
      non_resident: { '1': 449, '2': 898, '3': 1289, '4': 1690, '5': 2190, '6': 2590, '7': 2890 },
      extrapolation: 'day7_average',
    },
    urban: {
      flat: { '1': 39, '2': 78, '3': 109, '4': 129, '5': 149, '6': 179, '7': 189, '30': 689 },
      extrapolation: 'interpolate_7_30',
    },
    furgone: {
      flat: { '1': 139, '2': 278, '3': 389, '4': 490, '5': 590, '6': 649, '7': 689 },
      extrapolation: 'day7_average',
    },
  },

  payment_modes: [
    { id: 'full', label: 'Paga tutto subito', surcharge_percent: 0 },
    { id: 'deposit_30', label: 'Prenota con il 30%', surcharge_percent: 50 },
  ],
}
