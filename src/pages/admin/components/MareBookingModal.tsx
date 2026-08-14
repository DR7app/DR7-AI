// MareBookingModal — modale "Nuova prenotazione" del Noleggio Mare, allineata a
// quella del Noleggio Terra (ReservationsTab): stesso flusso cliente → barca →
// date/orari → opzioni → riepilogo → pagamento.
//
// Fuori scope per una barca (richiesta direzione):
//   - Km & Sforo: una barca non fa chilometri;
//   - Assicurazioni/Kasko: non si vendono sul noleggio mare.
//
// Ogni sezione OPZIONALE si accende/spegne dagli Interruttori ON/OFF
// (centralina_pro_config, riga `business_mare`, chiave `booking_form_off`)
// oppure spegnendo la sezione corrispondente in Centralina Pro (`sezioni_off`,
// es. Cauzioni -> blocco Cauzione): vedi mareFormSectionsOff().
// Spegnere una sezione la nasconde dal form senza cancellare nulla: i dati già
// salvati su prenotazioni esistenti restano in booking_details.
//
// Il flusso Tour a posti (partenze + mappa posti) NON passa di qui: vive nella
// sotto-tab "Tour".
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import { logAdminAction } from '../../../utils/logAdminAction'
import { usePaymentMethods } from '../../../hooks/usePaymentMethods'
import CustomerAutocomplete from './CustomerAutocomplete'
import NewClientModal from './NewClientModal'
import EuropeanDateInput from '../../../components/EuropeanDateInput'
import AddressAutocomplete from './AddressAutocomplete'
import { useSingleFlight } from '../../../hooks/useSingleFlight'
import TimeSelect from './TimeSelect'
import { mareFormSectionsOff } from './mareFormSections'
import {
  INPUT_CLS, rentalDaysBetween, addDaysYmd, toRomeIso,
  eurToCents, centsToEur, eur,
} from './noleggioFormBits'

/* ────────────────────────────────── Tipi ────────────────────────────────── */
export interface MareAsset {
  id: string
  name: string
  capacity: number | null
  price_per_day: number // centesimi
  is_active: boolean
}

export interface MareBookingRow {
  id: string
  customer_name: string | null
  customer_phone: string | null
  vehicle_name: string | null
  status: string | null
  payment_status: string | null
  payment_method: string | null
  pickup_date: string | null
  dropoff_date: string | null
  price_total: number | null
  amount_paid?: number | null
  user_id?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking_details: Record<string, any> | null
}

interface Passenger { name: string; phone: string }
interface Guarantor {
  nome_cognome: string; codice_fiscale: string; telefono: string; email: string
  indirizzo: string; citta: string; provincia: string; data_nascita: string
}
interface ServiceDef { id: string; name: string; price: number; unit: string; is_active?: boolean }

interface CustomerLite { id: string; full_name: string; email: string | null; phone: string | null; user_id?: string | null }

const PAY_STATUS_OPTIONS = [
  { value: 'pending', label: 'Da Saldare' },
  { value: 'partial', label: 'Parziale' },
  { value: 'paid', label: 'Pagato' },
]
const CAUZIONE_STATI = [
  { value: 'da_incassare', label: 'Da incassare' },
  { value: 'incassata', label: 'Incassata' },
  { value: 'no_cauzione', label: 'Nessuna cauzione' },
]
const PATENTE_NAUTICA_TIPI = ['Entro 12 miglia', 'Oltre 12 miglia', 'Senza limiti dalla costa']
const LUOGHI = ['Sede DR7 — Viale Marconi 229, Cagliari', 'Porto / Marina (indica indirizzo)', 'Consegna a domicilio (indica indirizzo)']
/** true per le voci che chiedono un indirizzo scritto (porto, domicilio). */
const richiedeIndirizzo = (luogo: string) => /indica indirizzo/i.test(luogo)
/** Toglie il suggerimento "(indica indirizzo)" quando il luogo finisce in pickup_location. */
const luogoPulito = (luogo: string) => luogo.replace(/\s*\(indica indirizzo\)/i, '').trim()
/** "Porto / Marina — Via X, Cagliari" se serve un indirizzo ed e' stato scritto. */
const componiLuogo = (luogo: string, indirizzo: string) => {
    const ind = (indirizzo || '').trim()
    return richiedeIndirizzo(luogo) && ind ? `${luogoPulito(luogo)} — ${ind}` : luogo
}
const isNexiPbl = (method: string) => /nexi/i.test(method)
// Unità servizio come in Centralina Pro > Servizi.
const UNIT_LABEL: Record<string, string> = {
  per_day: 'al giorno', per_hour: 'all’ora', per_item: 'cad.', flat: 'una tantum', per_km: 'al km',
}

const EMPTY_GUARANTOR: Guarantor = {
  nome_cognome: '', codice_fiscale: '', telefono: '', email: '',
  indirizzo: '', citta: '', provincia: '', data_nascita: '',
}

/* ──────────────────────────── Blocco sezione UI ──────────────────────────── */
function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-theme-border bg-theme-bg-primary/40 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h4 className="text-sm font-semibold text-dr7-gold uppercase tracking-wider">{title}</h4>
        {right}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-theme-text-muted">{label}</label>
      {children}
    </div>
  )
}

/* ─────────────────────────────── Componente ─────────────────────────────── */
interface Props {
  assets: MareAsset[]
  booking: MareBookingRow | null   // null = nuova
  assetPreset?: string             // nome barca pre-selezionata (dal calendario)
  datePreset?: { pickup: string; dropoff: string }
  onClose: () => void
  onSaved: () => void
}

export default function MareBookingModal({ assets, booking, assetPreset, datePreset, onClose, onSaved }: Props) {
  // Metodi di pagamento del business Mare (riga `business_mare`), con
  // fallback su `main`: prima si leggeva sempre Terra, quindi i metodi
  // configurati sul Mare venivano salvati e mai mostrati (roadmap #16).
  const paymentMethods = usePaymentMethods('boat_rental')
  const isEdit = !!booking

  /* ── Sezioni attive (Interruttori ON/OFF) ── */
  const [sectionsOff, setSectionsOff] = useState<Set<string>>(new Set())
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('centralina_pro_config').select('config').eq('id', 'business_mare').maybeSingle()
      if (cancelled) return
      setSectionsOff(mareFormSectionsOff(data?.config as Record<string, unknown> | null))
    })()
    return () => { cancelled = true }
  }, [])
  const on = (id: string) => !sectionsOff.has(id)

  /* ── Servizi extra dal catalogo Centralina Pro (riga mare, fallback main) ── */
  const [serviceDefs, setServiceDefs] = useState<ServiceDef[]>([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('centralina_pro_config').select('id, config').in('id', ['business_mare', 'main'])
      if (cancelled) return
      const rows = (data || []) as { id: string; config: Record<string, unknown> }[]
      // 2026-08-09 (roadmap #13): la Centralina Pro salva l'intero blocco
      // Servizi sotto la chiave `servizi` (CentralinaProTab.savePersisted),
      // quindi il percorso reale e' config.servizi.experience. Qui si leggeva
      // config.experience (top-level): chiave che non esiste ne' su
      // business_mare ne' su main -> lista SEMPRE vuota -> la sezione mostrava
      // "Nessun servizio configurato in Centralina Pro > Servizi" anche quando
      // i servizi erano configurati. E' il motivo per cui i servizi experience
      // per le barche "non c'erano". Il vecchio percorso resta come fallback
      // per eventuali righe legacy.
      const readExperience = (cfg: Record<string, unknown> | undefined): ServiceDef[] => {
        const servizi = (cfg || {}).servizi as { experience?: unknown } | undefined
        if (Array.isArray(servizi?.experience)) return servizi.experience as ServiceDef[]
        const legacy = (cfg || {}).experience
        return Array.isArray(legacy) ? (legacy as ServiceDef[]) : []
      }
      // Preferenza alla riga del business Mare; si ripiega su `main` solo se
      // il Mare non ha una lista propria (stessa semantica di prima).
      const fromMare = readExperience(rows.find(r => r.id === 'business_mare')?.config)
      const list = fromMare.length ? fromMare : readExperience(rows.find(r => r.id === 'main')?.config)
      setServiceDefs(list.filter(s => s && s.is_active !== false))
    })()
    return () => { cancelled = true }
  }, [])

  /* ── Clienti (per l'autocomplete) ── */
  const [customers, setCustomers] = useState<CustomerLite[]>([])
  const [showNewClient, setShowNewClient] = useState(false)
  const loadCustomers = async (selectId?: string) => {
    try {
      const res = await fetch('/.netlify/functions/list-customers')
      const json = await res.json()
      const rows = (json?.customers || []) as Record<string, unknown>[]
      const list: CustomerLite[] = rows.map((c, i) => {
        const g = (k: string) => (c[k] == null ? '' : String(c[k])).trim()
        return {
          id: g('id') || `c-${i}`,
          full_name: g('full_name') || `${g('nome')} ${g('cognome')}`.trim() || g('denominazione') || g('ente_o_ufficio'),
          email: g('email') || null,
          phone: g('telefono') || g('phone') || null,
          user_id: g('user_id') || null,
        }
      }).filter(c => c.full_name || c.email || c.phone)
      setCustomers(list)
      if (selectId) {
        const found = list.find(c => c.id === selectId)
        if (found) pickCustomer(found)
      }
    } catch { /* la modale resta usabile a mano */ }
  }
  useEffect(() => { loadCustomers() }, [])

  /* ── Stato form ── */
  const todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
  const [customerId, setCustomerId] = useState('')
  // Patente nautica del cliente presa dall'anagrafica: serve solo a mostrare
  // "senza skipper", dove conduce lui e la patente non si ridigita qui.
  const [clienteNautica, setClienteNautica] = useState<{ numero: string; categoria: string; limite: string; abilitazione: string; scadenza: string } | null>(null)
  useEffect(() => {
    let annullato = false
    if (!customerId) { setClienteNautica(null); return }
    ;(async () => {
      const { data } = await supabase
        .from('customers_extended')
        .select('numero_patente_nautica, categoria_patente_nautica, limite_patente_nautica, abilitazione_patente_nautica, scadenza_patente_nautica')
        .eq('id', customerId)
        .maybeSingle()
      if (annullato) return
      const r = data as Record<string, string | null> | null
      // Senza numero non c'e' patente da mostrare: il resto sarebbe rumore.
      setClienteNautica(r?.numero_patente_nautica ? {
        numero: r.numero_patente_nautica || '',
        categoria: r.categoria_patente_nautica || '',
        limite: r.limite_patente_nautica || '',
        abilitazione: r.abilitazione_patente_nautica || '',
        scadenza: (r.scadenza_patente_nautica || '').slice(0, 10),
      } : null)
    })()
    return () => { annullato = true }
  }, [customerId])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')

  const [assetName, setAssetName] = useState('')
  const [pickupDate, setPickupDate] = useState(todayYmd)
  const [pickupTime, setPickupTime] = useState('09:00')
  const [dropoffDate, setDropoffDate] = useState(addDaysYmd(todayYmd, 1))
  const [dropoffTime, setDropoffTime] = useState('18:00')

  const [luogoRitiro, setLuogoRitiro] = useState(LUOGHI[0])
  const [luogoRiconsegna, setLuogoRiconsegna] = useState(LUOGHI[0])
  const [indirizzoConsegna, setIndirizzoConsegna] = useState('')
  // Indirizzo di riconsegna separato: la barca non torna sempre dove e'
  // partita. Vuoto = stesso indirizzo del ritiro (riconsegna automatica).
  const [indirizzoRiconsegna, setIndirizzoRiconsegna] = useState('')
  const [costoConsegna, setCostoConsegna] = useState('')
  const [costoRitiro, setCostoRitiro] = useState('')

  const [conSkipper, setConSkipper] = useState(true)
  const [patente, setPatente] = useState({ tipo: '', numero: '', emessa_da: '', rilascio: '', scadenza: '' })
  const [passengers, setPassengers] = useState<Passenger[]>([])
  const [secondo, setSecondo] = useState({ nome: '', cognome: '', telefono: '', email: '', codice_fiscale: '', patente_numero: '', patente_scadenza: '' })
  const [guarantors, setGuarantors] = useState<Guarantor[]>([])
  const [cauzione, setCauzione] = useState({ importo: '', stato: 'da_incassare' })
  const [servizi, setServizi] = useState<Record<string, number>>({}) // serviceId → qty
  const [sconto, setSconto] = useState('')

  const [payStatus, setPayStatus] = useState('pending')
  const [payMethod, setPayMethod] = useState('')
  const [amountPaid, setAmountPaid] = useState('')
  const [priceFinal, setPriceFinal] = useState('')
  // Una volta che l'admin scrive il prezzo a mano, il totale NON si ricalcola
  // più da solo (stessa convenzione del resto del gestionale). È uno state e
  // non una ref perché la nota sotto al campo dipende da questo valore.
  const [priceEdited, setPriceEdited] = useState(false)
  // Il flag serve DENTRO un altro useEffect che gira nello stesso commit:
  // `setPriceEdited(true)` non aggiorna la variabile in quel giro, l'effetto
  // del calcolo automatico legge ancora `false` e sovrascrive il prezzo.
  // Il ref cambia subito, quindi il guardiano funziona a prescindere
  // dall'ordine con cui React esegue gli effetti.
  const priceEditedRef = useRef(false)
  const bloccaPrezzo = () => { priceEditedRef.current = true; setPriceEdited(true) }

  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  // Doppio click = due prenotazioni. `disabled={saving}` non basta: lo stato
  // React si aggiorna al rendere successivo, il secondo click entra in save()
  // con la closure vecchia e fa un secondo INSERT. L'insert va dritto a
  // Supabase, quindi nemmeno il dedupe globale su fetch (sendDedupe) lo copre.
  // useSingleFlight alza un lock con useRef, che e' sincrono.
  const [saveOnce, savingOnce] = useSingleFlight(save)
  const [formError, setFormError] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origDetails = useRef<Record<string, any>>({})

  function pickCustomer(c: CustomerLite) {
    setCustomerId(c.id)
    setCustomerName(c.full_name)
    setCustomerPhone(c.phone || '')
    setCustomerEmail(c.email || '')
  }

  /* ── Precompilazione: nuova (con preset) o modifica ── */
  useEffect(() => {
    if (assetPreset) setAssetName(assetPreset)
    else if (!booking) setAssetName(a => a || assets[0]?.name || '')
    if (datePreset && !booking) {
      setPickupDate(datePreset.pickup)
      setDropoffDate(datePreset.dropoff)
    }
    if (!booking) return
    bloccaPrezzo() // in modifica NON si sovrascrive il prezzo salvato
    const b = booking
    const d = (b.booking_details || {}) as Record<string, unknown>
    origDetails.current = { ...d }
    const pk = b.pickup_date ? new Date(b.pickup_date) : null
    const dr = b.dropoff_date ? new Date(b.dropoff_date) : null
    const ymd = (x: Date | null) => x ? x.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }) : ''
    const hm = (x: Date | null) => x ? x.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Rome' }) : '09:00'
    setCustomerId(b.user_id || '')
    setCustomerName(b.customer_name || '')
    setCustomerPhone(b.customer_phone || '')
    setCustomerEmail(String(d.customer_email || ''))
    setAssetName(b.vehicle_name || '')
    setPickupDate(ymd(pk)); setPickupTime(hm(pk))
    setDropoffDate(ymd(dr)); setDropoffTime(hm(dr))
    setPriceFinal(centsToEur(b.price_total || 0))
    setAmountPaid(centsToEur(b.amount_paid || Number(d.amountPaid) || 0))
    setPayStatus(b.payment_status || 'pending')
    setPayMethod(b.payment_method || '')
    setConSkipper(d.con_skipper !== false)
    setLuogoRitiro(String(d.luogo_ritiro || LUOGHI[0]))
    setLuogoRiconsegna(String(d.luogo_riconsegna || LUOGHI[0]))
    setIndirizzoConsegna(String(d.indirizzo_consegna || ''))
    setIndirizzoRiconsegna(String(d.indirizzo_riconsegna || ''))
    setCostoConsegna(d.costo_consegna ? centsToEur(Number(d.costo_consegna)) : '')
    setCostoRitiro(d.costo_ritiro ? centsToEur(Number(d.costo_ritiro)) : '')
    setPatente({
      tipo: String((d.patente_nautica as Record<string, string>)?.tipo || ''),
      numero: String((d.patente_nautica as Record<string, string>)?.numero || ''),
      emessa_da: String((d.patente_nautica as Record<string, string>)?.emessa_da || ''),
      rilascio: String((d.patente_nautica as Record<string, string>)?.rilascio || ''),
      scadenza: String((d.patente_nautica as Record<string, string>)?.scadenza || ''),
    })
    setPassengers(((d.passengers || []) as Passenger[]).map(p => ({ name: p.name || '', phone: p.phone || '' })))
    const sd = (d.second_driver || {}) as Record<string, string>
    setSecondo({
      nome: sd.nome || '', cognome: sd.cognome || '', telefono: sd.telefono || '', email: sd.email || '',
      codice_fiscale: sd.codice_fiscale || '', patente_numero: sd.patente_numero || '', patente_scadenza: sd.patente_scadenza || '',
    })
    setGuarantors(((d.guarantors || []) as Guarantor[]).map(g => ({ ...EMPTY_GUARANTOR, ...g })))
    const cz = (d.cauzione || {}) as Record<string, unknown>
    setCauzione({ importo: cz.importo ? centsToEur(Number(cz.importo)) : '', stato: String(cz.stato || 'da_incassare') })
    const sv: Record<string, number> = {}
    for (const line of ((d.servizi || []) as { id: string; qty: number }[])) sv[line.id] = line.qty
    setServizi(sv)
    setSconto(d.sconto ? centsToEur(Number(d.sconto)) : '')
    setNote(String(d.note || ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id, assetPreset, datePreset?.pickup, datePreset?.dropoff])

  /* ── Calcoli ── */
  const asset = useMemo(() => assets.find(a => a.name === assetName) || null, [assets, assetName])
  const rentalDays = rentalDaysBetween(pickupDate, pickupTime, dropoffDate, dropoffTime)
  const baseCents = asset && rentalDays > 0 ? rentalDays * asset.price_per_day : 0

  const serviceLines = useMemo(() => {
    return serviceDefs
      .filter(s => (servizi[s.id] || 0) > 0)
      .map(s => {
        const qty = servizi[s.id] || 0
        // per_day moltiplica anche per i giorni di noleggio, come sul Noleggio Terra.
        const mult = s.unit === 'per_day' ? Math.max(1, rentalDays) : 1
        return { id: s.id, name: s.name, unit: s.unit, qty, cents: Math.round(Number(s.price) * 100) * qty * mult }
      })
  }, [serviceDefs, servizi, rentalDays])
  const serviziCents = serviceLines.reduce((sum, l) => sum + l.cents, 0)
  const consegnaCents = eurToCents(costoConsegna) + eurToCents(costoRitiro)
  // "Sconto" in DR7 e' il PREZZO FINALE DESIDERATO, non l'importo da
  // sottrarre: e' cosi' nei Preventivi (PreventiviTab: `desiredFinal`) e
  // l'operatore lo usa con quel significato. Qui invece veniva sottratto:
  // scrivendo 11 su un noleggio da 0 il totale faceva max(0, 0-11) = 0, e la
  // prenotazione veniva salvata a 0,00 €. Due sensi opposti per la stessa
  // parola nella stessa piattaforma.
  const scontoCents = eurToCents(sconto)
  const lordoCents = baseCents + serviziCents + consegnaCents
  const computedCents = scontoCents > 0 ? scontoCents : lordoCents

  // Il totale si autocompila finche' l'admin non lo tocca a mano.
  //
  // 2026-08-14 BUG: aprendo una prenotazione in MODIFICA il prezzo tornava a
  // 0,00 e non si riusciva piu' a mandare il link di pagamento. Al montaggio
  // girano due effetti nello stesso commit: quello di precompilazione (che
  // scrive il prezzo salvato e alza il flag) e questo. Il secondo leggeva
  // ancora `priceEdited = false` — lo stato non e' aggiornato dentro lo stesso
  // giro — e sovrascriveva il prezzo con il calcolo, che in quel momento vale
  // 0 perche' il catalogo barche non e' ancora arrivato.
  //
  // Ora il guardiano e' un ref (cambia subito) e in modifica non si ricalcola
  // mai: su una prenotazione esistente comanda l'importo concordato, non il
  // listino di oggi.
  useEffect(() => {
    if (booking || priceEditedRef.current) return
    setPriceFinal(centsToEur(computedCents))
  }, [computedCents, priceEdited, booking])

  /* ── Disponibilità: la barca è già impegnata in quel periodo? ── */
  const [conflict, setConflict] = useState('')
  useEffect(() => {
    if (!assetName || rentalDays <= 0) { setConflict(''); return }
    const start = toRomeIso(pickupDate, pickupTime)
    const end = toRomeIso(dropoffDate, dropoffTime)
    if (!start || !end) { setConflict(''); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('bookings')
        .select('id, customer_name, pickup_date, dropoff_date')
        .eq('service_type', 'boat_rental')
        .eq('vehicle_name', assetName)
        .not('status', 'in', '(cancelled,annullata,deleted)')
        .lt('pickup_date', end)
        .gt('dropoff_date', start)
      if (cancelled) return
      const clash = (data || []).filter(b => b.id !== booking?.id)
      if (clash.length === 0) { setConflict(''); return }
      const f = clash[0] as { customer_name: string | null; pickup_date: string; dropoff_date: string }
      const fmt = (s: string) => new Date(s).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
      setConflict(`${assetName} già impegnata dal ${fmt(f.pickup_date)} al ${fmt(f.dropoff_date)}${f.customer_name ? ` — ${f.customer_name}` : ''}${clash.length > 1 ? ` (+${clash.length - 1} altre)` : ''}`)
    })()
    return () => { cancelled = true }
  }, [assetName, pickupDate, pickupTime, dropoffDate, dropoffTime, rentalDays, booking?.id])

  /* ── Salvataggio ── */
  async function save() {
    if (!customerName.trim()) { setFormError('Il nome cliente è obbligatorio.'); return }
    if (!assetName) { setFormError('Scegli la barca dal catalogo.'); return }
    if (rentalDays <= 0) { setFormError('La data/ora di riconsegna deve essere successiva al ritiro.'); return }
    setSaving(true); setFormError('')

    // Preserva le chiavi già presenti (es. tour_departure_id) e riscrive le nostre.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: Record<string, any> = { ...origDetails.current }
    d.rental_days = rentalDays
    d.customer_email = customerEmail.trim() || null
    if (on('conduzione')) d.con_skipper = conSkipper
    if (on('luoghi')) {
      d.luogo_ritiro = luogoRitiro
      d.luogo_riconsegna = luogoRiconsegna
      d.indirizzo_consegna = indirizzoConsegna.trim() || null
      // Vuoto = si riconsegna dove si e' ritirato.
      d.indirizzo_riconsegna = indirizzoRiconsegna.trim() || indirizzoConsegna.trim() || null
      d.costo_consegna = eurToCents(costoConsegna)
      d.costo_ritiro = eurToCents(costoRitiro)
    }
    // La patente nautica in prenotazione e' quella dello SKIPPER: si compila
    // solo "con skipper". Senza skipper conduce il cliente e la sua patente e'
    // gia' in anagrafica (customers_extended.*_patente_nautica), quindi il
    // blocco sparisce dal form e il dato non va duplicato qui.
    if (on('patente') && conSkipper) {
      const hasPat = Object.values(patente).some(v => String(v).trim())
      if (hasPat) d.patente_nautica = patente; else delete d.patente_nautica
    } else {
      delete d.patente_nautica
    }
    if (on('passeggeri')) {
      // Passeggeri = testo libero (nome + telefono per i messaggi). NON crea
      // lead/clienti: chi sale a bordo non diventa un contatto in anagrafica.
      const clean = passengers.map(p => ({ name: p.name.trim(), phone: p.phone.trim() })).filter(p => p.name || p.phone)
      if (clean.length) d.passengers = clean; else delete d.passengers
    }
    if (on('secondo')) {
      const hasSd = Object.values(secondo).some(v => String(v).trim())
      if (hasSd) d.second_driver = secondo; else delete d.second_driver
    }
    if (on('garante')) {
      const clean = guarantors.filter(g => g.nome_cognome.trim())
      if (clean.length) d.guarantors = clean; else delete d.guarantors
    }
    if (on('cauzione')) d.cauzione = { importo: eurToCents(cauzione.importo), stato: cauzione.stato }
    if (on('servizi')) {
      if (serviceLines.length) d.servizi = serviceLines; else delete d.servizi
    }
    // `sconto` = prezzo finale concordato (come nei Preventivi), `listino` =
    // quanto sarebbe costato a tariffa piena. Salvando entrambi lo scarto
    // resta ricostruibile senza doverlo ricalcolare.
    d.sconto = scontoCents
    d.listino = lordoCents
    d.note = note.trim() || null
    d.amountPaid = eurToCents(amountPaid)

    const payload = {
      service_type: 'boat_rental',
      user_id: customerId || null,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim() || null,
      guest_name: customerName.trim(),
      guest_email: customerEmail.trim() || null,
      guest_phone: customerPhone.trim() || null,
      vehicle_name: assetName,
      pickup_date: toRomeIso(pickupDate, pickupTime),
      dropoff_date: toRomeIso(dropoffDate, dropoffTime),
      // Se il luogo chiede un indirizzo, lo si porta dentro pickup/dropoff_location:
      // altrimenti in elenco e in calendario si leggerebbe solo "Porto / Marina
      // (indica indirizzo)", che non dice dove.
      pickup_location: on('luoghi') ? componiLuogo(luogoRitiro, indirizzoConsegna) : null,
      dropoff_location: on('luoghi') ? componiLuogo(luogoRiconsegna, indirizzoRiconsegna || indirizzoConsegna) : null,
      price_total: eurToCents(priceFinal),
      amount_paid: eurToCents(amountPaid),
      status: 'confirmed',
      payment_status: payStatus,
      payment_method: payMethod || null,
      booking_details: d,
    }

    const { data: savedRow, error } = booking
      ? await supabase.from('bookings').update(payload).eq('id', booking.id).select('id').single()
      : await supabase.from('bookings').insert({ ...payload, created_at: new Date().toISOString() }).select('id').single()
    setSaving(false)
    if (error) { setFormError(error.message); return }
    const savedId = (savedRow as { id: string } | null)?.id || booking?.id || null
    toast.success(booking ? 'Prenotazione aggiornata' : 'Prenotazione creata')

    // 2026-08-10 (roadmap #11): il salvataggio del Mare non aveva NESSUNO
    // degli effetti collaterali del Noleggio Terra. Due mancavano davvero:
    //
    // 1) AUDIT — nessuna riga nel log attivita' operatori. Una prenotazione
    //    Mare poteva essere creata o modificata senza lasciare traccia di chi
    //    e quando, mentre ogni azione su Terra e' tracciata.
    if (savedId) {
      logAdminAction(booking ? 'edit_booking' : 'create_booking', 'booking', savedId, {
        business: 'Noleggio Mare',
        cliente: customerName.trim(),
        mezzo: assetName,
        dal: pickupDate,
        al: dropoffDate,
        totale: (eurToCents(priceFinal) / 100).toFixed(2),
        stato_pagamento: payStatus,
        metodo_pagamento: payMethod || null,
      })
    }

    // 3) NEXI PAY BY LINK — su Terra, Aria e Lavaggio una prenotazione creata
    //    con metodo "Nexi - Pay by Link" e stato "Da Saldare" genera e invia
    //    subito il link di pagamento. Sul Mare non partiva niente: la
    //    prenotazione restava da saldare e nessuno mandava il link al cliente.
    //    Solo alla CREAZIONE, come negli altri business.
    if (!booking && savedId && payStatus === 'pending' && isNexiPbl(payMethod)) {
      try {
        const amountEuros = eurToCents(priceFinal) / 100
        const linkRes = await authFetch('/.netlify/functions/nexi-pay-by-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: savedId,
            amount: amountEuros,
            customerEmail: customerEmail.trim() || '',
            customerName: customerName.trim() || 'Cliente',
            description: `Noleggio Mare - ${assetName}`.trim(),
            expirationHours: 1,
          }),
        })
        const linkData = await linkRes.json()
        if (linkRes.ok && linkData.paymentUrl) {
          await supabase.from('bookings').update({
            booking_details: {
              ...d,
              nexi_payment_link: linkData.paymentUrl,
              nexi_order_id: linkData.orderId || null,
              payment_link_created_at: new Date().toISOString(),
              payment_link_expires_at: linkData.expiresAt || new Date(Date.now() + 3600000).toISOString(),
            },
          }).eq('id', savedId)
          const phone = customerPhone.trim()
          if (phone) {
            const firstName = customerName.trim().split(' ')[0] || 'Cliente'
            const amountStr = amountEuros.toFixed(2)
            const ref = savedId.substring(0, 8).toUpperCase()
            await fetch('/.netlify/functions/send-whatsapp-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                customPhone: phone,
                templateKey: 'payment_link_customer',
                booking: { service_type: 'boat_rental' },
                templateVars: {
                  customer_name: firstName, nome: firstName,
                  amount: amountStr, total: amountStr, importo: amountStr, totale: amountStr,
                  link: linkData.paymentUrl, payment_link: linkData.paymentUrl,
                  booking_id: ref, booking_ref: ref, expiry: '1 ora',
                },
                skipHeader: true,
              }),
            })
          }
          toast.success('Link di pagamento inviato al cliente')
        } else {
          toast.error('Prenotazione salvata, ma link di pagamento non generato: ' + (linkData.error || ''))
        }
      } catch (le) {
        toast.error('Errore Pay by Link: ' + (le as Error).message)
      }
    }

    // 2) FATTURA sul passaggio a "Pagato" — su Terra e Lavaggio parte
    //    automaticamente, qui no: un noleggio barca incassato restava senza
    //    fattura finche' qualcuno non se ne accorgeva. La regola su QUALI
    //    metodi di pagamento fatturano vive solo nel server (Centralina Pro >
    //    Fiscale): qui si chiama e basta, il server decide. Niente fattura a
    //    prezzo zero (uscita in omaggio).
    const isPaidNow = ['paid', 'completed', 'succeeded'].includes(payStatus)
    const wasPaid = ['paid', 'completed', 'succeeded'].includes(String(booking?.payment_status || ''))
    if (savedId && isPaidNow && !wasPaid && eurToCents(priceFinal) > 0) {
      try {
        const invRes = await authFetch('/.netlify/functions/generate-invoice-from-booking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: savedId, includeIVA: true }),
        })
        if (!invRes.ok) {
          const errData = await invRes.json().catch(() => ({}))
          const errMsg = errData.message || errData.error || invRes.statusText
          console.warn('[MareBookingModal] fattura non generata:', errMsg)
          if (String(errMsg).match(/obbligatorio|incomplete|missing/i)) {
            toast.error('Dati cliente incompleti per la fattura: completali nella scheda cliente.', { duration: 8000 })
          }
        }
      } catch (invErr) {
        console.warn('[MareBookingModal] chiamata fattura fallita (non blocca il salvataggio):', invErr)
      }
    }

    // 2026-08-10 (roadmap #44 + #11): il Noleggio Mare non inviava NIENTE al
    // cliente — ne' alla creazione ne' alla modifica. Il Noleggio Terra lo fa
    // da sempre; qui la prenotazione veniva salvata in silenzio. Ora parte la
    // notifica con le chiavi dedicate al Mare (boat_new_customer /
    // boat_modified), cosi' la direzione puo' scriverne il testo dai Messaggi
    // di Sistema Pro senza passare dallo sviluppo.
    //
    // Best-effort: se l'invio fallisce la prenotazione resta salvata. Non si
    // blocca un salvataggio riuscito per un problema di WhatsApp.
    if (customerPhone.trim()) {
      try {
        const firstName = (customerName.trim().split(' ')[0]) || 'Cliente'
        const totalStr = (eurToCents(priceFinal) / 100).toFixed(2)
        await fetch('/.netlify/functions/send-whatsapp-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customPhone: customerPhone.trim(),
            templateKey: booking ? 'boat_modified' : 'boat_new_customer',
            booking: { service_type: 'boat_rental' },
            templateVars: {
              nome: firstName, customer_name: customerName.trim(),
              mezzo: assetName, servizio: assetName, service_name: assetName, vehicle_name: assetName,
              data: pickupDate, date: pickupDate,
              data_ritiro: pickupDate, data_riconsegna: dropoffDate,
              orario: pickupTime, ora: pickupTime, time: pickupTime,
              luogo_ritiro: luogoRitiro || '', luogo_riconsegna: luogoRiconsegna || '',
              total: totalStr, totale: totalStr, importo: totalStr, amount: totalStr,
            },
            skipHeader: true,
          }),
        })
      } catch (waErr) {
        console.warn('[MareBookingModal] notifica WhatsApp non inviata (non blocca il salvataggio):', waErr)
      }
    }

    // Avviso allo STAFF alla creazione, come sul Noleggio Terra
    // (rental_new_admin). Solo alla creazione: una modifica non deve svegliare
    // il gruppo. `notifyAdmin: true` e' obbligatorio — il numero arriva da
    // Centralina Pro e non esiste piu' nessun fallback silenzioso.
    if (!booking) {
      try {
        const totalStr = (eurToCents(priceFinal) / 100).toFixed(2)
        await fetch('/.netlify/functions/send-whatsapp-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notifyAdmin: true,
            templateKey: 'boat_new_admin',
            booking: { service_type: 'boat_rental' },
            templateVars: {
              cliente: customerName.trim(), customer_name: customerName.trim(),
              telefono: customerPhone.trim(), customer_phone: customerPhone.trim(),
              mezzo: assetName, vehicle_name: assetName, service_name: assetName,
              data_ritiro: pickupDate, data_riconsegna: dropoffDate,
              orario: pickupTime, ora: pickupTime,
              total: totalStr, totale: totalStr, importo: totalStr,
            },
            skipHeader: true,
          }),
        })
      } catch (waErr) {
        console.warn('[MareBookingModal] avviso staff non inviato (non blocca il salvataggio):', waErr)
      }
    }

    onSaved()
  }

  const selectedCustomer = customers.find(c => c.id === customerId)

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4" onClick={() => !saving && onClose()}>
      <div className="min-h-full flex items-start justify-center">
        <div className="bg-theme-bg-secondary border border-theme-border rounded-xl w-full max-w-3xl my-4" onClick={e => e.stopPropagation()}>
          <div className="sticky top-0 z-10 bg-theme-bg-secondary border-b border-theme-border px-5 py-4 flex items-center justify-between rounded-t-xl">
            <h3 className="text-lg font-semibold text-dr7-gold">{isEdit ? 'Modifica Prenotazione' : 'Nuova Prenotazione'} — Noleggio Mare</h3>
            <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary text-2xl leading-none">&times;</button>
          </div>

          <div className="p-5 space-y-4">
            {formError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">{formError}</div>
            )}

            {/* ── Cliente ── */}
            <Section title="Dati Cliente" right={
              <button type="button" onClick={() => setShowNewClient(true)} className="text-xs text-dr7-gold hover:underline font-semibold">+ Nuovo Cliente</button>
            }>
              <CustomerAutocomplete
                customers={customers}
                selectedCustomerId={customerId}
                onSelectCustomer={(id) => {
                  const c = customers.find(x => x.id === id)
                  if (c) pickCustomer(c); else setCustomerId(id)
                }}
                placeholder="Cerca cliente per nome, email o telefono..."
                required={false}
                showCardInfoOnSelect
              />
              {selectedCustomer && (
                <div className="mt-2 p-2 rounded-lg bg-dr7-gold/10 border border-dr7-gold/30 text-xs text-theme-text-secondary">
                  {selectedCustomer.full_name}{selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ''}{selectedCustomer.email ? ` · ${selectedCustomer.email}` : ''}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <Field label="Cliente *">
                  <input className={INPUT_CLS} placeholder="Nome e cognome" value={customerName} onChange={e => setCustomerName(e.target.value)} />
                </Field>
                <Field label="Telefono">
                  <input className={INPUT_CLS} placeholder="Telefono" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
                </Field>
                <Field label="Email">
                  <input className={INPUT_CLS} placeholder="Email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} />
                </Field>
              </div>
            </Section>

            {/* ── Barca + periodo ── */}
            <Section title="Barca & Periodo">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <Field label={`Barca (${assets.length} dal catalogo)`}>
                    <select className={INPUT_CLS} value={assetName} onChange={e => setAssetName(e.target.value)}>
                      <option value="">— seleziona —</option>
                      {assets.map(a => <option key={a.id} value={a.name}>{a.name}{a.is_active ? '' : ' (non attiva)'}</option>)}
                    </select>
                  </Field>
                  {asset && (
                    <p className="mt-1 text-[11px] text-theme-text-muted">
                      {asset.capacity ? `Fino a ${asset.capacity} persone · ` : ''}
                      {asset.price_per_day > 0 ? `Tariffa €${centsToEur(asset.price_per_day)}/giorno` : 'Tariffa non impostata a catalogo'}
                    </p>
                  )}
                </div>
                <Field label="Data ritiro">
                  <EuropeanDateInput className={INPUT_CLS} value={pickupDate} onChange={(v: string) => {
                    setPickupDate(v)
                    // La riconsegna insegue il ritiro finché non ne scegli una successiva.
                    setDropoffDate(prev => (!prev || prev <= v) ? addDaysYmd(v, 1) : prev)
                  }} />
                </Field>
                <TimeSelect label="Ora ritiro" value={pickupTime} dateStr={pickupDate} kind="pickup" onChange={setPickupTime} serviceType="boat_rental" />
                <Field label="Data riconsegna">
                  <EuropeanDateInput className={INPUT_CLS} value={dropoffDate} min={pickupDate} onChange={(v: string) => setDropoffDate(v)} />
                </Field>
                <TimeSelect label="Ora riconsegna" value={dropoffTime} dateStr={dropoffDate} kind="return" onChange={setDropoffTime} serviceType="boat_rental" />
              </div>
              <div className="mt-3 space-y-2">
                {rentalDays > 0
                  ? <p className="text-xs text-theme-text-secondary">Durata: <strong className="text-theme-text-primary">{rentalDays} giorn{rentalDays === 1 ? 'o' : 'i'}</strong>{asset && asset.price_per_day > 0 && <> · {rentalDays} × €{centsToEur(asset.price_per_day)} = <strong className="text-theme-text-primary">{eur(baseCents)}</strong></>}</p>
                  : <p className="text-xs text-amber-400">La riconsegna deve essere successiva al ritiro.</p>}
                {conflict && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
                    <span className="text-red-400 leading-none">⚠</span>
                    <div>
                      <p className="text-xs text-red-300 font-medium">Sovrapposizione</p>
                      <p className="text-[11px] text-red-300/80 mt-0.5">{conflict}</p>
                    </div>
                  </div>
                )}
              </div>
            </Section>

            {/* ── Luoghi & consegna ── */}
            {on('luoghi') && (
              <Section title="Luoghi & Consegna">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Luogo ritiro">
                    <select className={INPUT_CLS} value={luogoRitiro} onChange={e => setLuogoRitiro(e.target.value)}>
                      {LUOGHI.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </Field>
                  <Field label="Luogo riconsegna">
                    <select className={INPUT_CLS} value={luogoRiconsegna} onChange={e => setLuogoRiconsegna(e.target.value)}>
                      {LUOGHI.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label={`Indirizzo ritiro${richiedeIndirizzo(luogoRitiro) ? '' : ' (facoltativo)'}`}>
                      <AddressAutocomplete
                        className={INPUT_CLS}
                        placeholder="Inizia a scrivere: porto, marina, via…"
                        value={indirizzoConsegna}
                        onChange={setIndirizzoConsegna}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Indirizzo riconsegna">
                      <AddressAutocomplete
                        className={INPUT_CLS}
                        placeholder={indirizzoConsegna ? `Stesso del ritiro — ${indirizzoConsegna}` : 'Stesso indirizzo del ritiro'}
                        value={indirizzoRiconsegna}
                        onChange={setIndirizzoRiconsegna}
                      />
                    </Field>
                    <p className="mt-1 text-[11px] text-theme-text-muted">Lascialo vuoto se la barca torna dove è stata ritirata.</p>
                  </div>
                  <Field label="Costo consegna (€)">
                    <input className={INPUT_CLS} inputMode="decimal" placeholder="0,00" value={costoConsegna} onChange={e => setCostoConsegna(e.target.value)} />
                  </Field>
                  <Field label="Costo ritiro (€)">
                    <input className={INPUT_CLS} inputMode="decimal" placeholder="0,00" value={costoRitiro} onChange={e => setCostoRitiro(e.target.value)} />
                  </Field>
                </div>
              </Section>
            )}

            {/* ── Conduzione ── */}
            {on('conduzione') && (
              <Section title="Conduzione">
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConSkipper(true)} className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${conSkipper ? 'bg-dr7-gold text-white border-dr7-gold' : 'bg-theme-bg-tertiary text-theme-text-secondary border-theme-border'}`}>Con skipper</button>
                  <button type="button" onClick={() => setConSkipper(false)} className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${!conSkipper ? 'bg-dr7-gold text-white border-dr7-gold' : 'bg-theme-bg-tertiary text-theme-text-secondary border-theme-border'}`}>Senza skipper</button>
                </div>
              </Section>
            )}

            {/* ── Patente nautica (solo con skipper) ── */}
            {on('patente') && !conSkipper && (
              <Section title="Patente Nautica">
                <p className="text-[11px] text-theme-text-muted">
                  Senza skipper conduce il cliente: la sua patente nautica è già in anagrafica, si gestisce dalla scheda cliente.
                </p>
                {clienteNautica && (
                  <div className="mt-2 text-xs text-theme-text-secondary">
                    <span className="font-semibold text-theme-text-primary font-mono">{clienteNautica.numero || '—'}</span>
                    {[clienteNautica.categoria, clienteNautica.limite, clienteNautica.abilitazione].filter(Boolean).length > 0 && (
                      <span> · {[clienteNautica.categoria, clienteNautica.limite, clienteNautica.abilitazione].filter(Boolean).join(' · ')}</span>
                    )}
                    {clienteNautica.scadenza && (
                      <span className={clienteNautica.scadenza < todayYmd ? 'ml-2 text-red-400 font-semibold' : 'ml-2'}>
                        scade il {clienteNautica.scadenza.split('-').reverse().join('/')}
                        {clienteNautica.scadenza < todayYmd && ' — SCADUTA'}
                      </span>
                    )}
                  </div>
                )}
                {customerId && !clienteNautica && (
                  <p className="mt-2 text-[11px] text-theme-text-muted">Nessuna patente nautica in anagrafica per questo cliente.</p>
                )}
              </Section>
            )}
            {on('patente') && conSkipper && (
              <Section title="Patente Nautica dello Skipper">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Tipo">
                    <select className={INPUT_CLS} value={patente.tipo} onChange={e => setPatente({ ...patente, tipo: e.target.value })}>
                      <option value="">— seleziona —</option>
                      {PATENTE_NAUTICA_TIPI.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Numero">
                    <input className={INPUT_CLS} value={patente.numero} onChange={e => setPatente({ ...patente, numero: e.target.value })} />
                  </Field>
                  <Field label="Emessa da">
                    <input className={INPUT_CLS} placeholder="Capitaneria / Motorizzazione" value={patente.emessa_da} onChange={e => setPatente({ ...patente, emessa_da: e.target.value })} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Rilascio">
                      <EuropeanDateInput className={INPUT_CLS} value={patente.rilascio} onChange={(v: string) => setPatente({ ...patente, rilascio: v })} />
                    </Field>
                    <Field label="Scadenza">
                      <EuropeanDateInput className={INPUT_CLS} value={patente.scadenza} onChange={(v: string) => setPatente({ ...patente, scadenza: v })} />
                    </Field>
                  </div>
                </div>
                {patente.scadenza && patente.scadenza < todayYmd && (
                  <p className="mt-2 text-[11px] text-red-400 font-semibold">Patente nautica scaduta il {patente.scadenza.split('-').reverse().join('/')}.</p>
                )}
              </Section>
            )}

            {/* ── Passeggeri (testo libero, nessun lead creato) ── */}
            {on('passeggeri') && (
              <Section title="Passeggeri" right={
                <button type="button" onClick={() => setPassengers(p => [...p, { name: '', phone: '' }])} className="text-xs text-dr7-gold font-semibold hover:underline">+ Aggiungi passeggero</button>
              }>
                {passengers.length === 0 ? (
                  <p className="text-[11px] text-theme-text-muted">
                    Nessun passeggero. Aggiungi nome e telefono di chi sale a bordo — servono solo per i messaggi, non creano un cliente in anagrafica.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {passengers.map((p, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input className={INPUT_CLS} placeholder={`Passeggero ${i + 1} — nome e cognome`} value={p.name}
                          onChange={e => setPassengers(arr => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                        <input className={`${INPUT_CLS} max-w-[180px]`} placeholder="Telefono" value={p.phone}
                          onChange={e => setPassengers(arr => arr.map((x, j) => j === i ? { ...x, phone: e.target.value } : x))} />
                        <button type="button" onClick={() => setPassengers(arr => arr.filter((_, j) => j !== i))} className="text-red-400 text-xl leading-none px-1 shrink-0" title="Rimuovi">×</button>
                      </div>
                    ))}
                  </div>
                )}
                {asset?.capacity != null && passengers.length + 1 > asset.capacity && (
                  <p className="mt-2 text-[11px] text-amber-400">
                    {passengers.length + 1} persone a bordo (cliente incluso) su una capienza di {asset.capacity}.
                  </p>
                )}
              </Section>
            )}

            {/* ── Secondo conduttore ── */}
            {on('secondo') && (
              <Section title="Secondo Conduttore">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Nome"><input className={INPUT_CLS} value={secondo.nome} onChange={e => setSecondo({ ...secondo, nome: e.target.value })} /></Field>
                  <Field label="Cognome"><input className={INPUT_CLS} value={secondo.cognome} onChange={e => setSecondo({ ...secondo, cognome: e.target.value })} /></Field>
                  <Field label="Telefono"><input className={INPUT_CLS} value={secondo.telefono} onChange={e => setSecondo({ ...secondo, telefono: e.target.value })} /></Field>
                  <Field label="Email"><input className={INPUT_CLS} value={secondo.email} onChange={e => setSecondo({ ...secondo, email: e.target.value })} /></Field>
                  <Field label="Codice Fiscale"><input className={INPUT_CLS} value={secondo.codice_fiscale} onChange={e => setSecondo({ ...secondo, codice_fiscale: e.target.value.toUpperCase() })} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="N° patente"><input className={INPUT_CLS} value={secondo.patente_numero} onChange={e => setSecondo({ ...secondo, patente_numero: e.target.value })} /></Field>
                    <Field label="Scadenza"><EuropeanDateInput className={INPUT_CLS} value={secondo.patente_scadenza} onChange={(v: string) => setSecondo({ ...secondo, patente_scadenza: v })} /></Field>
                  </div>
                </div>
              </Section>
            )}

            {/* ── Garanti ── */}
            {on('garante') && (
              <Section title="Garante / Fideiussore" right={
                guarantors.length < 3
                  ? <button type="button" onClick={() => setGuarantors(g => [...g, { ...EMPTY_GUARANTOR }])} className="text-xs text-dr7-gold font-semibold hover:underline">+ Aggiungi garante</button>
                  : <span className="text-[11px] text-theme-text-muted">massimo 3</span>
              }>
                {guarantors.length === 0 ? (
                  <p className="text-[11px] text-theme-text-muted">Nessun garante.</p>
                ) : (
                  <div className="space-y-4">
                    {guarantors.map((g, i) => (
                      <div key={i} className="rounded-lg border border-theme-border p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-theme-text-secondary">Garante {i + 1}</span>
                          <button type="button" onClick={() => setGuarantors(arr => arr.filter((_, j) => j !== i))} className="text-red-400 text-xs hover:underline">Rimuovi</button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Field label="Nome e Cognome"><input className={INPUT_CLS} value={g.nome_cognome} onChange={e => setGuarantors(arr => arr.map((x, j) => j === i ? { ...x, nome_cognome: e.target.value } : x))} /></Field>
                          <Field label="Codice Fiscale"><input className={INPUT_CLS} value={g.codice_fiscale} onChange={e => setGuarantors(arr => arr.map((x, j) => j === i ? { ...x, codice_fiscale: e.target.value.toUpperCase() } : x))} /></Field>
                          <Field label="Telefono"><input className={INPUT_CLS} value={g.telefono} onChange={e => setGuarantors(arr => arr.map((x, j) => j === i ? { ...x, telefono: e.target.value } : x))} /></Field>
                          <Field label="Email"><input className={INPUT_CLS} value={g.email} onChange={e => setGuarantors(arr => arr.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} /></Field>
                          <Field label="Indirizzo"><input className={INPUT_CLS} value={g.indirizzo} onChange={e => setGuarantors(arr => arr.map((x, j) => j === i ? { ...x, indirizzo: e.target.value } : x))} /></Field>
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Città"><input className={INPUT_CLS} value={g.citta} onChange={e => setGuarantors(arr => arr.map((x, j) => j === i ? { ...x, citta: e.target.value } : x))} /></Field>
                            <Field label="Prov."><input className={INPUT_CLS} value={g.provincia} onChange={e => setGuarantors(arr => arr.map((x, j) => j === i ? { ...x, provincia: e.target.value.toUpperCase() } : x))} /></Field>
                          </div>
                          <Field label="Data di nascita"><EuropeanDateInput className={INPUT_CLS} value={g.data_nascita} onChange={(v: string) => setGuarantors(arr => arr.map((x, j) => j === i ? { ...x, data_nascita: v } : x))} /></Field>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* ── Cauzione ── */}
            {on('cauzione') && (
              <Section title="Cauzione">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Importo cauzione (€)">
                    <input className={INPUT_CLS} inputMode="decimal" placeholder="0,00" value={cauzione.importo} onChange={e => setCauzione({ ...cauzione, importo: e.target.value })} />
                  </Field>
                  <Field label="Stato">
                    <select className={INPUT_CLS} value={cauzione.stato} onChange={e => setCauzione({ ...cauzione, stato: e.target.value })}>
                      {CAUZIONE_STATI.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </Field>
                </div>
                <p className="mt-2 text-[11px] text-theme-text-muted">La cauzione non entra nel totale del noleggio: si incassa e si restituisce a parte.</p>
              </Section>
            )}

            {/* ── Servizi extra ── */}
            {on('servizi') && (
              <Section title="Servizi Extra">
                {serviceDefs.length === 0 ? (
                  <p className="text-[11px] text-amber-400">Nessun servizio configurato in Centralina Pro &gt; Servizi.</p>
                ) : (
                  <div className="space-y-2">
                    {serviceDefs.map(s => {
                      const qty = servizi[s.id] || 0
                      return (
                        <div key={s.id} className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ${qty > 0 ? 'border-dr7-gold/50 bg-dr7-gold/5' : 'border-theme-border'}`}>
                          <div className="min-w-0">
                            <p className="text-sm text-theme-text-primary truncate">{s.name}</p>
                            <p className="text-[11px] text-theme-text-muted">€{Number(s.price).toFixed(2)} {UNIT_LABEL[s.unit] || s.unit}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button type="button" className="w-7 h-7 rounded border border-theme-border text-theme-text-secondary" onClick={() => setServizi(v => ({ ...v, [s.id]: Math.max(0, (v[s.id] || 0) - 1) }))}>−</button>
                            <span className="w-6 text-center text-sm tabular-nums text-theme-text-primary">{qty}</span>
                            <button type="button" className="w-7 h-7 rounded border border-theme-border text-theme-text-secondary" onClick={() => setServizi(v => ({ ...v, [s.id]: (v[s.id] || 0) + 1 }))}>+</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Section>
            )}

            {/* ── Riepilogo ── */}
            <Section title="Riepilogo">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-theme-text-secondary">
                  <span>Noleggio {rentalDays > 0 ? `(${rentalDays} × €${asset ? centsToEur(asset.price_per_day) : '0.00'})` : ''}</span>
                  <span className="tabular-nums">{eur(baseCents)}</span>
                </div>
                {serviceLines.map(l => (
                  <div key={l.id} className="flex justify-between text-theme-text-muted text-xs">
                    <span>{l.name} × {l.qty}{l.unit === 'per_day' ? ` × ${rentalDays}g` : ''}</span>
                    <span className="tabular-nums">{eur(l.cents)}</span>
                  </div>
                ))}
                {consegnaCents > 0 && (
                  <div className="flex justify-between text-theme-text-muted text-xs">
                    <span>Consegna / ritiro</span>
                    <span className="tabular-nums">{eur(consegnaCents)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center gap-3 pt-2">
                  <span className="text-theme-text-muted text-xs">Sconto — prezzo finale desiderato (€)</span>
                  <input className={`${INPUT_CLS} max-w-[120px] text-right`} inputMode="decimal" placeholder={centsToEur(lordoCents)} value={sconto} onChange={e => setSconto(e.target.value)} />
                </div>
                <p className="text-[11px] text-theme-text-muted">
                  Scrivi qui quanto deve pagare il cliente in tutto, non lo sconto da togliere. Lascia vuoto per il prezzo di listino.
                </p>
                {scontoCents > 0 && scontoCents !== lordoCents && (
                  <div className="flex justify-between text-emerald-500 text-xs">
                    <span>{scontoCents < lordoCents ? 'Sconto applicato' : 'Maggiorazione'}</span>
                    <span className="tabular-nums">{eur(Math.abs(lordoCents - scontoCents))}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-theme-border pt-2 mt-2 text-theme-text-primary font-semibold">
                  <span>Totale calcolato</span>
                  <span className="tabular-nums">{eur(computedCents)}</span>
                </div>
                {asset && asset.price_per_day <= 0 && (
                  <p className="mt-2 text-[11px] text-amber-500 font-semibold">
                    &laquo;{asset.name}&raquo; non ha un prezzo al giorno nel catalogo: il noleggio conta 0. Impostalo in
                    Catalogo, oppure scrivi qui sopra il prezzo finale.
                  </p>
                )}
              </div>
            </Section>

            {/* ── Pagamento ── */}
            <Section title="Pagamento">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Prezzo Finale (€)">
                  <input className={INPUT_CLS} inputMode="decimal" placeholder={centsToEur(computedCents)} value={priceFinal} onChange={e => { bloccaPrezzo(); setPriceFinal(e.target.value) }} />
                  {!priceEdited && <p className="mt-1 text-[11px] text-theme-text-muted">Calcolato in automatico — scrivilo a mano per bloccarlo.</p>}
                </Field>
                <Field label="Importo Pagato (€)">
                  <input className={INPUT_CLS} inputMode="decimal" placeholder="0,00" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} />
                </Field>
                <Field label="Stato Pagamento">
                  <select className={INPUT_CLS} value={payStatus} onChange={e => {
                    const st = e.target.value
                    setPayStatus(st)
                    // Passando a Pagato con l'importo ancora vuoto si salvava
                    // "Pagato" con incassato 0: la prenotazione risultava saldata
                    // e la cassa non tornava. Si propone il totale, che resta
                    // modificabile (un acconto si scrive a mano).
                    // NON si tocca mai se l'operatore ha gia' scritto qualcosa,
                    // ne' quando cambia il TOTALE: l'importo pagato e' indipendente.
                    if (st === 'paid' && !amountPaid.trim()) setAmountPaid(priceFinal)
                  }}>
                    {PAY_STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
                <Field label="Metodo di Pagamento">
                  <select className={INPUT_CLS} value={payMethod} onChange={e => {
                    const m = e.target.value
                    setPayMethod(m)
                    // Nexi Pay by Link = pagamento in sospeso -> Da Saldare.
                    // Qualsiasi altro metodo scelto = incassato -> Pagato.
                    if (!m) return
                    const st = isNexiPbl(m) ? 'pending' : 'paid'
                    setPayStatus(st)
                    if (st === 'paid' && !amountPaid.trim()) setAmountPaid(priceFinal)
                  }}>
                    <option value="">— seleziona —</option>
                    {paymentMethods.filter(m => m.is_enabled !== false).map(m => <option key={m.key || m.label} value={m.label}>{m.label}</option>)}
                  </select>
                  {paymentMethods.length === 0 && <p className="mt-1 text-[11px] text-amber-400">Nessun metodo configurato in Centralina Pro &gt; Fiscale.</p>}
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Note">
                    <textarea className={INPUT_CLS} rows={2} value={note} onChange={e => setNote(e.target.value)} />
                  </Field>
                </div>
              </div>
            </Section>
          </div>

          <div className="sticky bottom-0 bg-theme-bg-secondary border-t border-theme-border px-5 py-4 flex items-center justify-end gap-2 rounded-b-xl">
            <button onClick={onClose} disabled={saving || savingOnce} className="px-3 py-1.5 rounded-lg border border-theme-border text-theme-text-secondary text-sm hover:bg-theme-bg-hover">Annulla</button>
            <button onClick={() => saveOnce()} disabled={saving || savingOnce} className="px-4 py-2 rounded-full bg-dr7-gold text-white text-sm font-semibold hover:bg-[#0A8FA3] transition-colors disabled:opacity-50">
              {saving || savingOnce ? 'Salvataggio…' : (isEdit ? 'Salva' : 'Crea prenotazione')}
            </button>
          </div>
        </div>
      </div>

      <NewClientModal
        isOpen={showNewClient}
        onClose={() => setShowNewClient(false)}
        onClientCreated={(clientId) => {
          setShowNewClient(false)
          loadCustomers(clientId)
        }}
      />
    </div>
  )
}
