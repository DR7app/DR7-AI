/**
 * Server-side converter: Centralina Pro → legacy RentalConfig format
 * Used by get-extras-config.ts to serve converted config to the website.
 */

// Pro category → vehicle DB category
const PRO_TO_DB: Record<string, string> = { supercars: 'exotic', urban: 'urban', aziendali: 'aziendali' }
// Pro fascia → legacy tier
const PRO_TO_TIER: Record<string, string> = { A: 'TIER_2', B: 'TIER_1' }

function num(v: any): number { return typeof v === 'number' ? v : 0 }

function numRecord(rec: any): Record<string, number> {
  const out: Record<string, number> = {}
  if (!rec || typeof rec !== 'object') return out
  for (const [k, v] of Object.entries(rec)) {
    if (typeof v === 'number') out[k] = v
  }
  return out
}

export function convertProToLegacy(pro: any): any {
  if (!pro || typeof pro !== 'object') return null

  const config: any = {
    schema_version: 2,
    tier_rules: {
      blocked: { min_age: 21, max_age: 70, min_license_years: 3 },
      TIER_1: { label: 'Fascia B', age_range: [21, 25], license_years_range: [3, 4] },
      TIER_2: { label: 'Fascia A', min_age: 26, max_age: 69, min_license_years: 5 },
    },
    vehicle_categories: {},
    insurance: {},
    km_included: { _global: { table: { '1': 100, '2': 180, '3': 240, '4': 280, '5': 300 }, extra_per_day: 60 } },
    sforo_km: { _global: 1.80, category: {}, vehicle_overrides: {} },
    unlimited_km: {},
    deposits: { TIER_1_RESIDENT: [], TIER_2_RESIDENT: [], TIER_1_NON_RESIDENT: [], TIER_2_NON_RESIDENT: [], category_defaults: {} },
    second_driver: {},
    lavaggio: { fee: 9.90, mandatory: true },
    delivery: { price_per_km: 3 },
    no_cauzione_surcharge: { per_day: 49, tier_restriction: 'TIER_2', requires_kasko: true },
    experience_services: [],
    dr7_flex: { daily_price: 19.90, refund_percent: 90, tier_restriction: 'TIER_2', description: '' },
    rental_day_rates: {},
    payment_modes: [],
    preventivi: { maggiorazione_pct: 0, default_expiry_hours: 24, whatsapp_footer: '' },
  }

  // Categories
  if (pro.categories) {
    for (const cat of pro.categories) {
      config.vehicle_categories[PRO_TO_DB[cat.id] || cat.id] = { label: cat.label }
    }
  }

  // Fasce → tier_rules
  if (pro.fasce) {
    const a = pro.fasce.find((f: any) => f.id === 'A')
    const b = pro.fasce.find((f: any) => f.id === 'B')
    if (a) config.tier_rules.TIER_2 = { label: a.label, min_age: num(a.min_age), max_age: num(a.max_age), min_license_years: num(a.min_license_years) }
    if (b) config.tier_rules.TIER_1 = { label: b.label, age_range: [num(b.min_age), num(b.max_age)], license_years_range: [num(b.min_license_years), 4] }
  }

  // Insurance
  if (pro.insurance) {
    for (const catIns of pro.insurance) {
      const dbCat = PRO_TO_DB[catIns.id] || catIns.id
      const conv: any = {}
      const mapOpt = (o: any) => ({ id: o.id, name: o.name, daily_price: num(o.daily_price), mandatory_deposit: num(o.mandatory_deposit), deductible_fixed: num(o.deductible_fixed), deductible_percent: num(o.deductible_percent) })

      if (catIns.mode === 'per_fascia' && catIns.byFascia) {
        for (const [fId, opts] of Object.entries(catIns.byFascia)) {
          conv[PRO_TO_TIER[fId] || fId] = (opts as any[]).map(mapOpt)
        }
      } else if (catIns.all) {
        conv._all_tiers = catIns.all.map(mapOpt)
      }
      config.insurance[dbCat] = conv
    }
  }

  // KM + Sforo + Unlimited
  if (pro.km) {
    for (const kmCfg of pro.km) {
      const dbCat = PRO_TO_DB[kmCfg.id] || kmCfg.id
      const table = numRecord(kmCfg.table)
      const hasLimits = Object.values(table).some((v: any) => v > 0)

      if (!hasLimits && num(kmCfg.extraPerDay) === 0) {
        config.km_included[dbCat] = { unlimited: true }
      } else {
        config.km_included[dbCat] = { table, extra_per_day: num(kmCfg.extraPerDay) }
      }

      if (num(kmCfg.sforo) > 0) config.sforo_km.category[dbCat] = num(kmCfg.sforo)
      if (num(kmCfg.unlimitedPerDay) > 0) config.unlimited_km[dbCat] = { _all_tiers: { per_day: num(kmCfg.unlimitedPerDay) } }
    }
  }

  // Deposits
  if (pro.deposits) {
    for (const [fId, fd] of Object.entries(pro.deposits as Record<string, any>)) {
      const tier = PRO_TO_TIER[fId]
      if (!tier) continue
      const mapDep = (o: any) => ({ id: o.id, label: o.label, amount: num(o.amount), surcharge_per_day: num(o.surcharge_per_day) })
      config.deposits[`${tier}_RESIDENT`] = (fd.residente || []).map(mapDep)
      config.deposits[`${tier}_NON_RESIDENT`] = (fd.non_residente || []).map(mapDep)
    }
  }

  // Services
  if (pro.servizi) {
    const s = pro.servizi
    if (s.experience) {
      config.experience_services = s.experience.map((e: any) => ({
        id: e.id, name: e.name, price: num(e.price), unit: e.unit, is_active: e.is_active,
        tier_only: e.tier_only ? (PRO_TO_TIER[e.tier_only] || e.tier_only) : null,
      }))
    }
    if (s.dr7_flex) {
      config.dr7_flex = {
        daily_price: num(s.dr7_flex.daily_price), refund_percent: num(s.dr7_flex.refund_percent),
        tier_restriction: PRO_TO_TIER[s.dr7_flex.tier_restriction] || s.dr7_flex.tier_restriction || '',
        description: s.dr7_flex.description || '',
      }
    }
    if (s.lavaggio) config.lavaggio = { fee: num(s.lavaggio.fee), mandatory: s.lavaggio.mandatory }
    if (s.delivery) config.delivery = { price_per_km: num(s.delivery.price_per_km) }
    if (s.second_driver) {
      for (const [fId, price] of Object.entries(s.second_driver)) {
        config.second_driver[PRO_TO_TIER[fId] || fId] = num(price)
      }
    }
  }

  // Tariffe
  if (pro.prezzoDinamico?.tariffe) {
    for (const t of pro.prezzoDinamico.tariffe) {
      const dbCat = PRO_TO_DB[t.id] || t.id
      const dr: any = { extrapolation: 'day7_average' }
      if (t.mode === 'per_residenza') {
        dr.resident = numRecord(t.residente)
        dr.non_resident = numRecord(t.non_residente)
      } else {
        dr.flat = numRecord(t.unica)
      }
      config.rental_day_rates[dbCat] = dr
    }
  }

  // Preventivi
  if (pro.preventivi) {
    config.preventivi.maggiorazione_pct = num(pro.preventivi.maggiorazione_pct)
    config.preventivi.default_expiry_hours = num(pro.preventivi.scadenza_default_ore)
  }

  return config
}
