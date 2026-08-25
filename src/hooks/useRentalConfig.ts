/**
 * Centralina Unica — Admin hook to load rental config from Supabase
 * Reads from centralina_pro_config table and converts to legacy RentalConfig format.
 * Subscribes to real-time changes so all tabs update immediately.
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import type { RentalConfig } from '../types/rentalConfig'
import { DEFAULT_RENTAL_CONFIG } from './rentalConfigDefaults'
import { convertProToRentalConfig } from '../utils/convertProConfig'
import { businessRowForServiceType } from '../utils/businessConfigClient'
import type { ProSnapshot } from '../utils/convertProConfig'

interface UseRentalConfigResult {
  config: RentalConfig
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  saveConfig: (newConfig: RentalConfig, changedBy: string, section: string, description?: string) => Promise<boolean>
}

/**
 * Snapshot del business sovrapposto a quello dell'azienda, voce per voce.
 *
 * Una chiave configurata sul business vince; una chiave assente — o una lista
 * vuota, che e' una sezione mai compilata e non la scelta di non avere nulla —
 * eredita `main`. Stessa regola di `loadBusinessList` in businessConfigClient.
 */
function fondiSnapshot(business: ProSnapshot | null, main: ProSnapshot | null): ProSnapshot | null {
  if (!business) return main
  if (!main) return business
  const out: Record<string, unknown> = { ...(main as Record<string, unknown>) }
  for (const [k, v] of Object.entries(business as Record<string, unknown>)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out as ProSnapshot
}

/**
 * @param serviceType service_type del business servito ('boat_rental',
 *   'heli_rental', 'stay_rental', 'car_wash'…). Omesso = Noleggio Terra
 *   (riga `main`), comportamento identico a prima.
 *
 * 25/08/2026: leggeva `id='main'` in fisso. Su una prenotazione Mare o Aria i
 * Servizi Extra, l'Experience, il DR7 Flex e il costo di consegna uscivano
 * quindi ai prezzi di Terra, e quanto configurato nella Centralina di quel
 * business non si applicava mai.
 */
export function useRentalConfig(serviceType?: string | null): UseRentalConfigResult {
  const [config, setConfig] = useState<RentalConfig>(DEFAULT_RENTAL_CONFIG)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const rowId = businessRowForServiceType(serviceType)

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const ids = rowId === 'main' ? ['main'] : [rowId, 'main']
      const { data, error: fetchErr } = await supabase
        .from('centralina_pro_config')
        .select('id, config')
        .in('id', ids)

      if (fetchErr) {
        console.warn('[useRentalConfig] Pro fetch error, using defaults:', fetchErr.message)
        setConfig(DEFAULT_RENTAL_CONFIG)
        setError(fetchErr.message)
        return
      }

      const righe = (data || []) as { id: string; config: ProSnapshot | null }[]
      const main = righe.find(r => r.id === 'main')?.config || null
      const business = rowId === 'main' ? null : (righe.find(r => r.id === rowId)?.config || null)
      const proConfig = fondiSnapshot(business, main)

      if (proConfig && typeof proConfig === 'object') {
        const converted = convertProToRentalConfig(proConfig)
        setConfig(converted)
      } else {
        console.warn('[useRentalConfig] Pro config empty, using defaults')
        setConfig(DEFAULT_RENTAL_CONFIG)
      }
    } catch (err) {
      console.warn('[useRentalConfig] Unexpected error, using defaults:', err)
      setConfig(DEFAULT_RENTAL_CONFIG)
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [rowId])

  useEffect(() => {
    fetchConfig()

    // Subscribe to real-time changes on centralina_pro_config.
    // Le righe da seguire sono due (business + main) e il filtro ne accetta
    // una sola: si ascolta la tabella e si rilegge, cosi' la precedenza
    // business/main la ricostruisce fetchConfig e non questo callback.
    const channel = supabase
      .channel(`centralina-pro-changes-${rowId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'centralina_pro_config' },
        (payload) => {
          const id = (payload.new as { id?: string } | undefined)?.id
          if (id !== 'main' && id !== rowId) return
          console.log('[useRentalConfig] Pro config updated via realtime', id)
          fetchConfig()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchConfig, rowId])

  const saveConfig = useCallback(async (
    newConfig: RentalConfig,
    changedBy: string,
    section: string,
    description?: string
  ): Promise<boolean> => {
    try {
      await supabase.from('config_audit_log').insert({
        changed_by: changedBy,
        section,
        changes: { description: description || `Updated ${section}` },
        full_snapshot: newConfig,
      })

      setConfig(newConfig)
      return true
    } catch (err) {
      console.error('[useRentalConfig] Save failed:', err)
      return false
    }
  }, [])

  return { config, loading, error, refresh: fetchConfig, saveConfig }
}
