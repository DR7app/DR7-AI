// Preventivi Lavaggio & Meccanica.
//
// 14/09/2026 (direzione): "il preventivo del lavaggio non e' collegato ai
// lavaggi veri che abbiamo".
//
// Com'era: la voce Preventivi del Lavaggio riusava la scheda di Mare/Aria
// (NoleggioServiceTab > PreventiviView). Quella scheda pesca i servizi da
// `noleggio_catalog`, dove il lavaggio NON c'e' e non deve esserci: il suo
// listino sta in `car_wash_services` e si modifica dal Catalogo Prime Wash.
// Risultato: la tendina del servizio era vuota, il nome andava riscritto a
// mano, il prezzo pure, e il resto del modulo chiedeva cose che al lavaggio
// non servono (periodo dal/al, tour, passeggeri).
//
// Com'e' adesso: il preventivo lavaggio legge lo STESSO catalogo della
// prenotazione (car_wash_services, solo attivi), con le stesse regole:
//  - due schede LAVAGGIO / MECCANICA (main_tab), come nel Catalogo;
//  - servizio principale per categoria (Urban, Maxi, Extra, Moto, Experience);
//  - opzioni di prezzo (1h/2h, taglia...) quando il servizio le ha;
//  - extra con quantita';
//  - Prime Flex col prezzo di Centralina Pro;
//  - appuntamento = UNA data + UN orario (griglia lavaggio), non un periodo;
//  - durata totale calcolata dal listino, come nel booking form.
// L'importo si ricalcola dal listino a ogni scelta e resta correggibile a mano.
//
// La conversione in prenotazione scrive gli stessi `booking_details.cartItems`
// del form Prenotazioni: la prenotazione nata da un preventivo e' identica a
// una scritta a mano, comprese targa, veicolo e durata.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'
import { ScheletroTabella } from '../../../components/Scheletro'
import { LeadPicker } from './LeadPicker'
import EuropeanDateInput from '../../../components/EuropeanDateInput'
import TelefonoConPrefisso from '../../../components/TelefonoConPrefisso'
import MoneyInput from '../../../components/MoneyInput'
import { usePaymentMethods } from '../../../hooks/usePaymentMethods'
import { INPUT_CLS, eur, eurToCents, centsToEur, toRomeIso, missingTableHint, BTN_PRIMARY, BTN_GHOST } from './noleggioFormBits'
import { ErrorBox } from './noleggioUiBits'
import Button from './Button'
import GestisciMenu, { type GestisciSection } from './GestisciMenu'
import ClientStatusBadge from '../../../components/ClientStatusBadge'
import {
  generateAllDayLavaggioSlots,
  isInLavaggioHours,
  isSlotBlocked,
  getSlotBlock,
} from '../../../utils/lavaggioHours'
import SeatPlanPicker from './SeatPlanPicker'
import { isSeatPricedService, normalizeSeats, seatListLabel } from '../../../utils/seatPlan'

/* ------------------------------- CATALOGO ------------------------------- */

interface OpzionePrezzo { label: string; price: number }

interface ServizioLavaggio {
  id: string
  name: string
  price: number
  duration: string | null
  category: string
  main_tab: string
  display_order: number
  price_unit?: string | null
  price_options?: OpzionePrezzo[] | null
}

// Stesse etichette del Catalogo Prime Wash: chi legge il preventivo e chi
// modifica il listino devono vedere gli stessi nomi.
const CATEGORY_LABELS: Record<string, string> = {
  urban: 'Urban',
  maxi: 'Maxi',
  extra: 'Extra',
  moto: 'Moto',
  experience: 'Experience',
  tech: 'Tech',
}
const ORDINE_CATEGORIE = ['urban', 'maxi', 'moto', 'tech', 'experience', 'extra']

/** "45 min" / "2 ore" -> minuti. Stessa lettura del form Prenotazioni. */
function durataInMinuti(duration: string | null | undefined): number {
  if (!duration || duration === '-') return 30
  const min = duration.match(/(\d+)\s*min/i)
  if (min) return parseInt(min[1], 10)
  const ore = duration.match(/(\d+)\s*or/i)
  if (ore) return parseInt(ore[1], 10) * 60
  return 30
}

function durataLeggibile(minuti: number): string {
  if (minuti <= 0) return '—'
  const h = Math.floor(minuti / 60)
  const m = minuti % 60
  if (h && m) return `${h}h ${m}min`
  if (h) return `${h}h`
  return `${m} min`
}

const PRIME_FLEX_DEFAULT = 4.90

/* ------------------------------ PREVENTIVI ------------------------------ */

/** Riga di carrello salvata sul preventivo: stessa forma dei cartItems. */
interface VoceCarrello {
  serviceId: string
  serviceName: string
  quantity: number
  price: number            // EUR, prezzo unitario applicato
  option: string | null
  subtotal: number         // EUR
  durationMinutes: number
  principale?: boolean
  /** Sigle dei sedili scelti sulla pianta (servizi venduti a sedile, come
   *  PRIME SEAT CLEAN). Stessa chiave dei cartItems di sito e Prenotazioni. */
  seats?: string[]
}

interface DettaglioServizi {
  items: VoceCarrello[]
  prime_flex?: boolean
  prime_flex_price?: number   // EUR
}

interface RigaPreventivo {
  id: string
  customer_name: string | null
  customer_phone: string | null
  asset_name: string | null          // riepilogo servizi, stampabile
  start_date: string | null          // data appuntamento
  start_time: string | null          // ora appuntamento HH:MM
  end_time: string | null            // fine stimata HH:MM
  duration_minutes: number | null
  amount: number                     // centesimi
  notes: string | null
  status: string
  created_at: string | null
  vehicle_name?: string | null
  vehicle_plate?: string | null
  carwash_servizi?: DettaglioServizi | null
  whatsapp_sent_at?: string | null
}

const STATI = ['bozza', 'inviato', 'accettato', 'rifiutato']

// 05/10/2026 (direzione): "il formato dei preventivi lavaggio deve essere
// ESATTAMENTE come i preventivi noleggio, con il bottone Gestisci". Lista a
// griglia, riquadri per stato, filtri e card mobile ricalcano PreventiviTab;
// le azioni stanno in un solo menu Gestisci, come in Prenotazioni.
const STATUS_LABELS: Record<string, string> = {
  bozza: 'Bozza',
  inviato: 'Inviato',
  accettato: 'Accettato',
  rifiutato: 'Rifiutato',
  convertito: 'Convertito',
}
const PER_PAGINA = 10
const COLONNE_LISTA = 'grid-cols-[2.4fr_2.2fr_1.6fr_0.8fr_1.1fr_1.1fr_104px]'

function iniziali(nome?: string | null): string {
  if (!nome) return '??'
  const parti = nome.trim().split(/\s+/).filter(Boolean)
  if (parti.length >= 2) return (parti[0][0] + parti[1][0]).toUpperCase()
  return nome.slice(0, 2).toUpperCase()
}
const PALETTE_AVATAR = [
  'bg-rose-500/20 text-rose-300 ring-rose-500/40',
  'bg-amber-500/20 text-amber-300 ring-amber-500/40',
  'bg-blue-500/20 text-blue-300 ring-blue-500/40',
  'bg-emerald-500/20 text-emerald-300 ring-emerald-500/40',
  'bg-purple-500/20 text-purple-300 ring-purple-500/40',
  'bg-cyan-500/20 text-cyan-300 ring-cyan-500/40',
  'bg-orange-500/20 text-orange-300 ring-orange-500/40',
]
function coloreAvatar(chiave: string): string {
  let h = 0
  for (let i = 0; i < chiave.length; i++) h = (h * 31 + chiave.charCodeAt(i)) | 0
  return PALETTE_AVATAR[Math.abs(h) % PALETTE_AVATAR.length]
}
function badgeStato(status: string): { bg: string; sub: string; subColor: string } {
  switch (status) {
    case 'bozza':      return { bg: 'bg-slate-500/15 text-slate-300 ring-slate-500/40', sub: 'In attesa', subColor: 'text-slate-400' }
    case 'inviato':    return { bg: 'bg-blue-500/15 text-blue-300 ring-blue-500/40', sub: 'In attesa risposta', subColor: 'text-blue-300/80' }
    case 'accettato':  return { bg: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40', sub: 'Convertibile', subColor: 'text-emerald-300/80' }
    case 'convertito': return { bg: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40', sub: 'Appuntamento creato', subColor: 'text-emerald-300/80' }
    case 'rifiutato':  return { bg: 'bg-rose-500/15 text-rose-300 ring-rose-500/40', sub: 'Non accettata', subColor: 'text-rose-300/80' }
    default:           return { bg: 'bg-gray-500/15 text-gray-300 ring-gray-500/40', sub: '', subColor: 'text-theme-text-muted' }
  }
}

/** Una riga scelta nel catalogo: opzione di prezzo e quantita'. */
interface Scelta { option: string; qty: number; seats?: string[] }

const VUOTO = {
  customer_name: '',
  customer_phone: '',
  vehicle_name: '',
  vehicle_plate: '',
  main_tab: 'lavaggio' as 'lavaggio' | 'meccanica',
  // 14/09/2026 (direzione): "ho bisogno di poterne selezionare anche piu'
  // di uno". Un preventivo lavaggio puo' contenere QUALSIASI numero di
  // servizi — due lavaggi, un lavaggio piu' un tagliando, tre extra — quindi
  // non c'e' piu' un "servizio principale" a scelta singola: una sola mappa
  // id -> {opzione, quantita'}, valida sia per i servizi sia per gli extra.
  // La selezione NON si azzera passando da Lavaggio a Meccanica: un
  // preventivo puo' pescare da tutte e due le schede.
  scelte: {} as Record<string, Scelta>,
  prime_flex: false,
  appointment_date: '',
  appointment_time: '09:00',
  amount: '',
  amount_manuale: false,
  notes: '',
  status: 'bozza',
}
type FormPreventivo = typeof VUOTO

/** dd/mm/yyyy, mai il formato americano. */
function dataIt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = iso.substring(0, 10)
  return `${d.substring(8, 10)}/${d.substring(5, 7)}/${d.substring(0, 4)}`
}

/** HH:MM + minuti -> HH:MM (fine stimata del lavaggio). */
function sommaOrario(ora: string, minuti: number): string {
  if (!ora) return ''
  const tot = Number(ora.slice(0, 2)) * 60 + Number(ora.slice(3, 5)) + minuti
  const h = Math.floor(tot / 60) % 24
  const m = tot % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function PreventiviLavaggioView() {
  const [righe, setRighe] = useState<RigaPreventivo[]>([])
  const [servizi, setServizi] = useState<ServizioLavaggio[]>([])
  const [primeFlexPrezzo, setPrimeFlexPrezzo] = useState(PRIME_FLEX_DEFAULT)
  const [caricamento, setCaricamento] = useState(false)
  const [errore, setErrore] = useState('')
  const [form, setForm] = useState<FormPreventivo>(VUOTO)
  const [modificaId, setModificaId] = useState<string | null>(null)
  const [mostraForm, setMostraForm] = useState(false)
  const [salvataggio, setSalvataggio] = useState(false)
  // Le colonne del dettaglio servizi arrivano con la migration
  // 20260914120000: finche' non e' stata eseguita il preventivo si salva
  // lo stesso (riepilogo + importo), senza il dettaglio riga per riga.
  const [colonneDettaglio, setColonneDettaglio] = useState<boolean | null>(null)
  const lockSalvataggio = useRef(false)
  // Invio WhatsApp e conversione in appuntamento: due passaggi con conferma,
  // come sul preventivo Noleggio Terra.
  const metodiPagamento = usePaymentMethods()
  const [waPer, setWaPer] = useState<RigaPreventivo | null>(null)
  const [waTel, setWaTel] = useState('')
  const [waInvio, setWaInvio] = useState(false)
  const [convPer, setConvPer] = useState<RigaPreventivo | null>(null)
  const [convData, setConvData] = useState('')
  const [convOra, setConvOra] = useState('09:00')
  const [convMetodo, setConvMetodo] = useState('')
  const [convStato, setConvStato] = useState<'pending' | 'paid'>('pending')
  const [convAcconto, setConvAcconto] = useState('0')
  const [convConferma, setConvConferma] = useState(true)
  const [convInvio, setConvInvio] = useState(false)
  // 05/10/2026 (direzione): "su PRIME SEAT CLEAN non si apre lo schema dei
  // sedili". Il preventivo sceglieva solo QUANTI sedili con la quantita'; ora
  // apre la stessa pianta di sito e Prenotazioni Lavaggio.
  const [seatPer, setSeatPer] = useState<ServizioLavaggio | null>(null)
  // Filtri e pagina della lista, come su Preventivi Noleggio.
  const [filtroStato, setFiltroStato] = useState<string>('all')
  const [ricerca, setRicerca] = useState('')
  const [pagina, setPagina] = useState(1)

  /* --------------------------- caricamento dati --------------------------- */

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('car_wash_services')
        .select('id, name, price, duration, category, main_tab, display_order, price_unit, price_options')
        .eq('is_active', true)
        .order('display_order', { ascending: true })
      setServizi((data || []) as ServizioLavaggio[])
    })()
    // Prime Flex: stesso prezzo che leggono Catalogo e sito (Centralina Pro).
    void (async () => {
      const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
      const cfg = (data?.config || {}) as Record<string, unknown>
      const serviziCfg = (cfg.servizi || {}) as Record<string, unknown>
      const pf = (serviziCfg.prime_flex || {}) as Record<string, unknown>
      const p = typeof pf.price === 'number' ? pf.price : Number(pf.price)
      setPrimeFlexPrezzo(Number.isFinite(p) && p >= 0 ? p : PRIME_FLEX_DEFAULT)
    })()
  }, [])

  const carica = useCallback(async () => {
    setCaricamento(true); setErrore('')
    const base = 'id, customer_name, customer_phone, asset_name, start_date, start_time, end_time, duration_minutes, amount, notes, status, created_at'
    const completo = `${base}, vehicle_name, vehicle_plate, carwash_servizi, whatsapp_sent_at`
    const leggi = async (campi: string) => {
      const r = await supabase
        .from('noleggio_preventivi')
        .select(campi)
        .eq('service_type', 'car_wash')
        .order('created_at', { ascending: false })
      return { data: r.data as unknown as RigaPreventivo[] | null, error: r.error }
    }
    let { data, error } = await leggi(completo)
    if (error && (error as { code?: string }).code === '42703') {
      // Migration non ancora eseguita: si legge quello che c'e'.
      setColonneDettaglio(false)
      ;({ data, error } = await leggi(base))
    } else if (!error) {
      setColonneDettaglio(true)
    }
    if (error) setErrore(missingTableHint(error.message, (error as { code?: string }).code))
    else setRighe(data || [])
    setCaricamento(false)
  }, [])
  useEffect(() => { void carica() }, [carica])

  /* ------------------------------ catalogo ------------------------------- */

  const serviziScheda = useMemo(
    () => servizi.filter(s => (s.main_tab || 'lavaggio') === form.main_tab),
    [servizi, form.main_tab],
  )
  // Servizi ed extra stanno nella STESSA lista: si spuntano allo stesso modo,
  // quindi non c'e' piu' motivo di dividerli in due blocchi con due
  // comportamenti diversi. L'ordine delle categorie mette gli Extra in fondo.
  const gruppiCatalogo = useMemo(() => {
    const gruppi: Record<string, ServizioLavaggio[]> = {}
    for (const s of serviziScheda) (gruppi[s.category] ||= []).push(s)
    return ORDINE_CATEGORIE
      .filter(c => gruppi[c]?.length)
      .map(c => ({ categoria: c, servizi: gruppi[c] }))
      .concat(
        Object.keys(gruppi)
          .filter(c => !ORDINE_CATEGORIE.includes(c))
          .map(c => ({ categoria: c, servizi: gruppi[c] })),
      )
  }, [serviziScheda])
  /** Servizi scelti, nell'ordine del catalogo (non in quello dei clic). */
  const serviziScelti = useMemo(
    () => servizi.filter(s => form.scelte[s.id]),
    [servizi, form.scelte],
  )

  /** Prezzo applicato a un servizio, tenendo conto dell'opzione scelta. */
  const prezzoDi = useCallback((s: ServizioLavaggio, opzione: string): number => {
    const opt = (s.price_options || []).find(o => o.label === opzione)
    return Number(opt?.price ?? s.price) || 0
  }, [])

  /**
   * Etichetta prezzo della card, come la legge il Catalogo: le opzioni
   * mostrano il minimo ("da 25,00"), i servizi a preventivo (price_unit
   * 'custom') dicono che il prezzo si scrive a mano.
   */
  const etichettaPrezzo = useCallback((s: ServizioLavaggio): string => {
    if (s.price_unit === 'custom') return 'prezzo da concordare'
    if (s.price_options?.length) return `da €${Math.min(...s.price_options.map(o => o.price)).toFixed(2)}`
    return `€${Number(s.price || 0).toFixed(2)}`
  }, [])

  /** Carrello corrente: e' la fonte di totale, durata e riepilogo. */
  const carrello = useMemo<VoceCarrello[]>(() => {
    let primo = true
    return serviziScelti.map(s => {
      const sc = form.scelte[s.id]
      const seats = normalizeSeats(sc.seats)
      // Servizio a sedile: la quantita' e' sempre il numero di sedili scelti.
      const qty = seats.length || Math.max(1, sc.qty || 1)
      const prezzo = prezzoDi(s, sc.option || '')
      // `principale` marca la prima voce non-extra: serve solo a riaprire il
      // preventivo sulla scheda giusta, non cambia prezzi ne' durata.
      const principale = primo && s.category !== 'extra'
      if (principale) primo = false
      return {
        serviceId: s.id,
        serviceName: s.name,
        quantity: qty,
        price: prezzo,
        option: sc.option || null,
        subtotal: prezzo * qty,
        durationMinutes: durataInMinuti(s.duration) * qty,
        ...(principale ? { principale: true } : {}),
        ...(seats.length ? { seats } : {}),
      }
    })
  }, [serviziScelti, form.scelte, prezzoDi])

  /** Accende/spegne un servizio del catalogo. */
  const commuta = useCallback((s: ServizioLavaggio) => {
    // Servizio a sedile non ancora scelto: prima la pianta, poi il carrello.
    if (!form.scelte[s.id] && isSeatPricedService(s.name, s.price_unit)) {
      setSeatPer(s)
      return
    }
    setForm(f => {
      const scelte = { ...f.scelte }
      if (scelte[s.id]) delete scelte[s.id]
      else scelte[s.id] = { option: s.price_options?.[0]?.label || '', qty: 1 }
      return { ...f, scelte, amount_manuale: false }
    })
  }, [form.scelte])
  /** Toglie un servizio dal preventivo (dal riepilogo). */
  const togli = useCallback((id: string) => {
    setForm(f => {
      const scelte = { ...f.scelte }
      delete scelte[id]
      return { ...f, scelte, amount_manuale: false }
    })
  }, [])
  /** Cambia opzione di prezzo o quantita' di un servizio gia' scelto. */
  const aggiorna = useCallback((id: string, patch: Partial<Scelta>) => {
    setForm(f => (f.scelte[id]
      ? { ...f, amount_manuale: false, scelte: { ...f.scelte, [id]: { ...f.scelte[id], ...patch } } }
      : f))
  }, [])

  const totaleListino = useMemo(
    () => carrello.reduce((t, v) => t + v.subtotal, 0) + (form.prime_flex ? primeFlexPrezzo : 0),
    [carrello, form.prime_flex, primeFlexPrezzo],
  )
  const durataTotale = useMemo(
    () => carrello.reduce((t, v) => t + v.durationMinutes, 0),
    [carrello],
  )
  const riepilogoServizi = useMemo(() => {
    const parti = carrello.map(v => {
      let n = v.serviceName
      if (v.option) n += ` (${v.option})`
      if (v.quantity > 1) n += ` x${v.quantity}`
      return n
    })
    if (form.prime_flex) parti.push('Prime Flex')
    return parti.join(' + ')
  }, [carrello, form.prime_flex])

  // L'importo segue il listino finche' l'admin non lo corregge a mano.
  useEffect(() => {
    if (form.amount_manuale) return
    const nuovo = totaleListino > 0 ? totaleListino.toFixed(2) : ''
    setForm(f => (f.amount === nuovo ? f : { ...f, amount: nuovo }))
  }, [totaleListino, form.amount_manuale])

  /* ------------------------------- orari --------------------------------- */

  // Griglia oraria del lavaggio (Centralina Pro > Orari Lavaggio). Fuori
  // orario si SEGNALA, non si blocca: nessun hard-block sul gestionale.
  const opzioniOrario = useMemo(() => {
    const slot = generateAllDayLavaggioSlots()
    const scelto = form.appointment_time
    const lista = scelto && !slot.includes(scelto) ? [scelto, ...slot] : slot
    const d = form.appointment_date ? new Date(`${form.appointment_date}T12:00:00`) : null
    return lista.map(v => {
      if (!d) return { value: v, label: v, fuori: false }
      const bloccato = isSlotBlocked(d, v)
      const dentro = isInLavaggioHours(d, v)
      const nota = bloccato ? (getSlotBlock(d, v)?.note || 'BLOCCATO') : ''
      return {
        value: v,
        label: bloccato ? `${v}  ${nota}` : dentro ? v : `${v}  FUORI ORARIO`,
        fuori: bloccato || !dentro,
      }
    })
  }, [form.appointment_date, form.appointment_time])
  const orarioFuori = opzioniOrario.find(o => o.value === form.appointment_time)?.fuori === true

  /* ------------------------------ scrittura ------------------------------ */

  function apriNuovo() {
    setModificaId(null)
    setForm({ ...VUOTO, scelte: {} })
    setMostraForm(true)
  }

  function apriModifica(p: RigaPreventivo) {
    const dett = p.carwash_servizi || null
    const items = dett?.items || []
    const primo = items.find(i => i.principale) || items[0] || null
    const servizioDb = primo ? servizi.find(s => s.id === primo.serviceId) : null
    setModificaId(p.id)
    setForm({
      customer_name: p.customer_name || '',
      customer_phone: p.customer_phone || '',
      vehicle_name: p.vehicle_name || '',
      vehicle_plate: p.vehicle_plate || '',
      main_tab: (servizioDb?.main_tab === 'meccanica' ? 'meccanica' : 'lavaggio'),
      scelte: Object.fromEntries(items.map(i => [i.serviceId, {
        option: i.option || '',
        qty: i.quantity || 1,
        ...(normalizeSeats(i.seats).length ? { seats: normalizeSeats(i.seats) } : {}),
      }])),
      prime_flex: !!dett?.prime_flex,
      appointment_date: p.start_date ? p.start_date.substring(0, 10) : '',
      appointment_time: p.start_time || '09:00',
      // Un preventivo gia' salvato conserva il SUO importo: il listino puo'
      // essere cambiato nel frattempo e riscriverlo qui falserebbe lo storico.
      amount: centsToEur(p.amount),
      amount_manuale: true,
      notes: p.notes || '',
      status: p.status || 'bozza',
    })
    setMostraForm(true)
  }

  async function salva() {
    if (lockSalvataggio.current) return
    if (carrello.length === 0) { toast.error('Scegli almeno un servizio dal catalogo'); return }
    lockSalvataggio.current = true
    setSalvataggio(true); setErrore('')
    const dettaglio: DettaglioServizi = {
      items: carrello,
      prime_flex: form.prime_flex,
      prime_flex_price: form.prime_flex ? primeFlexPrezzo : 0,
    }
    const base: Record<string, unknown> = {
      service_type: 'car_wash',
      customer_name: form.customer_name.trim() || null,
      customer_phone: form.customer_phone.trim() || null,
      // Il nome resta salvato come testo: se un servizio viene tolto dal
      // catalogo, il preventivo storico continua a dire di cosa parlava.
      asset_name: riepilogoServizi || null,
      start_date: form.appointment_date || null,
      // Il lavaggio e' un appuntamento: la data di fine e' la stessa.
      end_date: form.appointment_date || null,
      start_time: form.appointment_time || null,
      end_time: form.appointment_time ? sommaOrario(form.appointment_time, durataTotale) : null,
      duration_minutes: durataTotale || null,
      amount: eurToCents(form.amount),
      notes: form.notes.trim() || null,
      status: form.status,
      updated_at: new Date().toISOString(),
    }
    const conDettaglio = {
      ...base,
      vehicle_name: form.vehicle_name.trim() || null,
      vehicle_plate: form.vehicle_plate.trim().toUpperCase() || null,
      carwash_servizi: dettaglio,
    }
    const scrivi = (payload: Record<string, unknown>) => modificaId
      ? supabase.from('noleggio_preventivi').update(payload).eq('id', modificaId)
      : supabase.from('noleggio_preventivi').insert(payload)

    let { error } = await scrivi(colonneDettaglio === false ? base : conDettaglio)
    if (error && (error as { code?: string }).code === '42703') {
      // Migration non ancora eseguita: si salva comunque il preventivo.
      setColonneDettaglio(false)
      ;({ error } = await scrivi(base))
    }
    setSalvataggio(false)
    lockSalvataggio.current = false
    if (error) { setErrore(missingTableHint(error.message, (error as { code?: string }).code)); return }
    setMostraForm(false)
    toast.success(modificaId ? 'Preventivo aggiornato' : 'Preventivo creato')
    void carica()
  }

  async function elimina(p: RigaPreventivo) {
    if (!window.confirm('Eliminare questo preventivo?')) return
    const prima = righe
    setRighe(rs => rs.filter(r => r.id !== p.id))
    const { error } = await supabase.from('noleggio_preventivi').delete().eq('id', p.id)
    if (error) { setRighe(prima); toast.error('Eliminazione non riuscita: ' + error.message); return }
    toast.success('Preventivo eliminato')
  }

  async function cambiaStato(p: RigaPreventivo, status: string) {
    const prima = righe
    setRighe(rs => rs.map(r => r.id === p.id ? { ...r, status } : r))
    const { error } = await supabase.from('noleggio_preventivi')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', p.id)
    if (error) { setRighe(prima); toast.error('Errore: ' + error.message); return }
    toast.success(status === 'accettato' ? 'Preventivo accettato' : status === 'rifiutato' ? 'Preventivo rifiutato' : 'Aggiornato')
  }

  /* ----------------------- invio WhatsApp (Green API) --------------------- */

  /**
   * 15/09/2026 (direzione): "invio WhatsApp e converti in appuntamento,
   * stessa cosa del preventivo Noleggio Terra".
   *
   * Prima il pulsante apriva solo wa.me: si apriva la chat, il messaggio lo
   * scriveva l'operatore, e il preventivo restava "bozza" come se non fosse
   * mai partito. Adesso, come su Terra: il testo arriva dal template Pro
   * "Preventivo Lavaggio" (pro_preventivo_lavaggio — 01/10/2026: prima
   * pro_conferma_preventivo, riusato come "Richiesta Recensione": il cliente
   * riceveva la richiesta di recensione), l'invio passa da
   * Green API (send-whatsapp-notification) e il preventivo diventa 'inviato'
   * con la data dell'invio. Nessun testo scritto nel codice: se il template
   * manca o e' spento non si inventa un messaggio, si dice quale template
   * compilare.
   */
  async function inviaWhatsapp() {
    const p = waPer
    if (!p) return
    const tel = waTel.replace(/\D/g, '')
    if (tel.length < 8) { toast.error('Numero WhatsApp non valido'); return }
    setWaInvio(true)
    try {
      const dett = p.carwash_servizi || null
      const nome = (p.customer_name || '').trim().split(/\s+/)[0] || 'Cliente'
      const totale = ((p.amount || 0) / 100).toFixed(2)
      const durata = p.duration_minutes ? durataLeggibile(p.duration_minutes) : ''
      const veicolo = [p.vehicle_name, p.vehicle_plate].filter(Boolean).join(' ')
      const risposta = await fetch('/.netlify/functions/send-whatsapp-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customPhone: tel,
          templateKey: 'pro_preventivo_lavaggio',
          // Il servizio serve al guard "Tipo servizio" del template: un
          // template limitato al Noleggio non deve partire per un lavaggio.
          booking: { service_type: 'car_wash' },
          skipHeader: true,
          templateVars: {
            nome, cliente: p.customer_name || '', customer_name: nome,
            servizio: p.asset_name || 'Lavaggio', service_name: p.asset_name || 'Lavaggio',
            data: dataIt(p.start_date), appointment_date: dataIt(p.start_date), date: dataIt(p.start_date),
            ora: p.start_time || '', appointment_time: p.start_time || '', time: p.start_time || '',
            durata, duration: durata,
            totale, total: totale, importo: totale, amount: totale, prezzo: totale,
            veicolo, vehicle_name: p.vehicle_name || '',
            targa: p.vehicle_plate || '', vehicle_plate: p.vehicle_plate || '', plate: p.vehicle_plate || '',
            note: p.notes || '', notes: p.notes || '',
            prime_flex: dett?.prime_flex ? 'Si' : '',
          },
        }),
      })
      const esito = await risposta.json().catch(() => ({}))
      if (!risposta.ok) throw new Error(esito?.message || 'Invio non riuscito')
      if (esito?.skipped) {
        toast.error(esito.reason === 'service_type_mismatch'
          ? 'Il template "Preventivo Lavaggio" e\' limitato a un altro tipo di servizio: mettilo su Lavaggio & Meccanica (o Tutti) in Messaggi di Sistema Pro.'
          : 'Template "Preventivo Lavaggio" mancante o disattivato in Messaggi di Sistema Pro.', { duration: 10000 })
        return
      }
      // Traccia dell'invio, come su Terra. `whatsapp_sent_at` arriva con la
      // migration 20260915090000: se manca si scrive comunque lo stato.
      const ora = new Date().toISOString()
      let { error } = await supabase.from('noleggio_preventivi')
        .update({ status: 'inviato', customer_phone: waTel.trim() || p.customer_phone, whatsapp_sent_at: ora, updated_at: ora })
        .eq('id', p.id)
      if (error && (error as { code?: string }).code === '42703') {
        ;({ error } = await supabase.from('noleggio_preventivi')
          .update({ status: 'inviato', customer_phone: waTel.trim() || p.customer_phone, updated_at: ora })
          .eq('id', p.id))
      }
      if (error) { toast.error('Inviato, ma lo stato non e\' stato aggiornato: ' + error.message); return }
      setRighe(rs => rs.map(r => r.id === p.id
        ? { ...r, status: 'inviato', whatsapp_sent_at: ora, customer_phone: waTel.trim() || r.customer_phone }
        : r))
      setWaPer(null)
      toast.success('Preventivo inviato via WhatsApp')
    } catch (e) {
      toast.error('Errore invio WhatsApp: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setWaInvio(false)
    }
  }

  /* --------------------- conversione in appuntamento ---------------------- */

  /**
   * Converti in appuntamento. Come l'"Accetta" del Noleggio Terra
   * (PreventivoAcceptModal): prima si chiede metodo di pagamento, stato,
   * acconto ed eventuale Conferma, poi si crea la prenotazione. La riga nasce
   * con gli stessi campi del form Prenotazioni Lavaggio (appointment_date /
   * appointment_time, cartItems, totalDuration, targa, categoria veicolo),
   * quindi compare in Prenotazioni E nel Calendario Lavaggio, che legge
   * appointment_time e `booking_details.totalDuration` per disegnare la fascia.
   */
  function apriConversione(p: RigaPreventivo) {
    if (p.status === 'convertito') { toast('Preventivo gia\' convertito'); return }
    if (!p.start_date) { toast.error('Manca la data dell\'appuntamento: apri Modifica e indicala.'); return }
    setConvPer(p)
    setConvData(p.start_date.substring(0, 10))
    setConvOra(p.start_time || '09:00')
    setConvMetodo(metodiPagamento[0]?.label || 'Contanti')
    setConvStato('pending')
    setConvAcconto('0')
    setConvConferma(true)
  }

  async function confermaConversione() {
    const p = convPer
    if (!p || convInvio) return
    setConvInvio(true)
    try {
      const inizio = toRomeIso(convData, convOra)
      const dett = p.carwash_servizi || null
      const items = dett?.items || []
      // Categoria del veicolo: la prende dal servizio principale scelto a
      // catalogo (urban / maxi / moto). Calendario e scheda la usano come
      // riserva per la durata quando totalDuration non c'e'.
      const principale = items.find(i => i.principale) || items[0] || null
      const servizioPrincipale = principale ? servizi.find(x => x.id === principale.serviceId) : null
      const categoria = servizioPrincipale && ['urban', 'maxi', 'moto'].includes(servizioPrincipale.category)
        ? servizioPrincipale.category
        : null
      const durataBooking = p.duration_minutes || items.reduce((t, i) => t + (i.durationMinutes || 0), 0) || null
      const pagato = convStato === 'paid'
      const accontoCents = pagato
        ? (p.amount || 0)
        : Math.max(0, Math.round(parseFloat((convAcconto || '0').replace(',', '.')) * 100)) || 0
      const payload = {
        service_type: 'car_wash',
        service_name: p.asset_name || 'Lavaggio',
        vehicle_name: p.vehicle_name || 'Car Wash Service',
        vehicle_plate: p.vehicle_plate || null,
        customer_name: p.customer_name || 'Cliente',
        customer_phone: p.customer_phone || null,
        guest_name: p.customer_name || 'Cliente',
        guest_phone: p.customer_phone || null,
        appointment_date: inizio,
        appointment_time: convOra,
        // Colonna vera di `bookings`: e' quella che il form Prenotazioni legge
        // per capire quali slot sono occupati. Con piu' servizi il nome e'
        // "A + B" e non combacia con nessuna voce di catalogo, quindi senza
        // questo campo l'appuntamento risulterebbe lungo 60 minuti fissi.
        duration_minutes: durataBooking,
        pickup_date: inizio,
        dropoff_date: inizio,
        pickup_location: 'DR7 - Car Wash',
        dropoff_location: 'DR7 - Car Wash',
        price_total: p.amount || 0,
        currency: 'EUR',
        status: 'confirmed',
        payment_status: pagato ? 'paid' : 'pending',
        payment_method: convMetodo || null,
        booking_details: {
          from_preventivo_id: p.id,
          createdBy: 'admin_panel',
          cartItems: items.map(i => ({
            serviceId: i.serviceId,
            serviceName: i.serviceName,
            quantity: i.quantity,
            price: i.price,
            option: i.option,
            subtotal: i.subtotal,
            ...(normalizeSeats(i.seats).length ? { seats: normalizeSeats(i.seats) } : {}),
          })),
          totalDuration: durataBooking || 0,
          amountPaid: accontoCents,
          // Stessa chiave di CarWashBookingsTab: il cron dei non pagati la
          // legge per non cancellare una prenotazione confermata a mano.
          manually_confirmed: pagato || convConferma,
          ...((pagato || convConferma) ? { manually_confirmed_at: new Date().toISOString() } : {}),
          ...(categoria ? { vehicleCategory: categoria } : {}),
          ...(dett?.prime_flex ? { prime_flex: true, prime_flex_price: dett.prime_flex_price || 0 } : {}),
          ...(p.vehicle_name ? { vehicleMakeModel: p.vehicle_name } : {}),
          ...(p.notes ? { notes: p.notes, note: p.notes } : {}),
        },
        created_at: new Date().toISOString(),
      }
      const { data: creata, error } = await supabase.from('bookings').insert(payload).select('id').single()
      if (error) { toast.error('Conversione fallita: ' + error.message); return }
      await supabase.from('noleggio_preventivi')
        .update({ status: 'convertito', updated_at: new Date().toISOString() }).eq('id', p.id)
      setRighe(rs => rs.map(r => r.id === p.id ? { ...r, status: 'convertito' } : r))
      setConvPer(null)
      toast.success(pagato
        ? 'Convertito in appuntamento (Pagato) — lo trovi in Prenotazioni e in Calendario'
        : 'Convertito in appuntamento (Da Saldare) — lo trovi in Prenotazioni e in Calendario')
      await inviaConfermaCliente(p, creata?.id || '', inizio || '', pagato, pagato || convConferma)
    } finally {
      setConvInvio(false)
    }
  }

  /**
   * 05/10/2026 (direzione): "ho accettato il preventivo e al cliente non e'
   * arrivato niente". La conversione creava la prenotazione e basta: nessun
   * messaggio. Ora parte la STESSA conferma che manda Prenotazioni Lavaggio
   * (CarWashBookingsTab) quando si salva un appuntamento: template
   * carwash_new_customer / mechanical_new_customer, piu' la ricevuta per
   * metodo se e' gia' pagato. Stesse regole: Da Saldare senza Conferma =
   * nessun messaggio. La lingua la sceglie il server dal prefisso.
   */
  async function inviaConfermaCliente(p: RigaPreventivo, bookingId: string, inizioIso: string, pagato: boolean, confermata: boolean) {
    const tel = (p.customer_phone || '').replace(/\D/g, '')
    if (!tel) { toast('Appuntamento creato, ma il preventivo non ha un telefono: nessun messaggio inviato', { icon: '!' }); return }
    if (!pagato && !confermata) return
    const servizioPrincipale = servizi.find(x => x.id === (p.carwash_servizi?.items || [])[0]?.serviceId)
    const isMech = servizioPrincipale?.main_tab === 'meccanica'
    const svc = isMech ? 'mechanical' : 'car_wash'
    const dt = new Date(inizioIso)
    const data = dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Rome' })
    const dataLunga = dt.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' })
    const ora = dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' })
    const totale = ((p.amount || 0) / 100).toFixed(2)
    const nome = (p.customer_name || '').trim().split(/\s+/)[0] || 'Cliente'
    const servizio = p.asset_name || 'Lavaggio'
    const pagamento = pagato ? 'Pagato' : 'Da saldare'
    const rif = bookingId.substring(0, 8).toUpperCase()
    const templateVars = {
      customer_name: nome, nome,
      service_name: servizio, servizio,
      appointment_date: data, appointment_time: ora, date: data, time: ora, data, ora, data_lunga: dataLunga,
      total: totale, totale, amount: totale, importo: totale,
      vehicle_plate: p.vehicle_plate || '', targa: p.vehicle_plate || '', plate: p.vehicle_plate || '',
      payment_info: pagamento, payment_status: pagamento, pagamento,
      booking_id: rif, booking_ref: rif,
      notes: p.notes || '', note: p.notes || '',
    }
    const invia = (templateKey: string) => fetch('/.netlify/functions/send-whatsapp-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customPhone: tel, templateKey, booking: { service_type: svc }, templateVars, skipHeader: true }),
    })
    try {
      const risposta = await invia(isMech ? 'mechanical_new_customer' : 'carwash_new_customer')
      const esito = await risposta.json().catch(() => ({}))
      if (!risposta.ok || esito?.skipped) {
        toast.error(`Appuntamento creato, ma la conferma WhatsApp non e' partita: template ${isMech ? 'Conferma Meccanica' : 'Conferma Lavaggio'} mancante o spento in Messaggi di Sistema Pro`, { duration: 10000 })
        return
      }
      toast.success('Conferma inviata al cliente su WhatsApp')
      // Ricevuta per metodo, come in Prenotazioni Lavaggio: solo se pagato.
      if (pagato) {
        const pm = String(convMetodo || '').toLowerCase().trim()
        const pref = isMech ? 'mechanical' : 'carwash'
        let evento: string | null = null
        if (pm.includes('contanti') || pm === 'cash' || pm === 'prepagata') evento = `${pref}_paid_cash`
        else if (pm.includes('carta') || pm.includes('bancomat') || pm === 'pos') evento = `${pref}_paid_card`
        else if (pm.includes('bonifico') || pm.includes('sepa')) evento = `${pref}_paid_bank_transfer`
        else if (pm === 'paypal') evento = `${pref}_paid_paypal`
        else if (pm.includes('wallet') || pm === 'credit wallet') evento = `${pref}_paid_wallet`
        if (evento) void invia(evento).catch(err => console.error(`Ricevuta WhatsApp (${evento}) non inviata:`, err))
      }
    } catch (e) {
      toast.error('Appuntamento creato, ma errore invio WhatsApp: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  /* ------------------------------- render -------------------------------- */

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-theme-text-primary">Preventivi</h2>
        <Button onClick={apriNuovo}>+ Nuovo Preventivo</Button>
      </div>
      {errore && <ErrorBox msg={errore} />}
      {colonneDettaglio === false && (
        <div className="bg-amber-500/10 border border-amber-500/40 text-amber-300 px-4 py-3 rounded-lg text-sm">
          Il dettaglio dei servizi (e targa/veicolo) non viene ancora salvato: esegui la migration
          <span className="font-mono"> 20260914120000_preventivi_lavaggio_servizi.sql</span> nel SQL editor Supabase.
          I preventivi continuano a salvarsi con riepilogo e importo.
        </div>
      )}
      {servizi.length === 0 && !caricamento && (
        <div className="bg-amber-500/10 border border-amber-500/40 text-amber-300 px-4 py-3 rounded-lg text-sm">
          Nessun servizio attivo nel Catalogo Lavaggio &amp; Meccanica: i preventivi si compilano da li'.
        </div>
      )}

      {mostraForm && (
        <div className="border border-theme-border rounded-lg p-4 bg-theme-bg-secondary space-y-4">
          {/* --- Cliente --- */}
          <section className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-theme-text-muted">Cliente</h3>
            <LeadPicker
              initialQuery={form.customer_name}
              onPick={(nome, tel) => setForm(f => ({ ...f, customer_name: nome || f.customer_name, customer_phone: tel || f.customer_phone }))}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className={INPUT_CLS} placeholder="Cliente" value={form.customer_name}
                onChange={e => setForm({ ...form, customer_name: e.target.value })} />
              <TelefonoConPrefisso
                className={`flex-1 min-w-0 ${INPUT_CLS}`} selectClassName={`w-[104px] shrink-0 ${INPUT_CLS}`}
                mostraAnteprima={false} placeholder="Telefono (WhatsApp)"
                value={form.customer_phone} onChange={v => setForm({ ...form, customer_phone: v })} />
            </div>
          </section>

          {/* --- Veicolo --- */}
          <section className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-theme-text-muted">Veicolo</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className={INPUT_CLS} placeholder="Marca e modello (es. Fiat Panda)" value={form.vehicle_name}
                onChange={e => setForm({ ...form, vehicle_name: e.target.value })} />
              <input className={INPUT_CLS} placeholder="Targa" value={form.vehicle_plate}
                onChange={e => setForm({ ...form, vehicle_plate: e.target.value.toUpperCase() })} />
            </div>
          </section>

          {/* --- Servizi dal catalogo vero: scelta MULTIPLA --- */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-xs uppercase tracking-wide text-theme-text-muted">
                Servizi <span className="normal-case tracking-normal">— puoi sceglierne piu' di uno</span>
              </h3>
              <div className="flex gap-1 p-1 rounded-full bg-theme-bg-tertiary border border-theme-border">
                {(['lavaggio', 'meccanica'] as const).map(t => (
                  <button key={t} type="button"
                    onClick={() => setForm(f => ({ ...f, main_tab: t }))}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${form.main_tab === t ? 'bg-dr7-gold text-white' : 'text-theme-text-secondary hover:text-theme-text-primary'}`}>
                    {t === 'lavaggio' ? 'Lavaggio' : 'Meccanica'}
                  </button>
                ))}
              </div>
            </div>

            {gruppiCatalogo.length === 0 && (
              <p className="text-sm text-theme-text-muted">Nessun servizio attivo in questa scheda del catalogo.</p>
            )}
            {gruppiCatalogo.map(g => (
              <div key={g.categoria} className="space-y-1">
                <p className="text-[11px] uppercase tracking-wide text-theme-text-muted">{CATEGORY_LABELS[g.categoria] || g.categoria}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {g.servizi.map(s => {
                    const sc = form.scelte[s.id]
                    return (
                      <div key={s.id} className={`px-3 py-2 rounded-lg border transition-colors ${sc ? 'border-dr7-gold bg-dr7-gold/10' : 'border-theme-border bg-theme-bg-tertiary'}`}>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input type="checkbox" className="mt-1 w-4 h-4 accent-dr7-gold" checked={!!sc} onChange={() => commuta(s)} />
                          <span className="min-w-0">
                            <span className="block text-sm text-theme-text-primary">{s.name}</span>
                            <span className="block text-xs text-theme-text-muted tabular-nums">
                              {etichettaPrezzo(s)}
                              {s.duration ? ` · ${s.duration}` : ''}
                            </span>
                          </span>
                        </label>
                        {sc && (
                          <div className="flex flex-wrap items-center gap-2 pt-2">
                            {(s.price_options?.length || 0) > 0 && (
                              <select className={`${INPUT_CLS} py-1`} value={sc.option}
                                onChange={ev => aggiorna(s.id, { option: ev.target.value })}>
                                {(s.price_options || []).map(o => (
                                  <option key={o.label} value={o.label}>{o.label} — €{Number(o.price).toFixed(2)}</option>
                                ))}
                              </select>
                            )}
                            {/* Servizio a sedile: la quantita' si cambia solo dalla
                                pianta, cosi' in officina si sa QUALI sedili. */}
                            {isSeatPricedService(s.name, s.price_unit) ? (
                              <button type="button" onClick={() => setSeatPer(s)}
                                className="text-xs font-semibold text-dr7-gold hover:underline text-left">
                                {normalizeSeats(sc.seats).length
                                  ? `Sedili: ${seatListLabel(sc.seats || [], 'it')} — modifica`
                                  : 'Scegli i sedili'}
                              </button>
                            ) : (
                            /* Quantita': due auto dello stesso cliente = 2. Moltiplica
                                prezzo E durata, cosi' l'appuntamento occupa il tempo vero. */
                            <label className="flex items-center gap-1 text-xs text-theme-text-muted">
                              Quantita'
                              <input className={`${INPUT_CLS} py-1 w-16`} inputMode="numeric" value={String(sc.qty)}
                                onChange={ev => aggiorna(s.id, { qty: Math.max(1, parseInt(ev.target.value.replace(/\D/g, '') || '1', 10)) })} />
                            </label>
                            )}
                          </div>
                        )}
                        {sc && s.price_unit === 'custom' && (
                          <p className="text-xs text-amber-400 pt-1">Servizio a preventivo: il listino non ha un prezzo, scrivi tu l'importo.</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </section>

          {/* --- Riepilogo della selezione: con piu' servizi serve vederli
                 tutti insieme, con il loro peso su prezzo e durata. --- */}
          {carrello.length > 0 && (
            <div className="rounded-lg border border-theme-border bg-theme-bg-tertiary divide-y divide-theme-border">
              {carrello.map(v => (
                <div key={v.serviceId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="text-theme-text-primary min-w-0 truncate">
                    {v.serviceName}{v.option ? ` (${v.option})` : ''}{v.quantity > 1 ? ` x${v.quantity}` : ''}
                    {v.seats?.length ? <span className="block text-xs text-theme-text-muted">{seatListLabel(v.seats, 'it')}</span> : null}
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-theme-text-muted tabular-nums">{durataLeggibile(v.durationMinutes)}</span>
                    <span className="tabular-nums text-theme-text-primary">€{v.subtotal.toFixed(2)}</span>
                    <button type="button" onClick={() => togli(v.serviceId)} className="text-xs text-red-400 hover:underline">Togli</button>
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm font-semibold">
                <span className="text-theme-text-secondary">{carrello.length} servizi · {durataLeggibile(durataTotale)}</span>
                <span className="tabular-nums text-theme-text-primary">€{totaleListino.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* --- Prime Flex --- */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-dr7-gold" checked={form.prime_flex}
              onChange={e => setForm(f => ({ ...f, prime_flex: e.target.checked, amount_manuale: false }))} />
            <span className="text-sm text-theme-text-primary">Prime Flex (€{primeFlexPrezzo.toFixed(2)})</span>
          </label>

          {/* --- Appuntamento --- */}
          <section className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-theme-text-muted">Appuntamento</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <EuropeanDateInput className={INPUT_CLS} value={form.appointment_date}
                onChange={(v: string) => setForm(f => ({ ...f, appointment_date: v }))} />
              <select className={INPUT_CLS} value={form.appointment_time}
                onChange={e => setForm(f => ({ ...f, appointment_time: e.target.value }))}>
                {opzioniOrario.map(o => (
                  <option key={o.value} value={o.value}
                    style={o.fuori ? { color: 'white', backgroundColor: '#dc2626', fontWeight: 600 } : { color: 'black', backgroundColor: 'white' }}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center text-sm text-theme-text-secondary tabular-nums">
                Durata {durataLeggibile(durataTotale)}
                {form.appointment_time && durataTotale > 0 && ` · fine ${sommaOrario(form.appointment_time, durataTotale)}`}
              </div>
            </div>
            {orarioFuori && (
              <p className="text-xs text-amber-400">Orario fuori dagli orari del lavaggio: si puo' salvare lo stesso.</p>
            )}
          </section>

          {/* --- Importo e stato --- */}
          <section className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-theme-text-muted">Importo</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Campo € sempre MoneyInput, mai type="number": con locale
                  italiano il browser rifiuta la virgola dei decimali. */}
              <MoneyInput className={INPUT_CLS} placeholder="Importo (€)" value={form.amount}
                onChange={v => setForm(f => ({ ...f, amount: v, amount_manuale: true }))} />
              <div className="flex items-center gap-2 text-sm text-theme-text-secondary tabular-nums">
                <span>Listino €{totaleListino.toFixed(2)}</span>
                {form.amount_manuale && totaleListino > 0 && (
                  <button type="button" className="text-dr7-gold hover:underline"
                    onClick={() => setForm(f => ({ ...f, amount: totaleListino.toFixed(2), amount_manuale: false }))}>
                    Ricalcola dal listino
                  </button>
                )}
              </div>
              <select className={INPUT_CLS} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                {STATI.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {riepilogoServizi && (
              <p className="text-xs text-theme-text-muted">Riepilogo: {riepilogoServizi}</p>
            )}
          </section>

          <textarea className={INPUT_CLS} placeholder="Note" rows={2} value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })} />

          <div className="flex gap-2">
            <button onClick={salva} disabled={salvataggio} className={BTN_PRIMARY}>
              {salvataggio ? 'Salvataggio…' : (modificaId ? 'Salva' : 'Crea preventivo')}
            </button>
            <button onClick={() => setMostraForm(false)} className={BTN_GHOST}>Annulla</button>
          </div>
        </div>
      )}

      {/* ─── Panoramica Preventivi: riquadri per stato, come su Noleggio ─── */}
      {(() => {
        const conta = (st: string) => righe.filter(r => r.status === st).length
        const totale = righe.length
        const pct = (n: number) => totale > 0 ? `${(n / totale * 100).toFixed(1).replace('.', ',')}% del totale` : '—'
        const cards: { key: string; label: string; value: number; sub: string; tone: string; iconBg: string; iconColor: string; ring: string; svg: React.ReactNode }[] = [
          { key: 'all', label: 'Tutti i Preventivi', value: totale, sub: 'Totale', tone: 'text-cyan-300', iconBg: 'bg-cyan-500/15', iconColor: 'text-cyan-300', ring: 'ring-cyan-500/30',
            svg: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/> },
          { key: 'bozza', label: 'Bozza', value: conta('bozza'), sub: pct(conta('bozza')), tone: 'text-slate-300', iconBg: 'bg-slate-500/15', iconColor: 'text-slate-300', ring: 'ring-slate-500/30',
            svg: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/> },
          { key: 'inviato', label: 'Inviati', value: conta('inviato'), sub: pct(conta('inviato')), tone: 'text-blue-300', iconBg: 'bg-blue-500/15', iconColor: 'text-blue-300', ring: 'ring-blue-500/30',
            svg: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/> },
          { key: 'accettato', label: 'Accettati', value: conta('accettato'), sub: pct(conta('accettato')), tone: 'text-emerald-300', iconBg: 'bg-emerald-500/15', iconColor: 'text-emerald-300', ring: 'ring-emerald-500/30',
            svg: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7"/> },
          { key: 'convertito', label: 'Convertiti', value: conta('convertito'), sub: pct(conta('convertito')), tone: 'text-emerald-300', iconBg: 'bg-emerald-500/15', iconColor: 'text-emerald-300', ring: 'ring-emerald-500/30',
            svg: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/> },
          { key: 'rifiutato', label: 'Rifiutati', value: conta('rifiutato'), sub: pct(conta('rifiutato')), tone: 'text-rose-300', iconBg: 'bg-rose-500/15', iconColor: 'text-rose-300', ring: 'ring-rose-500/30',
            svg: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 18L18 6M6 6l12 12"/> },
        ]
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-1.5">
            {cards.map(c => {
              const attivo = filtroStato === c.key
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => { setFiltroStato(c.key); setPagina(1) }}
                  className={`relative overflow-hidden text-left rounded-lg px-2.5 py-1.5 ring-1 transition-all bg-gradient-to-b from-theme-bg-secondary to-theme-bg-secondary/40 backdrop-blur-sm ${
                    attivo
                      ? `${c.ring} ring-2 shadow-[0_0_18px_-10px_rgba(34,211,238,0.4)]`
                      : `ring-theme-border ${c.ring.replace('/30', '/10')}`
                  }`}
                >
                  <div className={`absolute -top-4 -right-4 w-14 h-14 ${c.iconBg} rounded-full blur-2xl pointer-events-none opacity-50`}/>
                  <div className="relative flex items-center gap-2">
                    <div className={`grid w-6 h-6 place-items-center rounded-md ring-1 ${c.iconBg} ${c.iconColor} ${c.ring} shrink-0`}>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">{c.svg}</svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[9px] uppercase tracking-[0.12em] font-bold ${c.tone} truncate leading-none`}>{c.label}</p>
                      <p className="text-base font-bold text-theme-text-primary tabular-nums leading-tight">{c.value}</p>
                    </div>
                  </div>
                  <p className="text-[9px] text-theme-text-muted/80 font-mono truncate relative mt-0.5">{c.sub}</p>
                </button>
              )
            })}
          </div>
        )
      })()}

      {/* Filtri per stato + ricerca */}
      <div className="flex flex-wrap items-center gap-1.5">
        {['all', 'bozza', 'inviato', 'accettato', 'convertito', 'rifiutato'].map(st => {
          const n = st === 'all' ? righe.length : righe.filter(r => r.status === st).length
          const attivo = filtroStato === st
          return (
            <button
              key={st}
              onClick={() => { setFiltroStato(st); setPagina(1) }}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ring-1 ${
                attivo
                  ? 'bg-cyan-500/15 text-cyan-200 ring-cyan-500/40'
                  : 'bg-theme-bg-tertiary text-theme-text-muted ring-transparent hover:text-theme-text-primary hover:ring-theme-border'
              }`}
            >
              {st === 'all' ? 'Tutti' : STATUS_LABELS[st]} <span className="opacity-60 font-mono ml-1">({n})</span>
            </button>
          )
        })}
        <input
          className={`${INPUT_CLS} ml-auto w-full sm:w-64 py-1.5`}
          placeholder="Cerca cliente, telefono, targa, servizio"
          value={ricerca}
          onChange={e => { setRicerca(e.target.value); setPagina(1) }}
        />
      </div>

      {caricamento && <ScheletroTabella righe={6} colonne={6} />}
      {(() => {
        if (caricamento) return null
        const q = ricerca.trim().toLowerCase()
        const qCifre = q.replace(/\D/g, '')
        const filtrate = righe.filter(r => {
          if (filtroStato !== 'all' && r.status !== filtroStato) return false
          if (!q) return true
          const testo = [r.customer_name, r.asset_name, r.vehicle_name, r.vehicle_plate, r.notes].filter(Boolean).join(' ').toLowerCase()
          if (testo.includes(q)) return true
          return qCifre.length >= 3 && (r.customer_phone || '').replace(/\D/g, '').includes(qCifre)
        })
        if (filtrate.length === 0) {
          return !errore ? (
            <div className="rounded-2xl ring-1 ring-theme-border bg-theme-bg-secondary/40 px-4 py-10 text-center text-sm text-theme-text-muted">
              {righe.length === 0 ? 'Nessun preventivo.' : 'Nessun preventivo con questi filtri.'}
            </div>
          ) : null
        }
        const totPagine = Math.max(1, Math.ceil(filtrate.length / PER_PAGINA))
        const paginaSicura = Math.min(pagina, totPagine)
        const righePagina = filtrate.slice((paginaSicura - 1) * PER_PAGINA, paginaSicura * PER_PAGINA)

        /** Le stesse azioni di prima, raccolte nel menu Gestisci. */
        const sezioniGestisci = (p: RigaPreventivo): GestisciSection[] => {
          const aperto = p.status !== 'convertito'
          return [
            {
              title: 'Preventivo',
              actions: [
                { label: 'Modifica', onClick: () => apriModifica(p) },
                { label: p.whatsapp_sent_at ? 'Reinvia su WhatsApp' : 'Invia su WhatsApp', onClick: () => { setWaPer(p); setWaTel(p.customer_phone || '') } },
              ],
            },
            {
              title: 'Esito',
              actions: [
                // Accetta = crea l'appuntamento e manda la conferma al
                // cliente, come l'Accetta del Noleggio Terra.
                { label: 'Accetta e crea appuntamento', onClick: () => apriConversione(p), visible: aperto },
                { label: 'Rifiuta', onClick: () => cambiaStato(p, 'rifiutato'), visible: aperto && p.status !== 'rifiutato' },
              ],
            },
            {
              title: 'Archivio',
              actions: [
                { label: 'Elimina', onClick: () => elimina(p) },
              ],
            },
          ]
        }

        return (
          <>
            {/* Desktop: lista a griglia, stessa di Preventivi Noleggio */}
            <div className="hidden sm:block bg-theme-bg-secondary/40 rounded-2xl ring-1 ring-theme-border overflow-hidden">
              <div className={`grid ${COLONNE_LISTA} gap-2 px-4 py-3 border-b border-theme-border text-[10px] font-bold uppercase tracking-[0.14em] text-theme-text-muted`}>
                <span>Preventivo</span>
                <span>Cliente</span>
                <span>Appuntamento</span>
                <span>Durata</span>
                <span className="text-right">Totale</span>
                <span>Stato</span>
                <span className="text-right">Azioni</span>
              </div>
              <div className="divide-y divide-theme-border/50">
                {righePagina.map(p => {
                  const sb = badgeStato(p.status)
                  return (
                    <div key={p.id} className={`grid ${COLONNE_LISTA} gap-2 px-4 py-3 items-center transition-colors hover:bg-theme-bg-tertiary/30`}>
                      {/* Preventivo: servizi + veicolo + targa */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-14 h-10 shrink-0 rounded-md ring-1 ring-theme-border bg-gradient-to-br from-theme-bg-tertiary to-theme-bg-secondary grid place-items-center text-theme-text-muted">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13l1-3a4 4 0 014-3h8a4 4 0 014 3l1 3v5a1 1 0 01-1 1h-2a1 1 0 01-1-1v-1H7v1a1 1 0 01-1 1H4a1 1 0 01-1-1v-5z"/></svg>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-theme-text-primary truncate" title={p.asset_name || ''}>{p.asset_name || '—'}</div>
                          {(p.vehicle_name || p.vehicle_plate) && (
                            <div className="text-[10px] text-theme-text-muted truncate">
                              {p.vehicle_name || ''}{p.vehicle_plate ? <span className="font-mono">{p.vehicle_name ? ' · ' : ''}{p.vehicle_plate}</span> : null}
                            </div>
                          )}
                          {p.created_at && <div className="text-[9px] text-theme-text-muted/70 truncate">Creato {dataIt(p.created_at)}</div>}
                        </div>
                      </div>

                      {/* Cliente */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        {p.customer_name || p.customer_phone ? (
                          <>
                            <div className={`grid w-8 h-8 place-items-center rounded-full ring-1 text-[10px] font-bold shrink-0 ${coloreAvatar(p.customer_name || p.customer_phone || p.id)}`}>
                              {iniziali(p.customer_name || p.customer_phone)}
                            </div>
                            <div className="min-w-0">
                              <div className="text-[12px] font-semibold text-theme-text-primary truncate flex items-center gap-1.5">
                                {p.customer_name || '—'}
                                <ClientStatusBadge phone={p.customer_phone} />
                              </div>
                              {p.customer_phone && <div className="text-[10px] font-mono text-theme-text-muted truncate">{p.customer_phone}</div>}
                            </div>
                          </>
                        ) : (
                          <span className="text-[11px] text-theme-text-muted italic">Nessun cliente</span>
                        )}
                      </div>

                      {/* Appuntamento */}
                      <div className="text-[11px] text-theme-text-secondary leading-tight tabular-nums">
                        <div className="font-medium">{dataIt(p.start_date)}</div>
                        <div className="text-theme-text-muted">{p.start_time || ''}{p.start_time && p.end_time ? ` → ${p.end_time}` : ''}</div>
                      </div>

                      {/* Durata */}
                      <div className="text-[12px] font-mono text-theme-text-primary tabular-nums">{p.duration_minutes ? durataLeggibile(p.duration_minutes) : '—'}</div>

                      {/* Totale */}
                      <div className="text-right">
                        <div className="text-[13px] font-bold text-theme-text-primary tabular-nums">{eur(p.amount)}</div>
                        <div className="text-[9px] text-theme-text-muted">IVA inclusa</div>
                      </div>

                      {/* Stato */}
                      <div className="min-w-0">
                        <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ring-1 ${sb.bg}`}>
                          {STATUS_LABELS[p.status] || p.status}
                        </span>
                        {sb.sub && <div className={`text-[10px] mt-0.5 truncate ${sb.subColor}`}>{sb.sub}</div>}
                        {p.whatsapp_sent_at && <div className="text-[10px] text-emerald-400/80 truncate tabular-nums">Inviato {dataIt(p.whatsapp_sent_at)}</div>}
                      </div>

                      {/* Azioni */}
                      <div className="flex justify-end">
                        <GestisciMenu sections={sezioniGestisci(p)} size="sm" />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Mobile: card, come su Preventivi Noleggio */}
            <div className="sm:hidden space-y-2">
              {righePagina.map(p => {
                const sb = badgeStato(p.status)
                return (
                  <div key={p.id} className="bg-theme-bg-tertiary/60 rounded-2xl p-4 border border-theme-border/60">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold text-theme-text-primary truncate">{p.asset_name || '—'}</div>
                        {p.customer_name && (
                          <div className="text-[12px] text-theme-text-muted truncate flex items-center gap-1.5 flex-wrap">
                            <span className="truncate">{p.customer_name}{p.customer_phone ? ` · ${p.customer_phone}` : ''}</span>
                            <ClientStatusBadge phone={p.customer_phone} />
                          </div>
                        )}
                        {!p.customer_name && p.customer_phone && <div className="text-[12px] text-theme-text-muted">{p.customer_phone}</div>}
                      </div>
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ring-1 ${sb.bg}`}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-y-1 gap-x-3 text-[12px]">
                      <span className="text-theme-text-muted">Appuntamento</span>
                      <span className="text-theme-text-primary tabular-nums">
                        {dataIt(p.start_date)}{p.start_time ? ` · ${p.start_time}` : ''}
                        {p.duration_minutes ? <span className="text-theme-text-muted ml-1">· {durataLeggibile(p.duration_minutes)}</span> : null}
                      </span>
                      {(p.vehicle_name || p.vehicle_plate) && (<>
                        <span className="text-theme-text-muted">Veicolo</span>
                        <span className="text-theme-text-primary truncate">{[p.vehicle_name, p.vehicle_plate].filter(Boolean).join(' · ')}</span>
                      </>)}
                      <span className="text-theme-text-muted">Totale</span>
                      <span className="text-dr7-gold font-semibold tabular-nums">{eur(p.amount)}</span>
                    </div>
                    <div className="flex justify-end mt-3 pt-3 border-t border-theme-border/40">
                      <GestisciMenu sections={sezioniGestisci(p)} size="md" />
                    </div>
                  </div>
                )
              })}
            </div>

            {totPagine > 1 && (
              <div className="flex items-center justify-between gap-3 text-[12px] text-theme-text-muted">
                <span className="tabular-nums">{filtrate.length} preventivi · pagina {paginaSicura} di {totPagine}</span>
                <div className="flex gap-1.5">
                  <button type="button" disabled={paginaSicura <= 1} onClick={() => setPagina(paginaSicura - 1)}
                    className="px-3 py-1.5 rounded-lg ring-1 ring-theme-border bg-theme-bg-tertiary text-theme-text-primary disabled:opacity-40">Precedente</button>
                  <button type="button" disabled={paginaSicura >= totPagine} onClick={() => setPagina(paginaSicura + 1)}
                    className="px-3 py-1.5 rounded-lg ring-1 ring-theme-border bg-theme-bg-tertiary text-theme-text-primary disabled:opacity-40">Successiva</button>
                </div>
              </div>
            )}
          </>
        )
      })()}

      {/* --- Invio WhatsApp: si conferma il numero, il testo arriva dal
             template Pro. Stesso passaggio del preventivo Noleggio Terra. --- */}
      {waPer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !waInvio && setWaPer(null)}>
          <div className="w-full max-w-md rounded-xl border border-theme-border bg-theme-bg-secondary p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-theme-text-primary">Invia preventivo via WhatsApp</h3>
            <p className="text-sm text-theme-text-secondary">
              {waPer.customer_name || 'Cliente'} — {waPer.asset_name || 'Lavaggio'} — {eur(waPer.amount)}
              {waPer.start_date ? ` — ${dataIt(waPer.start_date)}${waPer.start_time ? ` alle ${waPer.start_time}` : ''}` : ''}
            </p>
            <TelefonoConPrefisso className={`flex-1 min-w-0 ${INPUT_CLS}`} selectClassName={`w-[104px] shrink-0 ${INPUT_CLS}`}
              mostraAnteprima={false} placeholder="Numero WhatsApp" value={waTel} onChange={setWaTel} />
            <p className="text-xs text-theme-text-muted">
              Il testo e' quello del template "Preventivo Lavaggio" in Messaggi di Sistema Pro.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setWaPer(null)} disabled={waInvio} className={BTN_GHOST}>Annulla</button>
              <button onClick={inviaWhatsapp} disabled={waInvio} className={BTN_PRIMARY}>{waInvio ? 'Invio…' : 'Invia'}</button>
            </div>
          </div>
        </div>
      )}

      {seatPer && (
        <SeatPlanPicker
          serviceName={seatPer.name}
          unitPrice={prezzoDi(seatPer, form.scelte[seatPer.id]?.option || seatPer.price_options?.[0]?.label || '')}
          initialSeats={form.scelte[seatPer.id]?.seats || []}
          onClose={() => setSeatPer(null)}
          onConfirm={seats => {
            const s = seatPer
            setForm(f => {
              const scelte = { ...f.scelte }
              const pulite = normalizeSeats(seats)
              if (pulite.length === 0) delete scelte[s.id]
              else scelte[s.id] = { option: f.scelte[s.id]?.option ?? (s.price_options?.[0]?.label || ''), qty: pulite.length, seats: pulite }
              return { ...f, scelte, amount_manuale: false }
            })
            setSeatPer(null)
          }}
        />
      )}

      {/* --- Conversione in appuntamento: metodo, stato e acconto prima di
             creare la prenotazione, come l'Accetta del Noleggio Terra. --- */}
      {convPer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !convInvio && setConvPer(null)}>
          <div className="w-full max-w-lg rounded-xl border border-theme-border bg-theme-bg-secondary p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-theme-text-primary">Converti in appuntamento</h3>
            <p className="text-sm text-theme-text-secondary">
              {convPer.customer_name || 'Cliente'} — {convPer.asset_name || 'Lavaggio'}
              {convPer.duration_minutes ? ` — ${durataLeggibile(convPer.duration_minutes)}` : ''} — {eur(convPer.amount)}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-theme-text-muted space-y-1">
                <span className="block">Data</span>
                <EuropeanDateInput className={INPUT_CLS} value={convData} onChange={(v: string) => setConvData(v)} />
              </label>
              <label className="text-xs text-theme-text-muted space-y-1">
                <span className="block">Ora</span>
                <select className={INPUT_CLS} value={convOra} onChange={e => setConvOra(e.target.value)}>
                  {generateAllDayLavaggioSlots().concat(convOra && !generateAllDayLavaggioSlots().includes(convOra) ? [convOra] : []).map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-theme-text-muted space-y-1">
                <span className="block">Metodo di pagamento</span>
                <select className={INPUT_CLS} value={convMetodo} onChange={e => setConvMetodo(e.target.value)}>
                  {metodiPagamento.map(m => <option key={m.label} value={m.label}>{m.label}</option>)}
                </select>
              </label>
              <label className="text-xs text-theme-text-muted space-y-1">
                <span className="block">Stato pagamento</span>
                <select className={INPUT_CLS} value={convStato} onChange={e => setConvStato(e.target.value as 'pending' | 'paid')}>
                  <option value="pending">Da Saldare</option>
                  <option value="paid">Pagato</option>
                </select>
              </label>
              {convStato === 'pending' && (
                <label className="text-xs text-theme-text-muted space-y-1">
                  <span className="block">Acconto gia' incassato (€)</span>
                  <MoneyInput className={INPUT_CLS} value={convAcconto} onChange={setConvAcconto} />
                </label>
              )}
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-dr7-gold" checked={convConferma || convStato === 'paid'}
                disabled={convStato === 'paid'} onChange={e => setConvConferma(e.target.checked)} />
              <span className="text-sm text-theme-text-primary">Conferma prenotazione</span>
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConvPer(null)} disabled={convInvio} className={BTN_GHOST}>Annulla</button>
              <button onClick={confermaConversione} disabled={convInvio} className={BTN_PRIMARY}>
                {convInvio ? 'Creazione…' : 'Crea appuntamento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
