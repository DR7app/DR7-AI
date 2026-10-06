// 06/10/2026 (direzione): Amministrazione > Investitori.
// Chi ha investito in DR7 e quanto. Un investitore puo' versare piu' volte:
// il totale investito e' sempre la somma dei suoi versamenti
// (tabelle investitori + investitori_versamenti, mig 20261006_investitori).
// Dato riservato: la RLS (dr7_puo_vedere_investitori) apre solo alla direzione
// e a chi ha la tab `investitori` spuntata — stessa regola di hasPermission.
// Valutazione azienda + costo di un'azione (investitori_valutazione, una riga):
// dato l'importo, quota % = importo / valutazione e azioni = importo / costo azione.
import { useEffect, useMemo, useState } from 'react'
import { ScheletroTabella } from '../../../components/Scheletro'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import MoneyInput from '../../../components/MoneyInput'
import EuropeanDateInput from '../../../components/EuropeanDateInput'
import { parseMoney } from '../../../utils/money'
import { LeadPicker } from './LeadPicker'
import { inviaMessaggiInvestitore } from '../../../utils/messaggiInvestitori'
import { pubblicaInvestitoreSulSito, togliInvestitoreDalSito } from '../../../utils/investitoriSito'

interface Investitore {
  id: string
  nome: string
  tipo: 'persona' | 'societa'
  codice_fiscale: string | null
  email: string | null
  telefono: string | null
  quota_percentuale: number | null
  numero_azioni: number | null
  // 06/10/2026: risposta al WhatsApp di autorizzazione (null = nessuna risposta).
  pubblicazione_nome: 'autorizzato' | 'riservato' | null
  note: string | null
  created_at: string
}

interface Versamento {
  id: string
  investitore_id: string
  importo: number
  data_versamento: string
  strumento: string | null
  note: string | null
}

const STRUMENTI = ['Bonifico', 'Assegno', 'Contanti', 'Conferimento', 'Altro']

function todayRome(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}
function eur(n: number): string {
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
}
function itDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('it-IT')
}
function azioniFmt(n: number): string {
  return Number(n).toLocaleString('it-IT', { maximumFractionDigits: 0 })
}
// Solo cifre: "1.500" o "1500" diventano 1500; vuoto = null.
function parseAzioni(v: string): number | null {
  const d = v.replace(/\D/g, '')
  return d ? Number(d) : null
}
// Arrotondo a 4 decimali (colonna numeric(7,4)) e non supero mai il 100%.
function quotaDa(importo: number, valutazione: number | null): number | null {
  if (!(importo > 0) || !valutazione || !(valutazione > 0)) return null
  return Math.min(100, Math.round((importo / valutazione) * 100 * 10000) / 10000)
}
// Azioni intere: si arrotonda per difetto, mai piu' azioni di quelle pagate.
function azioniDa(importo: number, costoAzione: number | null): number | null {
  if (!(importo > 0) || !costoAzione || !(costoAzione > 0)) return null
  return Math.floor(importo / costoAzione + 1e-9)
}
// Ricerca per nome senza badare a maiuscole e accenti.
function normalizza(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

const inputCls = 'mt-1 w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm'

const NUOVO_VUOTO = { nome: '', tipo: 'persona' as const, codice_fiscale: '', email: '', telefono: '', quota: '', azioni: '', note: '', importo: '', data: todayRome(), strumento: 'Bonifico' }

export default function InvestitoriTab() {
  const [investitori, setInvestitori] = useState<Investitore[]>([])
  const [versamenti, setVersamenti] = useState<Versamento[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mostraNuovo, setMostraNuovo] = useState(false)
  const [nuovo, setNuovo] = useState<{ nome: string; tipo: 'persona' | 'societa'; codice_fiscale: string; email: string; telefono: string; quota: string; azioni: string; note: string; importo: string; data: string; strumento: string }>(NUOVO_VUOTO)
  const [aperto, setAperto] = useState<string | null>(null)
  const [versamento, setVersamento] = useState({ importo: '', data: todayRome(), strumento: 'Bonifico', note: '' })
  const [cerca, setCerca] = useState('')
  const [azioniEdit, setAzioniEdit] = useState('')
  const [valutazione, setValutazione] = useState<{ valutazione: number | null; costo_azione: number | null }>({ valutazione: null, costo_azione: null })
  const [valEdit, setValEdit] = useState({ valutazione: '', costo: '' })

  async function carica() {
    setLoading(true)
    const [inv, ver, val] = await Promise.all([
      supabase.from('investitori').select('*').order('nome'),
      supabase.from('investitori_versamenti').select('*').order('data_versamento', { ascending: false }),
      supabase.from('investitori_valutazione').select('valutazione, costo_azione').eq('id', 1).maybeSingle(),
    ])
    // La valutazione e' un di piu': se manca (o la tabella non c'e' ancora) la tab funziona lo stesso.
    const v = {
      valutazione: val.data?.valutazione != null ? Number(val.data.valutazione) : null,
      costo_azione: val.data?.costo_azione != null ? Number(val.data.costo_azione) : null,
    }
    setValutazione(v)
    setValEdit({ valutazione: v.valutazione != null ? String(v.valutazione) : '', costo: v.costo_azione != null ? String(v.costo_azione) : '' })
    if (inv.error || ver.error) {
      toast.error('Errore nel caricamento degli investitori: ' + (inv.error || ver.error)?.message)
    }
    setInvestitori((inv.data as Investitore[]) || [])
    setVersamenti(((ver.data as Versamento[]) || []).map(v => ({ ...v, importo: Number(v.importo) })))
    setLoading(false)
  }

  useEffect(() => { carica() }, [])

  const perInvestitore = useMemo(() => {
    const m = new Map<string, Versamento[]>()
    for (const v of versamenti) {
      const arr = m.get(v.investitore_id)
      if (arr) arr.push(v); else m.set(v.investitore_id, [v])
    }
    return m
  }, [versamenti])

  const totaleDi = (id: string) => (perInvestitore.get(id) || []).reduce((s, v) => s + v.importo, 0)
  const totale = useMemo(() => versamenti.reduce((s, v) => s + v.importo, 0), [versamenti])
  const ordinati = useMemo(
    () => [...investitori].sort((a, b) => totaleDi(b.id) - totaleDi(a.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [investitori, perInvestitore]
  )
  const filtrati = useMemo(() => {
    const q = normalizza(cerca)
    if (!q) return ordinati
    return ordinati.filter(i => normalizza(i.nome).includes(q))
  }, [ordinati, cerca])
  const totaleAzioni = useMemo(() => investitori.reduce((s, i) => s + (Number(i.numero_azioni) || 0), 0), [investitori])

  // Importo digitato nel nuovo investitore: quota e azioni si compilano da sole
  // (restano modificabili a mano).
  function cambiaImportoNuovo(v: string) {
    const importo = parseMoney(v)
    const q = quotaDa(importo, valutazione.valutazione)
    const a = azioniDa(importo, valutazione.costo_azione)
    setNuovo(n => ({
      ...n,
      importo: v,
      quota: valutazione.valutazione ? (q != null ? String(q) : '') : n.quota,
      azioni: valutazione.costo_azione ? (a != null ? String(a) : '') : n.azioni,
    }))
  }

  async function salvaValutazione() {
    const val = valEdit.valutazione.trim() ? parseMoney(valEdit.valutazione) : null
    const costo = valEdit.costo.trim() ? parseMoney(valEdit.costo) : null
    if (val != null && !(val > 0)) { toast.error('La valutazione deve essere maggiore di zero'); return }
    if (costo != null && !(costo > 0)) { toast.error('Il costo dell\'azione deve essere maggiore di zero'); return }
    setSaving(true)
    const { error } = await supabase.from('investitori_valutazione').upsert({ id: 1, valutazione: val, costo_azione: costo, updated_at: new Date().toISOString() })
    setSaving(false)
    if (error) { toast.error('Valutazione non salvata: ' + error.message); return }
    toast.success('Valutazione aggiornata')
    carica()
  }

  async function creaInvestitore() {
    if (!nuovo.nome.trim()) { toast.error('Inserisci il nome dell\'investitore'); return }
    const importo = parseMoney(nuovo.importo)
    const quota = nuovo.quota.trim() ? parseMoney(nuovo.quota) : null
    setSaving(true)
    const { data, error } = await supabase.from('investitori').insert({
      nome: nuovo.nome.trim(),
      tipo: nuovo.tipo,
      codice_fiscale: nuovo.codice_fiscale.trim() || null,
      email: nuovo.email.trim() || null,
      telefono: nuovo.telefono.trim() || null,
      quota_percentuale: quota,
      numero_azioni: parseAzioni(nuovo.azioni),
      note: nuovo.note.trim() || null,
    }).select('id').single()
    if (error || !data) {
      setSaving(false)
      toast.error('Investitore non salvato: ' + (error?.message || 'errore sconosciuto'))
      return
    }
    if (importo > 0) {
      const { error: vErr } = await supabase.from('investitori_versamenti').insert({
        investitore_id: data.id,
        importo,
        data_versamento: nuovo.data || todayRome(),
        strumento: nuovo.strumento,
      })
      if (vErr) toast.error('Investitore salvato, ma il versamento no: ' + vErr.message)
    }
    setSaving(false)
    toast.success('Investitore aggiunto')
    const salvato = { nome: nuovo.nome.trim(), tipo: nuovo.tipo, telefono: nuovo.telefono.trim() || null }
    setNuovo({ ...NUOVO_VUOTO, data: todayRome() })
    setMostraNuovo(false)
    carica()
    // 06/10/2026 (direzione): al nuovo investitore partono i due WhatsApp di
    // Messaggi di Sistema Pro > Investitori (benvenuto, poi autorizzazione nome).
    mandaMessaggi(salvato)
  }

  async function mandaMessaggi(inv: { nome: string; tipo: 'persona' | 'societa'; telefono: string | null }) {
    if (!inv.telefono) { toast('Nessun telefono: messaggi di benvenuto non inviati'); return }
    const id = toast.loading('Invio messaggi all\'investitore…')
    const esiti = await inviaMessaggiInvestitore(inv)
    toast.dismiss(id)
    for (const e of esiti) {
      if (e.inviato) toast.success(`WhatsApp "${e.etichetta}" inviato`)
      else toast.error(`WhatsApp "${e.etichetta}" non inviato: ${e.motivo}`)
    }
  }

  async function aggiungiVersamento(investitoreId: string) {
    const importo = parseMoney(versamento.importo)
    if (!(importo > 0)) { toast.error('Inserisci un importo maggiore di zero'); return }
    setSaving(true)
    const { error } = await supabase.from('investitori_versamenti').insert({
      investitore_id: investitoreId,
      importo,
      data_versamento: versamento.data || todayRome(),
      strumento: versamento.strumento,
      note: versamento.note.trim() || null,
    })
    if (error) { setSaving(false); toast.error('Versamento non salvato: ' + error.message); return }
    // Con valutazione e costo azione impostati, il versamento aggiunge le sue azioni
    // e ricalcola la quota sul nuovo totale investito.
    const inv = investitori.find(x => x.id === investitoreId)
    const nuoveAzioni = azioniDa(importo, valutazione.costo_azione)
    const nuovaQuota = quotaDa(totaleDi(investitoreId) + importo, valutazione.valutazione)
    const patch: Record<string, unknown> = {}
    if (nuoveAzioni != null) patch.numero_azioni = (Number(inv?.numero_azioni) || 0) + nuoveAzioni
    if (nuovaQuota != null) patch.quota_percentuale = nuovaQuota
    if (Object.keys(patch).length) {
      const { error: uErr } = await supabase.from('investitori').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', investitoreId)
      if (uErr) toast.error('Versamento salvato, ma quota/azioni no: ' + uErr.message)
    }
    setSaving(false)
    toast.success('Versamento registrato')
    setVersamento({ importo: '', data: todayRome(), strumento: 'Bonifico', note: '' })
    carica()
  }

  async function salvaAzioni(i: Investitore) {
    setSaving(true)
    const { error } = await supabase.from('investitori').update({ numero_azioni: parseAzioni(azioniEdit), updated_at: new Date().toISOString() }).eq('id', i.id)
    setSaving(false)
    if (error) { toast.error('Numero di azioni non salvato: ' + error.message); return }
    toast.success('Numero di azioni aggiornato')
    carica()
  }

  async function eliminaVersamento(v: Versamento) {
    if (!window.confirm(`Eliminare il versamento di ${eur(v.importo)} del ${itDate(v.data_versamento)}?`)) return
    const { error } = await supabase.from('investitori_versamenti').delete().eq('id', v.id)
    if (error) { toast.error('Versamento non eliminato: ' + error.message); return }
    carica()
  }

  async function eliminaInvestitore(i: Investitore) {
    const n = (perInvestitore.get(i.id) || []).length
    if (!window.confirm(`Eliminare ${i.nome}${n ? ` e i suoi ${n} versamenti (${eur(totaleDi(i.id))})` : ''}?`)) return
    const { error } = await supabase.from('investitori').delete().eq('id', i.id)
    if (error) { toast.error('Investitore non eliminato: ' + error.message); return }
    if (aperto === i.id) setAperto(null)
    // Un investitore eliminato non resta nell'elenco azionisti del sito.
    if (i.pubblicazione_nome === 'autorizzato') {
      try { await togliInvestitoreDalSito(i) } catch (e) { toast.error('Investitore eliminato, ma il nome resta sul sito: toglilo da Sito > Investitori (' + (e instanceof Error ? e.message : String(e)) + ')') }
    }
    carica()
  }

  // 06/10/2026 (direzione): l'investitore risponde AUTORIZZO / RISERVATO al
  // WhatsApp; l'admin preme il pulsante e il sito si aggiorna da solo.
  async function impostaPubblicazione(i: Investitore, scelta: 'autorizzato' | 'riservato' | null) {
    const testo = scelta === 'autorizzato'
      ? `Pubblicare il nome "${i.nome}" nell'elenco azionisti del sito DR7?`
      : scelta === 'riservato'
        ? `${i.nome} preferisce restare riservato: il nome non comparira' sul sito. Confermi?`
        : `Togliere "${i.nome}" dal sito e tornare a "nessuna risposta"?`
    if (!window.confirm(testo)) return
    setSaving(true)
    try {
      if (scelta === 'autorizzato') {
        const suoi = perInvestitore.get(i.id) || []
        const primo = suoi.length ? suoi[suoi.length - 1].data_versamento : i.created_at
        await pubblicaInvestitoreSulSito({ id: i.id, nome: i.nome, tipo: i.tipo, anno: Number(String(primo).slice(0, 4)) })
      } else {
        await togliInvestitoreDalSito(i)
      }
      const { error } = await supabase.from('investitori').update({ pubblicazione_nome: scelta, updated_at: new Date().toISOString() }).eq('id', i.id)
      if (error) throw error
      toast.success(scelta === 'autorizzato' ? 'Nome pubblicato sul sito' : scelta === 'riservato' ? 'Segnato come riservato: non compare sul sito' : 'Tolto dal sito')
    } catch (e) {
      toast.error('Non salvato: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
      carica()
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">Investitori</h1>
          <p className="text-sm text-theme-text-muted mt-1">Chi ha investito in DR7 e quanto. Il totale di ognuno e' la somma dei suoi versamenti.</p>
        </div>
        <button onClick={() => setMostraNuovo(v => !v)} className="px-4 py-2 rounded-lg text-sm font-semibold bg-dr7-gold text-white hover:opacity-90">
          {mostraNuovo ? 'Chiudi' : 'Nuovo investitore'}
        </button>
      </div>

      <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-theme-text-primary">Valutazione azienda</h2>
          <p className="text-xs text-theme-text-muted mt-0.5">Con questi due valori, inserendo l'importo di un investitore la quota % e il numero di azioni si calcolano da soli.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <label className="text-xs text-theme-text-muted">Valutazione azienda €
            <MoneyInput value={valEdit.valutazione} onChange={v => setValEdit({ ...valEdit, valutazione: v })} placeholder="0,00" className={`${inputCls} text-right tabular-nums`} />
          </label>
          <label className="text-xs text-theme-text-muted">Costo di un'azione €
            <MoneyInput value={valEdit.costo} onChange={v => setValEdit({ ...valEdit, costo: v })} placeholder="0,00" className={`${inputCls} text-right tabular-nums`} />
          </label>
          <div className="text-xs text-theme-text-muted">
            Azioni dell'azienda
            <p className="mt-1 py-2 text-sm font-semibold text-theme-text-primary tabular-nums">
              {parseMoney(valEdit.valutazione) > 0 && parseMoney(valEdit.costo) > 0 ? azioniFmt(Math.floor(parseMoney(valEdit.valutazione) / parseMoney(valEdit.costo) + 1e-9)) : '—'}
            </p>
          </div>
          <button
            onClick={salvaValutazione}
            disabled={saving || (valEdit.valutazione === (valutazione.valutazione != null ? String(valutazione.valutazione) : '') && valEdit.costo === (valutazione.costo_azione != null ? String(valutazione.costo_azione) : ''))}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-dr7-gold text-white hover:opacity-90 disabled:opacity-40"
          >Salva valutazione</button>
        </div>
      </div>

      {mostraNuovo && (
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4 space-y-3">
          <h2 className="text-sm font-semibold text-theme-text-primary">Nuovo investitore</h2>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
            <label className="text-xs text-theme-text-muted sm:col-span-2">Nome / Ragione sociale *
              {/* Si cerca tra i Clienti/Lead: scegliendone uno si compilano tipo, CF/P.IVA, email e telefono. Si puo' anche scrivere un nome nuovo. */}
              <div className="mt-1">
                <LeadPicker
                  label=""
                  placeholder="Cerca tra i clienti o scrivi un nome…"
                  initialQuery={nuovo.nome}
                  onQueryChange={q => setNuovo(n => ({ ...n, nome: q }))}
                  onPick={(name, phone, _id, l) => {
                    const societa = l?.tipoCliente === 'azienda' || (!!l?.partitaIva && !l?.codiceFiscale)
                    setNuovo(n => ({
                      ...n,
                      nome: name || n.nome,
                      tipo: l ? (societa ? 'societa' : 'persona') : n.tipo,
                      codice_fiscale: ((societa ? l?.partitaIva || l?.codiceFiscale : l?.codiceFiscale || l?.partitaIva) || n.codice_fiscale).toUpperCase(),
                      email: l?.email || n.email,
                      telefono: phone || n.telefono,
                    }))
                  }}
                />
              </div>
            </label>
            <label className="text-xs text-theme-text-muted">Tipo
              <select value={nuovo.tipo} onChange={e => setNuovo({ ...nuovo, tipo: e.target.value as 'persona' | 'societa' })} className={inputCls}>
                <option value="persona">Persona</option>
                <option value="societa">Società</option>
              </select>
            </label>
            <label className="text-xs text-theme-text-muted">{nuovo.tipo === 'societa' ? 'P. IVA / CF' : 'Codice fiscale'}
              <input value={nuovo.codice_fiscale} onChange={e => setNuovo({ ...nuovo, codice_fiscale: e.target.value.toUpperCase() })} className={inputCls} />
            </label>
            <label className="text-xs text-theme-text-muted">Email
              <input value={nuovo.email} onChange={e => setNuovo({ ...nuovo, email: e.target.value })} className={inputCls} />
            </label>
            <label className="text-xs text-theme-text-muted">Telefono
              <input value={nuovo.telefono} onChange={e => setNuovo({ ...nuovo, telefono: e.target.value })} className={inputCls} />
            </label>
            <label className="text-xs text-theme-text-muted">Importo investito €
              <MoneyInput value={nuovo.importo} onChange={cambiaImportoNuovo} placeholder="0,00" className={`${inputCls} text-right tabular-nums`} />
            </label>
            <label className="text-xs text-theme-text-muted">Data versamento
              <EuropeanDateInput value={nuovo.data} onChange={v => setNuovo({ ...nuovo, data: v })} className={inputCls} />
            </label>
            <label className="text-xs text-theme-text-muted">Modalità
              <select value={nuovo.strumento} onChange={e => setNuovo({ ...nuovo, strumento: e.target.value })} className={inputCls}>
                {STRUMENTI.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="text-xs text-theme-text-muted">Quota %
              <MoneyInput value={nuovo.quota} onChange={v => setNuovo({ ...nuovo, quota: v })} placeholder={valutazione.valutazione ? 'automatica' : 'facoltativa'} className={`${inputCls} text-right tabular-nums`} />
            </label>
            <label className="text-xs text-theme-text-muted">N. azioni
              <input value={nuovo.azioni} inputMode="numeric" onChange={e => setNuovo({ ...nuovo, azioni: e.target.value.replace(/[^\d.]/g, '') })} placeholder={valutazione.costo_azione ? 'automatico' : 'facoltativo'} className={`${inputCls} text-right tabular-nums`} />
            </label>
            <label className="text-xs text-theme-text-muted">Note
              <input value={nuovo.note} onChange={e => setNuovo({ ...nuovo, note: e.target.value })} className={inputCls} />
            </label>
          </div>
          <div className="flex justify-end">
            <button onClick={creaInvestitore} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold bg-dr7-gold text-white hover:opacity-90 disabled:opacity-50">{saving ? 'Salvataggio…' : 'Salva investitore'}</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
          <p className="text-xs text-theme-text-muted">Totale investito</p>
          <p className="text-2xl font-bold text-dr7-gold tabular-nums">{eur(totale)}</p>
          <p className="text-xs text-theme-text-muted mt-1">{versamenti.length} versamento/i</p>
        </div>
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
          <p className="text-xs text-theme-text-muted">Investitori</p>
          <p className="text-2xl font-bold text-theme-text-primary tabular-nums">{investitori.length}</p>
        </div>
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
          <p className="text-xs text-theme-text-muted">Investimento medio</p>
          <p className="text-2xl font-bold text-theme-text-primary tabular-nums">{eur(investitori.length ? totale / investitori.length : 0)}</p>
        </div>
        <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border p-4">
          <p className="text-xs text-theme-text-muted">Azioni totali</p>
          <p className="text-2xl font-bold text-theme-text-primary tabular-nums">{azioniFmt(totaleAzioni)}</p>
        </div>
      </div>

      <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border overflow-hidden">
        <div className="px-4 py-3 border-b border-theme-border flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-theme-text-primary">Elenco investitori</h2>
          <input
            type="search"
            value={cerca}
            onChange={e => setCerca(e.target.value)}
            placeholder="Cerca per nome…"
            className="w-full sm:w-64 px-3 py-1.5 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm"
          />
        </div>
        {loading ? (
          <div className="p-4"><ScheletroTabella righe={5} colonne={4} /></div>
        ) : ordinati.length === 0 ? (
          <p className="p-4 text-sm text-theme-text-muted">Nessun investitore registrato.</p>
        ) : filtrati.length === 0 ? (
          <p className="p-4 text-sm text-theme-text-muted">Nessun investitore trovato per "{cerca.trim()}".</p>
        ) : (
          <div className="divide-y divide-theme-border">
            {filtrati.map(i => {
              const suoi = perInvestitore.get(i.id) || []
              const tot = totaleDi(i.id)
              const isOpen = aperto === i.id
              return (
                <div key={i.id}>
                  <div className="flex items-center hover:bg-theme-bg-hover">
                  <button onClick={() => { setAperto(isOpen ? null : i.id); setAzioniEdit(i.numero_azioni != null ? String(i.numero_azioni) : '') }} className="flex-1 min-w-0 flex items-center justify-between gap-3 px-4 py-3 text-left">
                    <div className="min-w-0">
                      <p className="text-sm text-theme-text-primary font-medium truncate">
                        {i.nome}
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] border border-theme-border text-theme-text-muted">{i.tipo === 'societa' ? 'Società' : 'Persona'}</span>
                        {i.quota_percentuale != null && <span className="ml-2 text-xs text-theme-text-muted">quota {Number(i.quota_percentuale).toLocaleString('it-IT')}%</span>}
                        {i.numero_azioni != null && <span className="ml-2 text-xs text-theme-text-muted">{azioniFmt(i.numero_azioni)} azioni</span>}
                      </p>
                      <p className="text-xs text-theme-text-muted truncate">
                        {suoi.length} versamento/i{suoi[0] ? ` · ultimo il ${itDate(suoi[0].data_versamento)}` : ''}{[i.email, i.telefono].filter(Boolean).length ? ` · ${[i.email, i.telefono].filter(Boolean).join(' · ')}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-dr7-gold tabular-nums">{eur(tot)}</p>
                      <p className="text-[11px] text-theme-text-muted tabular-nums">{totale > 0 ? `${((tot / totale) * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 })}% del totale` : '—'}</p>
                    </div>
                  </button>
                  {/* Nome sul sito: AUTORIZZO / RISERVATO risposto su WhatsApp. */}
                  <div className="shrink-0 flex items-center gap-1.5 pr-4">
                    {i.pubblicazione_nome === 'autorizzato' ? (
                      <>
                        <span className="px-2 py-1 rounded text-[11px] font-semibold border border-green-500/40 text-green-600 dark:text-green-400">Sul sito</span>
                        <button onClick={() => impostaPubblicazione(i, null)} disabled={saving} className="text-[11px] px-2 py-1 rounded border border-theme-border text-theme-text-muted hover:bg-theme-bg-tertiary disabled:opacity-50">Togli</button>
                      </>
                    ) : i.pubblicazione_nome === 'riservato' ? (
                      <>
                        <span className="px-2 py-1 rounded text-[11px] font-semibold border border-theme-border text-theme-text-muted">Riservato</span>
                        <button onClick={() => impostaPubblicazione(i, 'autorizzato')} disabled={saving} className="text-[11px] px-2 py-1 rounded border border-theme-border text-theme-text-primary hover:bg-theme-bg-tertiary disabled:opacity-50">Autorizza</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => impostaPubblicazione(i, 'autorizzato')} disabled={saving} className="text-[11px] px-2 py-1 rounded font-semibold bg-dr7-gold text-white hover:opacity-90 disabled:opacity-50">Autorizza</button>
                        <button onClick={() => impostaPubblicazione(i, 'riservato')} disabled={saving} className="text-[11px] px-2 py-1 rounded border border-theme-border text-theme-text-primary hover:bg-theme-bg-tertiary disabled:opacity-50">Riservato</button>
                      </>
                    )}
                  </div>
                  </div>
                  {isOpen && (
                    <div className="px-4 pb-4 space-y-3 bg-theme-bg-tertiary/40">
                      {(i.codice_fiscale || i.note) && (
                        <p className="pt-3 text-xs text-theme-text-muted">{[i.codice_fiscale, i.note].filter(Boolean).join(' · ')}</p>
                      )}
                      <div className="pt-3 flex flex-wrap items-end gap-3">
                        <label className="text-xs text-theme-text-muted">N. azioni
                          <input value={azioniEdit} inputMode="numeric" onChange={e => setAzioniEdit(e.target.value.replace(/[^\d.]/g, ''))} placeholder="non indicato" className={`${inputCls} w-40 text-right tabular-nums`} />
                        </label>
                        <button onClick={() => salvaAzioni(i)} disabled={saving || parseAzioni(azioniEdit) === (i.numero_azioni != null ? Number(i.numero_azioni) : null)} className="px-3 py-2 rounded-lg text-sm font-semibold border border-theme-border text-theme-text-primary hover:bg-theme-bg-hover disabled:opacity-40">Salva azioni</button>
                      </div>
                      <div className="pt-3 rounded-lg border border-theme-border divide-y divide-theme-border bg-theme-bg-primary">
                        {suoi.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-theme-text-muted">Nessun versamento.</p>
                        ) : suoi.map(v => (
                          <div key={v.id} className="flex items-center justify-between gap-3 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-sm text-theme-text-primary tabular-nums">{eur(v.importo)} <span className="text-theme-text-muted text-xs">— {itDate(v.data_versamento)}{v.strumento ? ` · ${v.strumento}` : ''}</span></p>
                              {v.note && <p className="text-xs text-theme-text-muted truncate">{v.note}</p>}
                            </div>
                            <button onClick={() => eliminaVersamento(v)} className="text-[11px] px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 shrink-0">Elimina</button>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
                        <label className="text-xs text-theme-text-muted">Importo €
                          <MoneyInput value={versamento.importo} onChange={v => setVersamento({ ...versamento, importo: v })} placeholder="0,00" className={`${inputCls} text-right tabular-nums`} />
                          {(() => {
                            const imp = parseMoney(versamento.importo)
                            const a = azioniDa(imp, valutazione.costo_azione)
                            const q = quotaDa(tot + (imp > 0 ? imp : 0), valutazione.valutazione)
                            if (!(imp > 0) || (a == null && q == null)) return null
                            return <span className="block mt-1 text-[11px] text-theme-text-muted tabular-nums">{[a != null ? `+${azioniFmt(a)} azioni` : '', q != null ? `quota ${q.toLocaleString('it-IT')}%` : ''].filter(Boolean).join(' · ')}</span>
                          })()}
                        </label>
                        <label className="text-xs text-theme-text-muted">Data
                          <EuropeanDateInput value={versamento.data} onChange={v => setVersamento({ ...versamento, data: v })} className={inputCls} />
                        </label>
                        <label className="text-xs text-theme-text-muted">Modalità
                          <select value={versamento.strumento} onChange={e => setVersamento({ ...versamento, strumento: e.target.value })} className={inputCls}>
                            {STRUMENTI.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-theme-text-muted">Nota
                          <input value={versamento.note} onChange={e => setVersamento({ ...versamento, note: e.target.value })} className={inputCls} />
                        </label>
                        <button onClick={() => aggiungiVersamento(i.id)} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold bg-dr7-gold text-white hover:opacity-90 disabled:opacity-50">Aggiungi versamento</button>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => { if (window.confirm(`Rimandare a ${i.nome} i due WhatsApp (benvenuto e autorizzazione nome)?`)) mandaMessaggi({ nome: i.nome, tipo: i.tipo, telefono: i.telefono }) }}
                          disabled={!i.telefono}
                          title={i.telefono ? '' : 'Telefono mancante'}
                          className="text-[11px] px-2 py-1 rounded border border-theme-border text-theme-text-primary hover:bg-theme-bg-hover disabled:opacity-40"
                        >Rimanda messaggi WhatsApp</button>
                        <button onClick={() => eliminaInvestitore(i)} className="text-[11px] px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10">Elimina investitore</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
