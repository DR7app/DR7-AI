import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import MoneyInput from '../../../components/MoneyInput'
import EuropeanDateInput from '../../../components/EuropeanDateInput'
import { ScheletroTabella } from '../../../components/Scheletro'
import toast from 'react-hot-toast'
import { percorsoStorage } from '../../../utils/percorsoStorage'

/**
 * PROMOZIONI PRENOTABILI — 26/09/2026
 *
 * Una promozione e' un PREZZO AL GIORNO speciale su uno o piu' veicoli, in una
 * finestra di date e con posti limitati. Il cliente la prenota subito dal sito
 * (la prevendita invece si compra oggi e si usa dopo).
 *
 * La promozione cambia SOLO il prezzo dei giorni di noleggio: cauzione,
 * assicurazione e km restano quelli di una prenotazione normale, perche'
 * dipendono dal cliente (Fascia, residenza), non dall'offerta.
 *
 * Il database controlla ogni prenotazione promo (trigger trg_01_promozione_valida,
 * migrazione 20260926_promozioni.sql): veicolo, date, giorni, posti e prezzo.
 */

interface VeicoloPromo { id: string; nome: string; targa: string | null }
interface VeicoloFlotta { id: string; display_name: string; plate: string | null; daily_rate: number | null }

interface Promozione {
  id: string
  titolo: string
  titolo_en: string | null
  descrizione: string | null
  descrizione_en: string | null
  foto_urls: string[]
  business: string
  veicoli: VeicoloPromo[]
  prezzo_giorno: number
  prezzo_listino_giorno: number | null
  noleggio_dal: string
  noleggio_al: string
  min_giorni: number | null
  max_giorni: number | null
  visibile_dal: string | null
  visibile_al: string | null
  posti_totali: number | null
  attiva: boolean
  visibile_sito: boolean
  ordine: number
  created_at: string
}

interface Bozza {
  titolo: string
  titolo_en: string
  descrizione: string
  descrizione_en: string
  foto_urls: string[]
  veicoli: VeicoloPromo[]
  prezzo_giorno: string
  prezzo_listino_giorno: string
  noleggio_dal: string
  noleggio_al: string
  min_giorni: string
  max_giorni: string
  visibile_dal: string
  visibile_al: string
  posti_totali: string
  attiva: boolean
  visibile_sito: boolean
  ordine: string
}

const BOZZA_VUOTA: Bozza = {
  titolo: '', titolo_en: '', descrizione: '', descrizione_en: '',
  foto_urls: [], veicoli: [],
  prezzo_giorno: '', prezzo_listino_giorno: '',
  noleggio_dal: '', noleggio_al: '', min_giorni: '', max_giorni: '',
  visibile_dal: '', visibile_al: '', posti_totali: '',
  attiva: true, visibile_sito: true, ordine: '0',
}

const ANNULLATE = ['cancelled', 'annullata', 'rejected']

const euro = (n: number | null | undefined) =>
  `€ ${(Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Date DATE (YYYY-MM-DD) mostrate gg/mm/aaaa senza passare dal fuso.
const dataIt = (v: string | null | undefined) => {
  if (!v) return '—'
  const [a, m, g] = v.slice(0, 10).split('-')
  return `${g}/${m}/${a}`
}

// Visibilita': si sceglie un giorno, si salva l'inizio (00:00) o la fine
// (23:59) di quel giorno nell'ora del browser dello staff (Italia).
const giornoAIso = (d: string, fine: boolean) =>
  d ? new Date(`${d}T${fine ? '23:59:59' : '00:00:00'}`).toISOString() : null
const isoAGiorno = (v: string | null) => {
  if (!v) return ''
  const d = new Date(v)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const numeroOppureNull = (v: string) => {
  const s = v.trim()
  if (s === '') return null
  const n = Number(s.replace(',', '.'))
  return isNaN(n) ? null : n
}
const interoOppureNull = (v: string) => {
  const n = numeroOppureNull(v)
  return n === null ? null : Math.trunc(n)
}

const campo = 'w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold'

export default function PromozioniView({ apriNuovaRichiesta, onRichiestaGestita }: { apriNuovaRichiesta: boolean; onRichiestaGestita: () => void }) {
  const [promozioni, setPromozioni] = useState<Promozione[]>([])
  const [caricamento, setCaricamento] = useState(true)
  // Posti occupati e incasso per promozione (prenotazioni non annullate).
  const [numeri, setNumeri] = useState<Record<string, { posti: number; incasso: number }>>({})

  const [modale, setModale] = useState<null | 'nuova' | 'modifica'>(null)
  const [inModifica, setInModifica] = useState<Promozione | null>(null)
  const [bozza, setBozza] = useState<Bozza>({ ...BOZZA_VUOTA })
  const [salvataggio, setSalvataggio] = useState(false)
  const [caricamentoFoto, setCaricamentoFoto] = useState(false)
  const inputFoto = useRef<HTMLInputElement>(null)

  const [flotta, setFlotta] = useState<VeicoloFlotta[]>([])
  const [ricercaVeicolo, setRicercaVeicolo] = useState('')

  const carica = useCallback(async () => {
    setCaricamento(true)
    try {
      const { data, error } = await supabase
        .from('promozioni')
        .select('*')
        .order('ordine', { ascending: true })
        .order('created_at', { ascending: false })
      if (error) throw error
      const lista = (data || []) as Promozione[]
      setPromozioni(lista)

      // Prenotazioni che usano una promozione: una sola lettura per tutte.
      if (lista.length) {
        const { data: pren, error: errPren } = await supabase
          .from('bookings')
          .select('status, price_total, booking_details->>promo_id')
          .not('booking_details->>promo_id', 'is', null)
        if (errPren) throw errPren
        const conti: Record<string, { posti: number; incasso: number }> = {}
        for (const b of (pren || []) as { status: string | null; price_total: number | null; promo_id: string | null }[]) {
          if (!b.promo_id || ANNULLATE.includes(String(b.status || '').toLowerCase())) continue
          const c = conti[b.promo_id] || { posti: 0, incasso: 0 }
          c.posti += 1
          c.incasso += (Number(b.price_total) || 0) / 100
          conti[b.promo_id] = c
        }
        setNumeri(conti)
      } else {
        setNumeri({})
      }
    } catch (e) {
      console.error('Promozioni: non caricate', e)
      toast.error('Promozioni non caricate')
    } finally {
      setCaricamento(false)
    }
  }, [])

  const caricaFlotta = useCallback(async () => {
    const { data } = await supabase
      .from('vehicles')
      .select('id, display_name, plate, daily_rate')
      .neq('status', 'retired')
      .order('display_name')
    setFlotta((data || []) as VeicoloFlotta[])
  }, [])

  useEffect(() => { carica(); caricaFlotta() }, [carica, caricaFlotta])

  // "Nuova offerta > Promozione" dalla testata della tab apre l'editor qui,
  // anche quando la vista viene montata in quel momento.
  useEffect(() => {
    if (apriNuovaRichiesta) {
      apriNuova()
      onRichiestaGestita()
    }
  }, [apriNuovaRichiesta, onRichiestaGestita])

  const flottaFiltrata = useMemo(() => {
    const q = ricercaVeicolo.trim().toLowerCase()
    return flotta.filter(v => !q || v.display_name.toLowerCase().includes(q) || (v.plate || '').toLowerCase().includes(q))
  }, [flotta, ricercaVeicolo])

  function apriNuova() {
    setInModifica(null)
    setBozza({ ...BOZZA_VUOTA })
    setRicercaVeicolo('')
    setModale('nuova')
  }

  function daPromo(p: Promozione): Bozza {
    return {
      titolo: p.titolo || '',
      titolo_en: p.titolo_en || '',
      descrizione: p.descrizione || '',
      descrizione_en: p.descrizione_en || '',
      foto_urls: Array.isArray(p.foto_urls) ? p.foto_urls : [],
      veicoli: Array.isArray(p.veicoli) ? p.veicoli : [],
      prezzo_giorno: p.prezzo_giorno != null ? String(p.prezzo_giorno) : '',
      prezzo_listino_giorno: p.prezzo_listino_giorno != null ? String(p.prezzo_listino_giorno) : '',
      noleggio_dal: p.noleggio_dal || '',
      noleggio_al: p.noleggio_al || '',
      min_giorni: p.min_giorni != null ? String(p.min_giorni) : '',
      max_giorni: p.max_giorni != null ? String(p.max_giorni) : '',
      visibile_dal: isoAGiorno(p.visibile_dal),
      visibile_al: isoAGiorno(p.visibile_al),
      posti_totali: p.posti_totali != null ? String(p.posti_totali) : '',
      attiva: p.attiva,
      visibile_sito: p.visibile_sito,
      ordine: String(p.ordine ?? 0),
    }
  }

  function apriModifica(p: Promozione) {
    setInModifica(p)
    setBozza(daPromo(p))
    setRicercaVeicolo('')
    setModale('modifica')
  }

  function duplica(p: Promozione) {
    setInModifica(null)
    // La copia nasce spenta: la si controlla prima di metterla sul sito.
    setBozza({ ...daPromo(p), titolo: `${p.titolo} (copia)`, attiva: false, visibile_sito: false })
    setRicercaVeicolo('')
    setModale('nuova')
  }

  function scegliVeicolo(v: VeicoloFlotta) {
    setBozza(b => {
      const scelto = b.veicoli.some(x => x.id === v.id)
      const veicoli = scelto
        ? b.veicoli.filter(x => x.id !== v.id)
        : [...b.veicoli, { id: v.id, nome: v.display_name, targa: v.plate }]
      // Con un solo veicolo il prezzo "invece di" parte dalla sua tariffa.
      let listino = b.prezzo_listino_giorno
      if (!listino && veicoli.length === 1) {
        const tariffa = flotta.find(f => f.id === veicoli[0].id)?.daily_rate
        if (tariffa) listino = String(tariffa)
      }
      return { ...b, veicoli, prezzo_listino_giorno: listino }
    })
  }

  async function caricaFoto(files: File[]) {
    const immagini = files.filter(f => f.type.startsWith('image/'))
    if (immagini.length < files.length) toast.error('Alcuni file non sono immagini: saltati')
    const troppoGrandi = immagini.filter(f => f.size > 10 * 1024 * 1024)
    if (troppoGrandi.length) toast.error(`${troppoGrandi.length} immagini oltre 10MB: saltate`)
    const daCaricare = immagini.filter(f => f.size <= 10 * 1024 * 1024)
    if (!daCaricare.length) return
    setCaricamentoFoto(true)
    const caricate: string[] = []
    try {
      for (const file of daCaricare) {
        const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
        const path = percorsoStorage('promozioni', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
        const { error } = await supabase.storage.from('catalog-images').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })
        if (error) throw error
        caricate.push(supabase.storage.from('catalog-images').getPublicUrl(path).data.publicUrl)
      }
      toast.success(`${caricate.length === 1 ? 'Foto caricata' : `${caricate.length} foto caricate`}. Ricorda di salvare.`)
    } catch (e) {
      console.error(e)
      toast.error('Caricamento foto non riuscito: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      if (caricate.length) setBozza(b => ({ ...b, foto_urls: [...b.foto_urls, ...caricate] }))
      setCaricamentoFoto(false)
      if (inputFoto.current) inputFoto.current.value = ''
    }
  }

  function spostaFoto(i: number, verso: -1 | 1) {
    setBozza(b => {
      const j = i + verso
      if (j < 0 || j >= b.foto_urls.length) return b
      const lista = [...b.foto_urls]
      ;[lista[i], lista[j]] = [lista[j], lista[i]]
      return { ...b, foto_urls: lista }
    })
  }

  async function salva() {
    if (!bozza.titolo.trim()) return toast.error('Serve il titolo della promozione')
    if (!bozza.veicoli.length) return toast.error('Scegli almeno un veicolo')
    const prezzo = numeroOppureNull(bozza.prezzo_giorno)
    if (prezzo === null || prezzo <= 0) return toast.error('Serve il prezzo al giorno della promozione (maggiore di zero)')
    const listino = numeroOppureNull(bozza.prezzo_listino_giorno)
    if (listino !== null && listino <= prezzo) return toast.error('Il prezzo normale deve essere piu alto del prezzo promo, altrimenti lascialo vuoto')
    if (!bozza.noleggio_dal || !bozza.noleggio_al) return toast.error('Servono le date: dal giorno e al giorno del noleggio')
    if (bozza.noleggio_al < bozza.noleggio_dal) return toast.error('La data di fine noleggio e prima della data di inizio')
    const minG = interoOppureNull(bozza.min_giorni)
    const maxG = interoOppureNull(bozza.max_giorni)
    if (minG !== null && minG < 1) return toast.error('Giorni minimi: almeno 1')
    if (maxG !== null && maxG < 1) return toast.error('Giorni massimi: almeno 1')
    if (minG !== null && maxG !== null && maxG < minG) return toast.error('I giorni massimi sono meno dei giorni minimi')
    if (bozza.visibile_dal && bozza.visibile_al && bozza.visibile_al < bozza.visibile_dal) return toast.error('La visibilita sul sito finisce prima di iniziare')
    const posti = interoOppureNull(bozza.posti_totali)
    if (posti !== null && posti < 0) return toast.error('Posti: un numero da 0 in su, oppure vuoto per illimitati')

    const riga = {
      titolo: bozza.titolo.trim(),
      titolo_en: bozza.titolo_en.trim() || null,
      descrizione: bozza.descrizione.trim() || null,
      descrizione_en: bozza.descrizione_en.trim() || null,
      foto_urls: bozza.foto_urls,
      business: 'terra',
      veicoli: bozza.veicoli,
      prezzo_giorno: prezzo,
      prezzo_listino_giorno: listino,
      noleggio_dal: bozza.noleggio_dal,
      noleggio_al: bozza.noleggio_al,
      min_giorni: minG,
      max_giorni: maxG,
      visibile_dal: giornoAIso(bozza.visibile_dal, false),
      visibile_al: giornoAIso(bozza.visibile_al, true),
      posti_totali: posti,
      attiva: bozza.attiva,
      visibile_sito: bozza.visibile_sito,
      ordine: interoOppureNull(bozza.ordine) ?? 0,
    }

    setSalvataggio(true)
    try {
      const { error } = inModifica
        ? await supabase.from('promozioni').update(riga).eq('id', inModifica.id)
        : await supabase.from('promozioni').insert(riga)
      if (error) throw error
      toast.success(inModifica ? 'Promozione aggiornata' : 'Promozione creata')
      setModale(null)
      await carica()
    } catch (e) {
      console.error(e)
      toast.error('Salvataggio non riuscito: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSalvataggio(false)
    }
  }

  async function cambia(p: Promozione, campo: 'attiva' | 'visibile_sito') {
    const { error } = await supabase.from('promozioni').update({ [campo]: !p[campo] }).eq('id', p.id)
    if (error) return toast.error('Modifica non riuscita: ' + error.message)
    setPromozioni(lista => lista.map(x => x.id === p.id ? { ...x, [campo]: !p[campo] } : x))
  }

  async function elimina(p: Promozione) {
    const prenotate = numeri[p.id]?.posti || 0
    if (!confirm(`Eliminare la promozione "${p.titolo}"?${prenotate ? `\n\n${prenotate} prenotazioni la usano: restano valide al prezzo pagato.` : ''}`)) return
    const { error } = await supabase.from('promozioni').delete().eq('id', p.id)
    if (error) return toast.error('Eliminazione non riuscita: ' + error.message)
    toast.success('Promozione eliminata')
    setPromozioni(lista => lista.filter(x => x.id !== p.id))
  }

  const oggi = new Date().toISOString().slice(0, 10)

  return (
    <>
      {caricamento ? <ScheletroTabella righe={4} colonne={5} /> : (
        promozioni.length === 0 ? (
          <div className="bg-theme-bg-tertiary border border-theme-border rounded-lg p-10 text-center">
            <p className="text-theme-text-primary font-medium">Nessuna promozione</p>
            <p className="text-sm text-theme-text-muted mt-1">Creane una con "Nuova offerta" &gt; Promozione: il cliente la prenota subito dal sito.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {promozioni.map(p => {
              const n = numeri[p.id] || { posti: 0, incasso: 0 }
              const esaurita = p.posti_totali !== null && n.posti >= p.posti_totali
              const scaduta = p.noleggio_al < oggi
              const copertina = Array.isArray(p.foto_urls) ? p.foto_urls[0] : undefined
              return (
                <div key={p.id} className="bg-theme-bg-tertiary border border-theme-border rounded-lg overflow-hidden flex flex-col">
                  {copertina
                    ? <img src={copertina} alt={p.titolo} className="w-full h-44 object-cover" />
                    : <div className="w-full h-44 bg-theme-bg-secondary flex items-center justify-center text-theme-text-muted text-sm">Nessuna foto</div>}
                  <div className="p-4 flex-1 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] uppercase tracking-wide text-dr7-gold font-semibold">Promozione</span>
                        <h3 className="font-bold text-theme-text-primary leading-tight">{p.titolo}</h3>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <span className="text-lg font-bold text-dr7-gold">{euro(p.prezzo_giorno)}</span>
                        <span className="text-xs text-theme-text-muted"> /giorno</span>
                        {p.prezzo_listino_giorno !== null && (
                          <p className="text-xs text-theme-text-muted line-through">{euro(p.prezzo_listino_giorno)}</p>
                        )}
                      </div>
                    </div>
                    {p.descrizione && <p className="text-sm text-theme-text-muted line-clamp-2">{p.descrizione}</p>}

                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt className="text-theme-text-muted">Noleggio</dt>
                      <dd className="text-theme-text-primary text-right">{dataIt(p.noleggio_dal)} - {dataIt(p.noleggio_al)}</dd>
                      <dt className="text-theme-text-muted">Giorni</dt>
                      <dd className="text-theme-text-primary text-right">
                        {p.min_giorni || p.max_giorni ? `${p.min_giorni ? `min ${p.min_giorni}` : ''}${p.min_giorni && p.max_giorni ? ' · ' : ''}${p.max_giorni ? `max ${p.max_giorni}` : ''}` : 'Nessun limite'}
                      </dd>
                      <dt className="text-theme-text-muted">Prenotazioni</dt>
                      <dd className="text-theme-text-primary text-right">{n.posti}{p.posti_totali !== null ? ` / ${p.posti_totali}` : ' (posti illimitati)'}</dd>
                      <dt className="text-theme-text-muted">Incasso</dt>
                      <dd className="text-theme-text-primary text-right">{euro(n.incasso)}</dd>
                      {(p.visibile_dal || p.visibile_al) && (<>
                        <dt className="text-theme-text-muted">Sul sito</dt>
                        <dd className="text-theme-text-primary text-right">{p.visibile_dal ? dataIt(isoAGiorno(p.visibile_dal)) : 'subito'} - {p.visibile_al ? dataIt(isoAGiorno(p.visibile_al)) : 'senza fine'}</dd>
                      </>)}
                    </dl>

                    <div className="flex flex-wrap gap-1">
                      {(p.veicoli || []).map(v => (
                        <span key={v.id} className="px-2 py-0.5 rounded-full text-xs bg-theme-bg-secondary text-theme-text-secondary">
                          {v.nome}{v.targa ? ` (${v.targa})` : ''}
                        </span>
                      ))}
                      {esaurita && <span className="px-2 py-0.5 rounded-full text-xs bg-red-600/20 text-red-500 dark:text-red-400">Esaurita</span>}
                      {scaduta && <span className="px-2 py-0.5 rounded-full text-xs bg-theme-bg-secondary text-theme-text-muted">Date passate</span>}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-auto pt-2 border-t border-theme-border">
                      <button
                        onClick={() => cambia(p, 'attiva')}
                        className={`px-2 py-1 rounded-full text-xs font-medium ${p.attiva ? 'bg-emerald-600/20 text-emerald-600 dark:text-emerald-400' : 'bg-theme-bg-secondary text-theme-text-muted'}`}
                      >
                        {p.attiva ? 'Attiva' : 'Non attiva'}
                      </button>
                      <button
                        onClick={() => cambia(p, 'visibile_sito')}
                        className={`px-2 py-1 rounded-full text-xs font-medium ${p.visibile_sito ? 'bg-blue-600/20 text-blue-600 dark:text-blue-400' : 'bg-theme-bg-secondary text-theme-text-muted'}`}
                      >
                        {p.visibile_sito ? 'Sul sito' : 'Nascosta'}
                      </button>
                      <div className="ml-auto flex gap-2">
                        <button onClick={() => apriModifica(p)} className="text-xs text-dr7-gold hover:underline">Modifica</button>
                        <button onClick={() => duplica(p)} className="text-xs text-dr7-gold hover:underline">Duplica</button>
                        <button onClick={() => elimina(p)} className="text-xs text-red-500 dark:text-red-400 hover:underline">Elimina</button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {modale && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-theme-bg-secondary border border-theme-border rounded-xl w-full max-w-3xl my-8">
            <div className="p-6 border-b border-theme-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-theme-text-primary">
                {modale === 'nuova' ? 'Nuova promozione' : 'Modifica promozione'}
              </h3>
              <button onClick={() => setModale(null)} className="text-theme-text-muted hover:text-theme-text-primary">Chiudi</button>
            </div>

            <div className="p-6 space-y-5">
              <p className="text-xs text-theme-text-muted bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2">
                Cauzione, assicurazione e km: come una prenotazione normale (dipendono dal cliente: Fascia, residenza).
                La promozione cambia solo il prezzo dei giorni di noleggio.
              </p>

              {/* Testi */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Titolo *</label>
                  <input type="text" value={bozza.titolo} onChange={e => setBozza(b => ({ ...b, titolo: e.target.value }))} placeholder="Ferrari 296 GTB a prezzo speciale" className={campo} />
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Titolo (inglese)</label>
                  <input type="text" value={bozza.titolo_en} onChange={e => setBozza(b => ({ ...b, titolo_en: e.target.value }))} className={campo} />
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Descrizione</label>
                  <textarea rows={3} value={bozza.descrizione} onChange={e => setBozza(b => ({ ...b, descrizione: e.target.value }))} className={campo} />
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Descrizione (inglese)</label>
                  <textarea rows={3} value={bozza.descrizione_en} onChange={e => setBozza(b => ({ ...b, descrizione_en: e.target.value }))} className={campo} />
                </div>
              </div>

              {/* Foto: solo caricamento dal computer, niente indirizzi */}
              <div>
                <label className="text-sm text-theme-text-secondary mb-1 block">Foto ({bozza.foto_urls.length})</label>
                <div className="flex flex-wrap gap-3">
                  {bozza.foto_urls.map((url, i) => (
                    <div key={url + i} className="relative w-32">
                      <img src={url} alt="" className="w-32 h-20 object-cover rounded-lg border border-theme-border" />
                      {i === 0 && <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-dr7-gold text-white text-[10px] font-semibold">Copertina</span>}
                      <div className="mt-1 flex items-center justify-between text-xs">
                        <button type="button" disabled={i === 0} onClick={() => spostaFoto(i, -1)} className="px-2 py-0.5 rounded border border-theme-border text-theme-text-secondary disabled:opacity-30" aria-label="Sposta a sinistra">&lt;</button>
                        <button type="button" onClick={() => setBozza(b => ({ ...b, foto_urls: b.foto_urls.filter((_, k) => k !== i) }))} className="px-2 py-0.5 rounded text-red-500 hover:bg-red-500/10">Rimuovi</button>
                        <button type="button" disabled={i === bozza.foto_urls.length - 1} onClick={() => spostaFoto(i, 1)} className="px-2 py-0.5 rounded border border-theme-border text-theme-text-secondary disabled:opacity-30" aria-label="Sposta a destra">&gt;</button>
                      </div>
                    </div>
                  ))}
                  <input
                    ref={inputFoto}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={e => { const f = Array.from(e.target.files || []); if (f.length) caricaFoto(f) }}
                  />
                  <button
                    type="button"
                    onClick={() => inputFoto.current?.click()}
                    disabled={caricamentoFoto}
                    className="w-32 h-20 rounded-lg border-2 border-dashed border-theme-border text-sm text-theme-text-secondary hover:border-dr7-gold hover:text-dr7-gold transition-colors disabled:opacity-50"
                  >
                    {caricamentoFoto ? 'Caricamento...' : '+ Aggiungi foto'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-theme-text-muted">Puoi selezionare piu foto insieme. La prima e la copertina; usa &lt; &gt; per cambiare l'ordine.</p>
              </div>

              {/* Veicoli */}
              <div>
                <label className="text-sm text-theme-text-secondary mb-1 block">Veicoli in promozione *</label>
                <div className="flex flex-wrap gap-1 mb-2">
                  {bozza.veicoli.map(v => (
                    <button
                      key={v.id}
                      onClick={() => setBozza(b => ({ ...b, veicoli: b.veicoli.filter(x => x.id !== v.id) }))}
                      className="px-2 py-1 rounded-full text-xs bg-dr7-gold/20 text-dr7-gold hover:bg-red-600/20 hover:text-red-500"
                    >
                      {v.nome}{v.targa ? ` (${v.targa})` : ''} — togli
                    </button>
                  ))}
                  {bozza.veicoli.length === 0 && <span className="text-xs text-theme-text-muted">Nessun veicolo scelto</span>}
                </div>
                <input type="text" value={ricercaVeicolo} onChange={e => setRicercaVeicolo(e.target.value)} placeholder="Cerca per nome o targa..." className={campo} />
                <div className="mt-2 max-h-48 overflow-y-auto border border-theme-border rounded-lg divide-y divide-theme-border">
                  {flottaFiltrata.map(v => {
                    const scelto = bozza.veicoli.some(x => x.id === v.id)
                    return (
                      <button
                        key={v.id}
                        onClick={() => scegliVeicolo(v)}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${scelto ? 'bg-dr7-gold/15 text-dr7-gold' : 'text-theme-text-primary hover:bg-theme-bg-hover'}`}
                      >
                        {v.display_name}
                        {v.plate && <span className="text-xs text-theme-text-muted ml-2">{v.plate}</span>}
                        {v.daily_rate ? <span className="text-xs text-theme-text-muted ml-2">{euro(v.daily_rate)}/giorno</span> : null}
                        {scelto && <span className="text-xs ml-2">— scelto</span>}
                      </button>
                    )
                  })}
                  {flottaFiltrata.length === 0 && <div className="px-3 py-4 text-sm text-theme-text-muted">Nessun veicolo trovato</div>}
                </div>
              </div>

              {/* Prezzo e posti */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Prezzo promo al giorno (€) *</label>
                  <MoneyInput value={bozza.prezzo_giorno} onChange={v => setBozza(b => ({ ...b, prezzo_giorno: v }))} placeholder="499" className={campo} />
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Prezzo normale al giorno (€)</label>
                  <MoneyInput value={bozza.prezzo_listino_giorno} onChange={v => setBozza(b => ({ ...b, prezzo_listino_giorno: v }))} placeholder="Mostrato barrato" className={campo} />
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Posti</label>
                  <input type="text" inputMode="numeric" value={bozza.posti_totali} onChange={e => setBozza(b => ({ ...b, posti_totali: e.target.value.replace(/\D/g, '') }))} placeholder="Vuoto = illimitati" className={campo} />
                </div>
              </div>

              {/* Date del noleggio */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Noleggio dal *</label>
                  <EuropeanDateInput value={bozza.noleggio_dal} onChange={v => setBozza(b => ({ ...b, noleggio_dal: v }))} className={campo} />
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Noleggio al *</label>
                  <EuropeanDateInput value={bozza.noleggio_al} onChange={v => setBozza(b => ({ ...b, noleggio_al: v }))} min={bozza.noleggio_dal || undefined} className={campo} />
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Giorni minimi</label>
                  <input type="text" inputMode="numeric" value={bozza.min_giorni} onChange={e => setBozza(b => ({ ...b, min_giorni: e.target.value.replace(/\D/g, '') }))} placeholder="Nessuno" className={campo} />
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Giorni massimi</label>
                  <input type="text" inputMode="numeric" value={bozza.max_giorni} onChange={e => setBozza(b => ({ ...b, max_giorni: e.target.value.replace(/\D/g, '') }))} placeholder="Nessuno" className={campo} />
                </div>
              </div>
              <p className="-mt-3 text-xs text-theme-text-muted">Ritiro e riconsegna devono stare dentro queste date.</p>

              {/* Visibilita' sul sito */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Sul sito dal</label>
                  <EuropeanDateInput value={bozza.visibile_dal} onChange={v => setBozza(b => ({ ...b, visibile_dal: v }))} className={campo} />
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Sul sito fino al</label>
                  <EuropeanDateInput value={bozza.visibile_al} onChange={v => setBozza(b => ({ ...b, visibile_al: v }))} min={bozza.visibile_dal || undefined} className={campo} />
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Ordine</label>
                  <input type="text" inputMode="numeric" value={bozza.ordine} onChange={e => setBozza(b => ({ ...b, ordine: e.target.value.replace(/[^\d-]/g, '') }))} className={campo} />
                </div>
              </div>

              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm text-theme-text-primary">
                  <input type="checkbox" checked={bozza.attiva} onChange={e => setBozza(b => ({ ...b, attiva: e.target.checked }))} />
                  Attiva
                </label>
                <label className="flex items-center gap-2 text-sm text-theme-text-primary">
                  <input type="checkbox" checked={bozza.visibile_sito} onChange={e => setBozza(b => ({ ...b, visibile_sito: e.target.checked }))} />
                  Visibile sul sito
                </label>
              </div>
            </div>

            <div className="p-6 border-t border-theme-border flex justify-end gap-3">
              <button onClick={() => setModale(null)} className="px-4 py-2 rounded-lg text-sm text-theme-text-secondary hover:bg-theme-bg-hover">Annulla</button>
              <button
                onClick={salva}
                disabled={salvataggio || caricamentoFoto}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-dr7-gold text-white hover:opacity-90 disabled:opacity-50"
              >
                {salvataggio ? 'Salvataggio...' : 'Salva promozione'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
