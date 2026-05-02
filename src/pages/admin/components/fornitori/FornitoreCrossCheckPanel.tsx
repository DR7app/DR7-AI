import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../../supabaseClient'
import type { Fornitore, FornitoreDocument } from './types'

interface Props {
  fornitore: Fornitore
}

interface BolleVsFatturaRow {
  fattura: FornitoreDocument | null
  bolle: FornitoreDocument[]
  fattura_total: number
  bolle_total: number
  diff: number
  status: 'verificato' | 'anomalia' | 'fattura_mancante' | 'bolle_mancanti'
}

const TOLERANCE_EUR = 0.01

function fmtEUR(v: number) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(v)
}

function monthLabel(year: number, month: number) {
  const months = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
  return `${months[month - 1]} ${year}`
}

export default function FornitoreCrossCheck({ fornitore }: Props) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [docs, setDocs] = useState<FornitoreDocument[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('fornitore_documents')
        .select('*')
        .eq('fornitore_id', fornitore.id)
        .eq('periodo_anno', year)
        .eq('periodo_mese', month)
      if (error) throw error
      setDocs((data || []) as FornitoreDocument[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fornitore.id, year, month])

  const rows = useMemo<BolleVsFatturaRow[]>(() => {
    const fatture = docs.filter(d => d.tipo === 'fattura')
    const bolle = docs.filter(d => d.tipo === 'ddt' || d.tipo === 'bolla')
    if (fatture.length === 0 && bolle.length === 0) return []

    // Group bolle either by their fattura_collegata_id (manual link) or "unmatched"
    const out: BolleVsFatturaRow[] = []

    for (const f of fatture) {
      const linked = bolle.filter(b => b.fattura_collegata_id === f.id)
      const totalLinked = linked.reduce((s, b) => s + Number(b.importo_totale || 0), 0)
      const fatturaTotal = Number(f.importo_totale || 0)
      const diff = fatturaTotal - totalLinked
      let status: BolleVsFatturaRow['status'] = 'verificato'
      if (linked.length === 0) status = 'bolle_mancanti'
      else if (Math.abs(diff) > TOLERANCE_EUR) status = 'anomalia'
      out.push({ fattura: f, bolle: linked, fattura_total: fatturaTotal, bolle_total: totalLinked, diff, status })
    }

    // Bolle non collegate a nessuna fattura
    const orphans = bolle.filter(b => !b.fattura_collegata_id)
    if (orphans.length > 0) {
      const total = orphans.reduce((s, b) => s + Number(b.importo_totale || 0), 0)
      out.push({
        fattura: null,
        bolle: orphans,
        fattura_total: 0,
        bolle_total: total,
        diff: -total,
        status: 'fattura_mancante',
      })
    }

    return out
  }, [docs])

  const totals = useMemo(() => {
    const fatture = rows.reduce((s, r) => s + r.fattura_total, 0)
    const bolle = rows.reduce((s, r) => s + r.bolle_total, 0)
    return { fatture, bolle, diff: fatture - bolle }
  }, [rows])

  async function linkBollaToFattura(bolla: FornitoreDocument, fatturaId: string | null) {
    const { error } = await supabase
      .from('fornitore_documents')
      .update({ fattura_collegata_id: fatturaId })
      .eq('id', bolla.id)
    if (error) {
      alert('Errore: ' + error.message)
      return
    }
    load()
  }

  const fatture = docs.filter(d => d.tipo === 'fattura')

  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1)
  const yearOptions: number[] = []
  for (let y = today.getFullYear() + 1; y >= 2026; y--) yearOptions.push(y)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-semibold text-theme-text-primary">Controllo incrociato — {monthLabel(year, month)}</h3>
        <select value={year} onChange={e => setYear(parseInt(e.target.value))}
          className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-1.5 text-theme-text-primary text-sm">
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={month} onChange={e => setMonth(parseInt(e.target.value))}
          className="bg-theme-bg-tertiary border border-theme-border rounded px-3 py-1.5 text-theme-text-primary text-sm">
          {monthOptions.map(m => <option key={m} value={m}>{monthLabel(year, m).split(' ')[0]}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-theme-bg-secondary border border-theme-border rounded p-4">
          <p className="text-theme-text-muted text-xs uppercase tracking-wider">Totale Fatture</p>
          <p className="text-2xl font-bold text-theme-text-primary mt-1">{fmtEUR(totals.fatture)}</p>
        </div>
        <div className="bg-theme-bg-secondary border border-theme-border rounded p-4">
          <p className="text-theme-text-muted text-xs uppercase tracking-wider">Totale Bolle/DDT</p>
          <p className="text-2xl font-bold text-theme-text-primary mt-1">{fmtEUR(totals.bolle)}</p>
        </div>
        <div className={`border rounded p-4 ${Math.abs(totals.diff) < TOLERANCE_EUR ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
          <p className="text-theme-text-muted text-xs uppercase tracking-wider">Differenza</p>
          <p className={`text-2xl font-bold mt-1 ${Math.abs(totals.diff) < TOLERANCE_EUR ? 'text-emerald-400' : 'text-amber-400'}`}>{fmtEUR(totals.diff)}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10 text-theme-text-muted">Caricamento...</div>
      ) : rows.length === 0 ? (
        <div className="bg-theme-bg-secondary border border-theme-border rounded p-10 text-center text-theme-text-muted">
          Nessuna fattura ne' bolla in {monthLabel(year, month)}.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r, idx) => (
            <div key={r.fattura?.id || `orphans-${idx}`} className={`border rounded-lg p-4 ${
              r.status === 'verificato' ? 'border-emerald-500/30 bg-emerald-500/5'
                : r.status === 'anomalia' ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-red-500/30 bg-red-500/5'
            }`}>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                {r.fattura ? (
                  <>
                    <span className="text-theme-text-primary font-semibold">Fattura n. {r.fattura.numero_documento}</span>
                    <span className="text-theme-text-muted text-sm">{r.fattura.data_documento}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      r.status === 'verificato' ? 'bg-emerald-600 text-white'
                        : r.status === 'anomalia' ? 'bg-amber-600 text-white'
                        : 'bg-red-600 text-white'
                    }`}>
                      {r.status === 'verificato' ? 'OK' : r.status === 'anomalia' ? `ANOMALIA ${fmtEUR(r.diff)}` : 'BOLLE MANCANTI'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-red-400 font-semibold">Bolle senza fattura</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-600 text-white font-semibold">FATTURA MANCANTE</span>
                  </>
                )}
                <span className="ml-auto text-sm text-theme-text-secondary">
                  Fattura: <strong>{fmtEUR(r.fattura_total)}</strong> · Bolle: <strong>{fmtEUR(r.bolle_total)}</strong>
                </span>
              </div>

              {r.bolle.length > 0 ? (
                <table className="w-full text-sm">
                  <thead className="text-theme-text-muted text-xs uppercase">
                    <tr>
                      <th className="text-left py-1">Tipo</th>
                      <th className="text-left py-1">N°</th>
                      <th className="text-left py-1">Data</th>
                      <th className="text-right py-1">Importo</th>
                      {!r.fattura && fatture.length > 0 && <th className="text-left py-1">Collega a fattura</th>}
                      {r.fattura && <th className="text-right py-1">Azione</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {r.bolle.map(b => (
                      <tr key={b.id}>
                        <td className="py-1 text-theme-text-secondary uppercase">{b.tipo}</td>
                        <td className="py-1 text-theme-text-primary">{b.numero_documento}</td>
                        <td className="py-1 text-theme-text-secondary">{b.data_documento}</td>
                        <td className="py-1 text-right text-theme-text-primary font-semibold">{fmtEUR(Number(b.importo_totale || 0))}</td>
                        {!r.fattura && fatture.length > 0 && (
                          <td className="py-1">
                            <select
                              defaultValue=""
                              onChange={(e) => linkBollaToFattura(b, e.target.value || null)}
                              className="bg-theme-bg-tertiary border border-theme-border rounded px-2 py-1 text-xs text-theme-text-primary"
                            >
                              <option value="">-- collega --</option>
                              {fatture.map(f => (
                                <option key={f.id} value={f.id}>n. {f.numero_documento} ({f.data_documento})</option>
                              ))}
                            </select>
                          </td>
                        )}
                        {r.fattura && (
                          <td className="py-1 text-right">
                            <button
                              onClick={() => linkBollaToFattura(b, null)}
                              className="text-xs px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary"
                            >
                              Scollega
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-theme-text-muted italic">Nessuna bolla collegata a questa fattura.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
