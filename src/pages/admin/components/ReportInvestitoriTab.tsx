// 06/10/2026 (direzione): Report > Investitori.
// Stessa forma degli altri Report: barra Periodo, schede, grafico, tabelle.
// Scarica PDF / Excel / PDF per mese arrivano dal pulsante comune del
// gestionale (ScaricaPdfReport in AdminDashboard) grazie a useRegistraPeriodoReport.
// Dati: investitori + investitori_versamenti + investitori_valutazione, stessa
// RLS della tab Amministrazione > Investitori (dr7_puo_vedere_investitori).
// La colonna si chiama "Nome": con "PDF senza nomi" sparisce dal PDF.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../supabaseClient'
import { useRegistraPeriodoReport } from '../../../utils/reportPeriodo'
import { ScheletroTabella } from '../../../components/Scheletro'
import { ReportPeriodo, usePeriodoReport } from './ReportPeriodo'
import {
  ReportShell, ReportKpiGrid, ReportKpi, ReportCard, ReportTable, ReportRow, ReportTotalRow,
  ReportEmpty, ReportError, ReportButton, ReportGrafici, ReportGrafico,
} from './ReportUI'

interface Investitore {
  id: string
  nome: string
  tipo: 'persona' | 'societa'
  quota_percentuale: number | null
  numero_azioni: number | null
}

interface Versamento {
  id: string
  investitore_id: string
  importo: number
  data_versamento: string
  strumento: string | null
  note: string | null
}

function eur(n: number): string {
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
}
function itDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
function numero(n: number): string {
  return n.toLocaleString('it-IT', { maximumFractionDigits: 0 })
}
function perc(n: number): string {
  return `${n.toLocaleString('it-IT', { maximumFractionDigits: 2 })}%`
}

const th = 'px-4 py-3'

export default function ReportInvestitoriTab() {
  const [investitori, setInvestitori] = useState<Investitore[]>([])
  const [versamenti, setVersamenti] = useState<Versamento[]>([])
  const [valutazione, setValutazione] = useState<{ valutazione: number | null; costo_azione: number | null }>({ valutazione: null, costo_azione: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Gli investimenti si leggono sull'anno, non sul mese.
  const periodo = usePeriodoReport('anno')
  useRegistraPeriodoReport({
    imposta: (f, t) => periodo.impostaIntervallo(f, t),
    periodo: { from: periodo.da, to: periodo.a },
    inCaricamento: loading,
  })

  async function carica() {
    setLoading(true)
    setError('')
    const [inv, ver, val] = await Promise.all([
      supabase.from('investitori').select('id, nome, tipo, quota_percentuale, numero_azioni').order('nome'),
      supabase.from('investitori_versamenti').select('id, investitore_id, importo, data_versamento, strumento, note').order('data_versamento', { ascending: true }),
      supabase.from('investitori_valutazione').select('valutazione, costo_azione').eq('id', 1).maybeSingle(),
    ])
    if (inv.error || ver.error) setError('Errore nel caricamento: ' + (inv.error || ver.error)?.message)
    setInvestitori(((inv.data as Investitore[]) || []).map(i => ({
      ...i,
      quota_percentuale: i.quota_percentuale != null ? Number(i.quota_percentuale) : null,
      numero_azioni: i.numero_azioni != null ? Number(i.numero_azioni) : null,
    })))
    setVersamenti(((ver.data as Versamento[]) || []).map(v => ({ ...v, importo: Number(v.importo) })))
    setValutazione({
      valutazione: val.data?.valutazione != null ? Number(val.data.valutazione) : null,
      costo_azione: val.data?.costo_azione != null ? Number(val.data.costo_azione) : null,
    })
    setLoading(false)
  }

  useEffect(() => { carica() }, [])

  const nomeDi = useMemo(() => new Map(investitori.map(i => [i.id, i.nome])), [investitori])

  // Nel periodo = versamenti fra da e a; fino a fine periodo = capitale raccolto a quella data.
  const nelPeriodo = useMemo(
    () => versamenti.filter(v => v.data_versamento >= periodo.da && v.data_versamento <= periodo.a),
    [versamenti, periodo.da, periodo.a]
  )
  const finoAFine = useMemo(() => versamenti.filter(v => v.data_versamento <= periodo.a), [versamenti, periodo.a])

  const somma = (vs: Versamento[]) => vs.reduce((s, v) => s + v.importo, 0)
  const versatoPeriodo = somma(nelPeriodo)
  const capitaleFine = somma(finoAFine)
  const totaleAzioni = investitori.reduce((s, i) => s + (i.numero_azioni || 0), 0)

  const righe = useMemo(() => {
    const per = new Map<string, { periodo: number; totale: number; n: number; ultimo: string | null }>()
    for (const i of investitori) per.set(i.id, { periodo: 0, totale: 0, n: 0, ultimo: null })
    for (const v of finoAFine) {
      const r = per.get(v.investitore_id)
      if (!r) continue
      r.totale += v.importo
      if (v.data_versamento >= periodo.da) { r.periodo += v.importo; r.n++ }
      if (!r.ultimo || v.data_versamento > r.ultimo) r.ultimo = v.data_versamento
    }
    return investitori
      .map(i => ({ ...i, ...per.get(i.id)! }))
      .filter(r => r.totale > 0 || r.numero_azioni)
      .sort((a, b) => b.totale - a.totale)
  }, [investitori, finoAFine, periodo.da])

  const investitoriAttivi = righe.filter(r => r.totale > 0).length
  const nuoviNelPeriodo = useMemo(() => {
    const primo = new Map<string, string>()
    for (const v of versamenti) {
      const p = primo.get(v.investitore_id)
      if (!p || v.data_versamento < p) primo.set(v.investitore_id, v.data_versamento)
    }
    return [...primo.values()].filter(d => d >= periodo.da && d <= periodo.a).length
  }, [versamenti, periodo.da, periodo.a])

  const perStrumento = useMemo(() => {
    const m = new Map<string, { importo: number; n: number }>()
    for (const v of nelPeriodo) {
      const k = v.strumento || 'Non indicato'
      const r = m.get(k) || { importo: 0, n: 0 }
      r.importo += v.importo
      r.n++
      m.set(k, r)
    }
    return [...m.entries()].map(([strumento, r]) => ({ strumento, ...r })).sort((a, b) => b.importo - a.importo)
  }, [nelPeriodo])

  const dettaglio = useMemo(() => [...nelPeriodo].reverse(), [nelPeriodo])
  const sommaAzioniRighe = righe.reduce((s, r) => s + (r.numero_azioni || 0), 0)
  const sommaQuoteRighe = righe.reduce((s, r) => s + (r.quota_percentuale || 0), 0)

  return (
    <ReportShell
      title="Report Investitori"
      subtitle="Capitale raccolto, versamenti e ripartizione delle azioni. Il capitale e' calcolato fino alla fine del periodo scelto."
    >
      <div className="flex flex-wrap items-end gap-3">
        <ReportPeriodo periodo={periodo} />
        <ReportButton onClick={carica} disabled={loading}>{loading ? 'Aggiorno…' : 'Aggiorna'}</ReportButton>
      </div>

      {error && <ReportError message={error} />}

      {loading ? (
        <ScheletroTabella righe={6} colonne={5} />
      ) : (
        <>
          <ReportKpiGrid>
            <ReportKpi label="Versato nel periodo" value={eur(versatoPeriodo)} sub={`${nelPeriodo.length} versamento/i`} tone="gold" />
            <ReportKpi label="Capitale raccolto" value={eur(capitaleFine)} sub={`al ${itDate(periodo.a)}`} />
            <ReportKpi label="Investitori" value={numero(investitoriAttivi)} sub={`${nuoviNelPeriodo} nuovo/i nel periodo`} />
            <ReportKpi label="Azioni assegnate" value={numero(totaleAzioni)} sub={valutazione.costo_azione ? `${eur(valutazione.costo_azione)} per azione` : 'costo azione non impostato'} />
            <ReportKpi label="Valutazione azienda" value={valutazione.valutazione ? eur(valutazione.valutazione) : '—'} sub={valutazione.valutazione && capitaleFine > 0 ? `raccolto ${perc((capitaleFine / valutazione.valutazione) * 100)} della valutazione` : undefined} tone="muted" />
          </ReportKpiGrid>

          <ReportGrafici>
            <ReportGrafico
              titolo="Versamenti (€)"
              punti={nelPeriodo.map(v => ({ data: v.data_versamento, valore: v.importo }))}
              da={periodo.da}
              a={periodo.a}
              colore="gold"
              formato={eur}
              totale={versatoPeriodo}
            />
            <ReportGrafico
              titolo="Numero di versamenti"
              punti={nelPeriodo.map(v => ({ data: v.data_versamento, valore: 1 }))}
              da={periodo.da}
              a={periodo.a}
              colore="cyan"
              formato={numero}
              totale={nelPeriodo.length}
            />
          </ReportGrafici>

          <ReportCard title="Investitori" right={`capitale al ${itDate(periodo.a)}`}>
            {righe.length === 0 ? (
              <ReportEmpty message="Nessun investitore con versamenti fino a questa data" />
            ) : (
              <ReportTable
                head={
                  <>
                    <th className={`text-left ${th}`}>Nome</th>
                    <th className={`text-left ${th}`}>Tipo</th>
                    <th className={`text-right ${th}`}>Versato nel periodo</th>
                    <th className={`text-right ${th}`}>Totale versato</th>
                    <th className={`text-right ${th}`}>% del capitale</th>
                    <th className={`text-right ${th}`}>Quota %</th>
                    <th className={`text-right ${th}`}>Azioni</th>
                    <th className={`text-left ${th}`}>Ultimo versamento</th>
                  </>
                }
                foot={
                  <ReportTotalRow>
                    <td className={th}>Totale</td>
                    <td className={th}>{righe.length}</td>
                    <td className={`${th} text-right tabular-nums`}>{eur(versatoPeriodo)}</td>
                    <td className={`${th} text-right tabular-nums`}>{eur(capitaleFine)}</td>
                    <td className={`${th} text-right tabular-nums`}>{capitaleFine > 0 ? '100%' : '—'}</td>
                    <td className={`${th} text-right tabular-nums`}>{sommaQuoteRighe > 0 ? perc(sommaQuoteRighe) : '—'}</td>
                    <td className={`${th} text-right tabular-nums`}>{numero(sommaAzioniRighe)}</td>
                    <td className={th} />
                  </ReportTotalRow>
                }
              >
                {righe.map(r => (
                  <ReportRow key={r.id}>
                    <td className={`${th} text-theme-text-primary font-medium`}>{r.nome}</td>
                    <td className={`${th} text-theme-text-muted`}>{r.tipo === 'societa' ? 'Società' : 'Persona'}</td>
                    <td className={`${th} text-right tabular-nums`}>{r.periodo > 0 ? eur(r.periodo) : '—'}</td>
                    <td className={`${th} text-right tabular-nums text-dr7-gold font-semibold`}>{eur(r.totale)}</td>
                    <td className={`${th} text-right tabular-nums`}>{capitaleFine > 0 ? perc((r.totale / capitaleFine) * 100) : '—'}</td>
                    <td className={`${th} text-right tabular-nums`}>{r.quota_percentuale != null ? perc(r.quota_percentuale) : '—'}</td>
                    <td className={`${th} text-right tabular-nums`}>{r.numero_azioni != null ? numero(r.numero_azioni) : '—'}</td>
                    <td className={`${th} text-theme-text-muted tabular-nums`}>{r.ultimo ? itDate(r.ultimo) : '—'}</td>
                  </ReportRow>
                ))}
              </ReportTable>
            )}
          </ReportCard>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <ReportCard title="Versamenti nel periodo" className="xl:col-span-2">
              {dettaglio.length === 0 ? (
                <ReportEmpty message="Nessun versamento nel periodo" />
              ) : (
                <ReportTable
                  head={
                    <>
                      <th className={`text-left ${th}`}>Data</th>
                      <th className={`text-left ${th}`}>Nome</th>
                      <th className={`text-left ${th}`}>Modalità</th>
                      <th className={`text-right ${th}`}>Importo</th>
                      <th className={`text-left ${th}`}>Nota</th>
                    </>
                  }
                  foot={
                    <ReportTotalRow>
                      <td className={th}>Totale</td>
                      <td className={th}>{dettaglio.length} versamento/i</td>
                      <td className={th} />
                      <td className={`${th} text-right tabular-nums`}>{eur(versatoPeriodo)}</td>
                      <td className={th} />
                    </ReportTotalRow>
                  }
                >
                  {dettaglio.map(v => (
                    <ReportRow key={v.id}>
                      <td className={`${th} tabular-nums`}>{itDate(v.data_versamento)}</td>
                      <td className={`${th} text-theme-text-primary`}>{nomeDi.get(v.investitore_id) || '—'}</td>
                      <td className={`${th} text-theme-text-muted`}>{v.strumento || '—'}</td>
                      <td className={`${th} text-right tabular-nums font-semibold`}>{eur(v.importo)}</td>
                      <td className={`${th} text-theme-text-muted`}>{v.note || ''}</td>
                    </ReportRow>
                  ))}
                </ReportTable>
              )}
            </ReportCard>

            <ReportCard title="Per modalità">
              {perStrumento.length === 0 ? (
                <ReportEmpty message="Nessun versamento nel periodo" />
              ) : (
                <ReportTable
                  head={
                    <>
                      <th className={`text-left ${th}`}>Modalità</th>
                      <th className={`text-right ${th}`}>N.</th>
                      <th className={`text-right ${th}`}>Importo</th>
                    </>
                  }
                  foot={
                    <ReportTotalRow>
                      <td className={th}>Totale</td>
                      <td className={`${th} text-right tabular-nums`}>{nelPeriodo.length}</td>
                      <td className={`${th} text-right tabular-nums`}>{eur(versatoPeriodo)}</td>
                    </ReportTotalRow>
                  }
                >
                  {perStrumento.map(s => (
                    <ReportRow key={s.strumento}>
                      <td className={th}>{s.strumento}</td>
                      <td className={`${th} text-right tabular-nums`}>{s.n}</td>
                      <td className={`${th} text-right tabular-nums`}>{eur(s.importo)}</td>
                    </ReportRow>
                  ))}
                </ReportTable>
              )}
            </ReportCard>
          </div>
        </>
      )}
    </ReportShell>
  )
}
