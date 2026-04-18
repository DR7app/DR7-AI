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
import type { ProSnapshot } from '../utils/convertProConfig'

interface UseRentalConfigResult {
  config: RentalConfig
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  saveConfig: (newConfig: RentalConfig, changedBy: string, section: string, description?: string) => Promise<boolean>
}

export function useRentalConfig(): UseRentalConfigResult {
  const [config, setConfig] = useState<RentalConfig>(DEFAULT_RENTAL_CONFIG)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const { data, error: fetchErr } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()

      if (fetchErr) {
        console.warn('[useRentalConfig] Pro fetch error, using defaults:', fetchErr.message)
        setConfig(DEFAULT_RENTAL_CONFIG)
        setError(fetchErr.message)
        return
      }

      if (data?.config && typeof data.config === 'object') {
        const proConfig = data.config as ProSnapshot
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
  }, [])

  useEffect(() => {
    fetchConfig()

    // Subscribe to real-time changes on centralina_pro_config
    const channel = supabase
      .channel('centralina-pro-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'centralina_pro_config', filter: 'id=eq.main' },
        (payload) => {
          console.log('[useRentalConfig] Pro config updated via realtime')
          const newConfig = payload.new?.config as ProSnapshot
          if (newConfig && typeof newConfig === 'object' && Object.keys(newConfig).length > 0) {
            const converted = convertProToRentalConfig(newConfig)
            setConfig(converted)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchConfig])

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
