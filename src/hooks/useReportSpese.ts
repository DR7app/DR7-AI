/**
 * Spese del report (ricorrenti + una tantum) — vedi migrazione
 * 20260825_report_spese.sql.
 *
 * Regola di calcolo, la parte che conta:
 *   - una_tantum : pesa se `data` cade dentro il periodo mostrato.
 *   - ricorrente : e' un importo MENSILE. Pesa una volta per ogni mese del
 *     periodo in cui e' attiva (dal ... al). Un report mensile la conta una
 *     volta; un report su tre mesi la conta tre volte; un affitto partito a
 *     marzo non compare nel report di gennaio.
 *
 * Non si fa proporzione sui giorni: una spesa mensile e' dovuta per intero nel
 * mese in cui esiste. Un periodo 15/03–15/04 tocca due mesi e conta due
 * mensilita' — e' come la vede l'amministrazione, non un rateo giornaliero.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

export type SpesaTipo = 'ricorrente' | 'una_tantum'

export interface ReportSpesa {
  id: string
  business: string
  tipo: SpesaTipo
  label: string
  amount: number
  dal?: string | null
  al?: string | null
  data?: string | null
  nota?: string | null
}

/** 'YYYY-MM' di una data ISO, senza passare da Date (niente slittamenti di fuso). */
function ym(iso?: string | null): string {
  return String(iso || '').slice(0, 7)
}

/** Elenco dei mesi 'YYYY-MM' toccati dal periodo, estremi inclusi. */
export function mesiNelPeriodo(fromISO: string, toISO: string): string[] {
  const a = ym(fromISO)
  const b = ym(toISO)
  if (!a || !b || a > b) return a ? [a] : []
  const out: string[] = []
  let [y, m] = a.split('-').map(Number)
  const [ey, em] = b.split('-').map(Number)
  // Guardia: un periodo assurdo (date invertite o corrotte) non deve girare
  // all'infinito ne' gonfiare il totale. 120 mesi = 10 anni, ben oltre l'uso reale.
  for (let i = 0; i < 120; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    if (y === ey && m === em) break
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

/** Quante mensilita' di questa spesa ricorrente cadono nel periodo. */
function mensilitaNelPeriodo(s: ReportSpesa, mesi: string[]): number {
  if (s.tipo !== 'ricorrente') return 0
  const dal = ym(s.dal)
  const al = s.al ? ym(s.al) : null
  return mesi.filter(m => m >= dal && (!al || m <= al)).length
}

export function useReportSpese(business: string, fromISO?: string, toISO?: string) {
  const [spese, setSpese] = useState<ReportSpesa[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('report_spese')
        .select('id, business, tipo, label, amount, dal, al, data, nota')
        .eq('business', business)
        .order('tipo', { ascending: true })
        .order('label', { ascending: true })
      setSpese(((data || []) as ReportSpesa[]).map(s => ({ ...s, amount: Number(s.amount) || 0 })))
    } finally {
      setLoading(false)
    }
  }, [business])

  useEffect(() => { reload() }, [reload])

  /** Ripartizione del totale sul periodo mostrato. */
  const totali = useMemo(() => {
    if (!fromISO || !toISO) return { ricorrenti: 0, unaTantum: 0, totale: 0, mesi: [] as string[] }
    const mesi = mesiNelPeriodo(fromISO, toISO)
    let ricorrenti = 0
    let unaTantum = 0
    for (const s of spese) {
      if (s.tipo === 'ricorrente') {
        ricorrenti += s.amount * mensilitaNelPeriodo(s, mesi)
      } else if (s.data && s.data >= fromISO && s.data <= toISO) {
        unaTantum += s.amount
      }
    }
    return { ricorrenti, unaTantum, totale: ricorrenti + unaTantum, mesi }
  }, [spese, fromISO, toISO])

  /** Righe attive nel periodo, con quante mensilita' pesano (per il pannello). */
  const righeNelPeriodo = useMemo(() => {
    if (!fromISO || !toISO) return [] as (ReportSpesa & { mensilita: number; pesa: number })[]
    const mesi = mesiNelPeriodo(fromISO, toISO)
    return spese
      .map(s => {
        const mensilita = s.tipo === 'ricorrente' ? mensilitaNelPeriodo(s, mesi) : 0
        const pesa = s.tipo === 'ricorrente'
          ? s.amount * mensilita
          : (s.data && s.data >= fromISO && s.data <= toISO ? s.amount : 0)
        return { ...s, mensilita, pesa }
      })
  }, [spese, fromISO, toISO])

  const create = useCallback(async (row: Omit<ReportSpesa, 'id' | 'business'>) => {
    setSaving(true)
    try {
      const { error } = await supabase.from('report_spese').insert([{ ...row, business }])
      if (error) throw error
      await reload()
      return null
    } catch (e) {
      return (e as { message?: string })?.message || 'Errore nel salvataggio'
    } finally {
      setSaving(false)
    }
  }, [business, reload])

  const update = useCallback(async (id: string, patch: Partial<ReportSpesa>) => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('report_spese')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      await reload()
      return null
    } catch (e) {
      return (e as { message?: string })?.message || 'Errore nel salvataggio'
    } finally {
      setSaving(false)
    }
  }, [reload])

  const remove = useCallback(async (id: string) => {
    setSaving(true)
    try {
      const { error } = await supabase.from('report_spese').delete().eq('id', id)
      if (error) throw error
      await reload()
      return null
    } catch (e) {
      return (e as { message?: string })?.message || 'Errore nell’eliminazione'
    } finally {
      setSaving(false)
    }
  }, [reload])

  return { spese, righeNelPeriodo, totali, loading, saving, reload, create, update, remove }
}
