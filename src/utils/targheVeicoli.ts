import { supabase } from '../supabaseClient'

/** Targa per id veicolo, dall'anagrafica `vehicles` (solo lettura). */
export async function targheVeicoli(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {}
  const { data, error } = await supabase.from('vehicles').select('id, plate').in('id', ids)
  if (error) throw error
  const out: Record<string, string> = {}
  for (const v of (data || []) as Array<{ id: string; plate: string | null }>) {
    if (v.plate) out[v.id] = v.plate
  }
  return out
}
