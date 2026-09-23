import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import MoneyInput from '../../../components/MoneyInput'
import { ScheletroTabella } from '../../../components/Scheletro'
import toast from 'react-hot-toast'
import { useRentalConfig } from '../../../hooks/useRentalConfig'
import { getInsuranceOptions } from '../../../utils/configLookup'

/**
 * PREVENDITE DR7 — 14/09/2026
 *
 * Una prevendita e' un pacchetto di utilizzi pagati in anticipo: "Ferrari 296
 * GTB - 10 Experience", 2.900 EUR, 10 utilizzi, 100 km per utilizzo, 12 mesi,
 * massimo 3 utilizzi al mese e 2 giorni consecutivi.
 *
 * Qui si fa tutto il giro:
 *   Catalogo   -> si crea e si modifica il pacchetto che il sito mette in
 *                 vendita. I vincoli scritti qui il sito li applica da solo.
 *   Venduti    -> per ogni cliente: cosa ha comprato, quanto ha pagato, quanti
 *                 utilizzi aveva, quanti ne ha usati, quanti ne restano, le
 *                 prenotazioni fatte, la scadenza e lo stato.
 *   Popup Sito -> il testo e l'interruttore del popup delle prevendite.
 *
 * Regola DR7 sull'annullamento: l'utilizzo NON torna indietro da solo. Lo
 * rimette la direzione da qui, prenotazione per prenotazione (bottone
 * "Ripristina utilizzo").
 */

// ─── Tipi ────────────────────────────────────────────────────────────────────

// Km illimitati = 9999, la stessa soglia che usano il wizard del sito e le
// prenotazioni (kmPackage.includedKm >= 9999). Niente colonna nuova.
const KM_ILLIMITATI = 9999
function testoKm(km: number | null | undefined): string {
  if (Number(km) >= KM_ILLIMITATI) return 'Illimitati'
  return km ? String(km) : '—'
}

interface VeicoloPrevendita { id: string; nome: string; targa?: string | null }

interface Prevendita {
  id: string
  nome: string
  descrizione: string | null
  foto_url: string | null
  prezzo: number
  prezzo_listino: number | null
  utilizzi_inclusi: number
  veicoli: VeicoloPrevendita[]
  km_inclusi: number
  assicurazione_inclusa: string | null
  validita_mesi: number
  max_utilizzi_mese: number | null
  max_giorni_consecutivi: number | null
  regole_extra: string | null
  posti_totali: number | null
  posti_venduti: number
  attiva: boolean
  visibile_sito: boolean
  ordine: number
  created_at: string
}

interface PrevenditaCliente {
  id: string
  prevendita_id: string | null
  user_id: string | null
  customer_email: string | null
  customer_nome: string | null
  customer_telefono: string | null
  nome: string
  foto_url: string | null
  prezzo_pagato: number
  utilizzi_iniziali: number
  utilizzi_usati: number
  veicoli: VeicoloPrevendita[]
  km_inclusi: number
  assicurazione_inclusa: string | null
  max_utilizzi_mese: number | null
  max_giorni_consecutivi: number | null
  regole_extra: string | null
  data_acquisto: string
  data_scadenza: string | null
  stato: 'attiva' | 'terminata' | 'scaduta' | 'bloccata'
  payment_status: string
  payment_method: string | null
  origine: string
  note_admin: string | null
}

interface Movimento {
  id: string
  prevendita_cliente_id: string
  booking_id: string | null
  tipo: 'scalo' | 'ripristino' | 'rettifica'
  quantita: number
  data_inizio: string | null
  data_fine: string | null
  giorni: number | null
  km_inclusi: number | null
  veicolo_nome: string | null
  annullato: boolean
  note: string | null
  creato_da: string | null
  created_at: string
}

interface VeicoloFlotta { id: string; display_name: string; plate: string | null; category: string | null }

interface ClienteScheda {
  id: string
  user_id: string | null
  nome: string | null
  cognome: string | null
  denominazione: string | null
  email: string | null
  telefono: string | null
}

type Vista = 'catalogo' | 'venduti' | 'popup'
type FiltroVenduti = 'tutte' | 'attiva' | 'terminata' | 'scaduta' | 'bloccata'

const PAGATO = ['paid', 'completed', 'succeeded']

// ─── Formattazione (Europa: 24h + gg/mm/aaaa) ────────────────────────────────

const dataIt = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' }) : '—'

const dataOraIt = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' }) : '—'

const euro = (n: number | null | undefined) =>
  `€ ${(Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Stato reale: la scadenza passa da sola, non aspetta un cron. */
function statoReale(pc: PrevenditaCliente): PrevenditaCliente['stato'] {
  if (pc.stato === 'bloccata') return 'bloccata'
  if (!PAGATO.includes(pc.payment_status)) return 'bloccata'
  if (pc.data_scadenza && new Date(pc.data_scadenza) < new Date()) return 'scaduta'
  if (pc.utilizzi_usati >= pc.utilizzi_iniziali) return 'terminata'
  return 'attiva'
}

function BadgeStato({ stato }: { stato: PrevenditaCliente['stato'] }) {
  const stili: Record<string, string> = {
    attiva: 'bg-emerald-600/20 text-emerald-400',
    terminata: 'bg-blue-600/20 text-blue-400',
    scaduta: 'bg-amber-600/20 text-amber-400',
    bloccata: 'bg-red-600/20 text-red-400',
  }
  const etichette: Record<string, string> = {
    attiva: 'Attiva', terminata: 'Terminata', scaduta: 'Scaduta', bloccata: 'Bloccata',
  }
  return <span className={`px-2 py-1 rounded-full text-xs font-medium ${stili[stato]}`}>{etichette[stato]}</span>
}

/** Intestazione di un blocco del modulo: la creazione va letta a passi. */
function Passo({ n, titolo, nota }: { n: number; titolo: string; nota?: string }) {
  return (
    <div className="flex items-baseline gap-3 pt-2">
      <span className="w-6 h-6 shrink-0 rounded-full bg-dr7-gold text-white text-xs font-bold flex items-center justify-center">{n}</span>
      <div>
        <h4 className="text-sm font-bold text-theme-text-primary uppercase tracking-wider">{titolo}</h4>
        {nota && <p className="text-xs text-theme-text-muted mt-0.5">{nota}</p>}
      </div>
    </div>
  )
}

const PREVENDITA_VUOTA = {
  nome: '',
  descrizione: '',
  foto_url: '',
  prezzo: '' as string | number,
  prezzo_listino: '' as string | number,
  utilizzi_inclusi: 10,
  veicoli: [] as VeicoloPrevendita[],
  km_inclusi: 100,
  assicurazione_inclusa: '',
  validita_mesi: 12,
  max_utilizzi_mese: '' as string | number,
  max_giorni_consecutivi: '' as string | number,
  regole_extra: '',
  posti_totali: '' as string | number,
  attiva: true,
  visibile_sito: true,
  ordine: 0,
}

/**
 * La voce nel menu e' una sola: Marketing > Prevendita e Promozioni, accanto
 * al Codice Sconto. Catalogo, Prevendite Vendute e Popup Sito si scambiano
 * qui dentro. `vista` resta un parametro perche' i vecchi link diretti alle
 * tre rotte continuino ad aprire la pagina giusta.
 */
export default function PrevenditeTab({ vista: vistaIniziale = 'catalogo' }: { vista?: Vista } = {}) {
  const [vista, setVista] = useState<Vista>(vistaIniziale)
  useEffect(() => { setVista(vistaIniziale) }, [vistaIniziale])

  // Catalogo
  const [prevendite, setPrevendite] = useState<Prevendita[]>([])
  const [caricamento, setCaricamento] = useState(true)
  const [modale, setModale] = useState<null | 'nuova' | 'modifica'>(null)
  const [bozza, setBozza] = useState({ ...PREVENDITA_VUOTA })
  const [inModifica, setInModifica] = useState<Prevendita | null>(null)
  const [salvataggio, setSalvataggio] = useState(false)
  const [caricamentoFoto, setCaricamentoFoto] = useState(false)

  // Flotta (per scegliere i veicoli della prevendita)
  const [flotta, setFlotta] = useState<VeicoloFlotta[]>([])
  const [ricercaVeicolo, setRicercaVeicolo] = useState('')

  // ─── Assicurazioni: SOLO dalla Centralina Pro ──────────────────────────────
  //
  // Nella Centralina un'assicurazione non e' un nome: e' una voce per CATEGORIA
  // e per FASCIA, con un prezzo suo. "Kasko Base" costa 100 EUR/giorno su
  // Exotic Cars e 45 su Supercar; "Kasko DR7" in fascia B spesso non esiste
  // proprio. Un pacchetto vale su piu' auto, quindi la prevendita non puo'
  // tenere un id solo: tiene il NOME scelto qui e il sito ritrova l'opzione
  // giusta per l'auto e per la fascia del cliente al momento della
  // prenotazione. Qui sotto si vede subito quanto vale su ogni categoria del
  // pacchetto e dove invece non esiste.
  //
  // Fascia A/B della Centralina = TIER_2/TIER_1 nel formato interno
  // (convertProConfig, mappa storica).
  const { config: configNoleggio } = useRentalConfig('car_rental')
  const FASCE_CENTRALINA = [
    { etichetta: 'Fascia A', tier: 'TIER_2' as const },
    { etichetta: 'Fascia B', tier: 'TIER_1' as const },
  ]
  const nomeAssicurazioneNormalizzato = (n: string | null | undefined) =>
    String(n ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/kasko|compresa|inclusa/g, ' ').replace(/[^a-z0-9]/g, '')
  const stessaAssicurazione = (a: string | null | undefined, b: string | null | undefined) => {
    const x = nomeAssicurazioneNormalizzato(a)
    return x !== '' && x === nomeAssicurazioneNormalizzato(b)
  }

  // Le categorie coperte dal pacchetto: quelle dei veicoli scelti.
  const categoriePacchetto = useMemo(() => {
    const viste: string[] = []
    for (const v of bozza.veicoli) {
      const cat = flotta.find(f => f.id === v.id)?.category
      if (cat && !viste.includes(cat)) viste.push(cat)
    }
    return viste
  }, [bozza.veicoli, flotta])

  const assicurazioniDisponibili = useMemo(() => {
    // Nessun veicolo scelto: si elencano tutte quelle che la Centralina conosce,
    // cosi' la tendina non resta vuota per sbaglio. Nessun elenco nel codice.
    const chiavi = categoriePacchetto.length > 0
      ? categoriePacchetto
      : Object.keys(configNoleggio?.insurance || {}).filter(k => !['eligibility', 'deductibles', 'category_labels'].includes(k))
    const nomi: string[] = []
    for (const cat of chiavi) {
      for (const f of FASCE_CENTRALINA) {
        for (const opt of getInsuranceOptions(configNoleggio, cat, f.tier)) {
          const nome = String(opt?.name || '').trim()
          if (nome && !nomi.some(n => stessaAssicurazione(n, nome))) nomi.push(nome)
        }
      }
    }
    return nomi
  }, [configNoleggio, categoriePacchetto])

  // Cosa succede davvero, categoria per categoria e fascia per fascia, con
  // l'assicurazione scelta: il prezzo al giorno che il pacchetto copre, oppure
  // il buco (quell'assicurazione li' non esiste).
  // Auto per auto, perche' e' cosi' che si ragiona scegliendo il pacchetto:
  // questa macchina, questa assicurazione, questo prezzo. La categoria decide
  // l'elenco, la fascia del cliente decide il prezzo — e a volte l'opzione in
  // fascia B non c'e' affatto.
  const coperturaAssicurazione = useMemo(() => {
    if (!bozza.assicurazione_inclusa) return []
    return bozza.veicoli.map(v => {
      const cat = flotta.find(f => f.id === v.id)?.category || ''
      return {
        id: v.id,
        nome: v.nome,
        categoria: cat ? (configNoleggio?.vehicle_categories?.[cat]?.label || cat) : 'senza categoria',
        fasce: FASCE_CENTRALINA.map(f => {
          const trovata = cat
            ? getInsuranceOptions(configNoleggio, cat, f.tier).find(o => stessaAssicurazione(o.name, bozza.assicurazione_inclusa))
            : undefined
          return { etichetta: f.etichetta, prezzo: trovata ? Number(trovata.daily_price) || 0 : null }
        }),
      }
    })
  }, [configNoleggio, bozza.veicoli, flotta, bozza.assicurazione_inclusa])

  // Venduti
  const [venduti, setVenduti] = useState<PrevenditaCliente[]>([])
  const [vendutiCaricamento, setVendutiCaricamento] = useState(false)
  const [filtroVenduti, setFiltroVenduti] = useState<FiltroVenduti>('tutte')
  const [ricercaVenduti, setRicercaVenduti] = useState('')
  const [dettaglio, setDettaglio] = useState<PrevenditaCliente | null>(null)
  const [movimenti, setMovimenti] = useState<Movimento[]>([])
  const [movimentiCaricamento, setMovimentiCaricamento] = useState(false)
  const [prenotazioni, setPrenotazioni] = useState<Record<string, { vehicle_name: string | null; pickup_date: string | null; status: string | null; price_total: number | null }>>({})
  const [residuiBozza, setResiduiBozza] = useState('')

  // Vendita manuale (sportello)
  const [modaleVendita, setModaleVendita] = useState(false)
  const [clienti, setClienti] = useState<ClienteScheda[]>([])
  const [ricercaCliente, setRicercaCliente] = useState('')
  const [vendPrevenditaId, setVendPrevenditaId] = useState('')
  const [vendClienteId, setVendClienteId] = useState('')
  const [vendPrezzo, setVendPrezzo] = useState<string>('')
  const [vendMetodo, setVendMetodo] = useState('contanti')
  const [vendNote, setVendNote] = useState('')
  const [vendInCorso, setVendInCorso] = useState(false)

  // Popup
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [configCaricamento, setConfigCaricamento] = useState(false)
  const [configSalvataggio, setConfigSalvataggio] = useState(false)

  // ─── Caricamenti ───────────────────────────────────────────────────────────

  const caricaCatalogo = useCallback(async () => {
    setCaricamento(true)
    try {
      const { data, error } = await supabase
        .from('prevendite')
        .select('*')
        .order('ordine', { ascending: true })
        .order('created_at', { ascending: false })
      if (error) throw error
      setPrevendite((data || []) as Prevendita[])
    } catch (e) {
      console.error('Prevendite: catalogo non caricato', e)
      toast.error('Catalogo prevendite non caricato')
    } finally {
      setCaricamento(false)
    }
  }, [])

  const caricaFlotta = useCallback(async () => {
    const { data } = await supabase
      .from('vehicles')
      .select('id, display_name, plate, category')
      .neq('status', 'retired')
      .order('display_name')
    setFlotta((data || []) as VeicoloFlotta[])
  }, [])

  const caricaVenduti = useCallback(async () => {
    setVendutiCaricamento(true)
    try {
      const { data, error } = await supabase
        .from('prevendite_clienti')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      setVenduti((data || []) as PrevenditaCliente[])
    } catch (e) {
      console.error('Prevendite: venduti non caricati', e)
      toast.error('Prevendite vendute non caricate')
    } finally {
      setVendutiCaricamento(false)
    }
  }, [])

  const caricaClienti = useCallback(async () => {
    const { data } = await supabase
      .from('customers_extended')
      .select('id, user_id, nome, cognome, denominazione, email, telefono')
      .order('updated_at', { ascending: false })
      .limit(1000)
    setClienti((data || []) as ClienteScheda[])
  }, [])

  const caricaConfig = useCallback(async () => {
    setConfigCaricamento(true)
    const { data } = await supabase.from('prevendite_settings').select('config').eq('id', 'main').maybeSingle()
    setConfig((data?.config || {}) as Record<string, unknown>)
    setConfigCaricamento(false)
  }, [])

  useEffect(() => { caricaCatalogo(); caricaFlotta() }, [caricaCatalogo, caricaFlotta])
  useEffect(() => { if (vista === 'venduti') { caricaVenduti(); caricaClienti() } }, [vista, caricaVenduti, caricaClienti])
  useEffect(() => { if (vista === 'popup') caricaConfig() }, [vista, caricaConfig])

  // Registro movimenti + prenotazioni collegate del pacchetto aperto.
  useEffect(() => {
    if (!dettaglio) { setMovimenti([]); setPrenotazioni({}); return }
    let annullato = false
    const run = async () => {
      setMovimentiCaricamento(true)
      const { data } = await supabase
        .from('prevendite_movimenti')
        .select('*')
        .eq('prevendita_cliente_id', dettaglio.id)
        .order('created_at', { ascending: false })
      if (annullato) return
      const movs = (data || []) as Movimento[]
      setMovimenti(movs)
      const ids = [...new Set(movs.map(m => m.booking_id).filter(Boolean))] as string[]
      if (ids.length) {
        const { data: bks } = await supabase
          .from('bookings')
          .select('id, vehicle_name, pickup_date, status, price_total')
          .in('id', ids)
        if (annullato) return
        const mappa: typeof prenotazioni = {}
        for (const b of bks || []) mappa[b.id] = b
        setPrenotazioni(mappa)
      }
      setMovimentiCaricamento(false)
      setResiduiBozza(String(Math.max(0, dettaglio.utilizzi_iniziali - dettaglio.utilizzi_usati)))
    }
    run()
    return () => { annullato = true }
  }, [dettaglio])

  // ─── Catalogo: salvataggio ─────────────────────────────────────────────────

  function apriNuova() {
    setBozza({ ...PREVENDITA_VUOTA })
    setInModifica(null)
    setRicercaVeicolo('')
    setModale('nuova')
  }

  function apriModifica(p: Prevendita) {
    setBozza({
      nome: p.nome,
      descrizione: p.descrizione || '',
      foto_url: p.foto_url || '',
      prezzo: p.prezzo,
      prezzo_listino: p.prezzo_listino ?? '',
      utilizzi_inclusi: p.utilizzi_inclusi,
      veicoli: Array.isArray(p.veicoli) ? p.veicoli : [],
      km_inclusi: p.km_inclusi,
      assicurazione_inclusa: p.assicurazione_inclusa || '',
      validita_mesi: p.validita_mesi,
      max_utilizzi_mese: p.max_utilizzi_mese ?? '',
      max_giorni_consecutivi: p.max_giorni_consecutivi ?? '',
      regole_extra: p.regole_extra || '',
      posti_totali: p.posti_totali ?? '',
      attiva: p.attiva,
      visibile_sito: p.visibile_sito,
      ordine: p.ordine,
    })
    setInModifica(p)
    setRicercaVeicolo('')
    setModale('modifica')
  }

  async function caricaFoto(file: File) {
    if (!file.type.startsWith('image/')) return toast.error('Serve un file immagine')
    if (file.size > 10 * 1024 * 1024) return toast.error('Immagine troppo grande (max 10MB)')
    setCaricamentoFoto(true)
    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `prevendite/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error } = await supabase.storage.from('marketing-campaigns').upload(path, file, { cacheControl: '3600', upsert: false })
      if (error) throw error
      const { data } = supabase.storage.from('marketing-campaigns').getPublicUrl(path)
      setBozza(b => ({ ...b, foto_url: data.publicUrl }))
      toast.success('Foto caricata')
    } catch (e) {
      console.error(e)
      toast.error('Caricamento foto non riuscito')
    } finally {
      setCaricamentoFoto(false)
    }
  }

  const numeroOppureNull = (v: string | number) => {
    const s = String(v).trim()
    if (s === '') return null
    const n = Number(s.replace(',', '.'))
    return isNaN(n) ? null : n
  }

  async function salvaPrevendita() {
    if (!bozza.nome.trim()) return toast.error('Serve il nome della prevendita')
    const prezzo = numeroOppureNull(bozza.prezzo)
    if (prezzo === null || prezzo <= 0) return toast.error('Serve un prezzo maggiore di zero')
    if (!bozza.veicoli.length) return toast.error('Scegli almeno un veicolo')
    const utilizzi = Number(bozza.utilizzi_inclusi) || 0
    if (utilizzi <= 0) return toast.error('Gli utilizzi inclusi devono essere almeno 1')

    setSalvataggio(true)
    try {
      const riga = {
        nome: bozza.nome.trim(),
        descrizione: bozza.descrizione.trim() || null,
        foto_url: bozza.foto_url.trim() || null,
        prezzo,
        prezzo_listino: numeroOppureNull(bozza.prezzo_listino),
        utilizzi_inclusi: utilizzi,
        veicoli: bozza.veicoli,
        km_inclusi: Number(bozza.km_inclusi) || 0,
        assicurazione_inclusa: bozza.assicurazione_inclusa.trim() || null,
        validita_mesi: Number(bozza.validita_mesi) || 12,
        max_utilizzi_mese: numeroOppureNull(bozza.max_utilizzi_mese),
        max_giorni_consecutivi: numeroOppureNull(bozza.max_giorni_consecutivi),
        regole_extra: bozza.regole_extra.trim() || null,
        posti_totali: numeroOppureNull(bozza.posti_totali),
        attiva: bozza.attiva,
        visibile_sito: bozza.visibile_sito,
        ordine: Number(bozza.ordine) || 0,
      }
      if (inModifica) {
        const { error } = await supabase.from('prevendite').update(riga).eq('id', inModifica.id)
        if (error) throw error
        toast.success('Prevendita aggiornata')
      } else {
        const { error } = await supabase.from('prevendite').insert(riga)
        if (error) throw error
        toast.success('Prevendita creata')
      }
      setModale(null)
      await caricaCatalogo()
    } catch (e) {
      console.error(e)
      toast.error('Salvataggio non riuscito: ' + ((e as Error).message || ''))
    } finally {
      setSalvataggio(false)
    }
  }

  async function cambiaVisibilita(p: Prevendita, campo: 'attiva' | 'visibile_sito') {
    const { error } = await supabase.from('prevendite').update({ [campo]: !p[campo] }).eq('id', p.id)
    if (error) return toast.error('Modifica non riuscita')
    setPrevendite(list => list.map(x => x.id === p.id ? { ...x, [campo]: !p[campo] } : x))
  }

  async function eliminaPrevendita(p: Prevendita) {
    // I pacchetti gia' venduti restano: hanno la loro fotografia delle regole
    // e non dipendono piu' dal catalogo (prevendita_id va a NULL).
    if (!confirm(`Eliminare "${p.nome}" dal catalogo?\n\nLe prevendite gia' vendute restano valide per i clienti che le hanno pagate.`)) return
    const { error } = await supabase.from('prevendite').delete().eq('id', p.id)
    if (error) return toast.error('Eliminazione non riuscita')
    toast.success('Prevendita eliminata dal catalogo')
    caricaCatalogo()
  }

  // ─── Venduti: azioni ───────────────────────────────────────────────────────

  async function ripristinaUtilizzo(m: Movimento) {
    if (!confirm('Rimettere questo utilizzo a disposizione del cliente?')) return
    const { data, error } = await supabase.rpc('prevendita_ripristina', {
      p_movimento_id: m.id,
      p_note: 'Ripristinato dal gestionale',
      p_creato_da: 'gestionale',
    })
    if (error || !data?.ok) return toast.error(data?.errore || 'Ripristino non riuscito')
    toast.success('Utilizzo ripristinato')
    await ricaricaDettaglio()
  }

  async function salvaResidui() {
    if (!dettaglio) return
    const n = Number(residuiBozza)
    if (isNaN(n) || n < 0) return toast.error('Numero di utilizzi non valido')
    const { data, error } = await supabase.rpc('prevendita_rettifica', {
      p_prevendita_cliente_id: dettaglio.id,
      p_utilizzi_residui: n,
      p_note: `Residui portati a ${n} dal gestionale`,
      p_creato_da: 'gestionale',
    })
    if (error || !data?.ok) return toast.error(data?.errore || 'Rettifica non riuscita')
    toast.success(`Utilizzi residui: ${n}`)
    await ricaricaDettaglio()
  }

  async function cambiaStato(pc: PrevenditaCliente, nuovo: 'attiva' | 'bloccata') {
    const { error } = await supabase.from('prevendite_clienti').update({ stato: nuovo }).eq('id', pc.id)
    if (error) return toast.error('Modifica non riuscita')
    toast.success(nuovo === 'bloccata' ? 'Prevendita bloccata' : 'Prevendita sbloccata')
    await caricaVenduti()
    if (dettaglio?.id === pc.id) setDettaglio({ ...dettaglio, stato: nuovo })
  }

  async function salvaScadenza(pc: PrevenditaCliente, nuova: string) {
    const iso = nuova ? new Date(`${nuova}T23:59:59`).toISOString() : null
    const { error } = await supabase.from('prevendite_clienti').update({ data_scadenza: iso }).eq('id', pc.id)
    if (error) return toast.error('Scadenza non aggiornata')
    toast.success('Scadenza aggiornata')
    await caricaVenduti()
    if (dettaglio?.id === pc.id) setDettaglio({ ...dettaglio, data_scadenza: iso })
  }

  async function salvaNote(pc: PrevenditaCliente, note: string) {
    await supabase.from('prevendite_clienti').update({ note_admin: note || null }).eq('id', pc.id)
    toast.success('Note salvate')
  }

  async function ricaricaDettaglio() {
    if (!dettaglio) return
    const { data } = await supabase.from('prevendite_clienti').select('*').eq('id', dettaglio.id).maybeSingle()
    if (data) setDettaglio(data as PrevenditaCliente)
    await caricaVenduti()
  }

  // Vendita allo sportello: stessa fotografia delle regole dell'acquisto online.
  async function vendiManuale() {
    if (!vendPrevenditaId) return toast.error('Scegli la prevendita')
    if (!vendClienteId) return toast.error('Scegli il cliente')
    const p = prevendite.find(x => x.id === vendPrevenditaId)
    const c = clienti.find(x => x.id === vendClienteId)
    if (!p || !c) return toast.error('Dati non trovati')

    setVendInCorso(true)
    try {
      const prezzo = numeroOppureNull(vendPrezzo) ?? p.prezzo
      const scadenza = new Date()
      scadenza.setMonth(scadenza.getMonth() + (p.validita_mesi || 12))
      const { error } = await supabase.from('prevendite_clienti').insert({
        prevendita_id: p.id,
        user_id: c.user_id,
        customer_email: c.email,
        customer_nome: c.denominazione || [c.nome, c.cognome].filter(Boolean).join(' ') || null,
        customer_telefono: c.telefono,
        nome: p.nome,
        foto_url: p.foto_url,
        prezzo_pagato: prezzo,
        utilizzi_iniziali: p.utilizzi_inclusi,
        utilizzi_usati: 0,
        veicoli: p.veicoli,
        km_inclusi: p.km_inclusi,
        assicurazione_inclusa: p.assicurazione_inclusa,
        max_utilizzi_mese: p.max_utilizzi_mese,
        max_giorni_consecutivi: p.max_giorni_consecutivi,
        regole_extra: p.regole_extra,
        data_acquisto: new Date().toISOString(),
        data_scadenza: scadenza.toISOString(),
        stato: 'attiva',
        payment_status: 'paid',
        payment_method: vendMetodo,
        payment_completed_at: new Date().toISOString(),
        origine: 'gestionale',
        note_admin: vendNote || null,
      })
      if (error) throw error
      await supabase.from('prevendite').update({ posti_venduti: (p.posti_venduti || 0) + 1 }).eq('id', p.id)
      toast.success('Prevendita caricata sull\'account del cliente')
      setModaleVendita(false)
      setVendPrevenditaId(''); setVendClienteId(''); setVendPrezzo(''); setVendNote('')
      await caricaVenduti(); await caricaCatalogo()
    } catch (e) {
      console.error(e)
      toast.error('Vendita non registrata: ' + ((e as Error).message || ''))
    } finally {
      setVendInCorso(false)
    }
  }

  async function salvaConfig() {
    setConfigSalvataggio(true)
    const { error } = await supabase.from('prevendite_settings')
      .upsert({ id: 'main', config, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    setConfigSalvataggio(false)
    if (error) return toast.error('Impostazioni non salvate')
    toast.success('Impostazioni salvate')
  }

  // ─── Derivati ──────────────────────────────────────────────────────────────

  const flottaFiltrata = useMemo(() => {
    const q = ricercaVeicolo.trim().toLowerCase()
    if (!q) return flotta.slice(0, 40)
    return flotta.filter(v =>
      (v.display_name || '').toLowerCase().includes(q) || (v.plate || '').toLowerCase().includes(q)
    ).slice(0, 40)
  }, [flotta, ricercaVeicolo])

  const vendutiFiltrati = useMemo(() => {
    const q = ricercaVenduti.trim().toLowerCase()
    return venduti.filter(pc => {
      if (filtroVenduti !== 'tutte' && statoReale(pc) !== filtroVenduti) return false
      if (!q) return true
      return [pc.customer_nome, pc.customer_email, pc.customer_telefono, pc.nome]
        .some(v => (v || '').toLowerCase().includes(q))
    })
  }, [venduti, filtroVenduti, ricercaVenduti])

  const clientiFiltrati = useMemo(() => {
    const q = ricercaCliente.trim().toLowerCase()
    if (!q) return clienti.slice(0, 30)
    return clienti.filter(c =>
      [c.nome, c.cognome, c.denominazione, c.email, c.telefono].some(v => (v || '').toLowerCase().includes(q))
    ).slice(0, 30)
  }, [clienti, ricercaCliente])

  const totali = useMemo(() => {
    const pagate = venduti.filter(v => PAGATO.includes(v.payment_status))
    return {
      vendute: pagate.length,
      incassato: pagate.reduce((s, v) => s + (Number(v.prezzo_pagato) || 0), 0),
      utilizziResidui: pagate.reduce((s, v) => s + Math.max(0, v.utilizzi_iniziali - v.utilizzi_usati), 0),
      attive: pagate.filter(v => statoReale(v) === 'attiva').length,
    }
  }, [venduti])

  const testo = (k: string, def = '') => String((config[k] ?? def) as string)
  const setTesto = (k: string, v: unknown) => setConfig(c => ({ ...c, [k]: v }))

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">Prevendite</h2>
          <p className="text-sm text-theme-text-muted mt-1">
            Pacchetti di utilizzi pagati in anticipo. Le regole scritte qui il sito le applica da solo.
          </p>
        </div>
        <div className="flex gap-2">
          {vista === 'catalogo' && <Button onClick={apriNuova}>Nuova prevendita</Button>}
          {vista === 'venduti' && <Button onClick={() => setModaleVendita(true)}>Vendi a un cliente</Button>}
        </div>
      </div>

      {/* Navigazione */}
      <div className="flex flex-wrap gap-2">
        {([
          { k: 'catalogo' as Vista, l: 'Catalogo' },
          { k: 'venduti' as Vista, l: 'Prevendite vendute' },
          { k: 'popup' as Vista, l: 'Popup sito' },
        ]).map(v => (
          <button
            key={v.k}
            onClick={() => setVista(v.k)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              vista === v.k ? 'bg-dr7-gold text-white' : 'bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover'
            }`}
          >
            {v.l}
          </button>
        ))}
      </div>

      {/* ═══ CATALOGO ═══ */}
      {vista === 'catalogo' && (
        caricamento ? <ScheletroTabella righe={4} colonne={5} /> : (
          prevendite.length === 0 ? (
            <div className="bg-theme-bg-tertiary border border-theme-border rounded-lg p-10 text-center">
              <p className="text-theme-text-primary font-medium">Nessuna prevendita nel catalogo</p>
              <p className="text-sm text-theme-text-muted mt-1">Creane una: comparira' sul sito nella sezione Prevendite.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {prevendite.map(p => {
                const residui = p.posti_totali === null ? null : Math.max(0, p.posti_totali - p.posti_venduti)
                return (
                  <div key={p.id} className="bg-theme-bg-tertiary border border-theme-border rounded-lg overflow-hidden flex flex-col">
                    {p.foto_url
                      ? <img src={p.foto_url} alt={p.nome} className="w-full h-44 object-cover" />
                      : <div className="w-full h-44 bg-theme-bg-secondary flex items-center justify-center text-theme-text-muted text-sm">Nessuna foto</div>}
                    <div className="p-4 flex-1 flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-theme-text-primary leading-tight">{p.nome}</h3>
                        <span className="text-lg font-bold text-dr7-gold whitespace-nowrap">{euro(p.prezzo)}</span>
                      </div>
                      {p.descrizione && <p className="text-sm text-theme-text-muted line-clamp-2">{p.descrizione}</p>}

                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <dt className="text-theme-text-muted">Utilizzi</dt><dd className="text-theme-text-primary text-right">{p.utilizzi_inclusi}</dd>
                        <dt className="text-theme-text-muted">Km per utilizzo</dt><dd className="text-theme-text-primary text-right">{testoKm(p.km_inclusi)}</dd>
                        <dt className="text-theme-text-muted">Validita'</dt><dd className="text-theme-text-primary text-right">{p.validita_mesi} mesi</dd>
                        <dt className="text-theme-text-muted">Max al mese</dt><dd className="text-theme-text-primary text-right">{p.max_utilizzi_mese ?? 'Nessun limite'}</dd>
                        <dt className="text-theme-text-muted">Giorni consecutivi</dt><dd className="text-theme-text-primary text-right">{p.max_giorni_consecutivi ?? 'Nessun limite'}</dd>
                        <dt className="text-theme-text-muted">Assicurazione</dt><dd className="text-theme-text-primary text-right">{p.assicurazione_inclusa || 'Non inclusa'}</dd>
                        <dt className="text-theme-text-muted">Vendute</dt>
                        <dd className="text-theme-text-primary text-right">{p.posti_venduti}{residui !== null && ` / ${p.posti_totali}`}</dd>
                      </dl>

                      <div className="flex flex-wrap gap-1">
                        {(p.veicoli || []).map(v => (
                          <span key={v.id} className="px-2 py-0.5 rounded-full text-xs bg-theme-bg-secondary text-theme-text-secondary">
                            {v.nome}{v.targa ? ` (${v.targa})` : ''}
                          </span>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mt-auto pt-2 border-t border-theme-border">
                        <button
                          onClick={() => cambiaVisibilita(p, 'attiva')}
                          className={`px-2 py-1 rounded-full text-xs font-medium ${p.attiva ? 'bg-emerald-600/20 text-emerald-400' : 'bg-theme-bg-secondary text-theme-text-muted'}`}
                        >
                          {p.attiva ? 'Attiva' : 'Non attiva'}
                        </button>
                        <button
                          onClick={() => cambiaVisibilita(p, 'visibile_sito')}
                          className={`px-2 py-1 rounded-full text-xs font-medium ${p.visibile_sito ? 'bg-blue-600/20 text-blue-400' : 'bg-theme-bg-secondary text-theme-text-muted'}`}
                        >
                          {p.visibile_sito ? 'Sul sito' : 'Nascosta'}
                        </button>
                        <div className="ml-auto flex gap-2">
                          <button onClick={() => apriModifica(p)} className="text-xs text-dr7-gold hover:underline">Modifica</button>
                          <button onClick={() => eliminaPrevendita(p)} className="text-xs text-red-400 hover:underline">Elimina</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )
      )}

      {/* ═══ VENDUTE ═══ */}
      {vista === 'venduti' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { l: 'Prevendite vendute', v: String(totali.vendute) },
              { l: 'Attive', v: String(totali.attive) },
              { l: 'Incassato', v: euro(totali.incassato) },
              { l: 'Utilizzi ancora da consumare', v: String(totali.utilizziResidui) },
            ].map(k => (
              <div key={k.l} className="bg-theme-bg-tertiary border border-theme-border rounded-lg p-4">
                <div className="text-xs text-theme-text-muted">{k.l}</div>
                <div className="text-xl font-bold text-theme-text-primary mt-1">{k.v}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex flex-wrap gap-2">
              {([
                { k: 'tutte' as FiltroVenduti, l: 'Tutte' },
                { k: 'attiva' as FiltroVenduti, l: 'Attive' },
                { k: 'terminata' as FiltroVenduti, l: 'Terminate' },
                { k: 'scaduta' as FiltroVenduti, l: 'Scadute' },
                { k: 'bloccata' as FiltroVenduti, l: 'Bloccate' },
              ]).map(f => (
                <button
                  key={f.k}
                  onClick={() => setFiltroVenduti(f.k)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    filtroVenduti === f.k ? 'bg-dr7-gold text-white' : 'bg-theme-bg-tertiary text-theme-text-primary hover:bg-theme-bg-hover'
                  }`}
                >
                  {f.l}
                </button>
              ))}
            </div>
            <div className="flex-1 min-w-[220px]">
              <div className="bg-theme-bg-tertiary p-3 rounded-full border border-theme-border">
                <input
                  type="text"
                  placeholder="Cerca cliente, email o prevendita..."
                  value={ricercaVenduti}
                  onChange={e => setRicercaVenduti(e.target.value)}
                  className="w-full bg-transparent text-theme-text-primary outline-none"
                />
              </div>
            </div>
          </div>

          {vendutiCaricamento ? <ScheletroTabella righe={6} colonne={6} /> : (
            <div className="bg-theme-bg-tertiary rounded-lg overflow-hidden border border-theme-border">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-theme-text-muted">
                  <thead className="bg-theme-bg-secondary/50 text-theme-text-secondary uppercase font-medium">
                    <tr>
                      <th className="p-4">Cliente</th>
                      <th className="p-4">Prevendita</th>
                      <th className="p-4">Pagato</th>
                      <th className="p-4">Utilizzi</th>
                      <th className="p-4">Acquisto</th>
                      <th className="p-4">Scadenza</th>
                      <th className="p-4">Stato</th>
                      <th className="p-4 text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme-border">
                    {vendutiFiltrati.map(pc => {
                      const residui = Math.max(0, pc.utilizzi_iniziali - pc.utilizzi_usati)
                      return (
                        <tr key={pc.id} className="hover:bg-theme-bg-hover/50 transition-colors">
                          <td className="p-4">
                            <div className="text-theme-text-primary font-medium">{pc.customer_nome || '—'}</div>
                            <div className="text-xs">{pc.customer_email || '—'}</div>
                          </td>
                          <td className="p-4 text-theme-text-primary">{pc.nome}</td>
                          <td className="p-4 text-theme-text-primary">{euro(pc.prezzo_pagato)}</td>
                          <td className="p-4">
                            <span className="text-theme-text-primary font-medium">{residui}</span>
                            <span className="text-xs"> disponibili su {pc.utilizzi_iniziali}</span>
                            <div className="text-xs">usati: {pc.utilizzi_usati}</div>
                          </td>
                          <td className="p-4 text-xs">{dataIt(pc.data_acquisto)}</td>
                          <td className="p-4 text-xs">{dataIt(pc.data_scadenza)}</td>
                          <td className="p-4"><BadgeStato stato={statoReale(pc)} /></td>
                          <td className="p-4 text-right">
                            <button onClick={() => setDettaglio(pc)} className="text-xs text-dr7-gold hover:underline">Apri</button>
                          </td>
                        </tr>
                      )
                    })}
                    {vendutiFiltrati.length === 0 && (
                      <tr><td colSpan={8} className="p-8 text-center">Nessuna prevendita venduta con questi filtri</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ POPUP SITO ═══ */}
      {vista === 'popup' && (
        <div className="bg-theme-bg-tertiary border border-theme-border rounded-lg p-6 space-y-5 max-w-3xl">
          {configCaricamento ? <ScheletroTabella righe={4} colonne={2} /> : (
            <>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(config.popup_attivo)}
                  onChange={e => setTesto('popup_attivo', e.target.checked)}
                  className="w-5 h-5"
                />
                <span className="text-theme-text-primary font-medium">Mostra il popup Prevendite sul sito</span>
              </label>

              {([
                { k: 'popup_titolo', l: 'Titolo' },
                { k: 'popup_sottotitolo', l: 'Sottotitolo' },
                { k: 'popup_testo', l: 'Testo' },
                { k: 'popup_nota', l: 'Nota' },
                { k: 'popup_cta', l: 'Testo del pulsante' },
                { k: 'pagina_titolo', l: 'Titolo della pagina Prevendite' },
                { k: 'pagina_sottotitolo', l: 'Sottotitolo della pagina Prevendite' },
              ]).map(c => (
                <div key={c.k}>
                  <label className="text-sm text-theme-text-secondary mb-1 block">{c.l}</label>
                  <input
                    type="text"
                    value={testo(c.k)}
                    onChange={e => setTesto(c.k, e.target.value)}
                    className="w-full bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                  />
                </div>
              ))}

              <div>
                <label className="text-sm text-theme-text-secondary mb-1 block">
                  Giorni prima di riproporlo a chi lo ha gia' chiuso
                </label>
                <MoneyInput
                  value={(config.popup_giorni_ricomparsa as number) ?? 7}
                  onChange={v => setTesto('popup_giorni_ricomparsa', Number(v) || 0)}
                  className="w-40 bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                />
              </div>

              <div className="pt-2">
                <Button onClick={salvaConfig} disabled={configSalvataggio}>
                  {configSalvataggio ? 'Salvataggio...' : 'Salva impostazioni'}
                </Button>
              </div>

              {/* Anteprima: come lo vede il cliente */}
              <div className="mt-6 pt-6 border-t border-theme-border">
                <div className="text-xs text-theme-text-muted uppercase tracking-wider mb-3">Anteprima</div>
                {/* Nero anche in tema chiaro: non e' un pezzo di gestionale, e'
                    la fotografia del popup come lo vede il cliente sul sito,
                    che e' sempre scuro. Non va convertito ai token di tema. */}
                <div className="bg-black border border-dr7-gold/40 rounded-2xl p-6 text-center max-w-md">
                  <h3 className="text-xl font-bold text-white tracking-widest">{testo('popup_titolo', 'PREVENDITE DR7')}</h3>
                  <p className="text-sm text-white/80 mt-3">{testo('popup_sottotitolo')}</p>
                  <p className="text-sm text-white/60 mt-3">{testo('popup_testo')}</p>
                  <p className="text-xs text-dr7-gold mt-3 uppercase tracking-wider">{testo('popup_nota')}</p>
                  <div className="mt-5 inline-block px-6 py-3 bg-white text-black text-sm font-bold rounded-full">
                    {testo('popup_cta', 'SCOPRI E ACQUISTA')}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ MODALE CATALOGO ═══ */}
      {modale && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-theme-bg-secondary border border-theme-border rounded-xl w-full max-w-3xl my-8">
            <div className="p-6 border-b border-theme-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-theme-text-primary">
                {modale === 'nuova' ? 'Nuova prevendita' : 'Modifica prevendita'}
              </h3>
              <button onClick={() => setModale(null)} className="text-theme-text-muted hover:text-theme-text-primary">Chiudi</button>
            </div>

            <div className="p-6 space-y-5">
              <Passo n={1} titolo="Il pacchetto" nota="Come si chiama e come lo vede il cliente sul sito." />
              <div>
                <label className="text-sm text-theme-text-secondary mb-1 block">Nome *</label>
                <input
                  type="text"
                  value={bozza.nome}
                  onChange={e => setBozza(b => ({ ...b, nome: e.target.value }))}
                  placeholder="Ferrari 296 GTB - 10 Experience"
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                />
              </div>

              <div>
                <label className="text-sm text-theme-text-secondary mb-1 block">Descrizione</label>
                <textarea
                  rows={3}
                  value={bozza.descrizione}
                  onChange={e => setBozza(b => ({ ...b, descrizione: e.target.value }))}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                />
              </div>

              <div>
                <label className="text-sm text-theme-text-secondary mb-1 block">Foto</label>
                <div className="flex items-center gap-4">
                  {bozza.foto_url
                    ? <img src={bozza.foto_url} alt="" className="w-32 h-20 object-cover rounded-lg border border-theme-border" />
                    : <div className="w-32 h-20 bg-theme-bg-tertiary border border-theme-border rounded-lg flex items-center justify-center text-xs text-theme-text-muted">Nessuna</div>}
                  <div className="flex-1 space-y-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={e => { const f = e.target.files?.[0]; if (f) caricaFoto(f) }}
                      className="text-sm text-theme-text-muted"
                    />
                    {caricamentoFoto && <div className="text-xs text-dr7-gold">Caricamento in corso...</div>}
                    <input
                      type="text"
                      value={bozza.foto_url}
                      onChange={e => setBozza(b => ({ ...b, foto_url: e.target.value }))}
                      placeholder="oppure incolla un indirizzo immagine"
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-xs text-theme-text-primary outline-none focus:border-dr7-gold"
                    />
                  </div>
                </div>
              </div>

              <Passo n={2} titolo="Veicoli" nota="Su quali auto il cliente potra' spendere questa prevendita. Il sito non gliela propone su nessun'altra." />
              {/* Veicoli */}
              <div>
                <label className="text-sm text-theme-text-secondary mb-1 block">Veicoli associati *</label>
                <div className="flex flex-wrap gap-1 mb-2">
                  {bozza.veicoli.map(v => (
                    <button
                      key={v.id}
                      onClick={() => setBozza(b => ({ ...b, veicoli: b.veicoli.filter(x => x.id !== v.id) }))}
                      className="px-2 py-1 rounded-full text-xs bg-dr7-gold/20 text-dr7-gold hover:bg-red-600/20 hover:text-red-400"
                    >
                      {v.nome}{v.targa ? ` (${v.targa})` : ''} — togli
                    </button>
                  ))}
                  {bozza.veicoli.length === 0 && <span className="text-xs text-theme-text-muted">Nessun veicolo scelto</span>}
                </div>
                <input
                  type="text"
                  value={ricercaVeicolo}
                  onChange={e => setRicercaVeicolo(e.target.value)}
                  placeholder="Cerca per nome o targa..."
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                />
                <div className="mt-2 max-h-48 overflow-y-auto border border-theme-border rounded-lg divide-y divide-theme-border">
                  {flottaFiltrata.map(v => {
                    const scelto = bozza.veicoli.some(x => x.id === v.id)
                    return (
                      <button
                        key={v.id}
                        onClick={() => setBozza(b => scelto
                          ? { ...b, veicoli: b.veicoli.filter(x => x.id !== v.id) }
                          : { ...b, veicoli: [...b.veicoli, { id: v.id, nome: v.display_name, targa: v.plate }] })}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${scelto ? 'bg-dr7-gold/15 text-dr7-gold' : 'text-theme-text-primary hover:bg-theme-bg-hover'}`}
                      >
                        {v.display_name}
                        {v.plate && <span className="text-xs text-theme-text-muted ml-2">{v.plate}</span>}
                        {scelto && <span className="text-xs ml-2">— scelto</span>}
                      </button>
                    )
                  })}
                  {flottaFiltrata.length === 0 && <div className="px-3 py-4 text-sm text-theme-text-muted">Nessun veicolo trovato</div>}
                </div>
              </div>

              <Passo n={3} titolo="Prezzo e utilizzi" nota="Quanto costa il pacchetto e quante volte si puo' usare." />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Prezzo *</label>
                  <MoneyInput
                    value={bozza.prezzo}
                    onChange={v => setBozza(b => ({ ...b, prezzo: v }))}
                    className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                  />
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Prezzo di listino</label>
                  <MoneyInput
                    value={bozza.prezzo_listino}
                    onChange={v => setBozza(b => ({ ...b, prezzo_listino: v }))}
                    className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                  />
                  <p className="text-xs text-theme-text-muted mt-1">Serve solo a mostrare il vantaggio in percentuale.</p>
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Utilizzi inclusi *</label>
                  <MoneyInput
                    value={bozza.utilizzi_inclusi}
                    onChange={v => setBozza(b => ({ ...b, utilizzi_inclusi: Number(v) || 0 }))}
                    className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Km inclusi per utilizzo</label>
                  {Number(bozza.km_inclusi) >= KM_ILLIMITATI ? (
                    <div className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary">Km illimitati</div>
                  ) : (
                    <MoneyInput
                      value={bozza.km_inclusi}
                      onChange={v => setBozza(b => ({ ...b, km_inclusi: Number(v) || 0 }))}
                      className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                    />
                  )}
                  <label className="mt-2 flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Number(bozza.km_inclusi) >= KM_ILLIMITATI}
                      onChange={e => setBozza(b => ({ ...b, km_inclusi: e.target.checked ? KM_ILLIMITATI : 100 }))}
                      className="accent-dr7-gold"
                    />
                    Km illimitati
                  </label>
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Validita' (mesi)</label>
                  <MoneyInput
                    value={bozza.validita_mesi}
                    onChange={v => setBozza(b => ({ ...b, validita_mesi: Number(v) || 12 }))}
                    className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                  />
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Assicurazione inclusa</label>
                  <select
                    value={bozza.assicurazione_inclusa}
                    onChange={e => setBozza(b => ({ ...b, assicurazione_inclusa: e.target.value }))}
                    className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                  >
                    <option value="">Non inclusa</option>
                    {assicurazioniDisponibili.map(nome => (
                      <option key={nome} value={nome}>{nome}</option>
                    ))}
                    {/* Un'assicurazione salvata prima, e poi rinominata in Centralina o
                        non piu' valida per i veicoli scelti adesso, resta visibile: non
                        sparisce in silenzio mentre si modifica il pacchetto. */}
                    {bozza.assicurazione_inclusa && !assicurazioniDisponibili.some(n => stessaAssicurazione(n, bozza.assicurazione_inclusa)) && (
                      <option value={bozza.assicurazione_inclusa}>{bozza.assicurazione_inclusa} (non disponibile per questi veicoli)</option>
                    )}
                  </select>
                  <p className="text-xs text-theme-text-muted mt-1">
                    {assicurazioniDisponibili.length === 0
                      ? 'Nessuna assicurazione in Centralina Pro per queste categorie: aggiungila da Centralina Pro > Assicurazioni.'
                      : 'Dalle Assicurazioni della Centralina Pro. Il prezzo cambia per categoria e per fascia: qui sotto quello che il pacchetto copre davvero.'}
                  </p>
                  {coperturaAssicurazione.length > 0 && (
                    <div className="mt-2 border border-theme-border rounded-lg overflow-hidden">
                      {coperturaAssicurazione.map(riga => (
                        <div key={riga.id} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-theme-border last:border-b-0 text-xs">
                          <span className="text-theme-text-secondary">{riga.nome} <span className="text-theme-text-muted">· {riga.categoria}</span></span>
                          <span className="flex gap-3">
                            {riga.fasce.map(f => (
                              <span key={f.etichetta} className={f.prezzo === null ? 'text-red-400' : 'text-theme-text-primary'}>
                                {f.etichetta}: {f.prezzo === null ? 'non esiste' : `${f.prezzo.toLocaleString('it-IT')} EUR/giorno`}
                              </span>
                            ))}
                          </span>
                        </div>
                      ))}
                      {coperturaAssicurazione.some(r => r.fasce.some(f => f.prezzo === null)) && (
                        <p className="px-3 py-2 text-xs text-red-400 bg-theme-bg-tertiary">
                          Dove c'e' "non esiste" il cliente di quella fascia, su quell'auto, non trova
                          questa assicurazione: il pacchetto non gli copre niente e il contratto non la
                          riporta. Aggiungila in Centralina Pro &gt; Assicurazioni per quella categoria,
                          oppure scegline un'altra.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <Passo n={4} titolo="Regole e vincoli" nota="Il sito li applica da solo: il cliente non puo' superarli mentre prenota." />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Massimo utilizzi al mese</label>
                  <MoneyInput
                    value={bozza.max_utilizzi_mese}
                    onChange={v => setBozza(b => ({ ...b, max_utilizzi_mese: v }))}
                    className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                  />
                  <p className="text-xs text-theme-text-muted mt-1">Vuoto = nessun limite.</p>
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Massimo giorni consecutivi</label>
                  <MoneyInput
                    value={bozza.max_giorni_consecutivi}
                    onChange={v => setBozza(b => ({ ...b, max_giorni_consecutivi: v }))}
                    className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                  />
                  <p className="text-xs text-theme-text-muted mt-1">Vuoto = nessun limite.</p>
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Disponibilita' (pezzi)</label>
                  <MoneyInput
                    value={bozza.posti_totali}
                    onChange={v => setBozza(b => ({ ...b, posti_totali: v }))}
                    className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                  />
                  <p className="text-xs text-theme-text-muted mt-1">Vuoto = illimitata.</p>
                </div>
              </div>

              <div>
                <label className="text-sm text-theme-text-secondary mb-1 block">Altre regole o vincoli</label>
                <textarea
                  rows={3}
                  value={bozza.regole_extra}
                  onChange={e => setBozza(b => ({ ...b, regole_extra: e.target.value }))}
                  placeholder="Testo libero: compare al cliente sul sito e nella sua area personale."
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                />
              </div>

              <Passo n={5} titolo="Pubblicazione" nota="Finche' non e' attiva e visibile, sul sito non compare." />
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={bozza.attiva} onChange={e => setBozza(b => ({ ...b, attiva: e.target.checked }))} className="w-4 h-4" />
                  <span className="text-sm text-theme-text-primary">Attiva</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={bozza.visibile_sito} onChange={e => setBozza(b => ({ ...b, visibile_sito: e.target.checked }))} className="w-4 h-4" />
                  <span className="text-sm text-theme-text-primary">Visibile sul sito</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-theme-text-secondary">Ordine</span>
                  <MoneyInput
                    value={bozza.ordine}
                    onChange={v => setBozza(b => ({ ...b, ordine: Number(v) || 0 }))}
                    className="w-20 bg-theme-bg-tertiary border border-theme-border rounded-lg px-2 py-1 text-theme-text-primary outline-none focus:border-dr7-gold"
                  />
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-theme-border flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setModale(null)}>Annulla</Button>
              <Button onClick={salvaPrevendita} disabled={salvataggio}>
                {salvataggio ? 'Salvataggio...' : 'Salva'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODALE VENDITA MANUALE ═══ */}
      {modaleVendita && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-theme-bg-secondary border border-theme-border rounded-xl w-full max-w-2xl my-8">
            <div className="p-6 border-b border-theme-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-theme-text-primary">Vendi una prevendita a un cliente</h3>
              <button onClick={() => setModaleVendita(false)} className="text-theme-text-muted hover:text-theme-text-primary">Chiudi</button>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-sm text-theme-text-muted">
                Per le vendite fuori dal sito. La prevendita viene caricata subito sull'account del cliente,
                gia' pagata, con le condizioni del catalogo di oggi.
              </p>

              <div>
                <label className="text-sm text-theme-text-secondary mb-1 block">Prevendita *</label>
                <select
                  value={vendPrevenditaId}
                  onChange={e => {
                    setVendPrevenditaId(e.target.value)
                    const p = prevendite.find(x => x.id === e.target.value)
                    if (p) setVendPrezzo(String(p.prezzo))
                  }}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                >
                  <option value="">Scegli...</option>
                  {prevendite.map(p => (
                    <option key={p.id} value={p.id}>{p.nome} — {euro(p.prezzo)} — {p.utilizzi_inclusi} utilizzi</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-theme-text-secondary mb-1 block">Cliente *</label>
                <input
                  type="text"
                  value={ricercaCliente}
                  onChange={e => setRicercaCliente(e.target.value)}
                  placeholder="Cerca per nome, email o telefono..."
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                />
                <div className="mt-2 max-h-48 overflow-y-auto border border-theme-border rounded-lg divide-y divide-theme-border">
                  {clientiFiltrati.map(c => {
                    const scelto = vendClienteId === c.id
                    const etichetta = c.denominazione || [c.nome, c.cognome].filter(Boolean).join(' ') || c.email || 'Senza nome'
                    return (
                      <button
                        key={c.id}
                        onClick={() => setVendClienteId(c.id)}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${scelto ? 'bg-dr7-gold/15 text-dr7-gold' : 'text-theme-text-primary hover:bg-theme-bg-hover'}`}
                      >
                        <div>{etichetta}{!c.user_id && <span className="text-xs text-amber-400 ml-2">senza account sito</span>}</div>
                        <div className="text-xs text-theme-text-muted">{c.email || '—'}</div>
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-theme-text-muted mt-1">
                  Senza account sul sito la prevendita resta collegata solo all'email: il cliente la vedra' appena si registra con quella stessa email.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Importo incassato</label>
                  <MoneyInput
                    value={vendPrezzo}
                    onChange={setVendPrezzo}
                    className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                  />
                </div>
                <div>
                  <label className="text-sm text-theme-text-secondary mb-1 block">Metodo di pagamento</label>
                  <select
                    value={vendMetodo}
                    onChange={e => setVendMetodo(e.target.value)}
                    className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                  >
                    <option value="contanti">Contanti</option>
                    <option value="bonifico">Bonifico</option>
                    <option value="pos">POS</option>
                    <option value="nexi">Nexi</option>
                    <option value="altro">Altro</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm text-theme-text-secondary mb-1 block">Note</label>
                <textarea
                  rows={2}
                  value={vendNote}
                  onChange={e => setVendNote(e.target.value)}
                  className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                />
              </div>
            </div>
            <div className="p-6 border-t border-theme-border flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setModaleVendita(false)}>Annulla</Button>
              <Button onClick={vendiManuale} disabled={vendInCorso}>
                {vendInCorso ? 'Registrazione...' : 'Registra la vendita'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ DETTAGLIO PACCHETTO VENDUTO ═══ */}
      {dettaglio && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-theme-bg-secondary border border-theme-border rounded-xl w-full max-w-4xl my-8">
            <div className="p-6 border-b border-theme-border flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-theme-text-primary">{dettaglio.nome}</h3>
                <p className="text-sm text-theme-text-muted mt-1">
                  {dettaglio.customer_nome || '—'} · {dettaglio.customer_email || '—'}
                  {dettaglio.customer_telefono ? ` · ${dettaglio.customer_telefono}` : ''}
                </p>
              </div>
              <button onClick={() => setDettaglio(null)} className="text-theme-text-muted hover:text-theme-text-primary">Chiudi</button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { l: 'Pagato', v: euro(dettaglio.prezzo_pagato) },
                  { l: 'Utilizzi iniziali', v: String(dettaglio.utilizzi_iniziali) },
                  { l: 'Utilizzati', v: String(dettaglio.utilizzi_usati) },
                  { l: 'Disponibili', v: String(Math.max(0, dettaglio.utilizzi_iniziali - dettaglio.utilizzi_usati)) },
                ].map(k => (
                  <div key={k.l} className="bg-theme-bg-tertiary border border-theme-border rounded-lg p-4">
                    <div className="text-xs text-theme-text-muted">{k.l}</div>
                    <div className="text-xl font-bold text-theme-text-primary mt-1">{k.v}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-theme-bg-tertiary border border-theme-border rounded-lg p-4 space-y-2 text-sm">
                  <div className="text-xs text-theme-text-muted uppercase tracking-wider mb-2">Condizioni pagate</div>
                  <div className="flex justify-between"><span className="text-theme-text-muted">Km per utilizzo</span><span className="text-theme-text-primary">{testoKm(dettaglio.km_inclusi)}</span></div>
                  <div className="flex justify-between"><span className="text-theme-text-muted">Assicurazione</span><span className="text-theme-text-primary">{dettaglio.assicurazione_inclusa || 'Non inclusa'}</span></div>
                  <div className="flex justify-between"><span className="text-theme-text-muted">Max utilizzi al mese</span><span className="text-theme-text-primary">{dettaglio.max_utilizzi_mese ?? 'Nessun limite'}</span></div>
                  <div className="flex justify-between"><span className="text-theme-text-muted">Max giorni consecutivi</span><span className="text-theme-text-primary">{dettaglio.max_giorni_consecutivi ?? 'Nessun limite'}</span></div>
                  <div className="flex justify-between"><span className="text-theme-text-muted">Acquistata il</span><span className="text-theme-text-primary">{dataOraIt(dettaglio.data_acquisto)}</span></div>
                  <div className="flex justify-between"><span className="text-theme-text-muted">Origine</span><span className="text-theme-text-primary">{dettaglio.origine === 'gestionale' ? 'Gestionale' : 'Sito'}</span></div>
                  <div className="flex justify-between"><span className="text-theme-text-muted">Pagamento</span><span className="text-theme-text-primary">{dettaglio.payment_method || '—'} ({dettaglio.payment_status})</span></div>
                  <div className="pt-2 flex flex-wrap gap-1">
                    {(dettaglio.veicoli || []).map(v => (
                      <span key={v.id} className="px-2 py-0.5 rounded-full text-xs bg-theme-bg-secondary text-theme-text-secondary">
                        {v.nome}{v.targa ? ` (${v.targa})` : ''}
                      </span>
                    ))}
                  </div>
                  {dettaglio.regole_extra && (
                    <p className="pt-2 text-xs text-theme-text-muted whitespace-pre-wrap">{dettaglio.regole_extra}</p>
                  )}
                </div>

                <div className="bg-theme-bg-tertiary border border-theme-border rounded-lg p-4 space-y-4">
                  <div className="text-xs text-theme-text-muted uppercase tracking-wider">Interventi della direzione</div>

                  <div className="flex items-center gap-3">
                    <span className="text-sm text-theme-text-secondary">Stato</span>
                    <BadgeStato stato={statoReale(dettaglio)} />
                    {dettaglio.stato === 'bloccata'
                      ? <Button variant="secondary" className="!py-1 !min-h-0 text-xs" onClick={() => cambiaStato(dettaglio, 'attiva')}>Sblocca</Button>
                      : <Button variant="danger" className="!py-1 !min-h-0 text-xs" onClick={() => cambiaStato(dettaglio, 'bloccata')}>Blocca</Button>}
                  </div>

                  <div>
                    <label className="text-sm text-theme-text-secondary mb-1 block">Utilizzi residui</label>
                    <div className="flex gap-2">
                      <MoneyInput
                        value={residuiBozza}
                        onChange={setResiduiBozza}
                        className="w-24 bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                      />
                      <Button className="!py-2 !min-h-0 text-xs" onClick={salvaResidui}>Applica</Button>
                    </div>
                    <p className="text-xs text-theme-text-muted mt-1">La differenza resta scritta nel registro qui sotto.</p>
                  </div>

                  <div>
                    <label className="text-sm text-theme-text-secondary mb-1 block">Scadenza</label>
                    <input
                      type="date"
                      defaultValue={dettaglio.data_scadenza ? new Date(dettaglio.data_scadenza).toISOString().slice(0, 10) : ''}
                      onBlur={e => salvaScadenza(dettaglio, e.target.value)}
                      className="bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2 text-theme-text-primary outline-none focus:border-dr7-gold"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-theme-text-secondary mb-1 block">Note interne</label>
                    <textarea
                      rows={2}
                      defaultValue={dettaglio.note_admin || ''}
                      onBlur={e => salvaNote(dettaglio, e.target.value)}
                      className="w-full bg-theme-bg-secondary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary outline-none focus:border-dr7-gold"
                    />
                  </div>
                </div>
              </div>

              {/* Registro */}
              <div>
                <div className="text-xs text-theme-text-muted uppercase tracking-wider mb-2">
                  Prenotazioni e movimenti
                </div>
                {movimentiCaricamento ? <ScheletroTabella righe={3} colonne={4} /> : (
                  <div className="border border-theme-border rounded-lg overflow-hidden">
                    <table className="w-full text-left text-sm text-theme-text-muted">
                      <thead className="bg-theme-bg-tertiary text-theme-text-secondary uppercase text-xs">
                        <tr>
                          <th className="p-3">Quando</th>
                          <th className="p-3">Movimento</th>
                          <th className="p-3">Prenotazione</th>
                          <th className="p-3">Periodo</th>
                          <th className="p-3 text-right">Azioni</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-theme-border">
                        {movimenti.map(m => {
                          const b = m.booking_id ? prenotazioni[m.booking_id] : null
                          return (
                            <tr key={m.id} className={m.annullato ? 'opacity-50' : ''}>
                              <td className="p-3 text-xs">{dataOraIt(m.created_at)}</td>
                              <td className="p-3">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                  m.tipo === 'scalo' ? 'bg-blue-600/20 text-blue-400'
                                  : m.tipo === 'ripristino' ? 'bg-emerald-600/20 text-emerald-400'
                                  : 'bg-amber-600/20 text-amber-400'
                                }`}>
                                  {m.tipo === 'scalo' ? 'Utilizzo scalato' : m.tipo === 'ripristino' ? 'Utilizzo ripristinato' : `Rettifica (${m.quantita > 0 ? '+' : ''}${m.quantita})`}
                                </span>
                                {m.annullato && <span className="text-xs ml-2">annullato</span>}
                                {m.note && <div className="text-xs mt-1">{m.note}</div>}
                              </td>
                              <td className="p-3 text-xs">
                                {b ? (
                                  <>
                                    <div className="text-theme-text-primary">{b.vehicle_name || m.veicolo_nome || '—'}</div>
                                    <div>{dataIt(b.pickup_date)} · {b.status || '—'}</div>
                                    {b.price_total != null && <div>extra pagati: {euro((b.price_total || 0) / 100)}</div>}
                                  </>
                                ) : (m.veicolo_nome || '—')}
                              </td>
                              <td className="p-3 text-xs">
                                {m.data_inizio ? `${dataIt(m.data_inizio)} → ${dataIt(m.data_fine)}` : '—'}
                                {m.giorni ? <div>{m.giorni} {m.giorni === 1 ? 'giorno' : 'giorni'}</div> : null}
                              </td>
                              <td className="p-3 text-right">
                                {m.tipo === 'scalo' && !m.annullato && (
                                  <button onClick={() => ripristinaUtilizzo(m)} className="text-xs text-dr7-gold hover:underline">
                                    Ripristina utilizzo
                                  </button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                        {movimenti.length === 0 && (
                          <tr><td colSpan={5} className="p-6 text-center">Nessun utilizzo ancora</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-xs text-theme-text-muted mt-2">
                  Se una prenotazione viene annullata l'utilizzo NON torna da solo: lo rimette la direzione da qui.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
