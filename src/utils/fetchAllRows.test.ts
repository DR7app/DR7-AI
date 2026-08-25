import { describe, it, expect } from 'vitest'
import { fetchAllRows } from './fetchAllRows'

/** Tabella finta di N righe, servita a pagine come fa PostgREST. */
function makeTable(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: `r${i}`, n: i }))
  const calls: Array<[number, number]> = []
  const page = async (from: number, to: number) => {
    calls.push([from, to])
    return { data: rows.slice(from, to + 1), error: null }
  }
  return { rows, page, calls }
}

describe('fetchAllRows', () => {
  it('restituisce TUTTE le righe quando ne servono piu pagine', async () => {
    const t = makeTable(2547)
    const res = await fetchAllRows<{ id: string }>(t.page, { pageSize: 1000 })
    expect(res.error).toBeNull()
    expect(res.data).toHaveLength(2547)
    expect(res.data.map(r => r.id)).toEqual(t.rows.map(r => r.id))
  })

  it('conserva ordine delle pagine anche se arrivano fuori sequenza', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `r${i}` }))
    const page = async (from: number, to: number) => {
      // La terza pagina risponde per prima.
      if (from > 0) await new Promise(r => setTimeout(r, from === 1000 ? 20 : 1))
      return { data: rows.slice(from, to + 1), error: null }
    }
    const res = await fetchAllRows<{ id: string }>(page, { pageSize: 1000 })
    expect(res.data.map(r => r.id)).toEqual(rows.map(r => r.id))
  })

  it('una sola richiesta se la tabella sta in una pagina', async () => {
    const t = makeTable(42)
    const res = await fetchAllRows(t.page, { pageSize: 1000 })
    expect(res.data).toHaveLength(42)
    expect(t.calls).toHaveLength(1)
  })

  it('tabella vuota', async () => {
    const t = makeTable(0)
    const res = await fetchAllRows(t.page, { pageSize: 1000 })
    expect(res.data).toEqual([])
  })

  it('esattamente un multiplo della pagina: non perde e non duplica', async () => {
    const t = makeTable(2000)
    const res = await fetchAllRows<{ id: string }>(t.page, { pageSize: 1000 })
    expect(res.data).toHaveLength(2000)
    expect(new Set(res.data.map(r => r.id)).size).toBe(2000)
  })

  it('toglie i doppioni se una riga scivola in due pagine', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: `r${i}` }))
    const page = async (from: number, to: number) => {
      // Simula un inserimento a meta' paginazione: r999 ricompare.
      if (from === 1000) return { data: [rows[999], ...rows.slice(1000, to + 1)], error: null }
      return { data: rows.slice(from, to + 1), error: null }
    }
    const res = await fetchAllRows<{ id: string }>(page, { pageSize: 1000 })
    expect(new Set(res.data.map(r => r.id)).size).toBe(res.data.length)
    expect(res.data).toHaveLength(1500)
  })

  it('propaga errore della prima pagina', async () => {
    const page = async () => ({ data: null, error: { message: 'boom' } })
    const res = await fetchAllRows(page, { pageSize: 1000 })
    expect(res.error).toEqual({ message: 'boom' })
    expect(res.data).toEqual([])
  })

  it('chiede le pagine successive in parallelo, non una alla volta', async () => {
    const t = makeTable(4000)
    let inFlight = 0
    let maxInFlight = 0
    const page = async (from: number, to: number) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      return t.page(from, to)
    }
    await fetchAllRows(page, { pageSize: 1000, burst: 4 })
    expect(maxInFlight).toBeGreaterThan(1)
  })
})
