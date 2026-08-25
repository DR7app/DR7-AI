/**
 * Contatore fatture scartate dallo SdI, mostrato sul badge della sidebar.
 *
 * 25/08/2026: stava dentro FatturaTab. AdminDashboard lo importava da li',
 * quindi TUTTA la tab (1743 righe) finiva nel chunk principale.
 */
import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

export function useFatturaScartataCount() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { count: n } = await supabase
        .from('fatture')
        .select('id', { count: 'exact', head: true })
        .in('sdi_status', ['rejected', 'scartata'])
        .eq('sdi_notification_seen', false)
      if (!cancelled && typeof n === 'number') setCount(n)
    }
    load()
    const id = setInterval(load, 60_000)
    const channel = supabase
      .channel('fattura-scartata-count')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fatture' }, load)
      .subscribe()
    return () => {
      cancelled = true
      clearInterval(id)
      supabase.removeChannel(channel)
    }
  }, [])

  return count
}
