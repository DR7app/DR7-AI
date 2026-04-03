/**
 * Centralina Unica — Admin hook to load rental config from Supabase
 * Reads directly from rental_extras_config table (admin is authenticated).
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import type { RentalConfig } from '../types/rentalConfig'
import { DEFAULT_RENTAL_CONFIG } from './rentalConfigDefaults'

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
        .from('rental_extras_config')
        .select('config')
        .limit(1)
        .single()

      if (fetchErr) {
        console.warn('[useRentalConfig] Fetch error, using defaults:', fetchErr.message)
        setConfig(DEFAULT_RENTAL_CONFIG)
        setError(fetchErr.message)
        return
      }

      if (data?.config && typeof data.config === 'object') {
        // Merge with defaults to fill any missing sections
        setConfig({ ...DEFAULT_RENTAL_CONFIG, ...data.config } as RentalConfig)
      } else {
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
  }, [fetchConfig])

  const saveConfig = useCallback(async (
    newConfig: RentalConfig,
    changedBy: string,
    section: string,
    description?: string
  ): Promise<boolean> => {
    try {
      // Save config
      const { error: saveErr } = await supabase
        .from('rental_extras_config')
        .update({
          config: newConfig,
          updated_at: new Date().toISOString(),
          updated_by: changedBy,
        })
        .not('id', 'is', null) // update the singleton row

      if (saveErr) {
        console.error('[useRentalConfig] Save error:', saveErr)
        return false
      }

      // Write audit log
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
