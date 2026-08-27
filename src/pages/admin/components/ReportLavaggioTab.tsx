import { useState, useEffect, useCallback, useMemo } from 'react'
import { loadReportOverrides, applyOverrides, saveEditOverride, saveRemoveOverride, deleteOverrideByRow, deleteOverrideById, type LoadedOverrides } from '../../../utils/reportOverrides'
import { ReportRowModal, type FieldDef } from './ReportRowModal'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'
import MoneyInput from '../../../components/MoneyInput'
import {
  ReportShell, ReportToolbar, ReportField, ReportButton, ReportKpiGrid, ReportKpi,
  ReportCard, ReportTable, ReportRow, ReportTotalRow, ReportEmpty, ReportError,
  REPORT_INPUT_CLASS,
} from './ReportUI'

interface WashTypeBreakdown {
  type: string
  count: number
  revenue: number
}

interface InternalWashBreakdown {
  vehicle: string
  count: number
}

interface WashReportData {
  month: string
  daysInMonth: number
  billableWashesCount: number
  washRevenue: number
  avgWashesPerDay: number
  byType: WashTypeBreakdown[]
  internalWashesCount?: number
  internalByVehicle?: InternalWashBreakdown[]
}

interface MonthlyTrendPoint {
  month: string
  revenue: number
  count: number
  label: string
}

const MONTH_LABELS_IT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

function formatCurrency(amount: number, frac = 2): string {
  return `€${amount.toLocaleString('it-IT', { minimumFractionDigits: frac, maximumFractionDigits: frac })}`
}

function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  return `${MONTH_LABELS_IT[(m - 1) % 12]} ${String(y).slice(2)}`
}

export default function ReportLavaggioTab() {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [washData, setWashData] = useState<WashReportData | null>(null)
  // 2026-08-10 (roadmap #38): correzione manuale delle voci, come sul Report
  // Noleggio. Gli override si applicano SOPRA lo snapshot e PRIMA dei totali,
  // quindi si riapplicano a ogni rigenerazione e restano annullabili.
  const [overrides, setOverrides] = useState<LoadedOverrides>({ raw: [], removed: new Set(), edits: new Map(), added: [], notesByRow: new Map() })
  const [editReport, setEditReport] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editRow, setEditRow] = useState<any | null>(null)
  const EDIT_FIELDS: FieldDef[] = [
    { key: 'revenue', label: 'Ricavo €' },
    { key: 'count', label: 'Numero lavaggi' },
  ]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rowKeyOf = (r: any) => String(r.type || '-')
  async function reloadOv() { setOverrides(await loadReportOverrides('lavaggio')) }
  async function saveEdit(changes: Record<string, number>, note: string) {
    if (!editRow) return
    for (const [field, value] of Object.entries(changes)) await saveEditOverride('lavaggio', rowKeyOf(editRow), field, value, note)
    setEditRow(null); await reloadOv(); toast.success('Voce corretta')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function removeRow(r: any) {
    if (!window.confirm(`Rimuovere "${r.type}" dal report?`)) return
    if (r._isManual) await deleteOverrideById(r._manualId); else await saveRemoveOverride('lavaggio', rowKeyOf(r), null)
    await reloadOv(); toast.success('Voce rimossa')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function restoreRow(r: any) {
    if (r._isManual) await deleteOverrideById(r._manualId); else await deleteOverrideByRow('lavaggio', rowKeyOf(r))
    await reloadOv(); toast.success('Voce ripristinata')
  }
  // Righe con gli override gia' applicati: usate da tabella, grafici e totali.
  const byTypeRows = useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => applyOverrides((washData?.byType || []) as any, overrides, rowKeyOf) as any[],
    [washData, overrides]) // eslint-disable-line react-hooks/exhaustive-deps
  const [trend, setTrend] = useState<MonthlyTrendPoint[]>([])
  const [trendLoading, setTrendLoading] = useState(false)

  const { hasRole } = useAdminRole()
  const canEditStipendio = hasRole('stipendio-editor')
  const [spesaMerce, setSpesaMerce] = useState<number>(0)
  const [costsLoading, setCostsLoading] = useState(false)
  // 2026-08-20 (richiesta direzione): modificabili TUTTE le voci di Costi &
  // Margine, non solo lo stipendio. Ricavo e Spesa Merce restano calcolati dai
  // dati reali (prenotazioni e fatture fornitori); quando la direzione scrive un
  // valore, quello VINCE per il mese scelto e resta segnalato come modificato,
  // con il calcolato sempre visibile e ripristinabile in un click.
  // 2026-08-20 (richiesta direzione): voci di costo LIBERE, aggiunte a mano
  // (es. "Spese acqua corrente"). Vivono per mese in
  // centralina_pro_config.lavaggio.voci_extra_mensili e entrano nel Margine.
  type VoceExtra = { id: string; label: string; importo: number }
  const [vociExtra, setVociExtra] = useState<VoceExtra[]>([])
  const [nuovaVoceLabel, setNuovaVoceLabel] = useState('')
  const [nuovaVoceImporto, setNuovaVoceImporto] = useState('')
  const [aggiungendoVoce, setAggiungendoVoce] = useState(false)
  const [ricavoOverride, setRicavoOverride] = useState<number | null>(null)
  const [spesaOverride, setSpesaOverride] = useState<number | null>(null)
  const [stipendio, setStipendio] = useState<number>(0)
  const [stipendioSaving, setStipendioSaving] = useState(false)

  const loadCosts = useCallback(async () => {
    setCostsLoading(true)
    try {
      const [year, month] = selectedMonth.split('-').map(Number)
      const monthStart = `${selectedMonth}-01`
      const lastDay = new Date(year, month, 0).getDate()
      const monthEnd = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`

      const { data: fornitori } = await supabase
        .from('fornitori')
        .select('id')
        .eq('categoria_merce', 'lavaggio_prodotti')
      const ids = (fornitori || []).map(f => f.id)
      let spesa = 0
      if (ids.length > 0) {
        const { data: fatture } = await supabase
          .from('fornitore_documents')
          .select('importo_totale')
          .in('fornitore_id', ids)
          .eq('tipo', 'fattura')
          .gte('data_documento', monthStart)
          .lte('data_documento', monthEnd)
        spesa = (fatture || []).reduce((s, d: { importo_totale: number | string | null }) => s + (Number(d.importo_totale) || 0), 0)
      }
      setSpesaMerce(spesa)

      const { data: cfgRow } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      const cfg = (cfgRow?.config || {}) as Record<string, unknown>
      const lav = (cfg.lavaggio || {}) as Record<string, unknown>
      const stip = (lav.stipendi_mensili || {}) as Record<string, number>
      const value = Number(stip[selectedMonth] ?? 0) || 0
      setStipendio(value)
      const ricOv = (lav.ricavi_mensili || {}) as Record<string, number>
      const speOv = (lav.spese_merce_mensili || {}) as Record<string, number>
      setRicavoOverride(ricOv[selectedMonth] != null ? Number(ricOv[selectedMonth]) : null)
      setSpesaOverride(speOv[selectedMonth] != null ? Number(speOv[selectedMonth]) : null)
      const extraMap = (lav.voci_extra_mensili || {}) as Record<string, VoceExtra[]>
      setVociExtra(Array.isArray(extraMap[selectedMonth]) ? extraMap[selectedMonth] : [])
    } catch (err) {
      console.error('[ReportLavaggio] loadCosts error:', err)
    } finally {
      setCostsLoading(false)
    }
  }, [selectedMonth])

  useEffect(() => { loadCosts() }, [loadCosts])

  useEffect(() => {
    fetchReport()
    fetchTrend()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth])

  // Salvataggio/azzeramento di un override mensile. `null` rimuove la voce e
  // fa tornare in vigore il valore calcolato.
  const [overrideSaving, setOverrideSaving] = useState(false)
  async function saveOverride(campo: 'ricavi_mensili' | 'spese_merce_mensili', valore: number | null) {
    setOverrideSaving(true)
    try {
      const { data: cfgRow } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      const cfg = (cfgRow?.config || {}) as Record<string, unknown>
      const lav = { ...((cfg.lavaggio as Record<string, unknown>) || {}) }
      const mappa = { ...((lav[campo] as Record<string, number>) || {}) }
      if (valore == null) delete mappa[selectedMonth]
      else mappa[selectedMonth] = valore
      lav[campo] = mappa
      const { error } = await supabase
        .from('centralina_pro_config')
        .upsert({ id: 'main', config: { ...cfg, lavaggio: lav } }, { onConflict: 'id' })
      if (error) throw error
      if (campo === 'ricavi_mensili') setRicavoOverride(valore)
      else setSpesaOverride(valore)
      toast.success(valore == null ? 'Valore ripristinato al calcolato' : 'Valore salvato')
    } catch (e) {
      toast.error('Salvataggio fallito: ' + (e instanceof Error ? e.message : 'errore'))
    } finally {
      setOverrideSaving(false)
    }
  }

  // Scrive l'elenco completo delle voci del mese (aggiunta, modifica, rimozione
  // passano tutte di qui: una sola strada verso il database).
  async function salvaVociExtra(nuovo: VoceExtra[]) {
    setOverrideSaving(true)
    try {
      const { data: cfgRow } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      const cfg = (cfgRow?.config || {}) as Record<string, unknown>
      const lav = { ...((cfg.lavaggio as Record<string, unknown>) || {}) }
      const mappa = { ...((lav.voci_extra_mensili as Record<string, VoceExtra[]>) || {}) }
      if (nuovo.length === 0) delete mappa[selectedMonth]
      else mappa[selectedMonth] = nuovo
      lav.voci_extra_mensili = mappa
      const { error } = await supabase
        .from('centralina_pro_config')
        .upsert({ id: 'main', config: { ...cfg, lavaggio: lav } }, { onConflict: 'id' })
      if (error) throw error
      setVociExtra(nuovo)
    } catch (e) {
      toast.error('Salvataggio voce fallito: ' + (e instanceof Error ? e.message : 'errore'))
    } finally {
      setOverrideSaving(false)
    }
  }

  async function aggiungiVoce() {
    const label = nuovaVoceLabel.trim()
    const importo = parseFloat((nuovaVoceImporto || '').replace(',', '.'))
    if (!label) { toast.error('Dai un nome alla voce'); return }
    if (!Number.isFinite(importo) || importo < 0) { toast.error('Importo non valido'); return }
    const id = `v${Date.now().toString(36)}`
    await salvaVociExtra([...vociExtra, { id, label, importo }])
    setNuovaVoceLabel(''); setNuovaVoceImporto(''); setAggiungendoVoce(false)
    toast.success('Voce aggiunta')
  }

  async function saveStipendioValue(parsed: number) {
    setStipendioSaving(true)
    try {
      const { data: cfgRow } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      const cfg = (cfgRow?.config || {}) as Record<string, unknown>
      const lav = { ...((cfg.lavaggio as Record<string, unknown>) || {}) }
      const stipendi = { ...((lav.stipendi_mensili as Record<string, number>) || {}) }
      stipendi[selectedMonth] = parsed
      lav.stipendi_mensili = stipendi
      const nextCfg = { ...cfg, lavaggio: lav }
      const { error } = await supabase
        .from('centralina_pro_config')
        .upsert({ id: 'main', config: nextCfg }, { onConflict: 'id' })
      if (error) throw error
      setStipendio(parsed)
      toast.success('Stipendio salvato')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Errore salvataggio: ' + msg)
    } finally {
      setStipendioSaving(false)
    }
  }

  async function fetchReport() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/.netlify/functions/monthly-report?type=washes&month=${selectedMonth}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore nel caricamento')
      setWashData(data)
      setOverrides(await loadReportOverrides('lavaggio'))
    } catch (err: unknown) {
      const _errMsg = err instanceof Error ? err.message : String(err)
      setError(_errMsg || 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  async function fetchTrend() {
    setTrendLoading(true)
    try {
      const [year, month] = selectedMonth.split('-').map(Number)
      const months: string[] = []
      for (let i = 5; i >= 0; i--) {
        const d = new Date(year, month - 1 - i, 1)
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      }
      const results = await Promise.all(
        months.map(m =>
          fetch(`/.netlify/functions/monthly-report?type=washes&month=${m}`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        )
      )
      const points: MonthlyTrendPoint[] = months.map((m, i) => {
        const d = results[i] as WashReportData | null
        return {
          month: m,
          revenue: d?.washRevenue || 0,
          count: d?.billableWashesCount || 0,
          label: monthLabel(m),
        }
      })
      setTrend(points)
    } catch (e) {
      console.warn('[ReportLavaggio] fetchTrend failed:', e)
    } finally {
      setTrendLoading(false)
    }
  }

  const lavaggiFatt = washData?.billableWashesCount || 0
  const lavaggiInterni = washData?.internalWashesCount || 0
  const lavaggiTot = lavaggiFatt + lavaggiInterni
  // Calcolati dai dati reali...
  const ricavoCalcolato = washData?.washRevenue || 0
  const spesaCalcolata = spesaMerce
  // ...e valori EFFETTIVI usati nel margine: l'override della direzione vince.
  const ricavo = ricavoOverride ?? ricavoCalcolato
  const spesaEffettiva = spesaOverride ?? spesaCalcolata
  // Le voci libere sono COSTI: si sottraggono come le altre.
  const totaleVociExtra = vociExtra.reduce((t, v) => t + (Number(v.importo) || 0), 0)
  const margineReale = ricavo - spesaEffettiva - stipendio - totaleVociExtra
  const marginPct = ricavo > 0 ? Math.round((margineReale / ricavo) * 100) : 0
  const avgRevenuePerWash = lavaggiFatt > 0 ? ricavo / lavaggiFatt : 0

  const emptyState = !washData && !loading

  return (
    <ReportShell
      title="Report Mensili — Lavaggio & Meccanica"
      subtitle={`${washData?.daysInMonth || '—'} giorni · ${monthLabel(selectedMonth)}`}
    >
      {/* Controls */}
      <ReportToolbar>
        <ReportField label="Mese">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className={`${REPORT_INPUT_CLASS} font-mono tabular-nums`}
          />
        </ReportField>
        <ReportButton onClick={() => { fetchReport(); fetchTrend(); loadCosts() }} disabled={loading}>
          {loading ? 'Caricamento...' : 'Aggiorna'}
        </ReportButton>
        <button
          onClick={() => setEditReport(v => !v)}
          title="Correggi, rimuovi o ripristina a mano le voci del report"
          className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${editReport ? 'bg-amber-500/15 border-amber-500/40 text-amber-400' : 'bg-theme-bg-tertiary border-theme-border text-theme-text-secondary hover:text-theme-text-primary'}`}
        >
          {editReport ? '✓ Modifica report attiva' : '✎ Modifica report'}
        </button>
      </ReportToolbar>

      {error && <ReportError message={`Errore: ${error}`} />}

      {/* Summary Cards */}
      <ReportKpiGrid>
        <ReportKpi
          label="Lavaggi Totali"
          value={lavaggiTot}
          sub={`${lavaggiFatt} fatturati · ${lavaggiInterni} interni`}
        />
        <ReportKpi
          label="Lavaggi Fatturati"
          value={lavaggiFatt}
          sub={`media ${washData?.avgWashesPerDay ?? 0} al giorno`}
        />
        <ReportKpi
          label="Ricavo"
          value={formatCurrency(ricavo)}
          sub={`media ${formatCurrency(avgRevenuePerWash)} a lavaggio`}
          tone="gold"
        />
        <ReportKpi
          label="Spesa Merce"
          value={formatCurrency(spesaEffettiva)}
          sub={costsLoading ? 'caricamento...' : 'prodotti / consumabili'}
          tone="red"
        />
        <ReportKpi
          label="Stipendio Lavaggista"
          value={formatCurrency(stipendio)}
          sub="payroll mensile"
          tone="yellow"
        />
        <ReportKpi
          label="Margine Reale"
          value={formatCurrency(margineReale)}
          sub={`${marginPct}% del ricavo · ${monthLabel(selectedMonth)}`}
          tone={margineReale >= 0 ? 'green' : 'red'}
        />
      </ReportKpiGrid>

      {/* Dettaglio per Tipo di Servizio */}
      <ReportCard
        title="Dettaglio per Tipo di Servizio"
        right={`${byTypeRows.length} servizi`}
      >
        {byTypeRows.length === 0 ? (
          <ReportEmpty message={loading ? 'Caricamento...' : 'Nessun dato per il mese selezionato'} />
        ) : (
          <ReportTable
            head={
              <>
                <th className="text-left px-4 py-3">Servizio</th>
                <th className="text-center px-4 py-3">Quantità</th>
                <th className="text-right px-4 py-3">Ricavo</th>
                <th className="text-right px-4 py-3">% del Totale</th>
                {editReport && <th className="text-right px-4 py-3">Azioni</th>}
              </>
            }
            foot={
              <ReportTotalRow>
                <td className="px-4 py-3">Totale</td>
                <td className="px-4 py-3 text-center tabular-nums">{lavaggiFatt}</td>
                <td className="px-4 py-3 text-right tabular-nums text-dr7-gold">{formatCurrency(ricavo)}</td>
                <td className="px-4 py-3 text-right tabular-nums">100%</td>
                {editReport && <td className="px-4 py-3" />}
              </ReportTotalRow>
            }
          >
            {byTypeRows.map(item => {
              const pct = ricavo > 0 ? Math.round((item.revenue / ricavo) * 100) : 0
              return (
                <ReportRow key={item.type}>
                  <td className="px-4 py-3 font-medium text-theme-text-primary">
                    {item.type}
                    {item._isManual && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400">manuale</span>}
                    {item._overrideNote !== undefined && !item._isManual && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">corretto</span>}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-theme-text-primary">{item.count}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-theme-text-primary">{formatCurrency(item.revenue)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-theme-text-muted">{pct}%</td>
                  {editReport && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setEditRow(item)} className="px-2 py-1 rounded text-xs border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover">Correggi</button>
                      {item._overrideNote !== undefined
                        ? <button onClick={() => restoreRow(item)} className="ml-2 px-2 py-1 rounded text-xs border border-amber-400/50 text-amber-500">Ripristina</button>
                        : <button onClick={() => removeRow(item)} className="ml-2 px-2 py-1 rounded text-xs border border-red-400/40 text-red-500">Rimuovi</button>}
                    </td>
                  )}
                </ReportRow>
              )
            })}
          </ReportTable>
        )}
      </ReportCard>

      {/* Costi & Margine */}
      <ReportCard title="Costi & Margine" right={monthLabel(selectedMonth)}>
        <ReportTable
          head={
            <>
              <th className="text-left px-4 py-3">Voce</th>
              <th className="text-right px-4 py-3">Importo</th>
              <th className="text-right px-4 py-3">{canEditStipendio ? 'Azioni' : ''}</th>
            </>
          }
          foot={
            <ReportTotalRow>
              <td className="px-4 py-3">Margine Reale</td>
              <td className={`px-4 py-3 text-right tabular-nums ${margineReale >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {formatCurrency(margineReale)}
              </td>
              <td className="px-4 py-3 text-right text-xs font-normal text-theme-text-muted">{marginPct}% del ricavo</td>
            </ReportTotalRow>
          }
        >
          <CostoRiga
            label="Ricavo" value={ricavo} sign="+" tone="positive"
            calcolato={ricavoCalcolato} modificato={ricavoOverride != null}
            canEdit={canEditStipendio} saving={overrideSaving}
            onSave={(v) => saveOverride('ricavi_mensili', v)}
          />
          <CostoRiga
            label="Spesa Merce" value={spesaEffettiva} sign="−" tone="negative"
            calcolato={spesaCalcolata} modificato={spesaOverride != null}
            canEdit={canEditStipendio} saving={overrideSaving}
            onSave={(v) => saveOverride('spese_merce_mensili', v)}
          />
          <CostoRiga
            label="Stipendio Lavaggista" value={stipendio} sign="−" tone="negative"
            calcolato={stipendio} modificato={false}
            canEdit={canEditStipendio} saving={stipendioSaving}
            onSave={(v) => saveStipendioValue(v ?? 0)}
          />
          {vociExtra.map(v => (
            <CostoRiga
              key={v.id}
              label={v.label} value={v.importo} sign="−" tone="negative"
              calcolato={v.importo} modificato={false}
              canEdit={canEditStipendio} saving={overrideSaving}
              onSave={(nuovo) => salvaVociExtra(
                nuovo == null
                  ? vociExtra.filter(x => x.id !== v.id)
                  : vociExtra.map(x => x.id === v.id ? { ...x, importo: nuovo } : x)
              )}
              onDelete={() => salvaVociExtra(vociExtra.filter(x => x.id !== v.id))}
            />
          ))}
          {canEditStipendio && (
            <tr className="border-t border-theme-border">
              <td colSpan={3} className="px-4 py-3">
                {aggiungendoVoce ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={nuovaVoceLabel}
                      onChange={e => setNuovaVoceLabel(e.target.value)}
                      placeholder="Es. Spese acqua corrente"
                      autoFocus
                      className={`${REPORT_INPUT_CLASS} flex-1 min-w-[180px]`}
                    />
                    <MoneyInput
                      min="0"
                      value={nuovaVoceImporto}
                      onChange={(__v: string) => setNuovaVoceImporto(__v)}
                      className={`${REPORT_INPUT_CLASS} w-28 tabular-nums font-semibold`}
                    />
                    <button onClick={aggiungiVoce} disabled={overrideSaving}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-dr7-gold hover:bg-[#0A8FA3] disabled:opacity-50">
                      {overrideSaving ? '...' : 'Salva'}
                    </button>
                    <button onClick={() => { setAggiungendoVoce(false); setNuovaVoceLabel(''); setNuovaVoceImporto('') }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover">Annulla</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAggiungendoVoce(true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-dr7-gold/40 text-dr7-gold hover:bg-dr7-gold/10"
                  >
                    + Aggiungi voce
                  </button>
                )}
              </td>
            </tr>
          )}
        </ReportTable>
        {!canEditStipendio && (
          <p className="px-4 py-3 text-xs text-theme-text-muted border-t border-theme-border">
            Le voci di costo si modificano solo con il ruolo stipendi.
          </p>
        )}
      </ReportCard>

      {/* Andamento ultimi 6 mesi */}
      <ReportCard title="Andamento Ultimi 6 Mesi" right={trendLoading ? 'caricamento...' : `${trend.length} mesi`}>
        {trend.length === 0 ? (
          <ReportEmpty message="Caricamento..." />
        ) : (
          <ReportTable
            head={
              <>
                <th className="text-left px-4 py-3">Mese</th>
                <th className="text-center px-4 py-3">Lavaggi</th>
                <th className="text-right px-4 py-3">Ricavo</th>
                <th className="text-right px-4 py-3">Variazione</th>
              </>
            }
          >
            {trend.map((p, i) => {
              const prev = i > 0 ? trend[i - 1].revenue : 0
              const delta = p.revenue - prev
              const pct = prev > 0 ? (delta / prev) * 100 : 0
              return (
                <ReportRow key={p.month}>
                  <td className="px-4 py-3 font-medium text-theme-text-primary">{p.label}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-theme-text-primary">{p.count}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-theme-text-primary">{formatCurrency(p.revenue)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${i === 0 ? 'text-theme-text-muted' : delta >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {i === 0 ? '—' : `${delta >= 0 ? '+' : '−'} ${formatCurrency(Math.abs(delta))}${prev > 0 ? ` (${delta >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%)` : ''}`}
                  </td>
                </ReportRow>
              )
            })}
          </ReportTable>
        )}
      </ReportCard>

      {/* Lavaggi interni */}
      <ReportCard title="Lavaggi Rientro · Interni" right={`${lavaggiInterni} lavaggi`}>
        {lavaggiInterni === 0 ? (
          <ReportEmpty message="Nessun lavaggio interno nel mese" />
        ) : (
          <ReportTable
            head={
              <>
                <th className="text-left px-4 py-3">Veicolo</th>
                <th className="text-right px-4 py-3">Lavaggi</th>
              </>
            }
            foot={
              <ReportTotalRow>
                <td className="px-4 py-3">Totale</td>
                <td className="px-4 py-3 text-right tabular-nums">{lavaggiInterni}</td>
              </ReportTotalRow>
            }
          >
            {(washData?.internalByVehicle || []).map(item => (
              <ReportRow key={item.vehicle}>
                <td className="px-4 py-3 font-medium text-theme-text-primary">{item.vehicle}</td>
                <td className="px-4 py-3 text-right tabular-nums text-theme-text-primary">{item.count}</td>
              </ReportRow>
            ))}
          </ReportTable>
        )}
      </ReportCard>

      {emptyState && <ReportEmpty message="Nessun report caricato. Premi Aggiorna." />}

      {editRow && (
        <ReportRowModal
          mode="edit"
          row={editRow}
          fields={EDIT_FIELDS}
          identityFields={[]}
          addTemplate={{}}
          onClose={() => setEditRow(null)}
          onSaveEdit={saveEdit}
          onSaveAdd={async () => { /* aggiunta manuale non prevista su questo report */ }}
        />
      )}
    </ReportShell>
  )
}

// ── Righe di Costi & Margine ─────────────────────────────────────────
// 2026-08-20 (richiesta direzione): ogni voce si modifica, non solo lo
// stipendio. Il valore CALCOLATO dai dati reali resta nel title della riga e si
// ripristina in un click: una cifra scritta a mano non deve far sparire il dato
// vero. 2026-08-27: stessa riga, ma dentro la tabella in stile Terra.
function CostoRiga({ label, value, tone, sign, calcolato, modificato, canEdit, saving, onSave, onDelete }: {
  label: string; value: number; tone: 'positive' | 'negative'; sign: string
  calcolato: number; modificato: boolean; canEdit: boolean; saving: boolean
  onSave: (v: number | null) => void | Promise<void>
  /** Solo per le voci libere: le voci fisse non si cancellano. */
  onDelete?: () => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const color = tone === 'positive' ? 'text-green-500' : 'text-red-500'

  if (editing && canEdit) {
    return (
      <tr className="border-t border-theme-border">
        <td className="px-4 py-3 text-theme-text-primary">{label}</td>
        <td className="px-4 py-3 text-right" colSpan={2}>
          <div className="flex items-center justify-end gap-2">
            <MoneyInput
              min="0"
              value={input}
              onChange={(__v: string) => setInput(__v)}
              className={`${REPORT_INPUT_CLASS} w-28 tabular-nums font-semibold text-right`}
              autoFocus
            />
            <button
              onClick={async () => {
                const parsed = parseFloat((input || '').replace(',', '.'))
                if (!Number.isFinite(parsed) || parsed < 0) return
                await onSave(parsed)
                setEditing(false)
              }}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-dr7-gold hover:bg-[#0A8FA3] disabled:opacity-50"
            >{saving ? '...' : 'Salva'}</button>
            <button onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover">Annulla</button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <ReportRow>
      <td
        className="px-4 py-3 text-theme-text-primary"
        title={modificato ? `Calcolato dai dati: ${formatCurrency(Math.abs(calcolato))}` : undefined}
      >
        {label}
        {modificato && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">corretto</span>}
      </td>
      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${color}`}>
        {sign} {formatCurrency(Math.abs(value))}
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {canEdit && (
          <>
            <button
              onClick={() => { setInput(Math.abs(value).toFixed(2)); setEditing(true) }}
              className="px-2 py-1 rounded text-xs border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover"
            >Modifica</button>
            {modificato && !onDelete && (
              <button
                onClick={() => onSave(null)}
                title="Torna al valore calcolato dai dati"
                className="ml-2 px-2 py-1 rounded text-xs border border-amber-400/50 text-amber-500"
              >Ripristina</button>
            )}
            {onDelete && (
              <button
                onClick={() => { if (confirm(`Eliminare la voce "${label}"?`)) onDelete() }}
                className="ml-2 px-2 py-1 rounded text-xs border border-red-400/40 text-red-500"
              >Elimina</button>
            )}
          </>
        )}
      </td>
    </ReportRow>
  )
}
