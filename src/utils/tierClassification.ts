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
