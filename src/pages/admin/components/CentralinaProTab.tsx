import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { logAdminAction } from '../../../utils/logAdminAction'
import AddressAutocomplete from './AddressAutocomplete'
import { kmFromDR7Office } from '../../../utils/dr7Distance'

type FleetVehicle = {
  id: string
  display_name: string
  daily_rate: number | null
  category: string | null
  plate: string | null
}

// A period over which a specific day_type (prefestivo, ponte, evento,
// festività…) applies. Inclusive on both ends. A 1-day entry is simply
// start_date === end_date.
type SpecialPeriod = {
  start_date: string  // YYYY-MM-DD
  end_date: string    // YYYY-MM-DD
  day_type_key: string
}

// Per-vehicle monthly revenue targets → coefficient, with MULTIPLE thresholds.
// Each tier: reach `min_revenue` € in the current month → multiply the daily rate
// by `coeff`. When several tiers are reached, the one with the highest `min_revenue`
// wins. Empty fields mean the tier isn't fully configured (engine ignores it).
type VehicleRevenueTier = {
  min_revenue: number | ''
  coeff: number | ''
}
type VehicleRevenueTarget = {
  tiers: VehicleRevenueTier[]
}

type SectionId = 'categorie-fascia' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6' | 'p7' | 'p8' | 'p9' | 'p10' | 'p11'

type Category = { id: string; label: string }
type Fascia = {
  id: string
  label: string
  description: string
  min_age: number | ''
  max_age: number | ''
  min_license_years: number | ''
}

const SECTIONS: { id: SectionId; title: string }[] = [
  { id: 'categorie-fascia', title: 'Categorie & Fascia' },
  { id: 'p2', title: 'Assicurazioni' },
  { id: 'p3', title: 'Km & Sforo' },
  { id: 'p4', title: 'Cauzioni' },
  { id: 'p5', title: 'Servizi' },
  { id: 'p6', title: 'Prezzo Dinamico' },
  { id: 'p7', title: 'Preventivi' },
  { id: 'p8', title: 'Danni & Penali' },
  { id: 'p9', title: 'Fiscale' },
  { id: 'p10', title: 'DR7 Club' },
  { id: 'p11', title: 'Automazioni' },
]

const INITIAL_CATEGORIES: Category[] = [
  { id: 'supercars', label: 'Supercars' },
  { id: 'urban', label: 'Urban' },
  { id: 'aziendali', label: 'Aziendali' },
]

type ServiceUnit = 'per_day' | 'per_hour' | 'per_item' | 'flat'

const UNIT_LABELS: Record<ServiceUnit, string> = {
  per_day: 'al giorno',
  per_hour: 'all\u2019ora',
  per_item: 'cad.',
  flat: 'una tantum',
}

type ExperienceService = {
  id: string
  name: string
  price: number | ''
  unit: ServiceUnit
  is_active: boolean
  tier_only: string // '' = all fasce, otherwise fascia.id
}

type PickupLocation = {
  id: string
  label: string
  km: number | ''
  is_active: boolean
}

type ServiziConfig = {
  // Section titles (editable from admin) — fall back to defaults when missing
  experience_title?: string
  experience_subtitle?: string
  dr7_flex_title?: string
  lavaggio_title?: string
  delivery_title?: string
  second_driver_title?: string
  pickup_locations_title?: string
  experience: ExperienceService[]
  dr7_flex: {
    enabled?: boolean // false = entire block hidden everywhere (admin + website)
    daily_price: number | ''
    refund_percent: number | ''
    tier_restriction: string // '' = all fasce, otherwise fascia.id
    description: string
  }
  lavaggio: { fee: number | ''; mandatory: boolean }
  delivery: { price_per_km: number | '' }
  second_driver: Record<string, number | ''> // keyed by fascia.id
  /**
   * Pickup locations the admin can pick from when creating a preventivo or
   * reservation. Fee is computed as `km × delivery.price_per_km` — admin
   * sets only the km value, the rate is shared with delivery.
   */
  pickup_locations: PickupLocation[]
}

const INITIAL_SERVIZI: ServiziConfig = {
  experience: [
    { id: 'bouquet', name: 'Bouquet di rose', price: 7.9, unit: 'per_item', is_active: true, tier_only: '' },
    { id: 'wedding', name: 'Allestimento matrimonio interno/esterno', price: 150, unit: 'flat', is_active: true, tier_only: '' },
    { id: 'personal_driver', name: 'Autista personale', price: 150, unit: 'per_hour', is_active: true, tier_only: '' },
    { id: 'restaurant', name: 'Prenotazione ristorante', price: 10, unit: 'flat', is_active: true, tier_only: '' },
    { id: 'video_drone', name: 'Video Maker + Drone shooting', price: 200, unit: 'per_hour', is_active: true, tier_only: '' },
    { id: 'premium_24h', name: 'Assistenza premium 24h dedicata', price: 19.9, unit: 'per_day', is_active: true, tier_only: '' },
    { id: 'vehicle_replacement', name: 'Sostituzione immediata veicolo', price: 19.9, unit: 'per_day', is_active: true, tier_only: 'A' },
    { id: 'chauffeur_vip', name: 'Noleggio con autista + itinerario VIP', price: 189, unit: 'per_hour', is_active: true, tier_only: '' },
  ],
  dr7_flex: {
    enabled: true,
    daily_price: 19.9,
    refund_percent: 90,
    tier_restriction: 'A',
    description: 'Cancella fino al giorno del noleggio',
  },
  lavaggio: { fee: 9.9, mandatory: true },
  delivery: { price_per_km: 3 },
  second_driver: { A: 10, B: 20 },
  pickup_locations: [
    { id: 'cagliari_airport', label: 'Aeroporto Cagliari Elmas', km: 9, is_active: true },
    { id: 'alghero_airport', label: 'Aeroporto Alghero Fertilia', km: 250, is_active: true },
    { id: 'olbia_airport', label: 'Aeroporto Olbia Costa Smeralda', km: 280, is_active: true },
  ],
}

// ========== PREZZO DINAMICO (Punto 6) types ==========

type TariffaMode = 'unica' | 'per_residenza'

type TariffaGiornaliera = {
  id: string
  label: string
  mode: TariffaMode
  days: string[]
  unica: Record<string, number | ''>
  residente: Record<string, number | ''>
  non_residente: Record<string, number | ''>
  extraPerDay: number | ''
}

type CoefficientRow = {
  id: string
  min: number | ''
  max: number | ''
  coeff: number | ''
  label: string
}

type DynamicMode = 'disabled' | 'suggestion' | 'auto_apply'
type OperatingMode = 'auto' | 'riempimento' | 'equilibrio' | 'protezione'

// A named-bucket coefficient — key → multiplier, no numeric range.
// Used for things like day-of-week, season tiers, promo levels.
type NamedCoeff = { key: string; label: string; coeff: number | '' }

// Per-window target occupancy (days-ahead → expected % occupancy)
type OccupancyTargets = {
  d30plus: number | ''
  d15_29: number | ''
  d7_14: number | ''
  d3_6: number | ''
  d0_2: number | ''
}

type DynamicPricingConfig = {
  enabled: boolean
  mode: DynamicMode
  base_prices: Record<string, number | ''>
  min_prices: Record<string, number | ''>
  max_prices: Record<string, number | ''>

  // Range-based coefficients (min/max/coeff/label)
  occupation_coefficients: CoefficientRow[]
  advance_coefficients: CoefficientRow[]
  duration_coefficients: CoefficientRow[]
  calendar_gap_coefficients: CoefficientRow[]

  // Named-bucket coefficients (tier/key → multiplier)
  season_coefficients: NamedCoeff[]
  day_type_coefficients: NamedCoeff[]
  vehicle_occupation_coefficients: NamedCoeff[]
  promo_push_coefficients: NamedCoeff[]

  // Admin controls
  active_promo_level: string // key from promo_push_coefficients, '' = none
  operating_mode: OperatingMode
  // Phase strategy (reshaped based on rental counts)
  phase_strategy_enabled: boolean
  phase1_max_rentals: number | ''
  phase2_max_rentals: number | ''

  // Month → season tier mapping (1..12 → season key)
  season_by_month: Record<string, string>
  // Date ranges admin marks as a specific day_type (prefestivo / ponte / evento /
  // festività). A single-day mark is just start_date === end_date. Legacy
  // `special_dates: Record<date, key>` is migrated into 1-day periods on load.
  special_periods: SpecialPeriod[]

  // Per-vehicle monthly revenue targets → coefficient (keyed by vehicle.id).
  // When vehicle's current-month revenue reaches min_revenue, coeff multiplies
  // the daily rate. Works ALONGSIDE the global promo_push_coefficients.
  vehicle_revenue_targets: Record<string, VehicleRevenueTarget>

  // Occupancy targets per vehicle class per advance window
  occupancy_targets: {
    utilitarie: OccupancyTargets
    suv_premium: OccupancyTargets
    luxury: OccupancyTargets
  }
}

type PrezzoDinamicoConfig = {
  tariffe: TariffaGiornaliera[]
  dynamic: DynamicPricingConfig
}

const INITIAL_TARIFFE: TariffaGiornaliera[] = [
  {
    id: 'supercars',
    label: 'Supercars',
    mode: 'per_residenza',
    days: ['1', '2', '3', '4', '5', '6', '7'],
    unica: {},
    residente: { '1': 349, '2': 698, '3': 980, '4': 1290, '5': 1590, '6': 1890, '7': 2290 },
    non_residente: { '1': 449, '2': 898, '3': 1280, '4': 1690, '5': 2100, '6': 2590, '7': 2890 },
    extraPerDay: 289,
  },
  {
    id: 'urban',
    label: 'Urban',
    mode: 'unica',
    days: ['1', '2', '3', '4', '5', '6', '7'],
    unica: { '1': 39, '2': 78, '3': 109, '4': 129, '5': 149, '6': 179, '7': 199 },
    residente: {},
    non_residente: {},
    extraPerDay: 29,
  },
  {
    id: 'aziendali',
    label: 'Aziendali',
    mode: 'unica',
    days: ['1', '2', '3', '4', '5', '6', '7'],
    unica: { '1': 139, '2': 278, '3': 389, '4': 490, '5': 590, '6': 649, '7': 689 },
    residente: {},
    non_residente: {},
    extraPerDay: 99,
  },
]

const INITIAL_PREZZO_DINAMICO: PrezzoDinamicoConfig = {
  tariffe: INITIAL_TARIFFE,
  dynamic: {
    enabled: true,
    mode: 'suggestion',
    base_prices: { supercars: '', urban: '', aziendali: '' },
    min_prices: { supercars: 289, urban: 29, aziendali: 99 },
    max_prices: { supercars: 699, urban: 249, aziendali: 799 },

    // 5. Occupazione Categoria — 7 bands (motore principale)
    occupation_coefficients: [
      { id: uid(), min: 0, max: 15, coeff: 0.78, label: '0–15% (vuoto)' },
      { id: uid(), min: 16, max: 30, coeff: 0.86, label: '16–30%' },
      { id: uid(), min: 31, max: 45, coeff: 0.93, label: '31–45%' },
      { id: uid(), min: 46, max: 60, coeff: 1.00, label: '46–60% (target)' },
      { id: uid(), min: 61, max: 75, coeff: 1.08, label: '61–75%' },
      { id: uid(), min: 76, max: 90, coeff: 1.18, label: '76–90%' },
      { id: uid(), min: 91, max: 100, coeff: 1.30, label: '91–100% (pieno)' },
    ],

    // 3. Anticipo — 7 bands (premia chi prenota prima / monetizza last minute)
    advance_coefficients: [
      { id: uid(), min: 30, max: 999, coeff: 0.90, label: '30+ giorni' },
      { id: uid(), min: 21, max: 30, coeff: 0.95, label: '21–29 giorni' },
      { id: uid(), min: 14, max: 21, coeff: 0.98, label: '14–20 giorni' },
      { id: uid(), min: 7, max: 14, coeff: 1.00, label: '7–13 giorni' },
      { id: uid(), min: 3, max: 7, coeff: 1.07, label: '3–6 giorni' },
      { id: uid(), min: 1, max: 3, coeff: 1.15, label: '1–2 giorni' },
      { id: uid(), min: 0, max: 1, coeff: 1.22, label: 'Stesso giorno' },
    ],

    // 4. Durata Noleggio — 7 bands (incentiva noleggi più lunghi)
    duration_coefficients: [
      { id: uid(), min: 1, max: 2, coeff: 1.00, label: '1 giorno' },
      { id: uid(), min: 2, max: 3, coeff: 0.95, label: '2 giorni' },
      { id: uid(), min: 3, max: 4, coeff: 0.91, label: '3 giorni' },
      { id: uid(), min: 4, max: 5, coeff: 0.88, label: '4 giorni' },
      { id: uid(), min: 5, max: 6, coeff: 0.85, label: '5 giorni' },
      { id: uid(), min: 6, max: 8, coeff: 0.82, label: '6–7 giorni' },
      { id: uid(), min: 8, max: 15, coeff: 0.76, label: '8–14 giorni' },
    ],

    // 7. Gap Calendario — 5 bands (vendi giorni isolati a sconto, lavora tutti i giorni)
    calendar_gap_coefficients: [
      { id: uid(), min: 1, max: 2, coeff: 0.65, label: 'Gap 1 giorno' },
      { id: uid(), min: 2, max: 3, coeff: 0.75, label: 'Gap 2 giorni' },
      { id: uid(), min: 3, max: 4, coeff: 0.85, label: 'Gap 3 giorni' },
      { id: uid(), min: 4, max: 6, coeff: 0.92, label: 'Gap 4–5 giorni' },
      { id: uid(), min: 999, max: 9999, coeff: 1.00, label: 'Nessun gap' },
    ],

    // 1. Stagione — 5 named tiers (contesto generale dell'anno)
    season_coefficients: [
      { key: 'bassissima', label: 'Bassissima stagione', coeff: 0.75 },
      { key: 'bassa', label: 'Bassa stagione', coeff: 0.88 },
      { key: 'media', label: 'Media stagione', coeff: 1.00 },
      { key: 'alta', label: 'Alta stagione', coeff: 1.22 },
      { key: 'altissima', label: 'Altissima stagione', coeff: 1.45 },
    ],

    // 2. Tipo Giorno — weekday + special day tiers
    day_type_coefficients: [
      { key: 'monday', label: 'Lunedì', coeff: 0.95 },
      { key: 'tuesday', label: 'Martedì', coeff: 0.95 },
      { key: 'wednesday', label: 'Mercoledì', coeff: 0.95 },
      { key: 'thursday', label: 'Giovedì', coeff: 1.00 },
      { key: 'friday', label: 'Venerdì', coeff: 1.08 },
      { key: 'saturday', label: 'Sabato', coeff: 1.15 },
      { key: 'sunday', label: 'Domenica', coeff: 1.10 },
      { key: 'prefestivo', label: 'Prefestivo', coeff: 1.18 },
      { key: 'ponte', label: 'Ponte', coeff: 1.20 },
      { key: 'evento_speciale', label: 'Evento speciale', coeff: 1.30 },
      { key: 'evento_top', label: 'Evento top', coeff: 1.45 },
      { key: 'festivita_debole', label: 'Festività debole', coeff: 1.10 },
      { key: 'festivita_media', label: 'Festività media', coeff: 1.18 },
      { key: 'festivita_forte', label: 'Festività forte', coeff: 1.30 },
    ],

    // 6. Occupazione Veicolo — 3 tiers (correzione singolo mezzo vs categoria)
    vehicle_occupation_coefficients: [
      { key: 'sotto', label: 'Veicolo fermo rispetto alla categoria', coeff: 0.92 },
      { key: 'allineato', label: 'Veicolo allineato', coeff: 1.00 },
      { key: 'richiesto', label: 'Veicolo molto richiesto', coeff: 1.08 },
    ],

    // 8. Spinta Direzionale — promo levels (solo quando serve)
    promo_push_coefficients: [
      { key: 'soft', label: 'Promo soft', coeff: 0.95 },
      { key: 'medium', label: 'Promo media', coeff: 0.90 },
      { key: 'strong', label: 'Promo forte', coeff: 0.82 },
      { key: 'empty_slot', label: 'Svuota slot', coeff: 0.72 },
    ],

    active_promo_level: '',         // '' = nessuna promo attiva
    operating_mode: 'auto',
    phase_strategy_enabled: false,
    phase1_max_rentals: 15,
    phase2_max_rentals: 25,

    // Default month → season mapping (admin can remap from UI)
    // Sardinia default: estate alta, dic/gen alta (natalizio), resto media/bassa
    season_by_month: {
      '1': 'bassa', '2': 'bassissima', '3': 'bassa', '4': 'media',
      '5': 'media', '6': 'alta', '7': 'altissima', '8': 'altissima',
      '9': 'alta', '10': 'bassa', '11': 'bassissima', '12': 'alta',
    },
    special_periods: [],

    // Empty by default — rows auto-appear in the UI from the fleet table;
    // admin fills min_revenue + coeff per vehicle.
    vehicle_revenue_targets: {},

    // 9. Target occupazione per finestra temporale per classe
    occupancy_targets: {
      utilitarie:  { d30plus: 15, d15_29: 30, d7_14: 50, d3_6: 70, d0_2: 85 },
      suv_premium: { d30plus: 10, d15_29: 25, d7_14: 45, d3_6: 60, d0_2: 75 },
      luxury:      { d30plus: 8,  d15_29: 18, d7_14: 30, d3_6: 45, d0_2: 60 },
    },
  },
}

type PreventivoMessage = {
  key: string
  label: string
  description: string
  body: string
  is_enabled: boolean
}

type PreventiviConfig = {
  maggiorazione_pct: number | ''
  scadenza_default_ore: number | ''
  messaggi: PreventivoMessage[]
}

const INITIAL_PREVENTIVI: PreventiviConfig = {
  maggiorazione_pct: 10,
  scadenza_default_ore: 24,
  messaggi: [
    {
      // DEPRECATED: The real body now lives EXCLUSIVELY in Messaggi di Sistema Pro
      // under the key `pro_conferma_preventivo` (mapped from legacy `preventivo_whatsapp`
      // via netlify/functions/utils/messageTemplates.ts). This Centralina slot is kept
      // for backwards compatibility with existing saved configs but is no longer read
      // as a template source. Body defaults to empty.
      key: 'preventivo_whatsapp',
      label: 'Invio preventivo (WhatsApp cliente) — GESTITO IN MESSAGGI DI SISTEMA PRO',
      description: 'Il testo del preventivo WhatsApp si modifica in Messaggi di Sistema Pro → Conferma Preventivo Inviato',
      body: '',
      is_enabled: true,
    },
    {
      key: 'admin_new_website_quote',
      label: 'Nuovo preventivo dal sito (admin)',
      description: 'Notifica admin quando arriva un preventivo dal sito',
      body: 'Nuovo preventivo da {{cliente}}\nVeicolo: {{veicolo}}\nPeriodo: {{pickup}} → {{dropoff}}\nTotale: €{{totale}}',
      is_enabled: true,
    },
    {
      key: 'admin_no_cauzione_request',
      label: 'Richiesta No Cauzione (admin)',
      description: 'Notifica admin per richiesta "nessuna cauzione"',
      body: 'Richiesta No Cauzione da {{cliente}}\nTelefono: {{telefono}}\nVeicolo: {{veicolo}}',
      is_enabled: true,
    },
  ],
}

// === Fiscale ===

type FiscalConfig = {
  vat_rate: number | ''
}

const INITIAL_FISCAL: FiscalConfig = {
  vat_rate: 22,
}

// === Automazioni ===
// Parametri operativi configurabili: buffer post-noleggio, ecc.
// Le logiche di disponibilita' (sito + admin) leggono da qui invece
// di usare valori hardcoded.

type AutomationsConfig = {
  rental_buffer_minutes: number | ''
  cross_vehicle_gap_minutes: number | ''
  pre_pickup_carwash_buffer_minutes: number | ''
  late_return_grace_minutes: number | ''
}

const INITIAL_AUTOMATIONS: AutomationsConfig = {
  rental_buffer_minutes: 90,
  cross_vehicle_gap_minutes: 15,
  pre_pickup_carwash_buffer_minutes: 90,
  late_return_grace_minutes: 90,
}

// === DR7 Club ===

type DR7ClubTier = {
  id: string
  label: string
  min_annual_spend: number | ''
  rate_pct: number | ''
  is_active: boolean
}

type DR7ClubConfig = {
  tiers: DR7ClubTier[]
}

const INITIAL_DR7_CLUB: DR7ClubConfig = {
  tiers: [
    { id: 'access',    label: 'Access',    min_annual_spend: 0,     rate_pct: 2, is_active: true },
    { id: 'black',     label: 'Black',     min_annual_spend: 3000,  rate_pct: 3, is_active: true },
    { id: 'signature', label: 'Signature', min_annual_spend: 10000, rate_pct: 4, is_active: true },
  ],
}

type DepositOption = {
  id: string
  label: string
  amount: number | ''
  surcharge_per_day: number | ''
}

type DepositFasciaConfig = {
  residente: DepositOption[]
  non_residente: DepositOption[]
}

// New shape: deposits[category][fascia] = { residente, non_residente }
// Categories are dynamic: keyed by Category.id (any string). When the admin
// adds a new category in "Categorie & Fascia", deposits/penali/danni get
// an empty entry for it automatically — see the categories useEffect.
// Old shape (deposits[fascia] = ...) is auto-migrated by migrateDeposits()
// at load time so existing saved configs keep working.
type DepositsCategoryKey = string
type DepositsByFascia = Record<string, DepositFasciaConfig> // keyed by fascia.id
type DepositsConfig = Record<DepositsCategoryKey, DepositsByFascia>

// Default seed for sections that need a starting tab when no categories
// exist yet. The actual list of categories shown in the UI comes from the
// live `categories` array (CentralinaProTab state).
const DEFAULT_DEPOSIT_CATEGORIES: { id: DepositsCategoryKey; label: string }[] = [
  { id: 'supercars', label: 'Supercars' },
  { id: 'urban', label: 'Urban' },
  { id: 'aziendali', label: 'Aziendali' },
]

const INITIAL_DEPOSITS: DepositsConfig = {
  // High-value supercars — keep the historical config the business has
  // been using since this section was first introduced.
  supercars: {
    B: {
      residente: [
        { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
        { id: 'credit_card', label: 'Carta di credito', amount: 2000, surcharge_per_day: 0 },
        { id: 'cash_prepaid', label: 'Contanti o prepagata', amount: 4999, surcharge_per_day: 0 },
      ],
      non_residente: [
        { id: 'credit_card', label: 'Carta di credito', amount: 5000, surcharge_per_day: 0 },
        { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
      ],
    },
    A: {
      residente: [
        { id: 'no_deposit', label: 'Nessuna cauzione', amount: 0, surcharge_per_day: 49 },
        { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
        { id: 'credit_card', label: 'Carta di credito', amount: 1000, surcharge_per_day: 0 },
        { id: 'cash_prepaid', label: 'Contanti o prepagata', amount: 4999, surcharge_per_day: 0 },
      ],
      non_residente: [
        { id: 'credit_card', label: 'Carta di credito', amount: 3500, surcharge_per_day: 0 },
        { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
      ],
    },
  },
  // Low-value city cars (Fiat Panda etc.) — smaller deposits, simpler set.
  urban: {
    B: {
      residente: [
        { id: 'credit_card', label: 'Carta di credito', amount: 500, surcharge_per_day: 0 },
        { id: 'cash_prepaid', label: 'Contanti o prepagata', amount: 800, surcharge_per_day: 0 },
      ],
      non_residente: [
        { id: 'credit_card', label: 'Carta di credito', amount: 800, surcharge_per_day: 0 },
      ],
    },
    A: {
      residente: [
        { id: 'credit_card', label: 'Carta di credito', amount: 300, surcharge_per_day: 0 },
        { id: 'cash_prepaid', label: 'Contanti o prepagata', amount: 500, surcharge_per_day: 0 },
      ],
      non_residente: [
        { id: 'credit_card', label: 'Carta di credito', amount: 500, surcharge_per_day: 0 },
      ],
    },
  },
  // Commercial vehicles (Fiat Ducato Maxi etc.) — mid-tier.
  aziendali: {
    B: {
      residente: [
        { id: 'credit_card', label: 'Carta di credito', amount: 1500, surcharge_per_day: 0 },
        { id: 'cash_prepaid', label: 'Contanti o prepagata', amount: 2000, surcharge_per_day: 0 },
      ],
      non_residente: [
        { id: 'credit_card', label: 'Carta di credito', amount: 2000, surcharge_per_day: 0 },
        { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
      ],
    },
    A: {
      residente: [
        { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
        { id: 'credit_card', label: 'Carta di credito', amount: 800, surcharge_per_day: 0 },
        { id: 'cash_prepaid', label: 'Contanti o prepagata', amount: 1500, surcharge_per_day: 0 },
      ],
      non_residente: [
        { id: 'credit_card', label: 'Carta di credito', amount: 1500, surcharge_per_day: 0 },
        { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
      ],
    },
  },
}

// Convert legacy single-fascia-keyed deposits to the new category-keyed shape.
// Detection: old shape's outer values have `residente`/`non_residente`;
// new shape's outer values are themselves objects whose values have those keys.
// Map a free-form deposit option label to its canonical id. Returns null when
// the label doesn't match any known type (custom options keep their uid).
function canonicalDepositId(label?: string): string | null {
  const l = String(label || '').toLowerCase().trim()
  if (!l) return null
  if (l === 'nessuna cauzione' || l === 'no cauzione' || l === 'senza cauzione' || l === 'no deposit') return 'no_deposit'
  if (l === 'cauzione con veicolo' || l === 'cauzione veicolo' || l === 'vehicle deposit') return 'vehicle_deposit'
  if (l === 'carta di credito' || l === 'carta di debito o credito' || l === 'carta di debito' || l === 'credit card') return 'credit_card'
  if (l === 'contanti o prepagata' || l === 'contanti' || l === 'prepagata' || l === 'cash' || l === 'cash prepaid') return 'cash_prepaid'
  return null
}

// Walk every deposit option and re-canonicalize its id from its label, so
// admin-added entries (which start with a random uid()) become recognizable
// to the website and Preventivi code as soon as they're saved.
function canonicalizeDepositIds(byFascia: DepositsByFascia): DepositsByFascia {
  const out: DepositsByFascia = {}
  for (const [fid, fcfg] of Object.entries(byFascia || {})) {
    const fix = (arr?: DepositOption[]) => (arr || []).map(o => {
      const c = canonicalDepositId(o.label)
      return c ? { ...o, id: c } : o
    })
    out[fid] = { residente: fix(fcfg?.residente), non_residente: fix(fcfg?.non_residente) }
  }
  return out
}

function migrateDeposits(raw: unknown): DepositsConfig {
  if (!raw || typeof raw !== 'object') return INITIAL_DEPOSITS
  const obj = raw as Record<string, unknown>
  const firstVal = Object.values(obj)[0] as Record<string, unknown> | undefined
  const isOld = !!firstVal && typeof firstVal === 'object'
    && ('residente' in firstVal || 'non_residente' in firstVal)
  if (isOld) {
    // Old shape: preserve the existing config under SUPERCARS (the most
    // common use case it was built around) and use the distinct INITIAL
    // defaults for urban + aziendali — otherwise all three tabs would
    // show identical content and the admin couldn't tell them apart.
    const old = obj as DepositsByFascia
    return {
      supercars: canonicalizeDepositIds(old),
      urban: INITIAL_DEPOSITS.urban,
      aziendali: INITIAL_DEPOSITS.aziendali,
    }
  }
  // New shape — preserve EVERY category that exists in raw (operator-added
  // categories included), then fill in any default-category that's still
  // missing from the initials. Previously this function hardcoded the 3
  // default ids and silently dropped deposits for any custom category on
  // every page load.
  const out: DepositsConfig = {}
  for (const [catId, catData] of Object.entries(obj)) {
    if (!catData || typeof catData !== 'object') continue
    out[catId] = canonicalizeDepositIds(catData as DepositsByFascia)
  }
  for (const [catId, defaults] of Object.entries(INITIAL_DEPOSITS)) {
    if (!out[catId]) out[catId] = defaults
  }
  return out
}

type KmConfig = {
  id: string
  label: string
  table: Record<string, number | ''>
  extraPerDay: number | ''
  sforo: number | ''
  unlimitedPerDay: number | ''
  // Optional per-fascia pricing for Km illimitati. When unlimitedMode='per_fascia'
  // the engine prefers unlimitedByFascia[driverTier] over unlimitedPerDay.
  // Backward-compatible default: 'all_tiers' → use the single unlimitedPerDay.
  unlimitedMode?: 'all_tiers' | 'per_fascia'
  unlimitedByFascia?: Record<string, number | ''>
}

const INITIAL_KM: KmConfig[] = [
  {
    id: 'supercars',
    label: 'Supercars',
    table: { '1': 100, '2': 180, '3': 240, '4': 280, '5': 300 },
    extraPerDay: 60,
    sforo: 0.89,
    unlimitedPerDay: 189,
    unlimitedMode: 'per_fascia',
    unlimitedByFascia: { A: 189, B: 289 },
  },
  {
    id: 'urban',
    label: 'Urban',
    table: { '1': '', '2': '', '3': '', '4': '', '5': '' },
    extraPerDay: 0,
    sforo: 0.30,
    unlimitedPerDay: 0,
    unlimitedMode: 'all_tiers',
    unlimitedByFascia: { A: 0, B: 0 },
  },
  {
    id: 'aziendali',
    label: 'Aziendali',
    table: { '1': 200, '2': 350, '3': 500, '4': 600, '5': 700 },
    extraPerDay: 100,
    sforo: 0.49,
    unlimitedPerDay: 0,
    unlimitedMode: 'all_tiers',
    unlimitedByFascia: { A: 0, B: 0 },
  },
]

// ─── Penali (Punto 8) ─────────────────────────────────────────────────────
// One list per vehicle category. Each item has a stable `id` that the
// PenaltyModal already uses (e.g. 'fermo_incidente', 'fumo'). The initial
// values mirror the hardcoded arrays previously baked into PenaltyModal.tsx
// so existing behaviour is preserved on first load.
type PenaliCategoryKey = string
type PenaliItem = {
  id: string
  label: string
  amount: number | ''
  description: string
  enabled?: boolean
}
type PenaliConfig = Record<PenaliCategoryKey, PenaliItem[]>

// Default seed only — the active list comes from the live `categories` array
// passed to PenaliSection / DanniSection.
const DEFAULT_PENALI_CATEGORIES: { id: PenaliCategoryKey; label: string }[] = [
  { id: 'supercars', label: 'Supercars' },
  { id: 'urban', label: 'Urban' },
  { id: 'aziendali', label: 'Aziendali' },
]

const INITIAL_PENALI: PenaliConfig = {
  supercars: [
    { id: 'fermo_incidente', label: 'Fermo veicolo incidente/danni', amount: 350, description: '€/giorno', enabled: true },
    { id: 'fermo_alto_valore', label: 'Fermo veicolo (auto > €200k)', amount: 700, description: '€/giorno', enabled: true },
    { id: 'fumo', label: "Fumo nell'auto", amount: 50, description: 'Odore/cenere', enabled: true },
    { id: 'foro_sigaretta', label: 'Foro da sigaretta', amount: 50, description: 'Per foro', enabled: true },
    { id: 'guidatore_non_indicato', label: 'Guidatore non nel contratto', amount: 200, description: 'Violazione contratto', enabled: true },
    { id: 'carburante_8', label: 'Carburante mancante (8 tacche)', amount: 25, description: 'Quadro 8 tacche', enabled: true },
    { id: 'carburante_4', label: 'Carburante mancante (4 tacche)', amount: 50, description: 'Quadro 4 tacche', enabled: true },
    { id: 'gonfia_ripara', label: 'Bomboletta gonfia e ripara', amount: 100, description: 'Per pneumatico', enabled: true },
    { id: 'sporco', label: 'Veicolo sporco', amount: 30, description: 'Interni/rifiuti', enabled: true },
    { id: 'igienizzazione', label: 'Igienizzazione straordinaria', amount: 100, description: 'Pulizia profonda', enabled: true },
    { id: 'controlli_elettronici', label: 'Controlli elettronici disattivati', amount: 100, description: 'ESP/stabilita', enabled: true },
    { id: 'multe', label: 'Multe e sanzioni', amount: 0, description: '100% a carico cliente', enabled: true },
    { id: 'assenza_intestatario', label: 'Assenza intestatario', amount: 150, description: 'Consegna/ritiro', enabled: true },
    { id: 'ritardo_checkout_base', label: 'Ritardo check-out (> 30 min)', amount: 50, description: 'Base minima', enabled: true },
    { id: 'ritardo_checkout_minuto', label: 'Ritardo check-out (per min)', amount: 0.5, description: 'Oltre i 30 min', enabled: true },
    { id: 'pista', label: 'Utilizzo in pista', amount: 5000, description: 'Kasko non attiva', enabled: true },
    { id: 'cani', label: 'Cani / pelo di cane', amount: 100, description: 'Non tollerato', enabled: true },
    { id: 'subnoleggio', label: 'Subnoleggio non autorizzato', amount: 1000, description: 'Violazione grave', enabled: true },
    { id: 'neopatentati', label: 'Guida neopatentati', amount: 0, description: 'Responsabilita TOTALE', enabled: true },
    { id: 'patente_mancante', label: 'Mancata esibizione patente', amount: 0, description: 'Perdita prenotazione', enabled: true },
    { id: 'ritardo_riconsegna', label: 'Ritardo riconsegna (> 22h30)', amount: 0, description: 'Max = tariffa giornaliera', enabled: true },
  ],
  urban: [
    { id: 'fermo_utilitarie', label: 'Fermo veicolo (Utilitarie)', amount: 30, description: '€/giorno', enabled: true },
    { id: 'fumo', label: "Fumo nell'auto", amount: 50, description: 'Odore/cenere', enabled: true },
    { id: 'foro_sigaretta', label: 'Foro da sigaretta', amount: 50, description: 'Per foro', enabled: true },
    { id: 'guidatore_non_indicato', label: 'Guidatore non nel contratto', amount: 200, description: 'Violazione contratto', enabled: true },
    { id: 'carburante_8', label: 'Carburante mancante (8 tacche)', amount: 15, description: 'Quadro 8 tacche', enabled: true },
    { id: 'carburante_4', label: 'Carburante mancante (4 tacche)', amount: 30, description: 'Quadro 4 tacche', enabled: true },
    { id: 'gonfia_ripara', label: 'Bomboletta gonfia e ripara', amount: 100, description: 'Per pneumatico', enabled: true },
    { id: 'sporco', label: 'Veicolo sporco', amount: 30, description: 'Interni/rifiuti', enabled: true },
    { id: 'igienizzazione', label: 'Igienizzazione straordinaria', amount: 100, description: 'Pulizia profonda', enabled: true },
    { id: 'multe', label: 'Multe e sanzioni', amount: 0, description: '100% a carico cliente', enabled: true },
    { id: 'assenza_intestatario', label: 'Assenza intestatario', amount: 150, description: 'Consegna/ritiro', enabled: true },
    { id: 'ritardo_checkout_base', label: 'Ritardo check-out (> 30 min)', amount: 20, description: 'Base minima', enabled: true },
    { id: 'ritardo_checkout_minuto', label: 'Ritardo check-out (per min)', amount: 0.5, description: 'Oltre i 30 min', enabled: true },
    { id: 'neopatentati', label: 'Guida neopatentati', amount: 0, description: 'Responsabilita TOTALE', enabled: true },
    { id: 'cani', label: 'Cani / pelo di cane', amount: 100, description: 'Non tollerato', enabled: true },
    { id: 'subnoleggio', label: 'Subnoleggio non autorizzato', amount: 1000, description: 'Violazione grave', enabled: true },
    { id: 'ritardo_riconsegna', label: 'Ritardo riconsegna (> 22h30)', amount: 0, description: 'Max = tariffa giornaliera', enabled: true },
  ],
  aziendali: [
    { id: 'fermo_furgoni', label: 'Fermo veicolo (Furgoni/NCC)', amount: 100, description: '€/giorno', enabled: true },
    { id: 'fumo', label: "Fumo nell'auto", amount: 50, description: 'Odore/cenere', enabled: true },
    { id: 'foro_sigaretta', label: 'Foro da sigaretta', amount: 50, description: 'Per foro', enabled: true },
    { id: 'guidatore_non_indicato', label: 'Guidatore non nel contratto', amount: 200, description: 'Violazione contratto', enabled: true },
    { id: 'carburante_8', label: 'Carburante mancante (8 tacche)', amount: 15, description: 'Quadro 8 tacche', enabled: true },
    { id: 'carburante_4', label: 'Carburante mancante (4 tacche)', amount: 30, description: 'Quadro 4 tacche', enabled: true },
    { id: 'gonfia_ripara', label: 'Bomboletta gonfia e ripara', amount: 100, description: 'Per pneumatico', enabled: true },
    { id: 'sporco', label: 'Veicolo sporco', amount: 30, description: 'Interni/rifiuti', enabled: true },
    { id: 'igienizzazione', label: 'Igienizzazione straordinaria', amount: 100, description: 'Pulizia profonda', enabled: true },
    { id: 'multe', label: 'Multe e sanzioni', amount: 0, description: '100% a carico cliente', enabled: true },
    { id: 'assenza_intestatario', label: 'Assenza intestatario', amount: 150, description: 'Consegna/ritiro', enabled: true },
    { id: 'ritardo_checkout_base', label: 'Ritardo check-out (> 30 min)', amount: 20, description: 'Base minima', enabled: true },
    { id: 'ritardo_checkout_minuto', label: 'Ritardo check-out (per min)', amount: 0.5, description: 'Oltre i 30 min', enabled: true },
    { id: 'cani', label: 'Cani / pelo di cane', amount: 100, description: 'Non tollerato', enabled: true },
    { id: 'subnoleggio', label: 'Subnoleggio non autorizzato', amount: 1000, description: 'Violazione grave', enabled: true },
    { id: 'ritardo_riconsegna', label: 'Ritardo riconsegna (> 22h30)', amount: 0, description: 'Max = tariffa giornaliera', enabled: true },
  ],
}

function migratePenali(raw: unknown): PenaliConfig {
  if (!raw || typeof raw !== 'object') return INITIAL_PENALI
  const obj = raw as Record<string, unknown>
  return {
    supercars: Array.isArray(obj.supercars) ? (obj.supercars as PenaliItem[]) : INITIAL_PENALI.supercars,
    urban: Array.isArray(obj.urban) ? (obj.urban as PenaliItem[]) : INITIAL_PENALI.urban,
    aziendali: Array.isArray(obj.aziendali) ? (obj.aziendali as PenaliItem[]) : INITIAL_PENALI.aziendali,
  }
}

// Danni use the same per-category list shape as Penali. No defaults shipped —
// admins populate this from scratch with the damage types they bill most often.
type DanniConfig = PenaliConfig
const INITIAL_DANNI: DanniConfig = {
  supercars: [],
  urban: [],
  aziendali: [],
}
function migrateDanni(raw: unknown): DanniConfig {
  if (!raw || typeof raw !== 'object') return INITIAL_DANNI
  const obj = raw as Record<string, unknown>
  return {
    supercars: Array.isArray(obj.supercars) ? (obj.supercars as PenaliItem[]) : [],
    urban: Array.isArray(obj.urban) ? (obj.urban as PenaliItem[]) : [],
    aziendali: Array.isArray(obj.aziendali) ? (obj.aziendali as PenaliItem[]) : [],
  }
}

const INITIAL_FASCE: Fascia[] = [
  {
    id: 'A',
    label: 'Fascia A',
    description: 'Conducente esperto',
    min_age: 26,
    max_age: 69,
    min_license_years: 5,
  },
  {
    id: 'B',
    label: 'Fascia B',
    description: 'Conducente giovane o patente recente',
    min_age: 21,
    max_age: 25,
    min_license_years: 3,
  },
]

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

// ─── DYNAMIC SYNC HELPERS ───
// Keep an array of {id,label,...} aligned with a master list of categories
function syncByCategory<T extends { id: string; label?: string }>(
  arr: T[],
  master: { id: string; label: string }[],
  makeBlank: (cat: { id: string; label: string }) => T
): T[] {
  const byId = new Map(arr.map((x) => [x.id, x]))
  return master.map((m) => {
    const existing = byId.get(m.id)
    if (existing) {
      // Update label if it changed
      return existing.label !== undefined ? ({ ...existing, label: m.label } as T) : existing
    }
    return makeBlank(m)
  })
}

// Keep a Record's keys aligned with a master list of ids
function syncRecord<V>(rec: Record<string, V>, ids: string[], blank: V): Record<string, V> {
  const next: Record<string, V> = {}
  ids.forEach((id) => {
    next[id] = rec[id] !== undefined ? rec[id] : blank
  })
  return next
}

const blankInsurance = (cat: { id: string; label: string }): InsuranceCategoryConfig => ({
  id: cat.id,
  label: cat.label,
  mode: 'all_tiers',
  byFascia: {},
  all: [],
})

const blankKm = (cat: { id: string; label: string }): KmConfig => ({
  id: cat.id,
  label: cat.label,
  table: { '1': '', '2': '', '3': '', '4': '', '5': '' },
  extraPerDay: 0,
  sforo: 0,
  unlimitedPerDay: 0,
})

const blankTariffa = (cat: { id: string; label: string }): TariffaGiornaliera => ({
  id: cat.id,
  label: cat.label,
  mode: 'unica',
  days: ['1', '2', '3', '4', '5', '6', '7'],
  unica: {},
  residente: {},
  non_residente: {},
  extraPerDay: 0,
})

const STORAGE_KEY = 'centralina_pro_v2'

type PersistedSnapshot = {
  categories: Category[]
  fasce: Fascia[]
  insurance: InsuranceCategoryConfig[]
  km: KmConfig[]
  deposits: DepositsConfig
  servizi: ServiziConfig
  prezzoDinamico: PrezzoDinamicoConfig
  preventivi: PreventiviConfig
  penali?: PenaliConfig
  danni?: DanniConfig
  fiscal?: FiscalConfig
  dr7_club?: DR7ClubConfig
  automations?: AutomationsConfig
}

// Supabase singleton row: centralina_pro_config (id='main', config jsonb).
// localStorage is kept as a fast-path cache + offline fallback.
function loadPersisted(): PersistedSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PersistedSnapshot
  } catch {
    return null
  }
}

async function loadPersistedFromSupabase(): Promise<PersistedSnapshot | null> {
  try {
    const { data, error } = await supabase
      .from('centralina_pro_config')
      .select('config')
      .eq('id', 'main')
      .maybeSingle()
    if (error || !data) return null
    const cfg = data.config as Partial<PersistedSnapshot> | null
    if (!cfg || Object.keys(cfg).length === 0) return null
    return cfg as PersistedSnapshot
  } catch {
    return null
  }
}

function savePersisted(snap: PersistedSnapshot) {
  // Always cache locally first — instant + resilient to offline.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap))
  } catch { /* ignore quota / private mode errors */ }
  // Then persist to Supabase so the website + other admins see it.
  // Use upsert so a missing row (id='main') is created, not silently ignored.
  supabase
    .from('centralina_pro_config')
    .upsert({ id: 'main', config: snap }, { onConflict: 'id' })
    .then(({ error }) => {
      if (error) {
        console.error('[CentralinaPro] failed to save to Supabase:', error)
        toast.error(`Salvataggio DB fallito: ${error.message}`)
      }
    })
}

// Accept both the legacy single-tier shape ({ min_revenue, coeff }) and the new
// tiered shape ({ tiers: [...] }), normalising everything to the tiered form.
// Returns undefined when the input is not a recognisable object, letting the
// caller fall back to the default.
function migrateVehicleRevenueTargets(raw: unknown): Record<string, VehicleRevenueTarget> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, VehicleRevenueTarget> = {}
  for (const [vid, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const obj = value as Record<string, unknown>
    if (Array.isArray(obj.tiers)) {
      const tiers = (obj.tiers as Array<Record<string, unknown>>)
        .map((t) => ({
          min_revenue: (typeof t?.min_revenue === 'number' ? t.min_revenue : '') as number | '',
          coeff: (typeof t?.coeff === 'number' ? t.coeff : '') as number | '',
        }))
      out[vid] = { tiers }
    } else if ('min_revenue' in obj || 'coeff' in obj) {
      out[vid] = {
        tiers: [{
          min_revenue: (typeof obj.min_revenue === 'number' ? obj.min_revenue : '') as number | '',
          coeff: (typeof obj.coeff === 'number' ? obj.coeff : '') as number | '',
        }],
      }
    }
  }
  return out
}

// Accept either the new array-of-periods shape, the legacy flat
// { [YYYY-MM-DD]: tier_key } map, or both (merged). Returns undefined when
// nothing recognisable is present so the caller can fall back to the default.
function migrateSpecialPeriods(
  rawPeriods: unknown,
  rawDates: unknown,
): SpecialPeriod[] | undefined {
  const out: SpecialPeriod[] = []
  if (Array.isArray(rawPeriods)) {
    for (const p of rawPeriods as Array<Record<string, unknown>>) {
      if (!p || typeof p !== 'object') continue
      const start = typeof p.start_date === 'string' ? p.start_date : ''
      const end   = typeof p.end_date   === 'string' ? p.end_date   : start
      const key   = typeof p.day_type_key === 'string' ? p.day_type_key : ''
      if (start) out.push({ start_date: start, end_date: end || start, day_type_key: key })
    }
  }
  if (rawDates && typeof rawDates === 'object' && !Array.isArray(rawDates)) {
    for (const [d, k] of Object.entries(rawDates as Record<string, unknown>)) {
      if (!d || typeof k !== 'string') continue
      out.push({ start_date: d, end_date: d, day_type_key: k })
    }
  }
  if (out.length === 0 && !Array.isArray(rawPeriods) && !rawDates) return undefined
  // Stable order: by start date ascending.
  return out.sort((a, b) => a.start_date.localeCompare(b.start_date))
}

function pick<T>(persisted: PersistedSnapshot | null, key: keyof PersistedSnapshot, fallback: T): T {
  if (persisted && persisted[key] !== undefined && persisted[key] !== null) {
    return persisted[key] as unknown as T
  }
  return fallback
}

/**
 * Merge a persisted PrezzoDinamicoConfig with the current defaults.
 * New fields added after a user saved their config would otherwise land as
 * `undefined`, crashing the UI on `.map()` calls. We deep-merge `dynamic`
 * field-by-field so any missing key gets the default value.
 */
function mergePrezzoDinamico(saved: Partial<PrezzoDinamicoConfig> | null | undefined): PrezzoDinamicoConfig {
  if (!saved) return INITIAL_PREZZO_DINAMICO
  const defaultDyn = INITIAL_PREZZO_DINAMICO.dynamic
  const savedDyn = (saved.dynamic || {}) as Partial<DynamicPricingConfig>
  return {
    tariffe: saved.tariffe ?? INITIAL_PREZZO_DINAMICO.tariffe,
    dynamic: {
      enabled: savedDyn.enabled ?? defaultDyn.enabled,
      mode: savedDyn.mode ?? defaultDyn.mode,
      base_prices: savedDyn.base_prices ?? defaultDyn.base_prices,
      min_prices: savedDyn.min_prices ?? defaultDyn.min_prices,
      max_prices: savedDyn.max_prices ?? defaultDyn.max_prices,
      occupation_coefficients: savedDyn.occupation_coefficients ?? defaultDyn.occupation_coefficients,
      advance_coefficients: savedDyn.advance_coefficients ?? defaultDyn.advance_coefficients,
      duration_coefficients: savedDyn.duration_coefficients ?? defaultDyn.duration_coefficients,
      calendar_gap_coefficients: savedDyn.calendar_gap_coefficients ?? defaultDyn.calendar_gap_coefficients,
      season_coefficients: savedDyn.season_coefficients ?? defaultDyn.season_coefficients,
      day_type_coefficients: savedDyn.day_type_coefficients ?? defaultDyn.day_type_coefficients,
      vehicle_occupation_coefficients: savedDyn.vehicle_occupation_coefficients ?? defaultDyn.vehicle_occupation_coefficients,
      promo_push_coefficients: savedDyn.promo_push_coefficients ?? defaultDyn.promo_push_coefficients,
      active_promo_level: savedDyn.active_promo_level ?? defaultDyn.active_promo_level,
      operating_mode: savedDyn.operating_mode ?? defaultDyn.operating_mode,
      phase_strategy_enabled: savedDyn.phase_strategy_enabled ?? defaultDyn.phase_strategy_enabled,
      phase1_max_rentals: savedDyn.phase1_max_rentals ?? defaultDyn.phase1_max_rentals,
      phase2_max_rentals: savedDyn.phase2_max_rentals ?? defaultDyn.phase2_max_rentals,
      season_by_month: savedDyn.season_by_month ?? defaultDyn.season_by_month,
      // Legacy `special_dates` may still exist in persisted configs — read it
      // via an index lookup so TypeScript doesn't complain, and let the
      // migration helper fold it into the new `special_periods` array.
      special_periods: migrateSpecialPeriods(
        savedDyn.special_periods,
        (savedDyn as Record<string, unknown>).special_dates,
      ) ?? defaultDyn.special_periods,
      vehicle_revenue_targets: migrateVehicleRevenueTargets(savedDyn.vehicle_revenue_targets) ?? defaultDyn.vehicle_revenue_targets,
      occupancy_targets: savedDyn.occupancy_targets ?? defaultDyn.occupancy_targets,
    },
  }
}

export default function CentralinaProTab() {
  const [section, setSection] = useState<SectionId>('categorie-fascia')

  // Hydrate from localStorage (sync, before first render of children)
  const persisted = useMemo(() => loadPersisted(), [])

  const initialCategories = pick(persisted, 'categories', INITIAL_CATEGORIES)
  const initialFasce = pick(persisted, 'fasce', INITIAL_FASCE)
  const initialInsurance = pick(persisted, 'insurance', INITIAL_INSURANCE)
  const initialKm = pick(persisted, 'km', INITIAL_KM)
  const initialDeposits = migrateDeposits(pick(persisted, 'deposits', INITIAL_DEPOSITS))
  const initialServizi = pick(persisted, 'servizi', INITIAL_SERVIZI)
  const initialPrezzoDinamico = mergePrezzoDinamico(pick(persisted, 'prezzoDinamico', INITIAL_PREZZO_DINAMICO))
  const initialPreventivi = pick(persisted, 'preventivi', INITIAL_PREVENTIVI)
  const initialPenali = migratePenali(pick(persisted, 'penali', INITIAL_PENALI))
  const initialDanni = migrateDanni(pick(persisted, 'danni', INITIAL_DANNI))
  const initialFiscal = pick(persisted, 'fiscal', INITIAL_FISCAL)
  const initialDr7Club = pick(persisted, 'dr7_club', INITIAL_DR7_CLUB)
  const initialAutomations = pick(persisted, 'automations', INITIAL_AUTOMATIONS)

  // Current (working) state
  const [categories, setCategories] = useState<Category[]>(initialCategories)
  const [fasce, setFasce] = useState<Fascia[]>(initialFasce)
  const [insurance, setInsurance] = useState<InsuranceCategoryConfig[]>(initialInsurance)
  const [km, setKm] = useState<KmConfig[]>(initialKm)
  const [deposits, setDeposits] = useState<DepositsConfig>(initialDeposits)
  const [servizi, setServizi] = useState<ServiziConfig>(initialServizi)
  const [prezzoDinamico, setPrezzoDinamico] = useState<PrezzoDinamicoConfig>(initialPrezzoDinamico)
  const [preventivi, setPreventivi] = useState<PreventiviConfig>(initialPreventivi)
  const [penali, setPenali] = useState<PenaliConfig>(initialPenali)
  const [danni, setDanni] = useState<DanniConfig>(initialDanni)
  const [fiscal, setFiscal] = useState<FiscalConfig>(initialFiscal)
  const [dr7Club, setDr7Club] = useState<DR7ClubConfig>(initialDr7Club)
  const [automations, setAutomations] = useState<AutomationsConfig>(initialAutomations)

  // Saved (committed) snapshot — what was last persisted
  const [savedCategories, setSavedCategories] = useState<Category[]>(initialCategories)
  const [savedFasce, setSavedFasce] = useState<Fascia[]>(initialFasce)
  const [savedInsurance, setSavedInsurance] = useState<InsuranceCategoryConfig[]>(initialInsurance)
  const [savedKm, setSavedKm] = useState<KmConfig[]>(initialKm)
  const [savedDeposits, setSavedDeposits] = useState<DepositsConfig>(initialDeposits)
  const [savedServizi, setSavedServizi] = useState<ServiziConfig>(initialServizi)
  const [savedPrezzoDinamico, setSavedPrezzoDinamico] = useState<PrezzoDinamicoConfig>(initialPrezzoDinamico)
  const [savedPreventivi, setSavedPreventivi] = useState<PreventiviConfig>(initialPreventivi)
  const [savedPenali, setSavedPenali] = useState<PenaliConfig>(initialPenali)
  const [savedDanni, setSavedDanni] = useState<DanniConfig>(initialDanni)
  const [savedFiscal, setSavedFiscal] = useState<FiscalConfig>(initialFiscal)
  const [savedDr7Club, setSavedDr7Club] = useState<DR7ClubConfig>(initialDr7Club)
  const [savedAutomations, setSavedAutomations] = useState<AutomationsConfig>(initialAutomations)

  const [justSaved, setJustSaved] = useState(false)

  // ─── HYDRATE FROM SUPABASE + ONE-TIME LOCALSTORAGE MIGRATION ───
  // On first mount: fetch Pro config from Supabase. If present, replace local
  // state (Supabase is the source of truth for the website). If absent AND
  // localStorage has data, push it up so nothing is lost.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const remote = await loadPersistedFromSupabase()
      if (cancelled) return
      if (remote) {
        // Supabase has data → adopt it
        if (remote.categories) { setCategories(remote.categories); setSavedCategories(remote.categories) }
        if (remote.fasce) { setFasce(remote.fasce); setSavedFasce(remote.fasce) }
        if (remote.insurance) { setInsurance(remote.insurance); setSavedInsurance(remote.insurance) }
        if (remote.km) { setKm(remote.km); setSavedKm(remote.km) }
        if (remote.deposits) {
          const migrated = migrateDeposits(remote.deposits)
          setDeposits(migrated); setSavedDeposits(migrated)
        }
        if (remote.servizi) { setServizi(remote.servizi); setSavedServizi(remote.servizi) }
        if (remote.prezzoDinamico) {
          const merged = mergePrezzoDinamico(remote.prezzoDinamico)
          setPrezzoDinamico(merged)
          setSavedPrezzoDinamico(merged)
        }
        if (remote.preventivi) { setPreventivi(remote.preventivi); setSavedPreventivi(remote.preventivi) }
        if (remote.penali !== undefined) {
          const migrated = migratePenali(remote.penali)
          setPenali(migrated); setSavedPenali(migrated)
        }
        if (remote.danni !== undefined) {
          const migrated = migrateDanni(remote.danni)
          setDanni(migrated); setSavedDanni(migrated)
        }
        if (remote.fiscal !== undefined) { setFiscal(remote.fiscal); setSavedFiscal(remote.fiscal) }
        if (remote.dr7_club !== undefined) { setDr7Club(remote.dr7_club); setSavedDr7Club(remote.dr7_club) }
        if (remote.automations !== undefined) { setAutomations(remote.automations); setSavedAutomations(remote.automations) }
        // Refresh local cache with the authoritative copy
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(remote)) } catch { /* ignore */ }
      } else {
        // Supabase is empty — seed with initial/localStorage values
        const seed: PersistedSnapshot = persisted || { categories, fasce, insurance, km, deposits, servizi, prezzoDinamico, preventivi, penali, danni, fiscal, dr7_club: dr7Club, automations }
        savePersisted(seed)
        console.log('[CentralinaPro] Seeded Pro config to Supabase')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── SYNC EFFECTS ───
  // When categories change, ensure dependent configs have entries.
  // Adding a new category in "Categorie & Fascia" automatically creates an
  // empty (editable) entry in: insurance, km, tariffe, deposits, penali, danni.
  // Removing a category drops the entry.
  // NOTE: base_prices/min_prices/max_prices are NOT synced here — they're keyed by vehicle.id (from Supabase),
  // not category.id. Syncing them with category ids would wipe all per-vehicle prices on every mount.
  useEffect(() => {
    setInsurance((prev) => syncByCategory(prev, categories, blankInsurance))
    setKm((prev) => syncByCategory(prev, categories, blankKm))
    setPrezzoDinamico((pd) => ({
      ...pd,
      tariffe: syncByCategory(pd.tariffe, categories, blankTariffa),
    }))
    // Deposits is keyed by category → fascia → scope. Build empty fascia map
    // for any new category and drop entries for removed categories.
    setDeposits((prev) => {
      const next: DepositsConfig = {}
      for (const c of categories) {
        next[c.id] = prev[c.id] || {}
      }
      return next
    })
    // Penali and Danni are arrays per category.
    setPenali((prev) => {
      const next: PenaliConfig = {}
      for (const c of categories) {
        next[c.id] = prev[c.id] || []
      }
      return next
    })
    setDanni((prev) => {
      const next: DanniConfig = {}
      for (const c of categories) {
        next[c.id] = prev[c.id] || []
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories])

  // When fasce change, ensure insurance.byFascia, deposits, second_driver have entries
  useEffect(() => {
    const fasciaIds = fasce.map((f) => f.id)
    setInsurance((prev) =>
      prev.map((cat) => ({
        ...cat,
        byFascia: syncRecord(cat.byFascia, fasciaIds, [] as InsuranceOption[]),
      }))
    )
    // Deposits is now category → fascia → scope. Sync each category map
    // using the LIVE categories list (so newly-added categories also get
    // a populated fascia structure).
    setDeposits((prev) => {
      const next: DepositsConfig = {}
      for (const cat of categories) {
        const cur = prev[cat.id] || {}
        next[cat.id] = syncRecord(cur, fasciaIds, { residente: [], non_residente: [] } as DepositFasciaConfig)
      }
      return next
    })
    setServizi((prev) => ({
      ...prev,
      second_driver: syncRecord(prev.second_driver, fasciaIds, '' as number | ''),
      // clear orphan tier_only / tier_restriction references
      experience: prev.experience.map((s) =>
        s.tier_only && !fasciaIds.includes(s.tier_only) ? { ...s, tier_only: '' } : s
      ),
      dr7_flex: {
        ...prev.dr7_flex,
        tier_restriction:
          prev.dr7_flex.tier_restriction && !fasciaIds.includes(prev.dr7_flex.tier_restriction)
            ? ''
            : prev.dr7_flex.tier_restriction,
      },
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fasce])

  const changes = useMemo(
    () =>
      computeChanges(
        { categories, fasce, insurance, km, deposits, servizi, prezzoDinamico, preventivi, penali, danni, fiscal, dr7_club: dr7Club, automations },
        {
          categories: savedCategories,
          fasce: savedFasce,
          insurance: savedInsurance,
          km: savedKm,
          deposits: savedDeposits,
          servizi: savedServizi,
          prezzoDinamico: savedPrezzoDinamico,
          preventivi: savedPreventivi,
          penali: savedPenali,
          danni: savedDanni,
          fiscal: savedFiscal,
          dr7_club: savedDr7Club,
          automations: savedAutomations,
        }
      ),
    [
      categories, fasce, insurance, km, deposits, servizi, prezzoDinamico, preventivi, penali, danni, fiscal, dr7Club, automations,
      savedCategories, savedFasce, savedInsurance, savedKm, savedDeposits, savedServizi, savedPrezzoDinamico, savedPreventivi, savedPenali, savedDanni, savedFiscal, savedDr7Club, savedAutomations,
    ]
  )

  function handleSave() {
    const changesSnapshot = changes.slice()
    setSavedCategories(categories)
    setSavedFasce(fasce)
    setSavedInsurance(insurance)
    setSavedKm(km)
    setSavedDeposits(deposits)
    setSavedServizi(servizi)
    setSavedPrezzoDinamico(prezzoDinamico)
    setSavedPreventivi(preventivi)
    setSavedPenali(penali)
    setSavedDanni(danni)
    setSavedFiscal(fiscal)
    setSavedDr7Club(dr7Club)
    setSavedAutomations(automations)
    savePersisted({ categories, fasce, insurance, km, deposits, servizi, prezzoDinamico, preventivi, penali, danni, fiscal, dr7_club: dr7Club, automations })
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 2000)

    logAdminAction('centralina_pro_updated', 'config', 'centralina_pro', {
      changes_count: changesSnapshot.length,
      changes: changesSnapshot.length > 0 ? changesSnapshot : ['(nessuna modifica rilevata)'],
    })
  }

  function handleDiscard() {
    setCategories(savedCategories)
    setFasce(savedFasce)
    setInsurance(savedInsurance)
    setKm(savedKm)
    setDeposits(savedDeposits)
    setServizi(savedServizi)
    setPrezzoDinamico(savedPrezzoDinamico)
    setPreventivi(savedPreventivi)
    setPenali(savedPenali)
    setDanni(savedDanni)
    setFiscal(savedFiscal)
    setDr7Club(savedDr7Club)
    setAutomations(savedAutomations)
  }

  void changes.length // SaveBar always visible

  return (
    <div className="min-h-screen bg-[#f5f5f7] pb-32">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#1d1d1f]">
              Centralina Pro
            </h1>
            <p className="mt-2 text-[15px] text-[#6e6e73]">
              Configurazione centralizzata noleggio
            </p>
          </div>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] font-medium bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7]">
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            Attivo
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
          <aside className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden h-fit">
            <nav className="py-2">
              {SECTIONS.map((s, idx) => {
                const active = section === s.id
                return (
                  <button
                    key={s.id}
                    onClick={() => setSection(s.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                      active
                        ? 'bg-[#007aff]/10'
                        : 'hover:bg-black/[0.03]:bg-white/[0.04]'
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center w-7 h-7 rounded-full text-[13px] font-semibold ${
                        active
                          ? 'bg-[#007aff] text-white'
                          : 'bg-[#e5e5ea] text-[#1d1d1f]'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span
                      className={`flex-1 min-w-0 text-[14px] font-medium truncate ${
                        active ? 'text-[#007aff]' : 'text-[#1d1d1f]'
                      }`}
                    >
                      {s.title}
                    </span>
                  </button>
                )
              })}
            </nav>
          </aside>

          <main className="min-w-0">
            {section === 'categorie-fascia' && (
              <CategorieFasciaSection
                categories={categories}
                setCategories={setCategories}
                fasce={fasce}
                setFasce={setFasce}
              />
            )}
            {section === 'p2' && (
              <AssicurazioniSection insurance={insurance} setInsurance={setInsurance} fasce={fasce} />
            )}
            {section === 'p3' && <KmSforoSection km={km} setKm={setKm} />}
            {section === 'p4' && <CauzioniSection deposits={deposits} setDeposits={setDeposits} fasce={fasce} categories={categories} />}
            {section === 'p5' && <ServiziSection servizi={servizi} setServizi={setServizi} fasce={fasce} />}
            {section === 'p6' && (
              <PrezzoDinamicoSection config={prezzoDinamico} setConfig={setPrezzoDinamico} />
            )}
            {section === 'p7' && (
              <PreventiviSection preventivi={preventivi} setPreventivi={setPreventivi} />
            )}
            {section === 'p8' && (
              <DanniPenaliSection
                penali={penali}
                setPenali={setPenali}
                danni={danni}
                setDanni={setDanni}
                categories={categories}
              />
            )}
            {section === 'p9' && (
              <FiscaleSection
                fiscal={fiscal}
                setFiscal={setFiscal}
              />
            )}
            {section === 'p10' && (
              <DR7ClubSection
                dr7Club={dr7Club}
                setDr7Club={setDr7Club}
              />
            )}
            {section === 'p11' && (
              <AutomazioniSection
                automations={automations}
                setAutomations={setAutomations}
              />
            )}
          </main>
        </div>
      </div>

      <SaveBar
        changes={changes}
        justSaved={justSaved}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}

function CategorieFasciaSection({
  categories,
  setCategories,
  fasce,
  setFasce,
}: {
  categories: Category[]
  setCategories: (next: Category[]) => void
  fasce: Fascia[]
  setFasce: (next: Fascia[]) => void
}) {
  return (
    <div className="space-y-6">
      <EditableList
        title="Categorie"
        subtitle="Tipologie di veicoli disponibili"
        items={categories}
        onChange={setCategories}
        addLabel="Aggiungi categoria"
        placeholderNew="Nuova categoria"
      />
      <FasciaList items={fasce} onChange={setFasce} />
    </div>
  )
}

// ========== SAVE BAR & CHANGE DETECTION ==========

function SaveBar({
  changes,
  justSaved,
  onSave,
  onDiscard,
}: {
  changes: string[]
  justSaved: boolean
  onSave: () => void
  onDiscard: () => void
}) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-50 px-4 pb-4 pointer-events-none">
      <div className="max-w-6xl mx-auto pointer-events-auto">
        <div
          className={`rounded-2xl shadow-2xl border backdrop-blur-xl px-5 py-4 flex items-center gap-4 flex-wrap transition-all ${
            justSaved
              ? 'bg-[#34c759]/95 border-[#34c759] text-white'
              : 'bg-white/95 border-black/10'
          }`}
        >
          {justSaved ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-[14px] font-medium">Modifiche salvate</span>
            </div>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[#1d1d1f] mb-1">
                  {changes.length} modifica{changes.length > 1 ? 'e' : ''} da salvare
                </p>
                <ul className="text-[12px] text-[#6e6e73] space-y-0.5 max-h-24 overflow-y-auto">
                  {changes.map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-[#007aff] mt-0.5">·</span>
                      <span className="truncate">{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={onDiscard}
                  className="px-4 py-2 rounded-lg text-[14px] font-medium text-[#1d1d1f] hover:bg-black/5:bg-white/10 transition-colors"
                >
                  Annulla
                </button>
                <button
                  onClick={onSave}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-[14px] font-semibold bg-[#007aff] text-white hover:bg-[#0066d6] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  Salva
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

type Snapshot = {
  categories: Category[]
  fasce: Fascia[]
  insurance: InsuranceCategoryConfig[]
  km: KmConfig[]
  deposits: DepositsConfig
  servizi: ServiziConfig
  prezzoDinamico: PrezzoDinamicoConfig
  preventivi: PreventiviConfig
  penali: PenaliConfig
  danni: DanniConfig
  fiscal: FiscalConfig
  dr7_club: DR7ClubConfig
  automations: AutomationsConfig
}

function computeChanges(current: Snapshot, saved: Snapshot): string[] {
  const out: string[] = []

  // Fiscale
  if (current.fiscal.vat_rate !== saved.fiscal.vat_rate) {
    out.push(`Aliquota IVA: ${saved.fiscal.vat_rate || 0}% → ${current.fiscal.vat_rate || 0}%`)
  }

  // Automazioni
  if (current.automations.rental_buffer_minutes !== saved.automations.rental_buffer_minutes) {
    out.push(`Buffer post-noleggio: ${saved.automations.rental_buffer_minutes || 0} → ${current.automations.rental_buffer_minutes || 0} minuti`)
  }
  if (current.automations.cross_vehicle_gap_minutes !== saved.automations.cross_vehicle_gap_minutes) {
    out.push(`Buffer handover tra veicoli diversi: ${saved.automations.cross_vehicle_gap_minutes || 0} → ${current.automations.cross_vehicle_gap_minutes || 0} minuti`)
  }
  if (current.automations.pre_pickup_carwash_buffer_minutes !== saved.automations.pre_pickup_carwash_buffer_minutes) {
    out.push(`Buffer pre-pickup (lavaggio in corso): ${saved.automations.pre_pickup_carwash_buffer_minutes || 0} → ${current.automations.pre_pickup_carwash_buffer_minutes || 0} minuti`)
  }
  if (current.automations.late_return_grace_minutes !== saved.automations.late_return_grace_minutes) {
    out.push(`Grace ritardo riconsegna: ${saved.automations.late_return_grace_minutes || 0} → ${current.automations.late_return_grace_minutes || 0} minuti`)
  }

  // DR7 Club tiers
  {
    const savedIds = new Set(saved.dr7_club.tiers.map((t) => t.id))
    const curIds = new Set(current.dr7_club.tiers.map((t) => t.id))
    current.dr7_club.tiers.forEach((t) => {
      if (!savedIds.has(t.id)) out.push(`DR7 Club: tier aggiunto "${t.label || '(senza nome)'}"`)
    })
    saved.dr7_club.tiers.forEach((t) => {
      if (!curIds.has(t.id)) out.push(`DR7 Club: tier rimosso "${t.label}"`)
    })
    current.dr7_club.tiers.forEach((cur) => {
      const prev = saved.dr7_club.tiers.find((x) => x.id === cur.id)
      if (!prev) return
      if (prev.label !== cur.label) out.push(`DR7 Club / "${prev.label}" → "${cur.label}"`)
      if (prev.min_annual_spend !== cur.min_annual_spend) out.push(`DR7 Club / ${cur.label}: soglia €${prev.min_annual_spend || 0} → €${cur.min_annual_spend || 0}`)
      if (prev.rate_pct !== cur.rate_pct) out.push(`DR7 Club / ${cur.label}: reward ${prev.rate_pct || 0}% → ${cur.rate_pct || 0}%`)
      if (prev.is_active !== cur.is_active) out.push(`DR7 Club / ${cur.label}: ${cur.is_active ? 'attivato' : 'disattivato'}`)
    })
  }


  // Categories
  const catSavedIds = new Set(saved.categories.map((c) => c.id))
  const catCurIds = new Set(current.categories.map((c) => c.id))
  current.categories.forEach((c) => {
    if (!catSavedIds.has(c.id)) out.push(`Categoria aggiunta: "${c.label || '(senza nome)'}"`)
  })
  saved.categories.forEach((c) => {
    if (!catCurIds.has(c.id)) out.push(`Categoria rimossa: "${c.label}"`)
  })
  current.categories.forEach((c) => {
    const prev = saved.categories.find((x) => x.id === c.id)
    if (prev && prev.label !== c.label) out.push(`Categoria rinominata: "${prev.label}" → "${c.label}"`)
  })

  // Fascia
  const fSavedIds = new Set(saved.fasce.map((f) => f.id))
  const fCurIds = new Set(current.fasce.map((f) => f.id))
  current.fasce.forEach((f) => {
    if (!fSavedIds.has(f.id)) out.push(`Fascia aggiunta: "${f.label || '(senza nome)'}"`)
  })
  saved.fasce.forEach((f) => {
    if (!fCurIds.has(f.id)) out.push(`Fascia rimossa: "${f.label}"`)
  })
  current.fasce.forEach((f) => {
    const prev = saved.fasce.find((x) => x.id === f.id)
    if (!prev) return
    if (prev.label !== f.label) out.push(`Fascia rinominata: "${prev.label}" → "${f.label}"`)
    if (prev.description !== f.description) out.push(`${f.label}: descrizione modificata`)
    if (prev.min_age !== f.min_age) out.push(`${f.label}: eta minima ${prev.min_age} → ${f.min_age}`)
    if (prev.max_age !== f.max_age) out.push(`${f.label}: eta massima ${prev.max_age} → ${f.max_age}`)
    if (prev.min_license_years !== f.min_license_years) out.push(`${f.label}: patente min ${prev.min_license_years} → ${f.min_license_years} anni`)
  })

  // Km & Sforo
  current.km.forEach((k) => {
    const prev = saved.km.find((x) => x.id === k.id)
    if (!prev) return
    const days = new Set([...Object.keys(k.table), ...Object.keys(prev.table)])
    days.forEach((d) => {
      if (prev.table[d] !== k.table[d]) {
        out.push(`Km & Sforo / ${k.label}: ${d}g ${prev.table[d] || 0} → ${k.table[d] || 0} km`)
      }
    })
    if (prev.extraPerDay !== k.extraPerDay) out.push(`Km & Sforo / ${k.label}: extra/giorno ${prev.extraPerDay} → ${k.extraPerDay} km`)
    if (prev.sforo !== k.sforo) out.push(`Km & Sforo / ${k.label}: sforo €${prev.sforo} → €${k.sforo}/km`)
    if (prev.unlimitedPerDay !== k.unlimitedPerDay) out.push(`Km & Sforo / ${k.label}: km illimitati €${prev.unlimitedPerDay} → €${k.unlimitedPerDay}/giorno`)
    const prevMode = prev.unlimitedMode || 'all_tiers'
    const curMode = k.unlimitedMode || 'all_tiers'
    if (prevMode !== curMode) out.push(`Km & Sforo / ${k.label}: modalità illimitati ${prevMode === 'per_fascia' ? 'per fascia' : 'tutte le fasce'} → ${curMode === 'per_fascia' ? 'per fascia' : 'tutte le fasce'}`)
    const fIds = new Set([...Object.keys(prev.unlimitedByFascia || {}), ...Object.keys(k.unlimitedByFascia || {})])
    fIds.forEach((fid) => {
      const p = prev.unlimitedByFascia?.[fid] ?? ''
      const c = k.unlimitedByFascia?.[fid] ?? ''
      if (p !== c) out.push(`Km & Sforo / ${k.label} / Fascia ${fid}: illimitati €${p || 0} → €${c || 0}/giorno`)
    })
  })

  // Servizi
  {
    const ce = current.servizi.experience
    const pe = saved.servizi.experience
    const ceIds = new Set(ce.map((s) => s.id))
    const peIds = new Set(pe.map((s) => s.id))
    ce.forEach((s) => {
      if (!peIds.has(s.id)) out.push(`Servizi: aggiunto "${s.name || 'Nuovo servizio'}"`)
    })
    pe.forEach((s) => {
      if (!ceIds.has(s.id)) out.push(`Servizi: rimosso "${s.name}"`)
    })
    ce.forEach((s) => {
      const p = pe.find((x) => x.id === s.id)
      if (!p) return
      if (p.name !== s.name) out.push(`Servizi: "${p.name}" rinominato in "${s.name}"`)
      if (p.price !== s.price) out.push(`Servizi / ${s.name}: prezzo €${p.price} → €${s.price}`)
      if (p.unit !== s.unit) out.push(`Servizi / ${s.name}: unita ${UNIT_LABELS[p.unit]} → ${UNIT_LABELS[s.unit]}`)
      if (p.tier_only !== s.tier_only) out.push(`Servizi / ${s.name}: restrizione fascia modificata`)
      if (p.is_active !== s.is_active) out.push(`Servizi / ${s.name}: ${s.is_active ? 'attivato' : 'disattivato'}`)
    })

    const cf = current.servizi.dr7_flex
    const pf = saved.servizi.dr7_flex
    if (pf.daily_price !== cf.daily_price) out.push(`DR7 Flex: prezzo €${pf.daily_price} → €${cf.daily_price}/g`)
    if (pf.refund_percent !== cf.refund_percent) out.push(`DR7 Flex: rimborso ${pf.refund_percent}% → ${cf.refund_percent}%`)
    if (pf.tier_restriction !== cf.tier_restriction) out.push(`DR7 Flex: restrizione fascia modificata`)
    if (pf.description !== cf.description) out.push(`DR7 Flex: descrizione modificata`)

    if (saved.servizi.lavaggio.fee !== current.servizi.lavaggio.fee) out.push(`Pulizia Finale: €${saved.servizi.lavaggio.fee} → €${current.servizi.lavaggio.fee}`)
    if (saved.servizi.lavaggio.mandatory !== current.servizi.lavaggio.mandatory) out.push(`Pulizia Finale: ${current.servizi.lavaggio.mandatory ? 'obbligatoria' : 'facoltativa'}`)
    if (saved.servizi.delivery.price_per_km !== current.servizi.delivery.price_per_km) out.push(`Consegna a domicilio: €${saved.servizi.delivery.price_per_km} → €${current.servizi.delivery.price_per_km}/km`)
    {
      const sdKeys = new Set([...Object.keys(saved.servizi.second_driver), ...Object.keys(current.servizi.second_driver)])
      sdKeys.forEach((k) => {
        if (saved.servizi.second_driver[k] !== current.servizi.second_driver[k]) {
          out.push(`Secondo Guidatore (${k}): €${saved.servizi.second_driver[k] ?? 0} → €${current.servizi.second_driver[k] ?? 0}/g`)
        }
      })
    }
  }

  // Prezzo Dinamico — Tariffe
  current.prezzoDinamico.tariffe.forEach((t) => {
    const p = saved.prezzoDinamico.tariffe.find((x) => x.id === t.id)
    if (!p) return
    if (p.mode !== t.mode) out.push(`Tariffe / ${t.label}: modalita ${p.mode} → ${t.mode}`)
    if (p.extraPerDay !== t.extraPerDay) out.push(`Tariffe / ${t.label}: extra/giorno ${p.extraPerDay} → ${t.extraPerDay}`)
    const days = new Set([...t.days, ...p.days])
    days.forEach((d) => {
      if (p.unica[d] !== t.unica[d]) out.push(`Tariffe / ${t.label} (unica) ${d}g: ${p.unica[d] || 0} → ${t.unica[d] || 0}`)
      if (p.residente[d] !== t.residente[d]) out.push(`Tariffe / ${t.label} (residente) ${d}g: ${p.residente[d] || 0} → ${t.residente[d] || 0}`)
      if (p.non_residente[d] !== t.non_residente[d]) out.push(`Tariffe / ${t.label} (non residente) ${d}g: ${p.non_residente[d] || 0} → ${t.non_residente[d] || 0}`)
    })
  })

  // Prezzo Dinamico — Engine
  {
    const cd = current.prezzoDinamico.dynamic
    const pd = saved.prezzoDinamico.dynamic
    if (pd.enabled !== cd.enabled) out.push(`Revenue Engine: ${cd.enabled ? 'attivato' : 'disattivato'}`)
    if (pd.mode !== cd.mode) out.push(`Revenue Engine: modalita ${pd.mode} → ${cd.mode}`)
    const priceKeys = new Set([...Object.keys(cd.base_prices), ...Object.keys(pd.base_prices)])
    priceKeys.forEach((k) => {
      if (pd.base_prices[k] !== cd.base_prices[k]) out.push(`Prezzo base / ${k}: ${pd.base_prices[k] || 0} → ${cd.base_prices[k] || 0}`)
      if (pd.min_prices[k] !== cd.min_prices[k]) out.push(`Prezzo min / ${k}: ${pd.min_prices[k] || 0} → ${cd.min_prices[k] || 0}`)
      if (pd.max_prices[k] !== cd.max_prices[k]) out.push(`Prezzo max / ${k}: ${pd.max_prices[k] || 0} → ${cd.max_prices[k] || 0}`)
    })
    diffCoeffRows('Occupazione', cd.occupation_coefficients, pd.occupation_coefficients, out)
    diffCoeffRows('Anticipo', cd.advance_coefficients, pd.advance_coefficients, out)
    diffCoeffRows('Durata', cd.duration_coefficients, pd.duration_coefficients, out)
    diffCoeffRows('Gap Calendario', cd.calendar_gap_coefficients, pd.calendar_gap_coefficients, out)

    // Named coefficients (tier -> multiplier)
    const diffNamed = (label: string, cur: NamedCoeff[], prev: NamedCoeff[]) => {
      const keys = new Set([...cur.map(c => c.key), ...prev.map(c => c.key)])
      keys.forEach(k => {
        const c = cur.find(x => x.key === k)
        const p = prev.find(x => x.key === k)
        if (!p && c) out.push(`${label}: aggiunta "${c.label}"`)
        else if (p && !c) out.push(`${label}: rimossa "${p.label}"`)
        else if (p && c && (p.coeff !== c.coeff || p.label !== c.label)) out.push(`${label}: "${p.label}" modificato`)
      })
    }
    diffNamed('Stagione', cd.season_coefficients, pd.season_coefficients)
    diffNamed('Tipo Giorno', cd.day_type_coefficients, pd.day_type_coefficients)
    diffNamed('Occupazione Veicolo', cd.vehicle_occupation_coefficients, pd.vehicle_occupation_coefficients)
    diffNamed('Promo', cd.promo_push_coefficients, pd.promo_push_coefficients)

    if (pd.active_promo_level !== cd.active_promo_level) out.push(`Promo attiva: ${pd.active_promo_level || 'nessuna'} → ${cd.active_promo_level || 'nessuna'}`)
    if (pd.operating_mode !== cd.operating_mode) out.push(`Modalità operativa: ${pd.operating_mode} → ${cd.operating_mode}`)

    // Stagione per Mese
    for (let m = 1; m <= 12; m++) {
      const cur = cd.season_by_month?.[String(m)] || ''
      const prev = pd.season_by_month?.[String(m)] || ''
      if (cur !== prev) out.push(`Stagione mese ${m}: ${prev || 'nessuna'} → ${cur || 'nessuna'}`)
    }

    // Special periods (day_type over a range of dates)
    const serializePeriods = (list?: SpecialPeriod[]) =>
      JSON.stringify((list || []).map(p => [p.start_date, p.end_date, p.day_type_key]))
    if (serializePeriods(cd.special_periods) !== serializePeriods(pd.special_periods)) {
      out.push(`Periodi speciali: ${(pd.special_periods || []).length} → ${(cd.special_periods || []).length}`)
    }

    // Per-vehicle revenue targets (list of tiers)
    const allVids = new Set([
      ...Object.keys(cd.vehicle_revenue_targets || {}),
      ...Object.keys(pd.vehicle_revenue_targets || {}),
    ])
    const serializeTiers = (t?: VehicleRevenueTarget) =>
      JSON.stringify((t?.tiers || []).map(x => [x.min_revenue, x.coeff]))
    allVids.forEach(vid => {
      const c = serializeTiers(cd.vehicle_revenue_targets?.[vid])
      const p = serializeTiers(pd.vehicle_revenue_targets?.[vid])
      if (c !== p) {
        const count = (cd.vehicle_revenue_targets?.[vid]?.tiers || []).length
        const prevCount = (pd.vehicle_revenue_targets?.[vid]?.tiers || []).length
        out.push(`Spinta veicolo ${vid} — soglie: ${prevCount} → ${count}`)
      }
    })

    // Occupancy targets
    const targetClasses: (keyof typeof cd.occupancy_targets)[] = ['utilitarie', 'suv_premium', 'luxury']
    const targetWindows: (keyof OccupancyTargets)[] = ['d30plus', 'd15_29', 'd7_14', 'd3_6', 'd0_2']
    targetClasses.forEach(cls => {
      targetWindows.forEach(w => {
        const c = cd.occupancy_targets?.[cls]?.[w]
        const p = pd.occupancy_targets?.[cls]?.[w]
        if (c !== p) out.push(`Target ${cls} / ${w}: ${p || 0}% → ${c || 0}%`)
      })
    })
  }

  // Preventivi
  {
    const cp = current.preventivi
    const pp = saved.preventivi
    if (pp.maggiorazione_pct !== cp.maggiorazione_pct) out.push(`Preventivi: maggiorazione ${pp.maggiorazione_pct}% → ${cp.maggiorazione_pct}%`)
    if (pp.scadenza_default_ore !== cp.scadenza_default_ore) out.push(`Preventivi: scadenza ${pp.scadenza_default_ore}h → ${cp.scadenza_default_ore}h`)
    cp.messaggi.forEach((m) => {
      const prev = pp.messaggi.find((x) => x.key === m.key)
      if (!prev) return
      if (prev.body !== m.body) out.push(`Preventivi / ${m.label}: testo modificato`)
      if (prev.is_enabled !== m.is_enabled) out.push(`Preventivi / ${m.label}: ${m.is_enabled ? 'attivato' : 'disattivato'}`)
    })
  }

  // Cauzioni — now per (category × fascia × scope)
  const allCategoryIds = new Set<string>([
    ...Object.keys(current.deposits || {}),
    ...Object.keys(saved.deposits || {}),
  ])
  allCategoryIds.forEach((catId) => {
    const curCat = (current.deposits as Record<string, DepositsByFascia>)[catId] || {}
    const savedCat = (saved.deposits as Record<string, DepositsByFascia>)[catId] || {}
    const catLabel = current.categories.find(c => c.id === catId)?.label
      || saved.categories.find(c => c.id === catId)?.label
      || catId
    const allFasciaIds = new Set([...Object.keys(curCat), ...Object.keys(savedCat)])
    allFasciaIds.forEach((fid) => {
      ;(['residente', 'non_residente'] as const).forEach((scope) => {
        const cur = curCat[fid]?.[scope] ?? []
        const prev = savedCat[fid]?.[scope] ?? []
        const prefix = `Cauzioni / ${catLabel} / Fascia ${fid} ${scope === 'residente' ? 'Residente' : 'Non Residente'}`
        const savedIds = new Set(prev.map((o) => o.id))
        const curIds = new Set(cur.map((o) => o.id))
        cur.forEach((o) => {
          if (!savedIds.has(o.id)) out.push(`${prefix}: aggiunta "${o.label || 'Nuova opzione'}"`)
        })
        prev.forEach((o) => {
          if (!curIds.has(o.id)) out.push(`${prefix}: rimossa "${o.label}"`)
        })
        cur.forEach((o) => {
          const p = prev.find((x) => x.id === o.id)
          if (!p) return
          if (p.label !== o.label) out.push(`${prefix}: "${p.label}" rinominata in "${o.label}"`)
          if (p.amount !== o.amount) out.push(`${prefix} / ${o.label}: importo €${p.amount} → €${o.amount}`)
          if (p.surcharge_per_day !== o.surcharge_per_day) out.push(`${prefix} / ${o.label}: sovrapprezzo €${p.surcharge_per_day}/g → €${o.surcharge_per_day}/g`)
        })
      })
    })
  })

  // Insurance
  current.insurance.forEach((cat) => {
    const prevCat = saved.insurance.find((c) => c.id === cat.id)
    if (!prevCat) return
    if (prevCat.mode !== cat.mode) {
      out.push(`${cat.label}: modalita cambiata (${prevCat.mode === 'per_fascia' ? 'per fascia' : 'tutte le fasce'} → ${cat.mode === 'per_fascia' ? 'per fascia' : 'tutte le fasce'})`)
    }
    const fasciaIds = new Set([...Object.keys(cat.byFascia), ...Object.keys(prevCat.byFascia)])
    fasciaIds.forEach((fid) => {
      diffInsuranceList(cat.label, `Fascia ${fid}`, cat.byFascia[fid] ?? [], prevCat.byFascia[fid] ?? [], out)
    })
    diffInsuranceList(cat.label, '', cat.all, prevCat.all, out)
  })

  // Penali & Danni — stessa shape (PenaliConfig = Record<categoryId, item[]>),
  // diff condiviso. Senza questo blocco la save bar mostrava "0 modifiche da
  // salvare" anche dopo aver editato un danno o una penale, anche se la save
  // funzionava lo stesso (handleSave include sempre penali+danni nello snapshot).
  diffFeeListConfig('Penali', current.penali, saved.penali, out)
  diffFeeListConfig('Danni', current.danni, saved.danni, out)

  return out
}

/** Diff per PenaliConfig / DanniConfig (Record<categoryId, item[]>). Mostra
    aggiunte / rimozioni / modifiche di label / importo / descrizione / enabled
    per ogni categoria, prefissate da "Penali" o "Danni". */
function diffFeeListConfig(
  prefix: string,
  current: PenaliConfig,
  saved: PenaliConfig,
  out: string[],
): void {
  const categoryIds = new Set([...Object.keys(current || {}), ...Object.keys(saved || {})])
  categoryIds.forEach((catId) => {
    const cur = (current?.[catId] ?? []) as PenaliItem[]
    const prev = (saved?.[catId] ?? []) as PenaliItem[]
    const prevById = new Map(prev.map((p) => [p.id, p]))
    const curById = new Map(cur.map((c) => [c.id, c]))

    cur.forEach((it) => {
      if (!prevById.has(it.id)) {
        out.push(`${prefix} / ${catId}: aggiunto "${it.label || '(senza nome)'}"`)
      }
    })
    prev.forEach((it) => {
      if (!curById.has(it.id)) {
        out.push(`${prefix} / ${catId}: rimosso "${it.label}"`)
      }
    })
    cur.forEach((it) => {
      const p = prevById.get(it.id)
      if (!p) return
      if (p.label !== it.label) out.push(`${prefix} / ${catId}: "${p.label}" rinominato in "${it.label}"`)
      if (p.amount !== it.amount) out.push(`${prefix} / ${catId} / ${it.label}: importo €${p.amount} → €${it.amount}`)
      if ((p.description || '') !== (it.description || '')) out.push(`${prefix} / ${catId} / ${it.label}: descrizione modificata`)
      if ((p.enabled !== false) !== (it.enabled !== false)) {
        out.push(`${prefix} / ${catId} / ${it.label}: ${it.enabled !== false ? 'abilitato' : 'disabilitato'}`)
      }
    })
  })
}

function diffInsuranceList(
  categoryLabel: string,
  scope: string,
  current: InsuranceOption[],
  saved: InsuranceOption[],
  out: string[]
) {
  const prefix = scope ? `${categoryLabel} / ${scope}` : categoryLabel
  const savedIds = new Set(saved.map((o) => o.id))
  const curIds = new Set(current.map((o) => o.id))
  current.forEach((o) => {
    if (!savedIds.has(o.id)) out.push(`${prefix}: aggiunta "${o.name || 'Nuova opzione'}"`)
  })
  saved.forEach((o) => {
    if (!curIds.has(o.id)) out.push(`${prefix}: rimossa "${o.name}"`)
  })
  current.forEach((o) => {
    const prev = saved.find((x) => x.id === o.id)
    if (!prev) return
    if (prev.name !== o.name) out.push(`${prefix}: "${prev.name}" rinominata in "${o.name}"`)
    if (prev.daily_price !== o.daily_price) out.push(`${prefix} / ${o.name}: €/giorno ${prev.daily_price} → ${o.daily_price}`)
    if (prev.mandatory_deposit !== o.mandatory_deposit) out.push(`${prefix} / ${o.name}: deposito ${prev.mandatory_deposit} → ${o.mandatory_deposit}`)
    if (prev.deductible_fixed !== o.deductible_fixed) out.push(`${prefix} / ${o.name}: franchigia ${prev.deductible_fixed} → ${o.deductible_fixed}`)
    if (prev.deductible_percent !== o.deductible_percent) out.push(`${prefix} / ${o.name}: franchigia % ${prev.deductible_percent} → ${o.deductible_percent}`)
  })
}

type ListItem = { id: string; label: string }

function EditableList<T extends ListItem>({
  title,
  subtitle,
  items,
  onChange,
  addLabel,
  placeholderNew,
}: {
  title: string
  subtitle: string
  items: T[]
  onChange: (next: T[]) => void
  addLabel: string
  placeholderNew: string
}) {
  const [newLabel, setNewLabel] = useState('')

  function update(id: string, label: string) {
    onChange(items.map((i) => (i.id === id ? { ...i, label } : i)))
  }
  function remove(id: string) {
    onChange(items.filter((i) => i.id !== id))
  }
  function add() {
    const label = newLabel.trim()
    if (!label) return
    // Genera id leggibile dallo slug del label (es. "Hypercar" → "hypercar"),
    // così il sito usa il NOME inserito dall'admin e non un id random come
    // "kwtcdhvs". Con suffisso numerico se collide con uno esistente.
    const baseSlug = label.toLowerCase().trim()
      .replace(/[^a-z0-9\s-_]/g, '')
      .replace(/[\s-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 40) || 'cat'
    let id = baseSlug
    let counter = 1
    while (items.some((i) => i.id === id)) {
      id = `${baseSlug}_${counter++}`
    }
    onChange([...items, { id, label } as T])
    setNewLabel('')
  }

  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-3">
        <h2 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight">
          {title}
        </h2>
        <p className="text-[13px] text-[#6e6e73] mt-0.5">{subtitle}</p>
      </header>

      <ul className="divide-y divide-black/5">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-5 py-3 group">
            <input
              value={item.label}
              onChange={(e) => update(item.id, e.target.value)}
              className="flex-1 bg-transparent outline-none text-[15px] text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7]:bg-white/5 rounded-lg px-2 py-1.5 -mx-2 transition-colors"
            />
            <button
              onClick={() => remove(item.id)}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center w-8 h-8 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-all"
              aria-label="Rimuovi"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
              </svg>
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73]">
            Nessun elemento — aggiungine uno qui sotto
          </li>
        )}
      </ul>

      <footer className="px-5 py-3 border-t border-black/5 bg-[#fafafa] flex items-center gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          placeholder={placeholderNew}
          className="flex-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
        />
        <button
          onClick={add}
          disabled={!newLabel.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[14px] font-medium bg-[#007aff] text-white hover:bg-[#0066d6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          {addLabel}
        </button>
      </footer>
    </section>
  )
}

function FasciaList({ items, onChange }: { items: Fascia[]; onChange: (next: Fascia[]) => void }) {
  function patch(id: string, patch: Partial<Fascia>) {
    onChange(items.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }
  function remove(id: string) {
    onChange(items.filter((f) => f.id !== id))
  }
  function add() {
    onChange([
      ...items,
      {
        id: uid(),
        label: `Fascia ${String.fromCharCode(65 + items.length)}`,
        description: '',
        min_age: '',
        max_age: '',
        min_license_years: '',
      },
    ])
  }

  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-3">
        <h2 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight">
          Fascia
        </h2>
        <p className="text-[13px] text-[#6e6e73] mt-0.5">
          Fasce conducente — eta e anni di patente
        </p>
      </header>

      <ul className="divide-y divide-black/5">
        {items.map((f) => (
          <li key={f.id} className="p-5 group">
            <div className="flex items-start gap-3 mb-4">
              <input
                value={f.label}
                onChange={(e) => patch(f.id, { label: e.target.value })}
                className="flex-1 bg-transparent outline-none text-[17px] font-semibold text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7]:bg-white/5 rounded-lg px-2 py-1 -mx-2 transition-colors"
                placeholder="Nome fascia"
              />
              <button
                onClick={() => remove(f.id)}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center w-8 h-8 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-all"
                aria-label="Rimuovi"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                </svg>
              </button>
            </div>

            <input
              value={f.description}
              onChange={(e) => patch(f.id, { description: e.target.value })}
              placeholder="Descrizione (es. Conducente esperto)"
              className="w-full bg-transparent outline-none text-[14px] text-[#6e6e73] placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7]:bg-white/5 rounded-lg px-2 py-1.5 -mx-2 mb-4 transition-colors"
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <NumberField
                label="Eta minima"
                value={f.min_age}
                onChange={(v) => patch(f.id, { min_age: v })}
                suffix="anni"
              />
              <NumberField
                label="Eta massima"
                value={f.max_age}
                onChange={(v) => patch(f.id, { max_age: v })}
                suffix="anni"
              />
              <NumberField
                label="Patente da almeno"
                value={f.min_license_years}
                onChange={(v) => patch(f.id, { min_license_years: v })}
                suffix="anni"
              />
            </div>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73]">
            Nessuna fascia configurata
          </li>
        )}
      </ul>

      <footer className="px-5 py-3 border-t border-black/5 bg-[#fafafa]">
        <button
          onClick={add}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[14px] font-medium bg-[#007aff] text-white hover:bg-[#0066d6] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Aggiungi fascia
        </button>
      </footer>
    </section>
  )
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string
  value: number | ''
  onChange: (v: number | '') => void
  suffix?: string
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-[#6e6e73] mb-1">
        {label}
      </span>
      <div className="relative">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => {
            const v = e.target.value
            onChange(v === '' ? '' : Number(v))
          }}
          className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 pr-14 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </label>
  )
}

// ========== ASSICURAZIONI (Punto 2) ==========

type InsuranceOption = {
  id: string
  name: string
  daily_price: number | ''
  mandatory_deposit: number | ''
  deductible_fixed: number | ''
  deductible_percent: number | ''
}

type Mode = 'per_fascia' | 'all_tiers'

type InsuranceCategoryConfig = {
  id: string
  label: string
  mode: Mode
  byFascia: Record<string, InsuranceOption[]> // keyed by fascia.id
  all: InsuranceOption[]
}

const INITIAL_INSURANCE: InsuranceCategoryConfig[] = [
  {
    id: 'supercars',
    label: 'Supercars / Exotic',
    mode: 'per_fascia',
    byFascia: {
      A: [
        { id: uid(), name: 'RCA Compresa (no Kasko)', daily_price: 0, mandatory_deposit: 10000, deductible_fixed: 0, deductible_percent: 0 },
        { id: uid(), name: 'Kasko Base', daily_price: 89, mandatory_deposit: 0, deductible_fixed: 5000, deductible_percent: 30 },
        { id: uid(), name: 'Kasko Black', daily_price: 149, mandatory_deposit: 0, deductible_fixed: 5000, deductible_percent: 10 },
        { id: uid(), name: 'Kasko Signature', daily_price: 189, mandatory_deposit: 0, deductible_fixed: 5000, deductible_percent: 0 },
        { id: uid(), name: 'Kasko DR7', daily_price: 289, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
      ],
      B: [
        { id: uid(), name: 'RCA Compresa (no Kasko)', daily_price: 0, mandatory_deposit: 15000, deductible_fixed: 0, deductible_percent: 0 },
        { id: uid(), name: 'Kasko Base', daily_price: 119, mandatory_deposit: 0, deductible_fixed: 5000, deductible_percent: 30 },
      ],
    },
    all: [],
  },
  {
    id: 'urban',
    label: 'Urban',
    mode: 'all_tiers',
    byFascia: {},
    all: [
      { id: uid(), name: 'Kasko Base', daily_price: 15, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
      { id: uid(), name: 'Kasko DR7', daily_price: 45, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
    ],
  },
  {
    id: 'aziendali',
    label: 'Aziendali',
    mode: 'all_tiers',
    byFascia: {},
    all: [
      { id: uid(), name: 'RCA Compresa (no Kasko)', daily_price: 0, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
      { id: uid(), name: 'Kasko Base', daily_price: 45, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
      { id: uid(), name: 'Kasko Black', daily_price: 65, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
      { id: uid(), name: 'Kasko Signature', daily_price: 80, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
      { id: uid(), name: 'Kasko DR7', daily_price: 90, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
    ],
  },
]

function AssicurazioniSection({
  insurance,
  setInsurance,
  fasce,
}: {
  insurance: InsuranceCategoryConfig[]
  fasce: Fascia[]
  setInsurance: (next: InsuranceCategoryConfig[]) => void
}) {
  const config = insurance

  function updateCategory(id: string, patch: Partial<InsuranceCategoryConfig>) {
    setInsurance(config.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          Prezzi Assicurazioni
        </h2>
        <p className="text-[14px] text-[#6e6e73] mt-1">
          Per categoria e fascia conducente
        </p>
      </div>

      {config.map((cat) => (
        <InsuranceCategoryCard
          key={cat.id}
          category={cat}
          fasce={fasce}
          onChange={(patch) => updateCategory(cat.id, patch)}
        />
      ))}
    </div>
  )
}

function InsuranceCategoryCard({
  category,
  fasce,
  onChange,
}: {
  category: InsuranceCategoryConfig
  fasce: Fascia[]
  onChange: (patch: Partial<InsuranceCategoryConfig>) => void
}) {
  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-4 flex items-center justify-between gap-4 flex-wrap">
        <h3 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight">
          {category.label}
        </h3>
        <label className="flex items-center gap-2 text-[13px] text-[#6e6e73]">
          <span>Modalita</span>
          <select
            value={category.mode}
            onChange={(e) => onChange({ mode: e.target.value as Mode })}
            className="bg-white border border-black/10 rounded-lg px-3 py-1.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
          >
            <option value="per_fascia">Per fascia (separata)</option>
            <option value="all_tiers">Uguale per tutte le fasce</option>
          </select>
        </label>
      </header>

      {category.mode === 'per_fascia' ? (
        <div className="divide-y divide-black/5 border-t border-black/5">
          {fasce.map((f) => (
            <InsuranceList
              key={f.id}
              heading={`${f.label}${f.description ? ` — ${f.description}` : ''}`}
              items={category.byFascia[f.id] ?? []}
              onChange={(next) =>
                onChange({ byFascia: { ...category.byFascia, [f.id]: next } })
              }
            />
          ))}
          {fasce.length === 0 && (
            <p className="px-5 py-6 text-center text-[13px] text-[#6e6e73]">
              Nessuna fascia configurata. Aggiungine una in "Categorie & Fascia".
            </p>
          )}
        </div>
      ) : (
        <div className="border-t border-black/5">
          <InsuranceList
            heading="Stesse opzioni per tutte le fasce"
            items={category.all}
            onChange={(next) => onChange({ all: next })}
          />
        </div>
      )}
    </section>
  )
}

function InsuranceList({
  heading,
  items,
  onChange,
}: {
  heading: string
  items: InsuranceOption[]
  onChange: (next: InsuranceOption[]) => void
}) {
  function patch(id: string, p: Partial<InsuranceOption>) {
    onChange(items.map((i) => (i.id === id ? { ...i, ...p } : i)))
  }
  function remove(id: string) {
    onChange(items.filter((i) => i.id !== id))
  }
  function add() {
    onChange([
      ...items,
      { id: uid(), name: 'Nuova opzione', daily_price: 0, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
    ])
  }

  return (
    <div className="p-5">
      <p className="text-[13px] font-medium text-[#6e6e73] mb-4">{heading}</p>

      <div className="space-y-3">
        {items.map((opt) => (
          <div
            key={opt.id}
            className="rounded-xl border border-black/[0.06] bg-[#fafafa] p-4 group"
          >
            <div className="flex items-center gap-3 mb-3">
              <input
                value={opt.name}
                onChange={(e) => patch(opt.id, { name: e.target.value })}
                placeholder="Nome opzione"
                className="flex-1 bg-transparent outline-none text-[15px] font-semibold text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:bg-white:bg-white/5 rounded-lg px-2 py-1 -mx-2 transition-colors"
              />
              <button
                onClick={() => remove(opt.id)}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center w-8 h-8 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-all"
                aria-label="Rimuovi"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <FieldBox label="€ / giorno" value={opt.daily_price} onChange={(v) => patch(opt.id, { daily_price: v })} />
              <FieldBox label="Deposito €" value={opt.mandatory_deposit} onChange={(v) => patch(opt.id, { mandatory_deposit: v })} />
              <FieldBox label="Franchigia €" value={opt.deductible_fixed} onChange={(v) => patch(opt.id, { deductible_fixed: v })} />
              <FieldBox label="Franchigia %" value={opt.deductible_percent} onChange={(v) => patch(opt.id, { deductible_percent: v })} />
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-center text-[13px] text-[#6e6e73] py-4">
            Nessuna opzione
          </p>
        )}
      </div>

      <button
        onClick={add}
        className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#007aff] hover:text-[#0066d6] transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
        </svg>
        Aggiungi opzione
      </button>
    </div>
  )
}

function FieldBox({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | ''
  onChange: (v: number | '') => void
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
        {label}
      </span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          onChange(v === '' ? '' : Number(v))
        }}
        className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
      />
    </label>
  )
}

// ========== KM & SFORO (Punto 3) ==========

function KmSforoSection({
  km,
  setKm,
}: {
  km: KmConfig[]
  setKm: (next: KmConfig[]) => void
}) {
  function patch(id: string, p: Partial<KmConfig>) {
    setKm(km.map((k) => (k.id === id ? { ...k, ...p } : k)))
  }
  function patchDay(id: string, day: string, value: number | '') {
    const target = km.find((k) => k.id === id)
    if (!target) return
    setKm(km.map((k) => (k.id === id ? { ...k, table: { ...k.table, [day]: value } } : k)))
  }

  const dayKeys = ['1', '2', '3', '4', '5']

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          Km & Sforo
        </h2>
        <p className="text-[14px] text-[#6e6e73] mt-1">
          Km inclusi per giorno, sforo e prezzo km illimitati per categoria
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {km.map((cat) => (
          <section
            key={cat.id}
            className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden flex flex-col"
          >
            <header className="px-5 pt-5 pb-3">
              <h3 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight">
                {cat.label}
              </h3>
            </header>

            <div className="px-5 pb-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-2">
                Km inclusi per giorno
              </p>
              <div className="space-y-2">
                {dayKeys.map((d) => (
                  <div key={d} className="flex items-center gap-3">
                    <span className="w-14 text-[13px] text-[#6e6e73]">
                      {d} {d === '1' ? 'giorno' : 'giorni'}
                    </span>
                    <div className="flex-1 relative">
                      <input
                        type="number"
                        min={0}
                        value={cat.table[d] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          patchDay(cat.id, d, v === '' ? '' : Number(v))
                        }}
                        className="w-full bg-[#f5f5f7] border border-black/5 rounded-lg px-3 py-2 pr-10 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
                        km
                      </span>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-3 pt-2 border-t border-black/[0.06] mt-2">
                  <span className="w-14 text-[13px] text-[#6e6e73]">
                    + giorno
                  </span>
                  <div className="flex-1 relative">
                    <input
                      type="number"
                      min={0}
                      value={cat.extraPerDay}
                      onChange={(e) => {
                        const v = e.target.value
                        patch(cat.id, { extraPerDay: v === '' ? '' : Number(v) })
                      }}
                      className="w-full bg-[#f5f5f7] border border-black/5 rounded-lg px-3 py-2 pr-10 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
                      km
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-black/[0.06] bg-[#fafafa]">
              <label className="block">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-2">
                  Sforo (€ per km oltre il limite)
                </span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[#a1a1a6] pointer-events-none">
                    €
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={cat.sforo}
                    onChange={(e) => {
                      const v = e.target.value
                      patch(cat.id, { sforo: v === '' ? '' : Number(v) })
                    }}
                    className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-14 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
                    /km
                  </span>
                </div>
              </label>
            </div>

            <div className="px-5 py-4 border-t border-black/[0.06] mt-auto space-y-3">
              {/* Label su riga dedicata — niente più wrap a 3 righe */}
              <p className="text-[12px] font-semibold text-[#1d1d1f]">
                Km illimitati — prezzo al giorno
              </p>

              {/* Toggle full-width — le due opzioni sono equiparate visivamente */}
              <div className="grid grid-cols-2 bg-gray-100 rounded-lg p-0.5 text-[12px] font-medium">
                <button
                  type="button"
                  onClick={() => patch(cat.id, { unlimitedMode: 'all_tiers' })}
                  className={`py-1.5 rounded-md transition-colors ${
                    (cat.unlimitedMode || 'all_tiers') === 'all_tiers'
                      ? 'bg-white shadow-sm text-[#1d1d1f]'
                      : 'text-[#6e6e73] hover:text-[#1d1d1f]'
                  }`}
                >Tutte le fasce</button>
                <button
                  type="button"
                  onClick={() => patch(cat.id, { unlimitedMode: 'per_fascia' })}
                  className={`py-1.5 rounded-md transition-colors ${
                    cat.unlimitedMode === 'per_fascia'
                      ? 'bg-white shadow-sm text-[#1d1d1f]'
                      : 'text-[#6e6e73] hover:text-[#1d1d1f]'
                  }`}
                >Per fascia</button>
              </div>

              {(cat.unlimitedMode || 'all_tiers') === 'all_tiers' ? (
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[16px] font-medium text-[#6e6e73] pointer-events-none">€</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0"
                    value={cat.unlimitedPerDay}
                    onChange={(e) => {
                      const v = e.target.value
                      patch(cat.id, { unlimitedPerDay: v === '' ? '' : Number(v) })
                    }}
                    className="w-full bg-white border border-black/10 rounded-lg pl-8 pr-20 py-3 text-[18px] font-semibold text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">/giorno</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {['A', 'B'].map((fid) => {
                    const val = cat.unlimitedByFascia?.[fid] ?? ''
                    return (
                      <div key={fid} className="space-y-1">
                        <label className="block text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73]">
                          Fascia {fid}
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[16px] font-medium text-[#6e6e73] pointer-events-none">€</span>
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            placeholder="0"
                            value={val}
                            onChange={(e) => {
                              const v = e.target.value
                              patch(cat.id, {
                                unlimitedByFascia: {
                                  ...(cat.unlimitedByFascia || {}),
                                  [fid]: v === '' ? '' : Number(v),
                                },
                              })
                            }}
                            className="w-full bg-white border border-black/10 rounded-lg pl-8 pr-20 py-3 text-[18px] font-semibold text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">/giorno</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

// ========== CAUZIONI (Punto 4) ==========

function CauzioniSection({
  deposits,
  setDeposits,
  fasce,
  categories,
}: {
  deposits: DepositsConfig
  setDeposits: (next: DepositsConfig) => void
  fasce: Fascia[]
  categories: Category[]
}) {
  type Scope = 'residente' | 'non_residente'
  // Categories list is dynamic — fall back to the seed list only if no
  // categories have been defined yet.
  const categoryList = categories.length > 0
    ? categories.map(c => ({ id: c.id, label: c.label }))
    : DEFAULT_DEPOSIT_CATEGORIES
  const [activeCategory, setActiveCategory] = useState<DepositsCategoryKey>(categoryList[0]?.id || 'supercars')

  // If the active category has been removed (or none yet selected), snap to first.
  useEffect(() => {
    if (!categoryList.some(c => c.id === activeCategory) && categoryList[0]) {
      setActiveCategory(categoryList[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories])

  function getCategoryConfig(cat: DepositsCategoryKey): DepositsByFascia {
    return deposits[cat] || {}
  }
  function setCategoryConfig(cat: DepositsCategoryKey, next: DepositsByFascia) {
    setDeposits({ ...deposits, [cat]: next })
  }

  function patchOption(fid: string, scope: Scope, optId: string, p: Partial<DepositOption>) {
    const catCfg = getCategoryConfig(activeCategory)
    const cur = catCfg[fid] ?? { residente: [], non_residente: [] }
    setCategoryConfig(activeCategory, {
      ...catCfg,
      [fid]: { ...cur, [scope]: cur[scope].map((o) => {
        if (o.id !== optId) return o
        const merged = { ...o, ...p }
        // If the label was edited, upgrade the id to its canonical form
        // so the rest of the system recognizes the option.
        if (p.label !== undefined) {
          const canonical = canonicalDepositId(merged.label)
          if (canonical) merged.id = canonical
        }
        return merged
      }) },
    })
  }
  function removeOption(fid: string, scope: Scope, optId: string) {
    const catCfg = getCategoryConfig(activeCategory)
    const cur = catCfg[fid] ?? { residente: [], non_residente: [] }
    setCategoryConfig(activeCategory, {
      ...catCfg,
      [fid]: { ...cur, [scope]: cur[scope].filter((o) => o.id !== optId) },
    })
  }
  function addOption(fid: string, scope: Scope) {
    const catCfg = getCategoryConfig(activeCategory)
    const cur = catCfg[fid] ?? { residente: [], non_residente: [] }
    setCategoryConfig(activeCategory, {
      ...catCfg,
      [fid]: {
        ...cur,
        [scope]: [...cur[scope], { id: uid(), label: 'Nuova opzione', amount: 0, surcharge_per_day: 0 }],
      },
    })
  }

  const activeDeposits = getCategoryConfig(activeCategory)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          Opzioni Cauzione per Categoria
        </h2>
        <p className="text-[14px] text-[#6e6e73] mt-1">
          Opzioni cauzione per categoria veicolo, fascia conducente e residenza.
          Il sito e l'admin scelgono il set giusto in base alla categoria del veicolo prenotato.
        </p>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2 border-b border-black/5 -mb-px">
        {categoryList.map((c) => {
          const isActive = c.id === activeCategory
          return (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={`px-4 py-2 text-[14px] font-medium rounded-t-lg transition-colors ${
                isActive
                  ? 'bg-white border border-black/10 border-b-white text-[#1d1d1f]'
                  : 'text-[#6e6e73] hover:text-[#1d1d1f]'
              }`}
            >
              {c.label}
            </button>
          )
        })}
      </div>

      {fasce.length === 0 && (
        <p className="text-center text-[13px] text-[#6e6e73] py-8">
          Nessuna fascia configurata. Aggiungine una in "Categorie & Fascia".
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {fasce.flatMap((f) =>
          (['residente', 'non_residente'] as Scope[]).map((scope) => {
            const groupLabel = `${f.label} — ${scope === 'residente' ? 'Residente' : 'Non Residente'}`
            const items = activeDeposits[f.id]?.[scope] ?? []
            return (
              <section
                key={`${f.id}_${scope}`}
                className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden"
              >
                <header className="px-5 pt-5 pb-3">
                  <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
                    {groupLabel}
                  </h3>
                </header>

                <ul className="divide-y divide-black/5">
                  {items.map((opt) => (
                    <li key={opt.id} className="px-5 py-3 group">
                      <div className="flex items-center gap-3 mb-2">
                        <input
                          value={opt.label}
                          onChange={(e) => patchOption(f.id, scope, opt.id, { label: e.target.value })}
                          placeholder="Nome opzione"
                          className="flex-1 bg-transparent outline-none text-[14px] font-medium text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7] rounded-lg px-2 py-1 -mx-2 transition-colors"
                        />
                        <button
                          onClick={() => removeOption(f.id, scope, opt.id)}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center w-7 h-7 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-all"
                          aria-label="Rimuovi"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                          </svg>
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
                            Importo
                          </span>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">€</span>
                            <input
                              type="number"
                              min={0}
                              value={opt.amount}
                              onChange={(e) => {
                                const v = e.target.value
                                patchOption(f.id, scope, opt.id, { amount: v === '' ? '' : Number(v) })
                              }}
                              className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                            />
                          </div>
                        </label>
                        <label className="block">
                          <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
                            Sovrapprezzo / giorno
                          </span>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">€</span>
                            <input
                              type="number"
                              min={0}
                              value={opt.surcharge_per_day}
                              onChange={(e) => {
                                const v = e.target.value
                                patchOption(f.id, scope, opt.id, { surcharge_per_day: v === '' ? '' : Number(v) })
                              }}
                              className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-10 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#a1a1a6] pointer-events-none">/g</span>
                          </div>
                        </label>
                      </div>
                    </li>
                  ))}
                  {items.length === 0 && (
                    <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73]">
                      Nessuna opzione
                    </li>
                  )}
                </ul>

                <footer className="px-5 py-3 border-t border-black/5 bg-[#fafafa]">
                  <button
                    onClick={() => addOption(f.id, scope)}
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#007aff] hover:text-[#0066d6] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Aggiungi opzione
                  </button>
                </footer>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}

// ========== SERVIZI (Punto 5) ==========

function ServiziSection({
  servizi,
  setServizi,
  fasce,
}: {
  servizi: ServiziConfig
  setServizi: (next: ServiziConfig) => void
  fasce: Fascia[]
}) {
  function patchExp(id: string, p: Partial<ExperienceService>) {
    setServizi({ ...servizi, experience: servizi.experience.map((s) => (s.id === id ? { ...s, ...p } : s)) })
  }
  function removeExp(id: string) {
    setServizi({ ...servizi, experience: servizi.experience.filter((s) => s.id !== id) })
  }
  function addExp() {
    setServizi({
      ...servizi,
      experience: [
        ...servizi.experience,
        { id: uid(), name: 'Nuovo servizio', price: 0, unit: 'per_day', is_active: true, tier_only: '' },
      ],
    })
  }

  const pickupLocations = servizi.pickup_locations ?? []
  function patchLoc(id: string, p: Partial<PickupLocation>) {
    setServizi({ ...servizi, pickup_locations: pickupLocations.map((l) => (l.id === id ? { ...l, ...p } : l)) })
  }
  function removeLoc(id: string) {
    setServizi({ ...servizi, pickup_locations: pickupLocations.filter((l) => l.id !== id) })
  }
  function addLoc() {
    setServizi({
      ...servizi,
      pickup_locations: [
        ...pickupLocations,
        { id: uid(), label: 'Nuovo luogo', km: 0, is_active: true },
      ],
    })
  }
  const deliveryRate = typeof servizi.delivery.price_per_km === 'number' ? servizi.delivery.price_per_km : 0

  return (
    <div className="space-y-6">
      {/* Servizi Experience */}
      <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <header className="px-5 pt-5 pb-3 flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <input
              value={servizi.experience_title ?? 'Servizi Experience'}
              onChange={(e) => setServizi({ ...servizi, experience_title: e.target.value })}
              className="w-full bg-transparent outline-none text-[17px] font-semibold text-[#1d1d1f] tracking-tight focus:bg-[#f5f5f7] rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors"
              placeholder="Titolo sezione"
            />
            <input
              value={servizi.experience_subtitle ?? 'Servizi extra opzionali'}
              onChange={(e) => setServizi({ ...servizi, experience_subtitle: e.target.value })}
              className="w-full bg-transparent outline-none text-[13px] text-[#6e6e73] mt-0.5 focus:bg-[#f5f5f7] rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors"
              placeholder="Sottotitolo"
            />
          </div>
          <button
            onClick={addExp}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#007aff] hover:text-[#0066d6] transition-colors shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Aggiungi servizio
          </button>
        </header>

        <ul className="divide-y divide-black/5">
          {servizi.experience.map((s) => (
            <li key={s.id} className="px-5 py-3 group">
              <div className="flex items-center gap-3 flex-wrap">
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={s.is_active}
                    onChange={(e) => patchExp(s.id, { is_active: e.target.checked })}
                    className="w-4 h-4 accent-[#007aff]"
                  />
                </label>
                <input
                  value={s.name}
                  onChange={(e) => patchExp(s.id, { name: e.target.value })}
                  placeholder="Nome servizio"
                  className="flex-1 min-w-[200px] bg-transparent outline-none text-[14px] font-medium text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7]:bg-white/5 rounded-lg px-2 py-1.5 -mx-2 transition-colors"
                />
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">
                    €
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={s.price}
                    onChange={(e) => {
                      const v = e.target.value
                      patchExp(s.id, { price: v === '' ? '' : Number(v) })
                    }}
                    className="w-24 bg-white border border-black/10 rounded-lg pl-7 pr-2 py-1.5 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                  />
                </div>
                <select
                  value={s.unit}
                  onChange={(e) => patchExp(s.id, { unit: e.target.value as ServiceUnit })}
                  className="bg-white border border-black/10 rounded-lg px-3 py-1.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                >
                  {(Object.keys(UNIT_LABELS) as ServiceUnit[]).map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABELS[u]}
                    </option>
                  ))}
                </select>
                <select
                  value={s.tier_only}
                  onChange={(e) => patchExp(s.id, { tier_only: e.target.value })}
                  className="bg-white border border-black/10 rounded-lg px-3 py-1.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                >
                  <option value="">Tutte le fasce</option>
                  {fasce.map((f) => (
                    <option key={f.id} value={f.id}>Solo {f.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => removeExp(s.id)}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center w-8 h-8 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-all"
                  aria-label="Rimuovi"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
          {servizi.experience.length === 0 && (
            <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73]">
              Nessun servizio
            </li>
          )}
        </ul>
      </section>

      {/* DR7 Flex — deletable block (toggle enabled). When disabled the block
           collapses to a one-line "Riattiva" placeholder and the website wizard
           hides the option entirely (read via configOverlay.dr7Flex.enabled). */}
      {servizi.dr7_flex.enabled === false ? (
        <section className="bg-white rounded-2xl border border-dashed border-black/15 shadow-sm overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between gap-3">
            <div className="text-[13px] text-[#6e6e73]">
              <strong className="text-[#1d1d1f]">{servizi.dr7_flex_title ?? 'DR7 Flex — Cancellazione Premium'}</strong> — disattivato.
            </div>
            <button
              onClick={() => setServizi({ ...servizi, dr7_flex: { ...servizi.dr7_flex, enabled: true } })}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#007aff] hover:text-[#0066d6] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Riattiva
            </button>
          </div>
        </section>
      ) : (
      <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <header className="px-5 pt-5 pb-3 flex items-center justify-between gap-3">
          <input
            value={servizi.dr7_flex_title ?? 'DR7 Flex — Cancellazione Premium'}
            onChange={(e) => setServizi({ ...servizi, dr7_flex_title: e.target.value })}
            className="flex-1 bg-transparent outline-none text-[17px] font-semibold text-[#1d1d1f] tracking-tight focus:bg-[#f5f5f7] rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors"
            placeholder="Titolo sezione"
          />
          <button
            onClick={() => {
              if (confirm('Rimuovere il blocco DR7 Flex? Non sarà più offerto in fase di prenotazione (potrai sempre riattivarlo).')) {
                setServizi({ ...servizi, dr7_flex: { ...servizi.dr7_flex, enabled: false } })
              }
            }}
            className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-all shrink-0"
            aria-label="Rimuovi blocco DR7 Flex"
            title="Rimuovi blocco"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
            </svg>
          </button>
        </header>

        <div className="px-5 pb-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
                Prezzo / giorno
              </span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">
                  €
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={servizi.dr7_flex.daily_price}
                  onChange={(e) => {
                    const v = e.target.value
                    setServizi({ ...servizi, dr7_flex: { ...servizi.dr7_flex, daily_price: v === '' ? '' : Number(v) } })
                  }}
                  className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                />
              </div>
            </label>
            <label className="block">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
                Rimborso
              </span>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={servizi.dr7_flex.refund_percent}
                  onChange={(e) => {
                    const v = e.target.value
                    setServizi({ ...servizi, dr7_flex: { ...servizi.dr7_flex, refund_percent: v === '' ? '' : Number(v) } })
                  }}
                  className="w-full bg-white border border-black/10 rounded-lg pl-3 pr-8 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">
                  %
                </span>
              </div>
            </label>
            <label className="block">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
                Disponibile per
              </span>
              <select
                value={servizi.dr7_flex.tier_restriction}
                onChange={(e) =>
                  setServizi({ ...servizi, dr7_flex: { ...servizi.dr7_flex, tier_restriction: e.target.value } })
                }
                className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              >
                <option value="">Tutte le fasce</option>
                {fasce.map((f) => (
                  <option key={f.id} value={f.id}>Solo {f.label}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
              Descrizione
            </span>
            <input
              value={servizi.dr7_flex.description}
              onChange={(e) => setServizi({ ...servizi, dr7_flex: { ...servizi.dr7_flex, description: e.target.value } })}
              className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
          </label>
        </div>
      </section>
      )}

      {/* Simple services: 3-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Pulizia Finale */}
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          <input
            value={servizi.lavaggio_title ?? 'Pulizia Finale'}
            onChange={(e) => setServizi({ ...servizi, lavaggio_title: e.target.value })}
            className="w-full bg-transparent outline-none text-[15px] font-semibold text-[#1d1d1f] mb-3 focus:bg-[#f5f5f7] rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors"
            placeholder="Titolo"
          />
          <label className="block mb-3">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
              Tariffa
            </span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">
                €
              </span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={servizi.lavaggio.fee}
                onChange={(e) => {
                  const v = e.target.value
                  setServizi({ ...servizi, lavaggio: { ...servizi.lavaggio, fee: v === '' ? '' : Number(v) } })
                }}
                className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              />
            </div>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={servizi.lavaggio.mandatory}
              onChange={(e) => setServizi({ ...servizi, lavaggio: { ...servizi.lavaggio, mandatory: e.target.checked } })}
              className="w-4 h-4 accent-[#007aff]"
            />
            <span className="text-[13px] text-[#1d1d1f]">Obbligatoria</span>
          </label>
        </section>

        {/* Consegna a Domicilio */}
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          <input
            value={servizi.delivery_title ?? 'Consegna a Domicilio'}
            onChange={(e) => setServizi({ ...servizi, delivery_title: e.target.value })}
            className="w-full bg-transparent outline-none text-[15px] font-semibold text-[#1d1d1f] mb-3 focus:bg-[#f5f5f7] rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors"
            placeholder="Titolo"
          />
          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
              Prezzo per km
            </span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">
                €
              </span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={servizi.delivery.price_per_km}
                onChange={(e) => {
                  const v = e.target.value
                  setServizi({ ...servizi, delivery: { price_per_km: v === '' ? '' : Number(v) } })
                }}
                className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-12 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
                /km
              </span>
            </div>
          </label>
        </section>

        {/* Secondo Guidatore */}
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          <input
            value={servizi.second_driver_title ?? 'Secondo Guidatore'}
            onChange={(e) => setServizi({ ...servizi, second_driver_title: e.target.value })}
            className="w-full bg-transparent outline-none text-[15px] font-semibold text-[#1d1d1f] mb-3 focus:bg-[#f5f5f7] rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors"
            placeholder="Titolo"
          />
          <div className="space-y-2">
            {fasce.map((f) => (
              <div key={f.id} className="flex items-center gap-3">
                <span className="w-20 text-[13px] text-[#6e6e73] truncate">{f.label}</span>
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">€</span>
                  <input
                    type="number"
                    min={0}
                    value={servizi.second_driver[f.id] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setServizi({
                        ...servizi,
                        second_driver: { ...servizi.second_driver, [f.id]: v === '' ? '' : Number(v) },
                      })
                    }}
                    className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-10 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">/g</span>
                </div>
              </div>
            ))}
            {fasce.length === 0 && (
              <p className="text-center text-[13px] text-[#6e6e73] py-2">
                Nessuna fascia configurata
              </p>
            )}
          </div>
        </section>

        {/* Luoghi di Ritiro */}
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden md:col-span-2">
          <header className="px-5 pt-5 pb-3 flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <input
                value={servizi.pickup_locations_title ?? 'Luoghi di Ritiro'}
                onChange={(e) => setServizi({ ...servizi, pickup_locations_title: e.target.value })}
                className="w-full bg-transparent outline-none text-[15px] font-semibold text-[#1d1d1f] focus:bg-[#f5f5f7] rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors"
                placeholder="Titolo"
              />
            </div>
            <button
              onClick={addLoc}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#007aff] hover:text-[#0066d6] transition-colors shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Aggiungi luogo
            </button>
          </header>

          <ul className="divide-y divide-black/5">
            {pickupLocations.map((loc) => {
              const km = typeof loc.km === 'number' ? loc.km : 0
              const fee = Math.round(km * deliveryRate * 100) / 100
              return (
                <li key={loc.id} className="px-5 py-3 group">
                  <div className="flex items-start gap-3 flex-wrap">
                    <label className="inline-flex items-center cursor-pointer mt-2.5">
                      <input
                        type="checkbox"
                        checked={loc.is_active}
                        onChange={(e) => patchLoc(loc.id, { is_active: e.target.checked })}
                        className="w-4 h-4 accent-[#007aff]"
                      />
                    </label>
                    <div className="flex-1 min-w-[260px]">
                      <AddressAutocomplete
                        value={loc.label}
                        onChange={(val) => patchLoc(loc.id, { label: val })}
                        onSelectParts={(parts) => {
                          // Geocode hit → recompute road km from DR7 office
                          // automatically. Admin can still override the km
                          // value below if they know better than the geodesic
                          // estimate (e.g. ferry routes, long detours).
                          if (parts.lat != null && parts.lon != null) {
                            const computedKm = kmFromDR7Office({ lat: parts.lat, lon: parts.lon })
                            patchLoc(loc.id, { label: parts.full, km: computedKm })
                          } else {
                            patchLoc(loc.id, { label: parts.full })
                          }
                        }}
                        placeholder="Aeroporto, hotel, indirizzo..."
                        className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                      />
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={loc.km}
                        onChange={(e) => {
                          const v = e.target.value
                          patchLoc(loc.id, { km: v === '' ? '' : Number(v) })
                        }}
                        className="w-28 bg-white border border-black/10 rounded-lg pl-3 pr-10 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                        title="Calcolato dall'indirizzo (modificabile)"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">km</span>
                    </div>
                    <span className="text-[13px] tabular-nums text-[#6e6e73] min-w-[80px] text-right mt-2.5">
                      = €{fee.toFixed(2)}
                    </span>
                    <button
                      onClick={() => removeLoc(loc.id)}
                      className="text-[13px] text-[#ff3b30] hover:text-[#d70015] transition-colors opacity-0 group-hover:opacity-100 mt-2.5"
                    >
                      Rimuovi
                    </button>
                  </div>
                </li>
              )
            })}
            {pickupLocations.length === 0 && (
              <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73]">
                Nessun luogo configurato. L&rsquo;ufficio DR7 e il domicilio restano sempre disponibili.
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}

function diffCoeffRows(label: string, cur: CoefficientRow[], prev: CoefficientRow[], out: string[]) {
  const prevIds = new Set(prev.map((r) => r.id))
  const curIds = new Set(cur.map((r) => r.id))
  cur.forEach((r) => {
    if (!prevIds.has(r.id)) out.push(`Coefficienti ${label}: aggiunta "${r.label || 'Nuova riga'}"`)
  })
  prev.forEach((r) => {
    if (!curIds.has(r.id)) out.push(`Coefficienti ${label}: rimossa "${r.label}"`)
  })
  cur.forEach((r) => {
    const p = prev.find((x) => x.id === r.id)
    if (!p) return
    if (p.min !== r.min || p.max !== r.max) out.push(`Coefficienti ${label} / ${r.label}: range ${p.min}-${p.max} → ${r.min}-${r.max}`)
    if (p.coeff !== r.coeff) out.push(`Coefficienti ${label} / ${r.label}: coefficiente ${p.coeff} → ${r.coeff}`)
    if (p.label !== r.label) out.push(`Coefficienti ${label}: "${p.label}" rinominata in "${r.label}"`)
  })
}

// ========== PREZZO DINAMICO (Punto 6) ==========

function PrezzoDinamicoSection({
  config,
  setConfig,
}: {
  config: PrezzoDinamicoConfig
  setConfig: (next: PrezzoDinamicoConfig) => void
}) {
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([])
  const [vehiclesLoading, setVehiclesLoading] = useState(true)
  // Current-month revenue per vehicle, computed by the Report (same source of
  // truth as what admins see under Reports). Drives the "raggiunto" indicator
  // next to the per-vehicle monthly target.
  const [vehicleRevenues, setVehicleRevenues] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('vehicles')
        .select('id, display_name, daily_rate, category, plate')
        .neq('status', 'retired')
        .order('display_name')
      if (!cancelled) {
        setVehicles((data as FleetVehicle[]) || [])
        setVehiclesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Load current-month revenue per vehicle from monthly-report (same calc the
  // admin sees under Reports → Utilizzo Flotta).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const now = new Date()
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        const res = await fetch(`/.netlify/functions/monthly-report?type=vehicles&month=${ym}`)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled || !data?.vehicles) return
        const map: Record<string, number> = {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data.vehicles.forEach((v: any) => {
          if (v.vehicleId) map[v.vehicleId] = typeof v.totalRevenue === 'number' ? v.totalRevenue : 0
        })
        setVehicleRevenues(map)
      } catch {
        // non-blocking: the UI falls back to a plain "—" for revenue
      }
    })()
    return () => { cancelled = true }
  }, [])

  function patchDyn(p: Partial<DynamicPricingConfig>) {
    setConfig({ ...config, dynamic: { ...config.dynamic, ...p } })
  }
  function patchPrice(scope: 'base_prices' | 'min_prices' | 'max_prices', key: string, value: number | '') {
    patchDyn({ [scope]: { ...config.dynamic[scope], [key]: value } } as Partial<DynamicPricingConfig>)
  }

  return (
    <div className="space-y-8">
      {/* ─── REVENUE ENGINE ─── */}
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          Revenue Engine — Pricing Dinamico
        </h2>
        <p className="text-[14px] text-[#6e6e73] mt-1 mb-5">
          Prezzi dinamici, coefficienti e limiti min/max
        </p>

        {/* Enabled + Mode */}
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-4">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.dynamic.enabled}
                onChange={(e) => patchDyn({ enabled: e.target.checked })}
                className="w-5 h-5 accent-[#007aff]"
              />
              <span className="text-[15px] font-semibold text-[#1d1d1f]">
                Revenue Management attivo
              </span>
            </label>
            <div className="flex-1" />
            <label className="flex items-center gap-2 text-[13px] text-[#6e6e73]">
              <span>Modalita</span>
              <select
                value={config.dynamic.mode}
                onChange={(e) => patchDyn({ mode: e.target.value as DynamicMode })}
                className="bg-white border border-black/10 rounded-lg px-3 py-1.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              >
                <option value="disabled">Disabilitato</option>
                <option value="suggestion">Suggerimento</option>
                <option value="auto_apply">Applicazione automatica</option>
              </select>
            </label>
          </div>
        </section>

        {/* Prezzi Base + Limiti Min/Max — per veicolo */}
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden mb-4">
          <header className="px-5 pt-5 pb-3">
            <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
              Prezzi Base + Limiti per Veicolo
            </h3>
            <p className="text-[13px] text-[#6e6e73] mt-0.5">
              Override del prezzo base e vincoli min/max applicati dopo i coefficienti — per ogni veicolo della flotta
            </p>
          </header>
          <div className="px-5 pb-5 space-y-3">
            <div className="grid grid-cols-[2fr_repeat(3,minmax(0,1fr))] gap-2 items-center text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] px-1">
              <span>Veicolo</span>
              <span className="text-right">Prezzo Base €/g</span>
              <span className="text-right">Min €/g</span>
              <span className="text-right">Max €/g</span>
            </div>
            {vehiclesLoading && (
              <p className="text-center text-[13px] text-[#6e6e73] py-4">
                Caricamento flotta…
              </p>
            )}
            {!vehiclesLoading && vehicles.length === 0 && (
              <p className="text-center text-[13px] text-[#6e6e73] py-4">
                Nessun veicolo nella flotta
              </p>
            )}
            <div className="max-h-[600px] overflow-y-auto -mx-1 px-1 space-y-6">
              {(
                [
                  { key: 'exotic', label: 'Supercars', match: ['exotic', 'supercars'] },
                  { key: 'urban', label: 'Urban', match: ['urban'] },
                  { key: 'aziendali', label: 'Aziendali', match: ['aziendali', 'furgone', 'ncc'] },
                ] as const
              ).map((group) => {
                const vs = vehicles.filter((v) =>
                  (group.match as readonly string[]).includes((v.category ?? 'exotic').toLowerCase())
                )
                if (vs.length === 0) return null
                return (
                  <div key={group.key}>
                    <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[#6e6e73] mb-2 px-1 sticky top-0 bg-white py-1 z-10">
                      {group.label} <span className="text-[#a1a1a6] font-normal">· {vs.length}</span>
                    </h4>
                    <div className="space-y-2">
                      {vs.map((v) => (
                        <div key={v.id} className="grid grid-cols-[2fr_repeat(3,minmax(0,1fr))] gap-2 items-center">
                          <div className="min-w-0">
                            <div className="text-[14px] text-[#1d1d1f] font-medium truncate">{v.display_name}</div>
                            {v.daily_rate != null && (
                              <div className="text-[11px] text-[#a1a1a6]">listino €{v.daily_rate}/g</div>
                            )}
                          </div>
                          <PriceBox
                            value={config.dynamic.base_prices[v.id] ?? ''}
                            onChange={(val) => patchPrice('base_prices', v.id, val)}
                            placeholder="—"
                          />
                          <PriceBox
                            value={config.dynamic.min_prices[v.id] ?? ''}
                            onChange={(val) => patchPrice('min_prices', v.id, val)}
                          />
                          <PriceBox
                            value={config.dynamic.max_prices[v.id] ?? ''}
                            onChange={(val) => patchPrice('max_prices', v.id, val)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
              {(() => {
                const known = new Set(['exotic', 'supercars', 'urban', 'aziendali', 'furgone', 'ncc'])
                const others = vehicles.filter((v) => !known.has((v.category ?? 'exotic').toLowerCase()))
                if (others.length === 0) return null
                return (
                  <div>
                    <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[#6e6e73] mb-2 px-1 sticky top-0 bg-white py-1 z-10">
                      Altre categorie <span className="text-[#a1a1a6] font-normal">· {others.length}</span>
                    </h4>
                    <div className="space-y-2">
                      {others.map((v) => (
                        <div key={v.id} className="grid grid-cols-[2fr_repeat(3,minmax(0,1fr))] gap-2 items-center">
                          <div className="min-w-0">
                            <div className="text-[14px] text-[#1d1d1f] font-medium truncate">{v.display_name}</div>
                            <div className="text-[11px] text-[#a1a1a6]">
                              {v.category ?? '—'}
                              {v.daily_rate != null && <> · listino €{v.daily_rate}/g</>}
                            </div>
                          </div>
                          <PriceBox
                            value={config.dynamic.base_prices[v.id] ?? ''}
                            onChange={(val) => patchPrice('base_prices', v.id, val)}
                            placeholder="—"
                          />
                          <PriceBox
                            value={config.dynamic.min_prices[v.id] ?? ''}
                            onChange={(val) => patchPrice('min_prices', v.id, val)}
                          />
                          <PriceBox
                            value={config.dynamic.max_prices[v.id] ?? ''}
                            onChange={(val) => patchPrice('max_prices', v.id, val)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </section>

        {/* Coefficienti */}
        <div className="space-y-4">
          <CoefficientTable
            title="Coefficienti Occupazione"
            subtitle="Moltiplicatore basato sulla % di occupazione della flotta"
            unit="%"
            rows={config.dynamic.occupation_coefficients}
            onChange={(rows) => patchDyn({ occupation_coefficients: rows })}
          />
          <CoefficientTable
            title="Coefficienti Anticipo"
            subtitle="Moltiplicatore basato sui giorni di anticipo della prenotazione"
            unit="giorni"
            rows={config.dynamic.advance_coefficients}
            onChange={(rows) => patchDyn({ advance_coefficients: rows })}
          />
          <CoefficientTable
            title="Coefficienti Durata"
            subtitle="Moltiplicatore basato sulla durata del noleggio"
            unit="giorni"
            rows={config.dynamic.duration_coefficients}
            onChange={(rows) => patchDyn({ duration_coefficients: rows })}
          />
          <CoefficientTable
            title="Coefficienti Gap Calendario"
            subtitle="Vendi giorni isolati tra due prenotazioni a prezzo ridotto — lavora tutti i giorni"
            unit="giorni"
            rows={config.dynamic.calendar_gap_coefficients}
            onChange={(rows) => patchDyn({ calendar_gap_coefficients: rows })}
          />

          {/* Named-bucket coefficient groups (Stagione / Tipo Giorno / Veicolo / Promo) */}
          <NamedCoefficientTable
            title="Coefficienti Stagione"
            subtitle="Contesto generale dell'anno — si combina con occupazione e domanda reale"
            rows={config.dynamic.season_coefficients}
            onChange={(rows) => patchDyn({ season_coefficients: rows })}
          />
          <SeasonByMonthSection
            seasonByMonth={config.dynamic.season_by_month}
            seasonTiers={config.dynamic.season_coefficients}
            onChange={(map) => patchDyn({ season_by_month: map })}
          />
          <NamedCoefficientTable
            title="Coefficienti Tipo Giorno"
            subtitle="Giorno della settimana + prefestivi / ponti / eventi / festività"
            rows={config.dynamic.day_type_coefficients}
            onChange={(rows) => patchDyn({ day_type_coefficients: rows })}
          />
          <SpecialPeriodsSection
            periods={config.dynamic.special_periods}
            dayTypeTiers={config.dynamic.day_type_coefficients}
            onChange={(next) => patchDyn({ special_periods: next })}
          />
          <NamedCoefficientTable
            title="Coefficienti Occupazione Veicolo"
            subtitle="Correzione del singolo mezzo rispetto alla media della categoria"
            rows={config.dynamic.vehicle_occupation_coefficients}
            onChange={(rows) => patchDyn({ vehicle_occupation_coefficients: rows })}
          />

          {/* Promo push (named tiers + live level selector) + per-vehicle targets */}
          <PromoPushSection
            coefficients={config.dynamic.promo_push_coefficients}
            activeLevel={config.dynamic.active_promo_level}
            onChangeCoefficients={(rows) => patchDyn({ promo_push_coefficients: rows })}
            onChangeActiveLevel={(level) => patchDyn({ active_promo_level: level })}
            vehicles={vehicles}
            vehicleTargets={config.dynamic.vehicle_revenue_targets}
            onChangeVehicleTargets={(map) => patchDyn({ vehicle_revenue_targets: map })}
            vehicleRevenues={vehicleRevenues}
          />

          {/* Operating mode (Riempimento / Equilibrio / Protezione / Auto) */}
          <OperatingModeSection
            mode={config.dynamic.operating_mode}
            onChange={(mode) => patchDyn({ operating_mode: mode })}
          />

          {/* Target occupazione per classe × finestra temporale */}
          <OccupancyTargetsSection
            targets={config.dynamic.occupancy_targets}
            onChange={(targets) => patchDyn({ occupancy_targets: targets })}
          />
        </div>
      </div>
    </div>
  )
}

// ── Named-bucket coefficient table (key + label + coeff, no min/max) ──
function NamedCoefficientTable({
  title, subtitle, rows, onChange,
}: {
  title: string
  subtitle: string
  rows: NamedCoeff[]
  onChange: (rows: NamedCoeff[]) => void
}) {
  function patchRow(idx: number, patch: Partial<NamedCoeff>) {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    onChange(next)
  }
  function addRow() {
    onChange([...rows, { key: `custom_${rows.length + 1}`, label: 'Nuova voce', coeff: 1 }])
  }
  function removeRow(idx: number) {
    onChange(rows.filter((_, i) => i !== idx))
  }

  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
      <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">{title}</h3>
      <p className="text-[13px] text-[#6e6e73] mt-0.5 mb-3">{subtitle}</p>
      <div className="grid grid-cols-[1fr_100px_40px] gap-2 items-center text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] px-1 mb-1">
        <span>Etichetta</span>
        <span className="text-right">Coeff.</span>
        <span />
      </div>
      <div className="space-y-2">
        {rows.map((r, idx) => (
          <div key={r.key + idx} className="grid grid-cols-[1fr_100px_40px] gap-2 items-center">
            <input
              type="text"
              value={r.label}
              onChange={(e) => patchRow(idx, { label: e.target.value })}
              className="bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
            <input
              type="number"
              step={0.01}
              value={r.coeff}
              onChange={(e) => patchRow(idx, { coeff: e.target.value === '' ? '' : Number(e.target.value) })}
              className="bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
            <button
              type="button"
              onClick={() => removeRow(idx)}
              title="Rimuovi"
              className="text-[#ff3b30] hover:bg-red-50 rounded-lg h-9 w-9 flex items-center justify-center"
            >
              −
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addRow}
        className="mt-3 text-[#007aff] text-[13px] font-medium hover:underline"
      >
        + Aggiungi voce
      </button>
    </section>
  )
}

// ── Promo Push with active-level selector ──
function PromoPushSection({
  coefficients, activeLevel, onChangeCoefficients, onChangeActiveLevel,
  vehicles, vehicleTargets, onChangeVehicleTargets, vehicleRevenues,
}: {
  coefficients: NamedCoeff[]
  activeLevel: string
  onChangeCoefficients: (rows: NamedCoeff[]) => void
  onChangeActiveLevel: (level: string) => void
  vehicles: FleetVehicle[]
  vehicleTargets: Record<string, VehicleRevenueTarget>
  onChangeVehicleTargets: (map: Record<string, VehicleRevenueTarget>) => void
  vehicleRevenues: Record<string, number>
}) {
  function getTiers(vid: string): VehicleRevenueTier[] {
    return vehicleTargets[vid]?.tiers || []
  }

  function commitTiers(vid: string, nextTiers: VehicleRevenueTier[]) {
    // Keep empty tiers as-is while the admin is editing — an all-empty row is
    // simply a newly-added threshold waiting for input. The engine already skips
    // half-configured tiers at runtime, so there's no risk of them affecting
    // pricing. Admins remove unwanted rows explicitly via the "−" button.
    if (nextTiers.length === 0) {
      const { [vid]: _drop, ...rest } = vehicleTargets
      void _drop
      onChangeVehicleTargets(rest)
    } else {
      onChangeVehicleTargets({ ...vehicleTargets, [vid]: { tiers: nextTiers } })
    }
  }

  function patchTier(vid: string, idx: number, p: Partial<VehicleRevenueTier>) {
    const prev = getTiers(vid)
    const next = prev.map((t, i) => (i === idx ? { ...t, ...p } : t))
    commitTiers(vid, next)
  }

  function addTier(vid: string) {
    const prev = getTiers(vid)
    commitTiers(vid, [...prev, { min_revenue: '', coeff: '' }])
  }

  function removeTier(vid: string, idx: number) {
    const prev = getTiers(vid)
    commitTiers(vid, prev.filter((_, i) => i !== idx))
  }

  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
      <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
        Coefficienti Spinta Direzionale (Promo)
      </h3>
      <p className="text-[13px] text-[#6e6e73] mt-0.5 mb-3">
        Moltiplicatore per campagne e promo — attivalo solo quando serve.
      </p>
      <label className="block mb-4">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
          Livello attivo adesso
        </span>
        <select
          value={activeLevel}
          onChange={(e) => onChangeActiveLevel(e.target.value)}
          className="bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
        >
          <option value="">Nessuna promo (coeff. 1,00)</option>
          {coefficients.map((c) => (
            <option key={c.key} value={c.key}>{c.label} — {typeof c.coeff === 'number' ? c.coeff.toFixed(2) : c.coeff}</option>
          ))}
        </select>
      </label>
      <NamedCoefficientTable
        title=""
        subtitle=""
        rows={coefficients}
        onChange={onChangeCoefficients}
      />

      {/* Per-vehicle monthly revenue target → coefficient */}
      <div className="mt-6 pt-5 border-t border-black/5">
        <h4 className="text-[14px] font-semibold text-[#1d1d1f] tracking-tight">
          Obiettivo Mensile per Veicolo
        </h4>
        <p className="text-[12px] text-[#6e6e73] mt-0.5 mb-3">
          Quando un veicolo raggiunge la soglia di incasso mensile nel mese del noleggio (es. preventivo per agosto → controlla l'incasso di agosto), il coefficiente moltiplica la tariffa. La soglia piu' alta raggiunta vince. Si combina con la promo globale qui sopra.
        </p>

        {vehicles.length === 0 ? (
          <p className="text-[13px] text-[#a1a1a6] py-3 text-center border border-dashed border-black/10 rounded-lg">
            Nessun veicolo nella flotta.
          </p>
        ) : (
          <div className="max-h-[600px] overflow-y-auto -mx-1 px-1 space-y-4">
            {vehicles.map(v => {
              const tiers = getTiers(v.id)
              const currentRevenue = vehicleRevenues[v.id]
              const hasRevenue = typeof currentRevenue === 'number'
              // Highest reached tier (for live "active" indicator).
              const configuredTiers = tiers
                .map((t, i) => ({ idx: i, min: typeof t.min_revenue === 'number' ? t.min_revenue : null, coeff: typeof t.coeff === 'number' ? t.coeff : null }))
                .filter(t => t.min !== null && t.coeff !== null && (t.min as number) > 0 && (t.coeff as number) > 0)
              const reachedIdx = hasRevenue
                ? configuredTiers
                    .filter(t => (currentRevenue as number) >= (t.min as number))
                    .sort((a, b) => (b.min as number) - (a.min as number))[0]?.idx
                : undefined

              return (
                <div key={v.id} className="rounded-xl border border-black/5 p-3">
                  {/* Header row: vehicle + live monthly revenue */}
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="text-[14px] text-[#1d1d1f] font-semibold truncate">{v.display_name}</div>
                      <div className="text-[11px] text-[#a1a1a6] font-mono">{v.plate || '— senza targa'}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] uppercase tracking-wide text-[#a1a1a6]">Incasso mese corrente</div>
                      <div className="text-[14px] text-[#1d1d1f] font-semibold tabular-nums">
                        {hasRevenue ? `€${(currentRevenue as number).toFixed(0)}` : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Tier list */}
                  {tiers.length === 0 ? (
                    <p className="text-[12px] text-[#a1a1a6] py-2 text-center border border-dashed border-black/10 rounded-lg">
                      Nessuna soglia configurata — clicca "+" per aggiungerne una.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center text-[10px] font-medium uppercase tracking-wide text-[#a1a1a6] px-1">
                        <span>Incasso minimo (€)</span>
                        <span className="text-right">Coeff.</span>
                        <span></span>
                      </div>
                      {tiers.map((t, idx) => {
                        const isReached = reachedIdx === idx
                        return (
                          <div
                            key={idx}
                            className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center ${isReached ? 'rounded-md bg-green-50 px-1 py-0.5' : ''}`}
                          >
                            <PriceBox
                              value={t.min_revenue}
                              onChange={(val) => patchTier(v.id, idx, { min_revenue: val })}
                              placeholder="—"
                            />
                            <CoeffBox
                              value={t.coeff}
                              onChange={(val) => patchTier(v.id, idx, { coeff: val })}
                            />
                            <button
                              type="button"
                              onClick={() => removeTier(v.id, idx)}
                              className="text-[#ff3b30] hover:text-[#d70015] text-[18px] px-2 leading-none"
                              aria-label="Rimuovi soglia"
                            >−</button>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Add tier button */}
                  <button
                    type="button"
                    onClick={() => addTier(v.id)}
                    className="mt-2 inline-flex items-center gap-1 text-[13px] text-[#007aff] hover:text-[#0051d5]"
                  >
                    <span className="text-[16px] leading-none">+</span>
                    <span>Aggiungi soglia</span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

// ── Operating mode ──
function OperatingModeSection({
  mode, onChange,
}: {
  mode: OperatingMode
  onChange: (mode: OperatingMode) => void
}) {
  const options: { value: OperatingMode; label: string; hint: string }[] = [
    { value: 'auto', label: 'Auto', hint: 'Il sistema sceglie la modalità in base ai target' },
    { value: 'riempimento', label: 'Riempimento', hint: 'Occupazione sotto target — prezzi aggressivi, gap + promo attive' },
    { value: 'equilibrio', label: 'Equilibrio', hint: 'Occupazione in linea — prezzo stabile, promo limitate' },
    { value: 'protezione', label: 'Protezione', hint: 'Occupazione alta — aumento prezzi, nessuna promo' },
  ]
  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
      <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">Modalità Operativa</h3>
      <p className="text-[13px] text-[#6e6e73] mt-0.5 mb-3">
        Strategia globale corrente del revenue engine.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {options.map((o) => (
          <label
            key={o.value}
            className={`cursor-pointer rounded-xl border p-3 transition-colors ${
              mode === o.value ? 'border-[#007aff] bg-[#007aff]/5' : 'border-black/10 hover:border-black/20'
            }`}
          >
            <input
              type="radio"
              name="operating-mode"
              value={o.value}
              checked={mode === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            <div className="font-semibold text-[14px] text-[#1d1d1f]">{o.label}</div>
            <div className="text-[12px] text-[#6e6e73] mt-1">{o.hint}</div>
          </label>
        ))}
      </div>
    </section>
  )
}

// ── Target occupancy per vehicle class × advance window ──
// ── Month → Season tier mapping ──
function SeasonByMonthSection({
  seasonByMonth, seasonTiers, onChange,
}: {
  seasonByMonth: Record<string, string>
  seasonTiers: NamedCoeff[]
  onChange: (map: Record<string, string>) => void
}) {
  const months = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
  ]
  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
      <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
        Stagione per Mese
      </h3>
      <p className="text-[13px] text-[#6e6e73] mt-0.5 mb-3">
        Quale tier di stagione applicare a ogni mese. Il coefficiente arriva dalla tabella sopra.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-5 gap-y-2">
        {months.map((name, i) => {
          const m = String(i + 1)
          const currentTier = seasonByMonth[m] || ''
          const tierData = seasonTiers.find(t => t.key === currentTier)
          const badgeClass = tierData && typeof tierData.coeff === 'number'
            ? tierData.coeff < 1 ? 'bg-green-100 text-green-700'
            : tierData.coeff > 1 ? 'bg-red-100 text-red-700'
            : 'bg-gray-100 text-gray-600'
            : 'bg-gray-100 text-gray-400'
          return (
            <div key={m} className="py-2 border-b border-black/5 last:border-0">
              {/* Header row: month name + coefficient badge */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[13px] text-black font-semibold">{name}</span>
                <span className={`shrink-0 inline-flex items-center justify-center min-w-[48px] px-2 py-0.5 rounded-md text-[11px] font-bold tabular-nums ${badgeClass}`}>
                  {tierData && typeof tierData.coeff === 'number' ? `×${tierData.coeff.toFixed(2)}` : '—'}
                </span>
              </div>
              {/* Select full-width on its own line */}
              <select
                value={currentTier}
                onChange={(e) => onChange({ ...seasonByMonth, [m]: e.target.value })}
                className="w-full bg-white border border-black/10 rounded-lg px-2 py-1.5 text-[13px] text-black font-medium focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              >
                <option value="">— (nessuna)</option>
                {seasonTiers.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Date → Day-type tier classification ──
// Weekdays (Lunedì…Domenica) are auto-inferred from each date's day-of-week.
// This section is for calling out SPECIFIC dates that are NOT plain weekdays:
// prefestivo / ponte / evento / festività. Weekday tiers are filtered out of
// the dropdown so the admin only picks relevant categories.
function SpecialPeriodsSection({
  periods, dayTypeTiers, onChange,
}: {
  periods: SpecialPeriod[]
  dayTypeTiers: NamedCoeff[]
  onChange: (next: SpecialPeriod[]) => void
}) {
  const WEEKDAY_KEYS = new Set([
    'monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday',
  ])
  const specialTiers = dayTypeTiers.filter(t => !WEEKDAY_KEYS.has(t.key))

  function patch(idx: number, p: Partial<SpecialPeriod>) {
    onChange(periods.map((row, i) => (i === idx ? { ...row, ...p } : row)))
  }
  function remove(idx: number) {
    onChange(periods.filter((_, i) => i !== idx))
  }
  function addPeriod() {
    const today = new Date().toISOString().slice(0, 10)
    const firstTier = specialTiers[0]?.key || ''
    onChange([...periods, { start_date: today, end_date: today, day_type_key: firstTier }])
  }

  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
      <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
        Classificazione Periodi Speciali
      </h3>
      <p className="text-[13px] text-[#6e6e73] mt-0.5 mb-3">
        Assegna un tipo a un periodo di date (es. ponte dell'Immacolata, vacanze natalizie, evento). I giorni della settimana restano calcolati automaticamente al di fuori dei periodi definiti.
      </p>

      {periods.length === 0 && (
        <div className="text-[13px] text-[#a1a1a6] py-3 text-center border border-dashed border-black/10 rounded-lg mb-3">
          Nessun periodo definito. Ogni data verrà classificata come semplice giorno della settimana.
        </div>
      )}

      {periods.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] gap-2 items-center text-[10px] font-medium uppercase tracking-wide text-[#a1a1a6] px-1 mb-1">
          <span>Data inizio</span>
          <span>Data fine</span>
          <span>Tipo</span>
          <span className="text-right">Coeff.</span>
          <span></span>
        </div>
      )}

      <div className="space-y-2">
        {periods.map((p, idx) => {
          const tierData = dayTypeTiers.find(t => t.key === p.day_type_key)
          const badgeClass = tierData && typeof tierData.coeff === 'number'
            ? tierData.coeff < 1 ? 'bg-green-100 text-green-700'
            : tierData.coeff > 1 ? 'bg-red-100 text-red-700'
            : 'bg-gray-100 text-gray-600'
            : 'bg-gray-100 text-gray-400'
          const invalidRange = !!p.start_date && !!p.end_date && p.end_date < p.start_date
          return (
            <div key={idx} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto_auto] gap-2 items-center">
              <input
                type="date"
                value={p.start_date}
                onChange={(e) => patch(idx, { start_date: e.target.value })}
                className={`bg-white border rounded-lg px-2 py-1.5 text-[13px] text-black font-medium focus:outline-none focus:ring-2 focus:ring-[#007aff]/40 ${invalidRange ? 'border-red-400' : 'border-black/10'}`}
              />
              <input
                type="date"
                value={p.end_date}
                min={p.start_date || undefined}
                onChange={(e) => patch(idx, { end_date: e.target.value })}
                className={`bg-white border rounded-lg px-2 py-1.5 text-[13px] text-black font-medium focus:outline-none focus:ring-2 focus:ring-[#007aff]/40 ${invalidRange ? 'border-red-400' : 'border-black/10'}`}
              />
              <select
                value={p.day_type_key}
                onChange={(e) => patch(idx, { day_type_key: e.target.value })}
                className="w-full bg-white border border-black/10 rounded-lg px-2 py-1.5 text-[13px] text-black font-medium focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              >
                <option value="">— (nessuna)</option>
                {specialTiers.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
              <span className={`shrink-0 inline-flex items-center justify-center min-w-[52px] px-2 py-1 rounded-md text-[11px] font-bold tabular-nums ${badgeClass}`}>
                {tierData && typeof tierData.coeff === 'number' ? `×${tierData.coeff.toFixed(2)}` : '—'}
              </span>
              <button
                type="button"
                onClick={() => remove(idx)}
                className="text-[#ff3b30] hover:text-[#d70015] text-[16px] px-2 leading-none"
                aria-label="Rimuovi"
              >−</button>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={addPeriod}
        disabled={specialTiers.length === 0}
        className="mt-3 text-[13px] text-[#007aff] hover:text-[#0051d5] disabled:text-[#a1a1a6] disabled:cursor-not-allowed"
      >
        + Aggiungi periodo speciale
      </button>
      {specialTiers.length === 0 && (
        <p className="text-[11px] text-[#ff9500] mt-2">
          Aggiungi prima dei tipi non-settimanali (prefestivo, ponte, evento…) alla tabella sopra.
        </p>
      )}
    </section>
  )
}

function OccupancyTargetsSection({
  targets, onChange,
}: {
  targets: DynamicPricingConfig['occupancy_targets']
  onChange: (t: DynamicPricingConfig['occupancy_targets']) => void
}) {
  const classes: { key: keyof DynamicPricingConfig['occupancy_targets']; label: string }[] = [
    { key: 'utilitarie', label: 'Utilitarie' },
    { key: 'suv_premium', label: 'SUV / Premium' },
    { key: 'luxury', label: 'Luxury' },
  ]
  const windows: { key: keyof OccupancyTargets; label: string }[] = [
    { key: 'd30plus', label: '30+ gg' },
    { key: 'd15_29', label: '15–29 gg' },
    { key: 'd7_14', label: '7–14 gg' },
    { key: 'd3_6', label: '3–6 gg' },
    { key: 'd0_2', label: '0–2 gg' },
  ]
  const handleChange = (clsKey: keyof typeof targets, winKey: keyof OccupancyTargets, raw: string) => {
    const v = raw.replace(/[^0-9]/g, '')
    onChange({
      ...targets,
      [clsKey]: { ...targets[clsKey], [winKey]: v === '' ? '' : Math.min(100, Number(v)) },
    })
  }
  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
      <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
        Target Occupazione per Classe × Finestra Temporale
      </h3>
      <p className="text-[13px] text-[#6e6e73] mt-0.5 mb-3">
        % attesa di occupazione rispetto al ritiro. Sotto target → sistema più aggressivo; sopra → protezione margine.
      </p>

      {/* Mobile / narrow: stacked cards per class */}
      <div className="space-y-4 md:hidden">
        {classes.map((cls) => (
          <div key={cls.key} className="rounded-xl border border-black/10 p-3">
            <div className="text-[13px] font-semibold text-black mb-2">{cls.label}</div>
            <div className="grid grid-cols-2 gap-2">
              {windows.map((w) => (
                <label key={w.key} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-1.5">
                  <span className="text-[11px] uppercase tracking-wide text-[#6e6e73]">{w.label}</span>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={targets[cls.key][w.key] === '' ? '' : String(targets[cls.key][w.key])}
                      onChange={(e) => handleChange(cls.key, w.key, e.target.value)}
                      className="w-16 text-right tabular-nums bg-white text-black border border-black/10 rounded-md pr-6 pl-2 py-1 text-[13px] font-semibold focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-[#a1a1a6]">%</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Tablet / desktop: compact table */}
      <div className="hidden md:block overflow-x-auto">
      <table className="min-w-full text-[13px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-[#a1a1a6]">
            <th className="text-left py-2 pr-4">Classe</th>
            {windows.map((w) => (
              <th key={w.key} className="text-right px-2">{w.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {classes.map((cls) => (
            <tr key={cls.key} className="border-t border-black/5">
              <td className="py-2 pr-4 font-medium text-[#1d1d1f]">{cls.label}</td>
              {windows.map((w) => (
                <td key={w.key} className="py-2 px-2">
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={targets[cls.key][w.key] === '' ? '' : String(targets[cls.key][w.key])}
                      onChange={(e) => handleChange(cls.key, w.key, e.target.value)}
                      className="w-20 text-right tabular-nums bg-white text-black border border-black/10 rounded-lg pr-6 pl-2 py-1 text-[13px] font-semibold focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-[#a1a1a6]">%</span>
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  )
}

function PriceBox({
  value,
  onChange,
  placeholder,
}: {
  value: number | ''
  onChange: (v: number | '') => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">€</span>
      <input
        type="number"
        min={0}
        step={0.01}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          onChange(v === '' ? '' : Number(v))
        }}
        className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
      />
    </div>
  )
}

function CoeffBox({
  value,
  onChange,
  placeholder,
}: {
  value: number | ''
  onChange: (v: number | '') => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">×</span>
      <input
        type="number"
        min={0}
        step={0.01}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          onChange(v === '' ? '' : Number(v))
        }}
        className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
      />
    </div>
  )
}

function CoefficientTable({
  title,
  subtitle,
  unit,
  rows,
  onChange,
}: {
  title: string
  subtitle: string
  unit: string
  rows: CoefficientRow[]
  onChange: (next: CoefficientRow[]) => void
}) {
  function patch(id: string, p: Partial<CoefficientRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)))
  }
  function remove(id: string) {
    onChange(rows.filter((r) => r.id !== id))
  }
  function add() {
    onChange([...rows, { id: uid(), min: 0, max: 0, coeff: 1, label: '' }])
  }

  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-3">
        <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
          {title}
        </h3>
        <p className="text-[13px] text-[#6e6e73] mt-0.5">{subtitle}</p>
      </header>

      <div className="px-5 pb-4">
        <div className="grid grid-cols-[80px_80px_80px_1fr_32px] gap-2 items-center px-1 mb-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Min {unit}</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Max {unit}</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Coeff.</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Etichetta</span>
          <span />
        </div>

        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[80px_80px_80px_1fr_32px] gap-2 items-center group">
              <input
                type="number"
                value={r.min}
                onChange={(e) => {
                  const v = e.target.value
                  patch(r.id, { min: v === '' ? '' : Number(v) })
                }}
                className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              />
              <input
                type="number"
                value={r.max}
                onChange={(e) => {
                  const v = e.target.value
                  patch(r.id, { max: v === '' ? '' : Number(v) })
                }}
                className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              />
              <input
                type="number"
                step={0.01}
                value={r.coeff}
                onChange={(e) => {
                  const v = e.target.value
                  patch(r.id, { coeff: v === '' ? '' : Number(v) })
                }}
                className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              />
              <input
                type="text"
                value={r.label}
                onChange={(e) => patch(r.id, { label: e.target.value })}
                placeholder="Descrizione"
                className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              />
              <button
                onClick={() => remove(r.id)}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center w-8 h-8 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-all"
                aria-label="Rimuovi"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                </svg>
              </button>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-center text-[13px] text-[#6e6e73] py-4">
              Nessuna riga
            </p>
          )}
        </div>

        <button
          onClick={add}
          className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#007aff] hover:text-[#0066d6] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Aggiungi riga
        </button>
      </div>
    </section>
  )
}

// ========== PREVENTIVI (Punto 7) ==========

function PreventiviSection({
  preventivi,
  setPreventivi,
}: {
  preventivi: PreventiviConfig
  setPreventivi: (next: PreventiviConfig) => void
}) {
  function patchMsg(key: string, p: Partial<PreventivoMessage>) {
    setPreventivi({
      ...preventivi,
      messaggi: preventivi.messaggi.map((m) => (m.key === key ? { ...m, ...p } : m)),
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          Impostazioni Preventivi
        </h2>
        <p className="text-[14px] text-[#6e6e73] mt-1">
          Maggiorazione, scadenza e messaggi di sistema
        </p>
      </div>

      {/* Maggiorazione + Scadenza */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-1">
            Maggiorazione
          </h3>
          <p className="text-[12px] text-[#6e6e73] mb-3">
            Applicata sul totale del preventivo
          </p>
          <div className="relative w-28">
            <input
              type="number"
              min={0}
              max={100}
              value={preventivi.maggiorazione_pct}
              onChange={(e) => {
                const v = e.target.value
                setPreventivi({ ...preventivi, maggiorazione_pct: v === '' ? '' : Number(v) })
              }}
              className="w-full bg-white border border-black/10 rounded-lg pl-3 pr-8 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">%</span>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-1">
            Scadenza Default
          </h3>
          <p className="text-[12px] text-[#6e6e73] mb-3">
            Validita del preventivo dopo l'invio
          </p>
          <div className="relative w-28">
            <input
              type="number"
              min={0}
              value={preventivi.scadenza_default_ore}
              onChange={(e) => {
                const v = e.target.value
                setPreventivi({ ...preventivi, scadenza_default_ore: v === '' ? '' : Number(v) })
              }}
              className="w-full bg-white border border-black/10 rounded-lg pl-3 pr-12 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">ore</span>
          </div>
        </section>
      </div>

      {/* Messaggi di Sistema Preventivo */}
      <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <header className="px-5 pt-5 pb-3">
          <h3 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight">
            Messaggi di Sistema — Preventivi
          </h3>
          <p className="text-[13px] text-[#6e6e73] mt-0.5">
            Template usati dal sistema per i preventivi
          </p>
        </header>

        <ul className="divide-y divide-black/5">
          {preventivi.messaggi.map((m) => {
            const isDeprecated = m.key === 'preventivo_whatsapp'
            return (
              <li key={m.key} className="p-5">
                <div className="flex items-start gap-3 mb-3">
                  <label className="inline-flex items-center cursor-pointer pt-0.5">
                    <input
                      type="checkbox"
                      checked={m.is_enabled}
                      onChange={(e) => patchMsg(m.key, { is_enabled: e.target.checked })}
                      className="w-4 h-4 accent-[#007aff]"
                      disabled={isDeprecated}
                    />
                  </label>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[14px] font-semibold text-[#1d1d1f]">
                      {m.label}
                    </h4>
                    <p className="text-[12px] text-[#6e6e73] mt-0.5">
                      {m.description}
                    </p>
                    <p className="text-[11px] text-[#a1a1a6] mt-0.5 font-mono">{m.key}</p>
                  </div>
                </div>
                {isDeprecated ? (
                  <div className="w-full bg-[#fff8e1] border border-[#f0c36d]/60 rounded-lg px-3 py-3 text-[13px] text-[#6b4e00] leading-relaxed">
                    <strong>Questo campo è stato spostato.</strong><br />
                    Il testo del preventivo WhatsApp si modifica in{' '}
                    <strong>Messaggi di Sistema Pro → Conferma Preventivo Inviato</strong>.
                    <br />
                    <span className="text-[12px] text-[#8a6d00]">
                      (Lo slot qui è deprecato e non viene più letto come template.)
                    </span>
                  </div>
                ) : (
                  <textarea
                    value={m.body}
                    onChange={(e) => patchMsg(m.key, { body: e.target.value })}
                    rows={5}
                    className="w-full bg-[#f5f5f7] border border-black/5 rounded-lg px-3 py-2 text-[13px] text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40 resize-y font-mono leading-relaxed"
                  />
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

// ========== DANNI & PENALI (Punto 8) ==========

function DanniPenaliSection({
  penali,
  setPenali,
  danni,
  setDanni,
  categories,
}: {
  penali: PenaliConfig
  setPenali: (next: PenaliConfig) => void
  danni: DanniConfig
  setDanni: (next: DanniConfig) => void
  categories: Category[]
}) {
  const [kind, setKind] = useState<'penali' | 'danni'>('penali')
  const config = kind === 'penali' ? penali : danni
  const setConfig = kind === 'penali' ? setPenali : setDanni
  const itemNoun = kind === 'penali' ? 'penale' : 'danno'
  const titleNoun = kind === 'penali' ? 'Penali' : 'Danni'
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          Danni &amp; Penali
        </h2>
        <p className="text-[14px] text-[#6e6e73] mt-1">
          Listino di Danni e Penali per categoria veicolo. Quando l&apos;admin apre il modale
          di addebito su una prenotazione, le voci abilitate qui vengono proposte automaticamente
          con prezzi e descrizione.
        </p>
      </div>

      {/* Kind toggle (Penali / Danni) */}
      <div className="inline-flex rounded-full bg-[#f5f5f7] p-1 gap-1">
        {(['penali', 'danni'] as const).map((k) => {
          const active = k === kind
          return (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-4 py-1.5 text-[13px] font-medium rounded-full transition-colors ${
                active
                  ? 'bg-white text-[#1d1d1f] shadow-sm'
                  : 'text-[#6e6e73] hover:text-[#1d1d1f]'
              }`}
            >
              {k === 'penali' ? 'Penali' : 'Danni'}
            </button>
          )
        })}
      </div>

      <FeeListEditor
        config={config}
        setConfig={setConfig as (next: PenaliConfig) => void}
        titleNoun={titleNoun}
        itemNoun={itemNoun}
        categories={categories}
      />
    </div>
  )
}

function FeeListEditor({
  config,
  setConfig,
  titleNoun,
  itemNoun,
  categories,
}: {
  config: PenaliConfig
  setConfig: (next: PenaliConfig) => void
  titleNoun: string
  itemNoun: string
  categories: Category[]
}) {
  const categoryList = categories.length > 0
    ? categories.map(c => ({ id: c.id, label: c.label }))
    : DEFAULT_PENALI_CATEGORIES
  const [activeCategory, setActiveCategory] = useState<PenaliCategoryKey>(categoryList[0]?.id || 'supercars')

  useEffect(() => {
    if (!categoryList.some(c => c.id === activeCategory) && categoryList[0]) {
      setActiveCategory(categoryList[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories])
  const items = config[activeCategory] || []

  function patchItem(idx: number, p: Partial<PenaliItem>) {
    const next = items.map((it, i) => (i === idx ? { ...it, ...p } : it))
    setConfig({ ...config, [activeCategory]: next })
  }
  function removeItem(idx: number) {
    const next = items.filter((_, i) => i !== idx)
    setConfig({ ...config, [activeCategory]: next })
  }
  function addItem() {
    setConfig({
      ...config,
      [activeCategory]: [
        ...items,
        { id: uid(), label: `Nuovo ${itemNoun}`, amount: 0, description: '', enabled: true },
      ],
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[16px] font-semibold tracking-tight text-[#1d1d1f]">
          {titleNoun} per Categoria
        </h3>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2 border-b border-black/5 -mb-px">
        {categoryList.map((c) => {
          const isActive = c.id === activeCategory
          return (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={`px-4 py-2 text-[14px] font-medium rounded-t-lg transition-colors ${
                isActive
                  ? 'bg-white border border-black/10 border-b-white text-[#1d1d1f]'
                  : 'text-[#6e6e73] hover:text-[#1d1d1f]'
              }`}
            >
              {c.label}
            </button>
          )
        })}
      </div>

      <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <ul className="divide-y divide-black/5">
          {items.map((it, idx) => (
            // NB: chiave SOLO per indice. Includere it.id farebbe cambiare
            // la key ad ogni keystroke (vedi commit precedente).
            // L'ID interno e' nascosto all'admin: viene generato via uid()
            // alla creazione e mai modificato, ma resta nei dati per
            // matching cart/cronologia in PenaltyModal e DanniModal.
            // Anche `description` (vuoto) ed `enabled` (true) restano nei
            // dati per compatibilita' con il modale ma non si vedono qui.
            <li key={idx} className="px-5 py-3 group">
              <div className="flex items-center gap-3">
                <input
                  value={it.label}
                  onChange={(e) => patchItem(idx, { label: e.target.value })}
                  placeholder={`Nome ${itemNoun}`}
                  className="flex-1 min-w-0 bg-white border border-black/10 rounded-lg px-3 py-1.5 text-[14px] font-medium text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40 transition-colors"
                />
                <div className="relative w-32 flex-shrink-0">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">€</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={it.amount}
                    onChange={(e) => {
                      const v = e.target.value
                      patchItem(idx, { amount: v === '' ? '' : Number(v) })
                    }}
                    placeholder="0"
                    className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-3 py-1.5 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                  />
                </div>
                <button
                  onClick={() => removeItem(idx)}
                  className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-colors"
                  aria-label="Rimuovi"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73]">
              Nessun {itemNoun} per questa categoria
            </li>
          )}
        </ul>

        <footer className="px-5 py-3 border-t border-black/5 bg-[#fafafa]">
          <button
            onClick={addItem}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#007aff] hover:text-[#0066d6] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Aggiungi {itemNoun}
          </button>
        </footer>
      </section>
    </div>
  )
}

// ========== FISCALE (Punto 9) ==========

function FiscaleSection({
  fiscal,
  setFiscal,
}: {
  fiscal: FiscalConfig
  setFiscal: (next: FiscalConfig) => void
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          Fiscale
        </h2>
        <p className="text-[14px] text-[#6e6e73] mt-1">
          Aliquota IVA applicata alle fatture generate dal sistema.
        </p>
      </div>

      <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
        <label className="block max-w-xs">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
            Aliquota IVA
          </span>
          <div className="relative">
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={fiscal.vat_rate}
              onChange={(e) => {
                const v = e.target.value
                setFiscal({ ...fiscal, vat_rate: v === '' ? '' : Number(v) })
              }}
              className="w-full bg-white border border-black/10 rounded-lg pl-3 pr-10 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">%</span>
          </div>
        </label>
      </section>
    </div>
  )
}

// ========== DR7 CLUB (Punto 10) ==========

function DR7ClubSection({
  dr7Club,
  setDr7Club,
}: {
  dr7Club: DR7ClubConfig
  setDr7Club: (next: DR7ClubConfig) => void
}) {
  function patchTier(id: string, p: Partial<DR7ClubTier>) {
    setDr7Club({
      ...dr7Club,
      tiers: dr7Club.tiers.map((t) => (t.id === id ? { ...t, ...p } : t)),
    })
  }

  function addTier() {
    setDr7Club({
      ...dr7Club,
      tiers: [
        ...dr7Club.tiers,
        { id: uid(), label: 'Nuovo tier', min_annual_spend: 0, rate_pct: 0, is_active: true },
      ],
    })
  }

  function removeTier(id: string) {
    setDr7Club({
      ...dr7Club,
      tiers: dr7Club.tiers.filter((t) => t.id !== id),
    })
  }

  // Sort by min_annual_spend ascending for display (doesn't mutate state)
  const sortedTiers = [...dr7Club.tiers].sort((a, b) => {
    const av = typeof a.min_annual_spend === 'number' ? a.min_annual_spend : 0
    const bv = typeof b.min_annual_spend === 'number' ? b.min_annual_spend : 0
    return av - bv
  })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          DR7 Club
        </h2>
        <p className="text-[14px] text-[#6e6e73] mt-1">
          Tier di cashback DR7 Club. Il tier piu' alto raggiunto in base alla spesa annuale del cliente determina la percentuale di cashback applicata.
        </p>
      </div>

      {/* Legend — explain what the rules mean for the operator */}
      <section className="bg-[#f5f9ff] rounded-2xl border border-[#007aff]/15 p-5">
        <h3 className="text-[14px] font-semibold text-[#1d1d1f] mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-[#007aff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Come funziona il calcolo
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-[13px] text-[#1d1d1f]">
          <div>
            <p className="font-semibold mb-2 text-[#34c759]">Cosa conta come "spesa annuale"</p>
            <ul className="space-y-1.5 text-[#3a3a3c]">
              <li className="flex gap-2">
                <span className="text-[#34c759] mt-0.5">+</span>
                <span>Prenotazioni pagate con <b>carta</b> (Nexi / circuito Visa-Mastercard / Stripe), negli ultimi 12 mesi</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#34c759] mt-0.5">+</span>
                <span>Ricariche wallet pagate con carta — solo l'importo ricaricato, <b>non</b> il bonus pacchetto</span>
              </li>
            </ul>
          </div>
          <div>
            <p className="font-semibold mb-2 text-[#ff3b30]">Cosa <u>non</u> conta</p>
            <ul className="space-y-1.5 text-[#3a3a3c]">
              <li className="flex gap-2">
                <span className="text-[#ff3b30] mt-0.5">−</span>
                <span>Prenotazioni pagate dal <b>wallet</b> (credito accumulato)</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#ff3b30] mt-0.5">−</span>
                <span>Prenotazioni <b>annullate</b></span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#ff3b30] mt-0.5">−</span>
                <span>Pagamenti in <b>contanti</b>, bonifico, codice sconto</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#ff3b30] mt-0.5">−</span>
                <span>Bonus pacchetto sulle ricariche wallet</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-[#007aff]/10 text-[12px] text-[#6e6e73]">
          <span className="font-semibold text-[#1d1d1f]">Requisito:</span> il cliente deve avere un'iscrizione DR7 Club <b>attiva</b> al momento del pagamento. Senza iscrizione, nessun cashback viene applicato anche se la spesa supera la soglia.
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <header className="px-5 pt-5 pb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-[#1d1d1f]">Tier di Cashback</h3>
            <p className="text-[12px] text-[#6e6e73] mt-0.5">
              Disattiva un tier per non applicarlo, senza perderlo dalla configurazione. Elimina un tier per rimuoverlo definitivamente.
            </p>
          </div>
          <button
            onClick={addTier}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#007aff] hover:text-[#0066d6] transition-colors shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Aggiungi tier
          </button>
        </header>

        <div className="px-5 pb-2">
          <div className="grid grid-cols-[44px_1fr_140px_100px_32px] gap-2 items-center px-1 mb-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Attivo</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Nome</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] text-right">Spesa min.</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] text-right">Reward</span>
            <span />
          </div>
        </div>

        <ul className="divide-y divide-black/5">
          {sortedTiers.map((t) => (
            <li key={t.id} className="px-5 py-3 grid grid-cols-[44px_1fr_140px_100px_32px] gap-2 items-center group">
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={t.is_active}
                  onChange={(e) => patchTier(t.id, { is_active: e.target.checked })}
                  className="sr-only peer"
                />
                <span className="relative inline-block w-11 h-6 rounded-full bg-[#e5e5ea] peer-checked:bg-[#34c759] transition-colors">
                  <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                </span>
              </label>
              <input
                type="text"
                value={t.label}
                onChange={(e) => patchTier(t.id, { label: e.target.value })}
                placeholder="Nome tier"
                className={`bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40 ${!t.is_active ? 'opacity-50' : ''}`}
              />
              <div className={`relative ${!t.is_active ? 'opacity-50' : ''}`}>
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">€</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={t.min_annual_spend}
                  onChange={(e) => {
                    const v = e.target.value
                    patchTier(t.id, { min_annual_spend: v === '' ? '' : Number(v) })
                  }}
                  className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                />
              </div>
              <div className={`relative ${!t.is_active ? 'opacity-50' : ''}`}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={t.rate_pct}
                  onChange={(e) => {
                    const v = e.target.value
                    patchTier(t.id, { rate_pct: v === '' ? '' : Number(v) })
                  }}
                  className="w-full bg-white border border-black/10 rounded-lg pl-3 pr-8 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">%</span>
              </div>
              <button
                onClick={() => removeTier(t.id)}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center w-8 h-8 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-all"
                aria-label="Rimuovi tier"
                title="Rimuovi tier"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                </svg>
              </button>
            </li>
          ))}
          {sortedTiers.length === 0 && (
            <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73]">
              Nessun tier configurato. Tutti i clienti riceveranno 0% di cashback.
            </li>
          )}
        </ul>
      </section>
    </div>
  )
}

// ========== AUTOMAZIONI (Punto 11) ==========

function AutomazioniSection({
  automations,
  setAutomations,
}: {
  automations: AutomationsConfig
  setAutomations: (next: AutomationsConfig) => void
}) {
  const update = (patch: Partial<AutomationsConfig>) =>
    setAutomations({ ...automations, ...patch })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          Automazioni
        </h2>
        <p className="text-[14px] text-[#6e6e73] mt-1">
          Buffer e gap operativi che controllano le verifiche di disponibilita' del calendario, sito e admin.
        </p>
      </div>

      {/* Legend — 3 buffers, what they do, when they fire */}
      <section className="bg-[#f5f9ff] rounded-2xl border border-[#007aff]/15 p-5">
        <h3 className="text-[14px] font-semibold text-[#1d1d1f] mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-[#007aff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Come funzionano i 3 buffer
        </h3>
        <ul className="space-y-2.5 text-[13px] text-[#3a3a3c]">
          <li className="flex gap-3">
            <span className="inline-flex shrink-0 w-6 h-6 rounded-full bg-[#007aff] text-white items-center justify-center text-[11px] font-bold mt-0.5">1</span>
            <div>
              <b>Post-noleggio (stesso veicolo).</b> Quanto tempo deve passare dopo la riconsegna prima che la <b>stessa</b> auto sia di nuovo prenotabile. Include il lavaggio automatico. Default 90. Sito e admin.
            </div>
          </li>
          <li className="flex gap-3">
            <span className="inline-flex shrink-0 w-6 h-6 rounded-full bg-[#ff9500] text-white items-center justify-center text-[11px] font-bold mt-0.5">2</span>
            <div>
              <b>Handover tra veicoli diversi.</b> Pausa minima tra qualsiasi ritiro o riconsegna su <b>auto diverse</b>. Lo staff non puo' gestire due handover contemporaneamente: cliente A ritira alle 10:30 → cliente B non prima delle 10:45. Default 15. Solo admin.
            </div>
          </li>
          <li className="flex gap-3">
            <span className="inline-flex shrink-0 w-6 h-6 rounded-full bg-[#34c759] text-white items-center justify-center text-[11px] font-bold mt-0.5">3</span>
            <div>
              <b>Pre-pickup (lavaggio in corso).</b> Se il veicolo e' impegnato in un lavaggio entro <b>questo intervallo</b> prima del ritiro, blocca la prenotazione. Evita di promettere un'auto che non sara' asciutta in tempo. Default 90. Solo admin.
            </div>
          </li>
        </ul>
        <div className="mt-4 pt-3 border-t border-[#007aff]/10 text-[12px] text-[#6e6e73]">
          <span className="font-semibold text-[#1d1d1f]">Importante:</span> dopo aver salvato un nuovo valore, l'admin va aggiornato (refresh pagina). Il sito propaga entro ~60 secondi grazie alla cache server-side.
        </div>
      </section>

      {/* 1) Buffer post-noleggio */}
      <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <header className="px-5 pt-5 pb-3 bg-[#f5f9ff] border-b border-[#007aff]/10">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-1 flex items-center gap-2">
            <span className="inline-flex w-6 h-6 rounded-full bg-[#007aff] text-white items-center justify-center text-[12px] font-bold">1</span>
            Buffer post-noleggio (stesso veicolo)
          </h3>
          <p className="text-[12px] text-[#3a3a3c] leading-relaxed pl-8">
            Pausa minima tra la riconsegna di un noleggio e l'inizio del successivo sullo <b>stesso veicolo</b>. Serve per pulizia, controllo, eventuale lavaggio. Sito e admin usano lo stesso valore.
          </p>
        </header>
        <div className="p-5">
          <label className="block max-w-xs">
            <div className="relative">
              <input
                type="number"
                min={0}
                max={720}
                step={5}
                value={automations.rental_buffer_minutes}
                onChange={(e) => {
                  const v = e.target.value
                  update({ rental_buffer_minutes: v === '' ? '' : Number(v) })
                }}
                className="w-full bg-white border border-black/10 rounded-lg pl-3 pr-16 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">minuti</span>
            </div>
            <p className="text-[11px] text-[#6e6e73] mt-1.5">Default: 90 (include il lavaggio automatico).</p>
          </label>
        </div>
      </section>

      {/* 2) Cross-vehicle handover gap */}
      <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <header className="px-5 pt-5 pb-3 bg-[#fff7e6] border-b border-[#ff9500]/15">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-1 flex items-center gap-2">
            <span className="inline-flex w-6 h-6 rounded-full bg-[#ff9500] text-white items-center justify-center text-[12px] font-bold">2</span>
            Buffer handover tra veicoli diversi
          </h3>
          <p className="text-[12px] text-[#3a3a3c] leading-relaxed pl-8">
            Pausa minima tra <b>qualsiasi</b> ritiro o riconsegna su un veicolo diverso. Serve perche' lo staff non puo' gestire due handover contemporaneamente: due clienti non possono ritirare auto diverse alla stessa ora.
          </p>
        </header>
        <div className="p-5">
          <label className="block max-w-xs">
            <div className="relative">
              <input
                type="number"
                min={0}
                max={120}
                step={5}
                value={automations.cross_vehicle_gap_minutes}
                onChange={(e) => {
                  const v = e.target.value
                  update({ cross_vehicle_gap_minutes: v === '' ? '' : Number(v) })
                }}
                className="w-full bg-white border border-black/10 rounded-lg pl-3 pr-16 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#ff9500]/40"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">minuti</span>
            </div>
            <p className="text-[11px] text-[#6e6e73] mt-1.5">Default: 15. Esempio: cliente A ritira alle 10:30 → cliente B non puo' ritirare prima delle 10:45.</p>
          </label>
        </div>
      </section>

      {/* 3) Pre-pickup carwash conflict */}
      <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <header className="px-5 pt-5 pb-3 bg-[#f0f9ff] border-b border-[#34c759]/15">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-1 flex items-center gap-2">
            <span className="inline-flex w-6 h-6 rounded-full bg-[#34c759] text-white items-center justify-center text-[12px] font-bold">3</span>
            Buffer pre-pickup (veicolo in lavaggio)
          </h3>
          <p className="text-[12px] text-[#3a3a3c] leading-relaxed pl-8">
            Se il veicolo e' impegnato in un lavaggio entro questo intervallo prima del ritiro, l'admin blocca la prenotazione. Evita di prenotare un'auto che non sara' pronta in tempo.
          </p>
        </header>
        <div className="p-5">
          <label className="block max-w-xs">
            <div className="relative">
              <input
                type="number"
                min={0}
                max={720}
                step={15}
                value={automations.pre_pickup_carwash_buffer_minutes}
                onChange={(e) => {
                  const v = e.target.value
                  update({ pre_pickup_carwash_buffer_minutes: v === '' ? '' : Number(v) })
                }}
                className="w-full bg-white border border-black/10 rounded-lg pl-3 pr-16 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#34c759]/40"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">minuti</span>
            </div>
            <p className="text-[11px] text-[#6e6e73] mt-1.5">Default: 90 (1h30). Solo lato admin.</p>
          </label>
        </div>
      </section>
    </div>
  )
}
