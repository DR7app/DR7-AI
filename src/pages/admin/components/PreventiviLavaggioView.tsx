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
import { INPUT_CLS, eur, eurToCents, centsToEur, toRomeIso, missingTableHint, BTN_PRIMARY, BTN_GHOST } from './noleggioFormBits'
import { Header, Badge, ErrorBox, EmptyBox } from './noleggioUiBits'
import {
  generateAllDayLavaggioSlots,
  isInLavaggioHours,
  isSlotBlocked,
  getSlotBlock,
} from '../../../utils/lavaggioHours'

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
}

const STATI = ['bozza', 'inviato', 'accettato', 'rifiutato']

const VUOTO = {
  customer_name: '',
  customer_phone: '',
  vehicle_name: '',
  vehicle_plate: '',
  main_tab: 'lavaggio' as 'lavaggio' | 'meccanica',
  service_id: '',
  option_label: '',
  extra_ids: [] as string[],
  extra_options: {} as Record<string, string>,
  extra_qty: {} as Record<string, number>,
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
    const completo = `${base}, vehicle_name, vehicle_plate, carwash_servizi`
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
  const principaliPerCategoria = useMemo(() => {
    const principali = serviziScheda.filter(s => s.category !== 'extra')
    const gruppi: Record<string, ServizioLavaggio[]> = {}
    for (const s of principali) (gruppi[s.category] ||= []).push(s)
    return ORDINE_CATEGORIE
      .filter(c => gruppi[c]?.length)
      .map(c => ({ categoria: c, servizi: gruppi[c] }))
      .concat(
        Object.keys(gruppi)
          .filter(c => !ORDINE_CATEGORIE.includes(c))
          .map(c => ({ categoria: c, servizi: gruppi[c] })),
      )
  }, [serviziScheda])
  const extraDisponibili = useMemo(
    () => serviziScheda.filter(s => s.category === 'extra'),
    [serviziScheda],
  )
  const servizioScelto = useMemo(
    () => servizi.find(s => s.id === form.service_id) || null,
    [servizi, form.service_id],
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
    const voci: VoceCarrello[] = []
    if (servizioScelto) {
      const prezzo = prezzoDi(servizioScelto, form.option_label)
      voci.push({
        serviceId: servizioScelto.id,
        serviceName: servizioScelto.name,
        quantity: 1,
        price: prezzo,
        option: form.option_label || null,
        subtotal: prezzo,
        durationMinutes: durataInMinuti(servizioScelto.duration),
        principale: true,
      })
    }
    for (const id of form.extra_ids) {
      const e = servizi.find(s => s.id === id)
      if (!e) continue
      const qty = Math.max(1, form.extra_qty[id] || 1)
      const prezzo = prezzoDi(e, form.extra_options[id] || '')
      voci.push({
        serviceId: e.id,
        serviceName: e.name,
        quantity: qty,
        price: prezzo,
        option: form.extra_options[id] || null,
        subtotal: prezzo * qty,
        durationMinutes: durataInMinuti(e.duration) * qty,
      })
    }
    return voci
  }, [servizioScelto, servizi, form.option_label, form.extra_ids, form.extra_options, form.extra_qty, prezzoDi])

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
    setForm({ ...VUOTO, extra_ids: [], extra_options: {}, extra_qty: {} })
    setMostraForm(true)
  }

  function apriModifica(p: RigaPreventivo) {
    const dett = p.carwash_servizi || null
    const items = dett?.items || []
    const principale = items.find(i => i.principale) || items[0] || null
    const extra = items.filter(i => i !== principale)
    const servizioDb = principale ? servizi.find(s => s.id === principale.serviceId) : null
    setModificaId(p.id)
    setForm({
      customer_name: p.customer_name || '',
      customer_phone: p.customer_phone || '',
      vehicle_name: p.vehicle_name || '',
      vehicle_plate: p.vehicle_plate || '',
      main_tab: (servizioDb?.main_tab === 'meccanica' ? 'meccanica' : 'lavaggio'),
      service_id: principale?.serviceId || '',
      option_label: principale?.option || '',
      extra_ids: extra.map(e => e.serviceId),
      extra_options: Object.fromEntries(extra.filter(e => e.option).map(e => [e.serviceId, e.option as string])),
      extra_qty: Object.fromEntries(extra.map(e => [e.serviceId, e.quantity || 1])),
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
    if (!form.service_id && carrello.length === 0) { toast.error('Scegli almeno un servizio dal catalogo'); return }
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

  /**
   * Converti in prenotazione lavaggio. La riga nasce con gli stessi campi del
   * form Prenotazioni (appointment_date/time, cartItems, durata, targa): cosi'
   * compare nella sua tab e nel calendario, e si puo' incassare da li'.
   */
  async function converti(p: RigaPreventivo) {
    if (p.status === 'convertito') { toast('Preventivo gia\' convertito'); return }
    if (!p.start_date) { toast.error('Manca la data dell\'appuntamento: apri Modifica e indicala.'); return }
    if (!window.confirm(`Convertire il preventivo di ${p.customer_name || 'questo cliente'} in prenotazione (Da Saldare)?`)) return
    const ora = p.start_time || '09:00'
    const inizio = toRomeIso(p.start_date.substring(0, 10), ora)
    const dett = p.carwash_servizi || null
    const items = dett?.items || []
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
      appointment_time: ora,
      pickup_date: inizio,
      dropoff_date: inizio,
      pickup_location: 'DR7 - Car Wash',
      dropoff_location: 'DR7 - Car Wash',
      price_total: p.amount || 0,
      currency: 'EUR',
      status: 'confirmed',
      payment_status: 'pending', // Da Saldare, come una nuova prenotazione
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
        })),
        totalDuration: p.duration_minutes || items.reduce((t, i) => t + (i.durationMinutes || 0), 0),
        ...(dett?.prime_flex ? { prime_flex: true, prime_flex_price: dett.prime_flex_price || 0 } : {}),
        ...(p.vehicle_name ? { vehicleMakeModel: p.vehicle_name } : {}),
        ...(p.notes ? { notes: p.notes } : {}),
      },
      created_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('bookings').insert(payload).select('id').single()
    if (error) { toast.error('Conversione fallita: ' + error.message); return }
    await supabase.from('noleggio_preventivi')
      .update({ status: 'convertito', updated_at: new Date().toISOString() }).eq('id', p.id)
    setRighe(rs => rs.map(r => r.id === p.id ? { ...r, status: 'convertito' } : r))
    toast.success('Convertito in prenotazione (Da Saldare) — vai in Prenotazioni per incassare')
  }

  function linkWhatsapp(p: RigaPreventivo): string {
    const tel = (p.customer_phone || '').replace(/\D/g, '')
    const quando = p.start_date ? ` del ${dataIt(p.start_date)}${p.start_time ? ` alle ${p.start_time}` : ''}` : ''
    const mezzo = [p.vehicle_name, p.vehicle_plate].filter(Boolean).join(' ')
    const msg = `Ciao ${p.customer_name || ''}, ecco il preventivo Lavaggio & Meccanica${quando}: ${p.asset_name || 'Lavaggio'}${mezzo ? ` — ${mezzo}` : ''} — ${eur(p.amount)}.`
    return `https://wa.me/${tel}?text=${encodeURIComponent(msg)}`
  }

  /* ------------------------------- render -------------------------------- */

  return (
    <div className="space-y-4">
      <Header
        title="Lavaggio & Meccanica — Preventivi"
        action={<button onClick={apriNuovo} className={BTN_PRIMARY}>+ Nuovo preventivo</button>}
      />
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

          {/* --- Servizi dal catalogo vero --- */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-xs uppercase tracking-wide text-theme-text-muted">Servizio</h3>
              <div className="flex gap-1 p-1 rounded-full bg-theme-bg-tertiary border border-theme-border">
                {(['lavaggio', 'meccanica'] as const).map(t => (
                  <button key={t} type="button"
                    onClick={() => setForm(f => ({ ...f, main_tab: t, service_id: '', option_label: '', extra_ids: [], extra_options: {}, extra_qty: {} }))}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${form.main_tab === t ? 'bg-dr7-gold text-white' : 'text-theme-text-secondary hover:text-theme-text-primary'}`}>
                    {t === 'lavaggio' ? 'Lavaggio' : 'Meccanica'}
                  </button>
                ))}
              </div>
            </div>

            {principaliPerCategoria.length === 0 && (
              <p className="text-sm text-theme-text-muted">Nessun servizio attivo in questa scheda del catalogo.</p>
            )}
            {principaliPerCategoria.map(g => (
              <div key={g.categoria} className="space-y-1">
                <p className="text-[11px] uppercase tracking-wide text-theme-text-muted">{CATEGORY_LABELS[g.categoria] || g.categoria}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {g.servizi.map(s => {
                    const scelto = form.service_id === s.id
                    return (
                      <button key={s.id} type="button"
                        onClick={() => setForm(f => ({
                          ...f,
                          service_id: scelto ? '' : s.id,
                          option_label: scelto ? '' : (s.price_options?.[0]?.label || ''),
                          amount_manuale: false,
                        }))}
                        className={`text-left px-3 py-2 rounded-lg border transition-colors ${scelto ? 'border-dr7-gold bg-dr7-gold/10' : 'border-theme-border bg-theme-bg-tertiary hover:bg-theme-bg-hover'}`}>
                        <span className="block text-sm text-theme-text-primary">{s.name}</span>
                        <span className="block text-xs text-theme-text-muted tabular-nums">
                          {etichettaPrezzo(s)}
                          {s.duration ? ` · ${s.duration}` : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            {servizioScelto?.price_unit === 'custom' && (
              <p className="text-xs text-amber-400">
                Servizio a preventivo: il listino non ha un prezzo: scrivi tu l'importo qui sotto.
              </p>
            )}
            {servizioScelto && (servizioScelto.price_options?.length || 0) > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <select className={INPUT_CLS} value={form.option_label}
                  onChange={e => setForm(f => ({ ...f, option_label: e.target.value, amount_manuale: false }))}>
                  {(servizioScelto.price_options || []).map(o => (
                    <option key={o.label} value={o.label}>{o.label} — €{Number(o.price).toFixed(2)}</option>
                  ))}
                </select>
              </div>
            )}
          </section>

          {/* --- Extra --- */}
          {extraDisponibili.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs uppercase tracking-wide text-theme-text-muted">Extra</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {extraDisponibili.map(e => {
                  const attivo = form.extra_ids.includes(e.id)
                  return (
                    <div key={e.id} className={`px-3 py-2 rounded-lg border ${attivo ? 'border-dr7-gold bg-dr7-gold/10' : 'border-theme-border bg-theme-bg-tertiary'}`}>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox" className="mt-1 w-4 h-4 accent-dr7-gold" checked={attivo}
                          onChange={() => setForm(f => {
                            const dentro = f.extra_ids.includes(e.id)
                            return {
                              ...f,
                              amount_manuale: false,
                              extra_ids: dentro ? f.extra_ids.filter(x => x !== e.id) : [...f.extra_ids, e.id],
                              extra_options: dentro ? f.extra_options : { ...f.extra_options, [e.id]: e.price_options?.[0]?.label || '' },
                              extra_qty: dentro ? f.extra_qty : { ...f.extra_qty, [e.id]: 1 },
                            }
                          })} />
                        <span className="min-w-0">
                          <span className="block text-sm text-theme-text-primary">{e.name}</span>
                          <span className="block text-xs text-theme-text-muted tabular-nums">
                            {etichettaPrezzo(e)}
                            {e.duration ? ` · ${e.duration}` : ''}
                          </span>
                        </span>
                      </label>
                      {attivo && (
                        <div className="flex items-center gap-2 pt-2">
                          {(e.price_options?.length || 0) > 0 && (
                            <select className={`${INPUT_CLS} py-1`} value={form.extra_options[e.id] || ''}
                              onChange={ev => setForm(f => ({ ...f, amount_manuale: false, extra_options: { ...f.extra_options, [e.id]: ev.target.value } }))}>
                              {(e.price_options || []).map(o => (
                                <option key={o.label} value={o.label}>{o.label} — €{Number(o.price).toFixed(2)}</option>
                              ))}
                            </select>
                          )}
                          <input className={`${INPUT_CLS} py-1 w-20`} inputMode="numeric" value={String(form.extra_qty[e.id] || 1)}
                            onChange={ev => {
                              const q = Math.max(1, parseInt(ev.target.value.replace(/\D/g, '') || '1', 10))
                              setForm(f => ({ ...f, amount_manuale: false, extra_qty: { ...f.extra_qty, [e.id]: q } }))
                            }} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
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
              <input className={INPUT_CLS} placeholder="Importo (€)" inputMode="decimal" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value, amount_manuale: true }))} />
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

      {caricamento && <ScheletroTabella righe={6} colonne={6} />}
      {!caricamento && righe.length === 0 && !errore && <EmptyBox msg="Nessun preventivo." />}
      {righe.length > 0 && (
        <div className="overflow-x-auto border border-theme-border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-theme-bg-tertiary text-theme-text-secondary">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Cliente</th>
                <th className="text-left px-3 py-2 font-medium">Servizio</th>
                <th className="text-left px-3 py-2 font-medium">Veicolo</th>
                <th className="text-left px-3 py-2 font-medium">Appuntamento</th>
                <th className="text-left px-3 py-2 font-medium">Stato</th>
                <th className="text-right px-3 py-2 font-medium">Importo</th>
                <th className="text-right px-3 py-2 font-medium">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {righe.map(p => (
                <tr key={p.id} className="border-t border-theme-border hover:bg-theme-bg-hover align-top">
                  <td className="px-3 py-2 text-theme-text-primary">{p.customer_name || '—'}</td>
                  <td className="px-3 py-2 text-theme-text-secondary">
                    {p.asset_name || '—'}
                    {p.duration_minutes ? <span className="block text-xs text-theme-text-muted">{durataLeggibile(p.duration_minutes)}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-theme-text-secondary">
                    {p.vehicle_name || '—'}
                    {p.vehicle_plate ? <span className="block text-xs font-mono text-theme-text-muted">{p.vehicle_plate}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-theme-text-secondary tabular-nums">
                    {dataIt(p.start_date)}{p.start_time ? ` · ${p.start_time}` : ''}
                  </td>
                  <td className="px-3 py-2"><Badge value={p.status} /></td>
                  <td className="px-3 py-2 text-right text-theme-text-primary tabular-nums">{eur(p.amount)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {p.status !== 'convertito' && (
                      <button onClick={() => converti(p)} className="text-dr7-gold hover:underline font-semibold mr-3">Converti</button>
                    )}
                    {p.status !== 'accettato' && p.status !== 'convertito' && (
                      <button onClick={() => cambiaStato(p, 'accettato')} className="text-emerald-400 hover:underline mr-3">Accetta</button>
                    )}
                    {p.status !== 'rifiutato' && p.status !== 'convertito' && (
                      <button onClick={() => cambiaStato(p, 'rifiutato')} className="text-amber-400 hover:underline mr-3">Rifiuta</button>
                    )}
                    {p.customer_phone && (
                      <a href={linkWhatsapp(p)} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline mr-3">WhatsApp</a>
                    )}
                    <button onClick={() => apriModifica(p)} className="text-theme-text-secondary hover:underline mr-3">Modifica</button>
                    <button onClick={() => elimina(p)} className="text-red-400 hover:underline">Elimina</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
