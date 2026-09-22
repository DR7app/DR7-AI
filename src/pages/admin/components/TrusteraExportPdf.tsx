// 22/09/2026 (direzione): PDF di tutte le righe di DR7 Trust (contratti e
// documenti mandati in firma), stesso formato dei Report: periodo scritto in
// testa, riepilogo, tabella completa. Con o senza i nomi dei clienti.
// La lista a video mostra solo le ultime 100 richieste: qui si rilegge il
// database per il periodo scelto, pagina per pagina (PostgREST si ferma a 1000).
import { useState } from 'react'
import { supabase } from '../../../supabaseClient'
import EuropeanDateInput from '../../../components/EuropeanDateInput'
import { isoLocale, periodoDelMese, type Periodo } from '../../../utils/reportPeriodo'

interface RigaFirma {
  id: string
  contract_id: string | null
  signer_name: string | null
  signer_email: string | null
  signer_phone: string | null
  status: string
  document_name: string | null
  signed_at: string | null
  created_at: string
  token_expires_at: string | null
}

const STATI: Record<string, string> = {
  signed: 'Firmato',
  pending: 'In attesa',
  otp_sent: 'OTP inviato',
  otp_verified: 'OTP verificato',
  expired: 'Scaduto',
  cancelled: 'Annullato',
}

const dataOra = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' })
  : ''

function statoDi(r: RigaFirma): string {
  const scaduto = r.status !== 'signed' && r.token_expires_at && new Date(r.token_expires_at) < new Date()
  return scaduto ? 'Scaduto' : (STATI[r.status] || r.status)
}

// Inizio/fine del periodo in ora di Roma, come istanti UTC per la query.
function limiti(p: Periodo): { da: string; a: string } {
  const [y1, m1, d1] = p.from.split('-').map(Number)
  const [y2, m2, d2] = p.to.split('-').map(Number)
  return { da: new Date(y1, m1 - 1, d1, 0, 0, 0).toISOString(), a: new Date(y2, m2 - 1, d2, 23, 59, 59, 999).toISOString() }
}

async function leggiRighe(p: Periodo): Promise<RigaFirma[]> {
  const { da, a } = limiti(p)
  const tutte: RigaFirma[] = []
  const PAGINA = 1000
  for (let da0 = 0; ; da0 += PAGINA) {
    const { data, error } = await supabase
      .from('signature_requests')
      .select('id, contract_id, signer_name, signer_email, signer_phone, status, document_name, signed_at, created_at, token_expires_at')
      .gte('created_at', da)
      .lte('created_at', a)
      .order('created_at', { ascending: true })
      .range(da0, da0 + PAGINA - 1)
    if (error) throw error
    tutte.push(...((data || []) as RigaFirma[]))
    if (!data || data.length < PAGINA) break
  }
  return tutte
}

async function numeriContratto(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('contracts').select('id, contract_number').in('id', ids.slice(i, i + 200))
    for (const c of (data || []) as Array<{ id: string; contract_number: string | null }>) {
      if (c.contract_number) out.set(c.id, c.contract_number)
    }
  }
  return out
}

async function mittenti(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from('admin_activity_log')
      .select('entity_id, admin_name, admin_email')
      .eq('action', 'send_trustera_document')
      .in('entity_id', ids.slice(i, i + 200))
    for (const l of (data || []) as Array<{ entity_id: string; admin_name: string | null; admin_email: string | null }>) {
      out.set(l.entity_id, l.admin_name || l.admin_email || '')
    }
  }
  return out
}

async function scaricaPeriodo(p: Periodo, conNomi: boolean) {
  const righe = await leggiRighe(p)
  const [contratti, inviatiDa] = await Promise.all([
    numeriContratto([...new Set(righe.map(r => r.contract_id).filter((x): x is string => !!x))]),
    mittenti(righe.map(r => r.id)),
  ])
  const stati = righe.map(statoDi)
  const conta = (s: string) => stati.filter(x => x === s).length
  const head = ['Data invio', 'Documento', ...(conNomi ? ['Firmatario', 'Email', 'Telefono'] : []), 'Stato', 'Firmato il', 'Inviato da']
  const body = righe.map((r, i) => {
    const doc = r.contract_id
      ? `Contratto${contratti.get(r.contract_id) ? ' ' + contratti.get(r.contract_id) : ''}`
      : (r.document_name || 'Documento')
    return [
      dataOra(r.created_at),
      doc,
      ...(conNomi ? [r.signer_name || '', r.signer_email || '', r.signer_phone || ''] : []),
      stati[i],
      dataOra(r.signed_at),
      inviatiDa.get(r.id) || '',
    ]
  })
  const { scaricaTabellaPdf } = await import('../../../utils/scaricaReportPdf')
  await scaricaTabellaPdf({
    titolo: 'DR7 Trust - Documenti e contratti',
    periodo: p,
    riepilogo: [
      ['Totale richieste', String(righe.length)],
      ['Contratti', String(righe.filter(r => r.contract_id).length)],
      ['Documenti', String(righe.filter(r => !r.contract_id).length)],
      ['Firmati', String(conta('Firmato'))],
      ['In attesa / OTP', String(conta('In attesa') + conta('OTP inviato') + conta('OTP verificato'))],
      ['Scaduti', String(conta('Scaduto'))],
      ['Annullati', String(conta('Annullato'))],
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
