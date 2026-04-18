/**
 * Centralina Unica — Admin hook to load rental config from Supabase
 * Reads from centralina_pro_config table and converts to legacy RentalConfig format.
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

      // Read from Centralina Pro
      const { data, error: fetchErr } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()

      if (fetchErr) {
        console.warn('[useRentalConfig] Pro fetch error, falling back to old config:', fetchErr.message)
        // Fallback to old config
        return await fetchLegacyConfig()
      }

      if (data?.config && typeof data.config === 'object') {
        const proConfig = data.config as ProSnapshot
        const converted = convertProToRentalConfig(proConfig)
        setConfig(converted)
      } else {
        console.warn('[useRentalConfig] Pro config empty, falling back to old config')
        return await fetchLegacyConfig()
      }
    } catch (err) {
      console.warn('[useRentalConfig] Unexpected error, using defaults:', err)
      setConfig(DEFAULT_RENTAL_CONFIG)
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // Fallback: read from old rental_extras_config if Pro is not available
  async function fetchLegacyConfig() {
    try {
      const { data, error: legacyErr } = await supabase
        .from('rental_extras_config')
        .select('config')
        .limit(1)
        .single()

      if (legacyErr || !data?.config) {
        setConfig(DEFAULT_RENTAL_CONFIG)
        setError(legacyErr?.message || 'No config found')
        return
      }

      setConfig({ ...DEFAULT_RENTAL_CONFIG, ...data.config } as RentalConfig)
    } catch {
      setConfig(DEFAULT_RENTAL_CONFIG)
    }
  }

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
      // Save to old config table (CentralinaConfig still uses this for writes)
      const { error: saveErr } = await supabase
        .from('rental_extras_config')
        .update({
          config: newConfig,
          updated_at: new Date().toISOString(),
          updated_by: changedBy,
        })
        .not('id', 'is', null)

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
