// 22/09/2026 (direzione): PDF di tutti i contratti del periodo, stesso
// formato dei Report: periodo scritto in testa, riepilogo, tabella completa.
// Con o senza i nomi dei clienti. Si rilegge il database per il periodo
// scelto, pagina per pagina (PostgREST si ferma a 1000 righe).
import { useState } from 'react'
import { supabase } from '../../../supabaseClient'
import EuropeanDateInput from '../../../components/EuropeanDateInput'
import { isoLocale, periodoDelMese, type Periodo } from '../../../utils/reportPeriodo'

// 22/09/2026 (direzione): nel PDF vanno i CONTRATTI come li mostra la tab
// Contratti (numero, cliente, veicolo, periodo, totale, stato, firme), non le
// sole richieste di firma. Tutti i business: la colonna Servizio li distingue.
interface RigaContratto {
  id: string
  contract_number: string | null
  created_at: string
  customer_name: string | null
  vehicle_name: string | null
  rental_start_date: string | null
  rental_end_date: string | null
  total_days: number | null
  total_amount: number | null
  status: string | null
  bookings: { service_type: string | null } | null
}

const STATI_CONTRATTO: Record<string, string> = { active: 'Attivo', completed: 'Completato', cancelled: 'Cancellato' }
const SERVIZI: Record<string, string> = { boat_rental: 'Mare', heli_rental: 'Aria', stay_rental: 'Soggiorni' }
// Stessa priorita' della tab Contratti: per ogni firmatario vale lo stato migliore.
const RANGO: Record<string, number> = { signed: 0, otp_verified: 1, otp_sent: 2, pending: 3, superseded: 4, expired: 5, cancelled: 6 }

const soloData = (iso: string | null) => iso
  ? new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })
  : ''
const euro = (n: number) => `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Inizio/fine del periodo in ora di Roma, come istanti UTC per la query.
function limiti(p: Periodo): { da: string; a: string } {
  const [y1, m1, d1] = p.from.split('-').map(Number)
  const [y2, m2, d2] = p.to.split('-').map(Number)
  return { da: new Date(y1, m1 - 1, d1, 0, 0, 0).toISOString(), a: new Date(y2, m2 - 1, d2, 23, 59, 59, 999).toISOString() }
}

async function leggiContratti(p: Periodo): Promise<RigaContratto[]> {
  const { da, a } = limiti(p)
  const tutte: RigaContratto[] = []
  const PAGINA = 1000
  for (let da0 = 0; ; da0 += PAGINA) {
    const { data, error } = await supabase
      .from('contracts')
      .select('id, contract_number, created_at, customer_name, vehicle_name, rental_start_date, rental_end_date, total_days, total_amount, status, bookings(service_type)')
      .gte('created_at', da)
      .lte('created_at', a)
      .order('created_at', { ascending: true })
      .range(da0, da0 + PAGINA - 1)
    if (error) throw error
    tutte.push(...((data || []) as unknown as RigaContratto[]))
    if (!data || data.length < PAGINA) break
  }
  return tutte
}

/** Per ogni contratto: firmatari che hanno firmato / firmatari totali. */
async function firme(ids: string[]): Promise<Map<string, { firmati: number; totale: number }>> {
  const perContratto = new Map<string, Map<string, string>>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from('signature_requests')
      .select('contract_id, signer_name, signer_phone, status')
      .in('contract_id', ids.slice(i, i + 200))
    for (const r of (data || []) as Array<{ contract_id: string; signer_name: string | null; signer_phone: string | null; status: string }>) {
      const chi = String(r.signer_name || r.signer_phone || '').trim().toLowerCase()
      if (!chi) continue
      const m = perContratto.get(r.contract_id) || new Map<string, string>()
      const prima = m.get(chi)
      if (!prima || (RANGO[r.status] ?? 9) < (RANGO[prima] ?? 9)) m.set(chi, r.status)
      perContratto.set(r.contract_id, m)
    }
  }
  const out = new Map<string, { firmati: number; totale: number }>()
  for (const [id, m] of perContratto) {
    const stati = [...m.values()].filter(s => s !== 'superseded' && s !== 'cancelled')
    out.set(id, { firmati: stati.filter(s => s === 'signed').length, totale: stati.length })
  }
  return out
}

async function scaricaPeriodo(p: Periodo, conNomi: boolean) {
  const righe = await leggiContratti(p)
  const f = await firme(righe.map(r => r.id))
  const testoFirme = (id: string) => {
    const x = f.get(id)
    if (!x || x.totale === 0) return 'Non inviato'
    return x.firmati === x.totale ? `${x.firmati}/${x.totale} firmato` : `${x.firmati}/${x.totale} firmato (incompleto)`
  }
  const totale = righe.reduce((t, r) => t + (Number(r.total_amount) || 0), 0)
  const contaStato = (s: string) => righe.filter(r => r.status === s).length
  const firmatiTutti = righe.filter(r => { const x = f.get(r.id); return !!x && x.totale > 0 && x.firmati === x.totale }).length
  const firmatiParte = righe.filter(r => { const x = f.get(r.id); return !!x && x.firmati > 0 && x.firmati < x.totale }).length

  const head = ['N. contratto', 'Data', ...(conNomi ? ['Cliente'] : []), 'Veicolo', 'Ritiro -> Riconsegna', 'Giorni', 'Totale', 'Stato', 'Firme', 'Servizio']
  const body = righe.map(r => [
    r.contract_number || '',
    soloData(r.created_at),
    ...(conNomi ? [r.customer_name || ''] : []),
    r.vehicle_name || '',
    `${soloData(r.rental_start_date)} -> ${soloData(r.rental_end_date)}`,
    r.total_days != null ? String(r.total_days) : '',
    euro(Number(r.total_amount) || 0),
    STATI_CONTRATTO[String(r.status)] || String(r.status || ''),
    testoFirme(r.id),
    SERVIZI[String(r.bookings?.service_type || '')] || 'Terra',
  ])
  const { scaricaTabellaPdf } = await import('../../../utils/scaricaReportPdf')
  await scaricaTabellaPdf({
    titolo: 'DR7 Trust - Contratti',
    periodo: p,
    riepilogo: [
      ['Contratti', String(righe.length)],
      ['Totale contratti', euro(totale)],
      ['Attivi', String(contaStato('active'))],
      ['Completati', String(contaStato('completed'))],
      ['Cancellati', String(contaStato('cancelled'))],
      ['Firmati da tutti', String(firmatiTutti)],
      ['Firmati in parte', String(firmatiParte)],
      ['Firma non inviata / in attesa', String(righe.length - firmatiTutti - firmatiParte)],
    ],
    head,
    body,
  })
}

function mesiFraDue(da: string, a: string): string[] {
  const out: string[] = []
  let [y, m] = da.split('-').map(Number)
  const [y2, m2] = a.split('-').map(Number)
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}
const NOMI_MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

export default function TrusteraExportPdf() {
  const oggi = new Date()
  const meseOggi = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}`
  const [da, setDa] = useState(isoLocale(new Date(oggi.getFullYear(), oggi.getMonth(), 1)))
  const [a, setA] = useState(isoLocale(oggi))
  const [daMese, setDaMese] = useState(`${oggi.getFullYear()}-01`)
  const [aMese, setAMese] = useState(meseOggi)
  const [perMese, setPerMese] = useState(false)
  const [inCorso, setInCorso] = useState<string | null>(null)
  // Stessa scelta dei Report: ricordata su questo browser.
  const [conNomi, setConNomi] = useState<boolean>(() => {
    try { return localStorage.getItem('report-pdf-nomi') !== 'no' } catch { return true }
  })
  const cambiaNomi = (v: boolean) => {
    setConNomi(v)
    try { localStorage.setItem('report-pdf-nomi', v ? 'si' : 'no') } catch { /* niente memoria */ }
  }
  const opzioniMesi = mesiFraDue(`${oggi.getFullYear() - 4}-01`, meseOggi).reverse()
  const etichetta = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${NOMI_MESI[m - 1]} ${y}` }

  const scarica = async () => {
    if (inCorso) return
    if (!da || !a) { alert('Scegli le date del periodo.'); return }
    if (a < da) { alert('La data finale viene prima di quella iniziale.'); return }
    setInCorso('Genero il PDF...')
    try { await scaricaPeriodo({ from: da, to: a }, conNomi) }
    catch (e) { alert('PDF non generato: ' + (e instanceof Error ? e.message : String(e))) }
    finally { setInCorso(null) }
  }
  const scaricaMesi = async () => {
    if (inCorso) return
    if (daMese > aMese) { alert('Il mese iniziale viene dopo quello finale.'); return }
    const mesi = mesiFraDue(daMese, aMese)
    try {
      for (let i = 0; i < mesi.length; i++) {
        setInCorso(`${etichetta(mesi[i])} (${i + 1} di ${mesi.length})...`)
        await scaricaPeriodo(periodoDelMese(mesi[i]), conNomi)
        await new Promise(r => setTimeout(r, 700))
      }
    } catch (e) {
      alert('PDF per mese interrotto: ' + (e instanceof Error ? e.message : String(e)))
    } finally { setInCorso(null) }
  }

  const btn = 'inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-full transition-opacity disabled:opacity-50'
  const sel = 'px-2 py-1.5 bg-theme-bg-tertiary border border-theme-border rounded text-theme-text-primary text-sm'
  const campo = 'w-32 text-sm bg-theme-bg-tertiary border border-theme-border rounded px-2 py-1 text-theme-text-primary'
  return (
    <div className="bg-theme-bg-secondary rounded-lg p-4 border border-theme-border space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-theme-text-primary mr-2">Esporta PDF</p>
        <span className="text-sm text-theme-text-secondary">dal</span>
        <EuropeanDateInput value={da} onChange={setDa} className={campo} />
        <span className="text-sm text-theme-text-secondary">al</span>
        <EuropeanDateInput value={a} onChange={setA} className={campo} />
        <label className="inline-flex items-center gap-1.5 text-sm text-theme-text-secondary cursor-pointer select-none ml-2">
          <input type="checkbox" checked={conNomi} onChange={e => cambiaNomi(e.target.checked)} disabled={!!inCorso} className="w-4 h-4" />
          Nomi clienti nel PDF
        </label>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {inCorso && <span className="text-xs text-theme-text-muted">{inCorso}</span>}
          <button type="button" onClick={() => setPerMese(v => !v)} disabled={!!inCorso} className={`${btn} border border-dr7-gold text-dr7-gold hover:opacity-80`}>
            PDF per mese
          </button>
          <button type="button" onClick={scarica} disabled={!!inCorso} className={`${btn} bg-dr7-gold text-white hover:opacity-90`}>
            Scarica PDF
          </button>
        </div>
      </div>
      {perMese && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-theme-border">
          <span className="text-sm text-theme-text-secondary">Da</span>
          <select value={daMese} onChange={e => setDaMese(e.target.value)} className={sel} disabled={!!inCorso}>
            {opzioniMesi.map(m => <option key={m} value={m}>{etichetta(m)}</option>)}
          </select>
          <span className="text-sm text-theme-text-secondary">a</span>
          <select value={aMese} onChange={e => setAMese(e.target.value)} className={sel} disabled={!!inCorso}>
            {opzioniMesi.map(m => <option key={m} value={m}>{etichetta(m)}</option>)}
          </select>
          <button type="button" onClick={scaricaMesi} disabled={!!inCorso} className={`${btn} bg-dr7-gold text-white hover:opacity-90`}>
            Scarica {daMese <= aMese ? mesiFraDue(daMese, aMese).length : 0} PDF
          </button>
        </div>
      )}
    </div>
  )
}
