/**
 * Vehicle classification — URBAN vs MAXI for car wash pricing.
 *
 * The deterministic rules live in ./classifyWashVehicle (shared 1:1 with the
 * website). This module keeps the existing public API (VehicleCategory,
 * classifyVehicleLocally, classifyVehicle) so the call sites stay unchanged.
 *
 * Previous version mis-classified SUVs / vans / "...Maxi" vehicles as Urban
 * (the word "maxi" and many model names were missing); replaced 2026-06-12.
 */
import { classifyVehicle as classifyWashVehicle } from './classifyWashVehicle'

export type VehicleCategory = 'urban' | 'maxi' | 'moto'

export interface ClassificationResult {
  category: VehicleCategory
  confidence: 'high' | 'medium' | 'low'
  source: 'local' | 'api'
  matchedBrand?: string
  matchedModel?: string
}

/**
 * Classify a combined "brand model" string into urban / maxi.
 * Deterministic — see ./classifyWashVehicle for the rules and manualOverrides.
 */
export function classifyVehicleLocally(makeModel: string): ClassificationResult {
  // makeModel is a combined "brand model" string → pass it as the model field;
  // the shared classifier matches keywords/overrides against the full text.
  const cat = classifyWashVehicle({ model: makeModel }) // 'Urban' | 'Maxi'
  return {
    category: cat.toLowerCase() as VehicleCategory,
    confidence: 'high',
    source: 'local',
  }
}

export async function classifyVehicle(makeModel: string): Promise<ClassificationResult> {
  return classifyVehicleLocally(makeModel)
}
