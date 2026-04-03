/**
 * Driver Tier Classification — shared logic (mirrors website tierClassification.ts)
 *
 * Tier 1 (Fascia B — young/risk): Age 21-25 OR license held 3-4 years
 * Tier 2 (Fascia A — standard):   Age 26-69 AND license held 5+ years
 * Blocked: age <21, age >=70, or license <3 years
 */

export type DriverTier = 'TIER_1' | 'TIER_2' | 'BLOCKED';

export interface TierClassification {
  tier: DriverTier;
  reason: string;
  driverAge: number;
  licenseYears: number;
}

export function classifyDriverTier(driverAge: number, licenseYears: number): TierClassification {
  const base = { driverAge, licenseYears };

  if (driverAge < 21) {
    return { ...base, tier: 'BLOCKED', reason: 'Età minima 21 anni per il noleggio.' };
  }
  if (driverAge >= 70) {
    return { ...base, tier: 'BLOCKED', reason: 'Noleggio non disponibile per età superiore a 69 anni.' };
  }
  if (licenseYears < 3) {
    return { ...base, tier: 'BLOCKED', reason: 'Patente da almeno 3 anni richiesta.' };
  }

  // Tier 1 (Fascia B): Age 21-25 OR license 3-4 years
  if ((driverAge >= 21 && driverAge <= 25) || (licenseYears >= 3 && licenseYears <= 4)) {
    return { ...base, tier: 'TIER_1', reason: 'Fascia B — Conducente giovane o patente recente' };
  }

  // Tier 2 (Fascia A): Age 26-69 AND license 5+ years
  if (driverAge >= 26 && driverAge <= 69 && licenseYears >= 5) {
    return { ...base, tier: 'TIER_2', reason: 'Fascia A — Conducente esperto' };
  }

  return { ...base, tier: 'BLOCKED', reason: 'Noleggio non disponibile con i requisiti forniti.' };
}

/** Calculate age from birth date string (YYYY-MM-DD) */
export function calculateAge(birthDate: string): number {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

/** Calculate years since license issue date string (YYYY-MM-DD) */
export function calculateLicenseYears(issueDate: string): number {
  const issue = new Date(issueDate);
  const today = new Date();
  let years = today.getFullYear() - issue.getFullYear();
  const monthDiff = today.getMonth() - issue.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < issue.getDate())) {
    years--;
  }
  return years;
}

/** Tier-based pricing constants — must match website constants.ts */
export const TIER_KASKO_BASE_PRICE = {
  TIER_1: 119, // €119/day for young/risk
  TIER_2: 89,  // €89/day for standard
} as const;

export const TIER_UNLIMITED_KM_PRICE = {
  TIER_1: 289, // €289/day for young/risk
  TIER_2: 189, // €189/day for standard
} as const;

export const NO_CAUZIONE_SURCHARGE_PER_DAY = 49; // €49/day — only for TIER_2

export const TIER_SECOND_DRIVER_PRICE = {
  TIER_1: 20, // €20/day for young/risk
  TIER_2: 10, // €10/day for standard
} as const;

// --- Experience Services (mirrors website constants.ts) ---

export interface ExperienceService {
  id: string;
  name: string;
  price: number;
  unit: 'per_day' | 'per_hour' | 'per_item' | 'flat';
  tierOnly?: DriverTier;
}

export const EXPERIENCE_SERVICES: ExperienceService[] = [
  { id: 'bouquet', name: 'Bouquet di rose', price: 7.90, unit: 'per_item' },
  { id: 'wedding', name: 'Allestimento matrimonio interno/esterno', price: 150, unit: 'flat' },
  { id: 'personal_driver', name: 'Autista personale', price: 150, unit: 'per_hour' },
  { id: 'restaurant', name: 'Prenotazione ristorante', price: 10, unit: 'flat' },
  { id: 'video_drone', name: 'Video Maker + Drone shooting', price: 200, unit: 'per_hour' },
  { id: 'premium_24h', name: 'Assistenza premium 24h dedicata', price: 19.90, unit: 'per_day' },
  { id: 'vehicle_replacement', name: 'Sostituzione immediata veicolo', price: 19.90, unit: 'per_day', tierOnly: 'TIER_2' },
  { id: 'chauffeur_vip', name: 'Noleggio con autista + itinerario VIP', price: 189, unit: 'per_hour' },
];

export function getExperienceServicesForTier(tier: DriverTier): ExperienceService[] {
  if (tier === 'BLOCKED') return [];
  return EXPERIENCE_SERVICES.filter(s => !s.tierOnly || s.tierOnly === tier);
}

export const DR7_FLEX_PRICE_PER_DAY = 19.90; // Only for TIER_2 (Fascia A)
