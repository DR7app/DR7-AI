import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import { getProKeyEventTriggers, EVENT_DESCRIPTIONS, suggestEventsForTemplate } from '../../../utils/proTemplateRouting'
const EVENT_LABELS_IT = EVENT_DESCRIPTIONS
import toast from 'react-hot-toast'

interface SystemMessage {
    id: string
    message_key: string
    label: string
    description: string
    message_body: string
    is_automatic: boolean
    is_enabled: boolean
    include_header: boolean
    trigger_event: string
    trigger_offset_hours: number
    send_hour: number | null
    target_category: string
    target_status: string
    /** DB-driven event routing. Quale evento di codice (legacy key
        come 'rental_new_customer', 'wallet_bonus_credit') instrada qui.
        Vince sulla mappa hardcoded OLD_TO_PRO. Vuoto/null → fallback
        alla mappa storica. Editabile dall'admin nel pannello "Eventi
        gestiti". */
    handled_events?: string[] | null
    /** Se true, dopo il WhatsApp invia anche email (stesso body). */
    send_email?: boolean
    /** Oggetto email; se vuoto, fallback al label del template. */
    email_subject?: string | null
    // Filtri avanzati (migration 20260509_system_messages_more_filters)
    target_service_type?: string  // 'rental'|'car_wash'|'mechanical'|'all'
    target_with_deposit?: string  // 'yes'|'no'|'all'
    target_plate?: string | null  // targa esatta opzionale
    target_payment_method?: string // 'card'|'wallet'|'cash'|'bonifico'|'all'
    target_amount_min?: number | null  // euro
    target_amount_max?: number | null  // euro
    target_membership_tier?: string | null
    target_min_prev_bookings?: number | null
    target_max_prev_bookings?: number | null
    target_rental_duration_min?: number | null
    target_rental_duration_max?: number | null
    target_customer_tags?: string | null
    target_residency?: string | null
    target_age_min?: number | null
    target_age_max?: number | null
    target_pickup_hour_min?: number | null
    target_pickup_hour_max?: number | null
    target_source_channel?: string | null
    target_province?: string | null
    target_min_lifetime_value?: number | null
    target_has_unpaid_invoices?: boolean | null
    target_used_promo_before?: boolean | null
    target_extension_count_min?: number | null
    target_extension_count_max?: number | null
    /** CSV di JS day-of-week (0=Dom..6=Sab) Europe/Rome — default tutti i giorni */
    target_days_of_week?: string
    /** Ora inizio fascia silenziosa Europe/Rome (0-23). NULL = nessuna fascia. */
    quiet_hours_start?: number | null
    /** Ora fine fascia silenziosa esclusiva (0-23). Se start>end, attraversa mezzanotte. */
    quiet_hours_end?: number | null
    created_at: string
    updated_at: string
}

interface CustomerResult {
    id: string
    nome: string
    cognome: string
    telefono: string
    full_name: string
}

interface SentMessageLog {
    id: string
    customer_name: string
    customer_phone: string
    message_text: string
    template_label: string | null
    sent_at: string
    status: string
}

const TRIGGER_LABELS: Record<string, string> = {
    // Booking lifecycle
    'before_pickup': 'Prima del ritiro',
    'after_pickup': 'Dopo il ritiro',
    'before_dropoff': 'Prima della riconsegna',
    'after_dropoff': 'Dopo la riconsegna',
    'on_booking': 'Alla creazione della prenotazione',
    'on_payment': 'Al pagamento ricevuto',
    'on_signature': 'Dopo la firma del contratto',
    'before_signature': 'Promemoria firma contratto',
    'after_signature_review': 'Recensione dopo firma',
    'on_extension': 'Dopo una proroga',
    'on_late_return': 'Ritardo riconsegna oltre grace',
    'on_preventivo': 'Invio preventivo (gestito separatamente)',
    // Cauzione lifecycle
    'on_cauzione_created': 'Nuova cauzione creata',
    'on_cauzione_due': 'Cauzione in scadenza',
    'on_cauzione_overdue': 'Cauzione scaduta',
    'on_cauzione_collected': 'Cauzione incassata',
    'on_cauzione_partial_capture': 'Cauzione incassata parziale',
    'on_cauzione_refunded': 'Cauzione restituita',
    // Customer lifecycle
    'on_first_booking': 'Prima prenotazione del cliente',
    'on_inactive_30d': 'Cliente inattivo da 30 giorni',
    'on_inactive_90d': 'Cliente inattivo da 90 giorni',
    'before_birthday': 'Compleanno cliente',
    // Documenti
    'on_doc_uploaded': 'Documento caricato',
    'on_doc_verified': 'Documento verificato',
    // Pagamento
    'on_payment_failed': 'Pagamento fallito',
    'on_payment_link_expired': 'Link pagamento scaduto',
    // Scadenze
    'on_scadenza_3d': 'Scadenza tra 3 giorni',
    'on_scadenza_7d': 'Scadenza tra 7 giorni',
    // Marketing & ops
    'on_review_received': 'Recensione Google ricevuta',
    'on_promo_gap': 'Gap disponibilita\' veicolo',
}

// Stati prenotazione validi per il filtro `target_status` (CSV nel DB).
// Storicamente il default era 'confirmed,active', il che escludeva
// silenziosamente le prenotazioni `pending` (es. on_booking parte solo
// quando il cliente paga). Adesso l'admin sceglie esplicitamente quali
// stati far passare.
const BOOKING_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'pending', label: 'In attesa' },
  { value: 'confirmed', label: 'Confermata' },
  { value: 'active', label: 'Attiva (in corso)' },
  { value: 'in_corso', label: 'In corso' },
  { value: 'completed', label: 'Completata' },
  { value: 'completata', label: 'Completata (legacy)' },
  { value: 'cancelled', label: 'Annullata' },
  { value: 'annullata', label: 'Annullata (legacy)' },
]

function parseStatusCsv(csv: string | null | undefined): Set<string> {
  if (!csv) return new Set()
  return new Set(csv.split(',').map(s => s.trim()).filter(Boolean))
}

function statusCsvLabel(csv: string | null | undefined): string {
  const set = parseStatusCsv(csv)
  if (set.size === 0) return 'Tutti gli stati'
  const labels = BOOKING_STATUS_OPTIONS.filter(o => set.has(o.value)).map(o => o.label)
  if (labels.length === 0) return csv || 'Tutti gli stati'
  if (labels.length <= 3) return labels.join(', ')
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3}`
}

// Italian day-of-week labels (0=Domenica per JS Date)
const DAY_LABELS_IT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']

// Grouping for the "Eventi gestiti" UI panel — raggruppa le legacy keys
// per categoria così l'admin trova subito l'evento giusto invece di
// scorrere una lista piatta di 30+ pillole indistinguibili.
// Tag opzionale `service` su ogni gruppo: indica a quale target_service_type
// è LEGATO il gruppo. Quando il template ha un target_service_type specifico
// (rental / car_wash / mechanical / prime_wash), i gruppi incompatibili
// vengono nascosti e i loro eventi rimossi automaticamente dai handled_events
// (vedi logica in handleUpdateAutomation gate per service-type change).
const EVENT_GROUPS: Array<{ label: string; color: string; keys: string[]; service?: 'rental' | 'car_wash' | 'mechanical' }> = [
  {
    label: 'Noleggio',
    color: 'blue',
    service: 'rental',
    keys: ['rental_new_customer', 'rental_new', 'rental_new_admin', 'rental_modified', 'rental_da_saldare_customer'],
  },
  {
    label: 'Lavaggio / Prime Wash',
    color: 'cyan',
    service: 'car_wash',
    keys: ['carwash_new_customer', 'carwash_new', 'carwash_new_admin', 'carwash_modified'],
  },
  {
    label: 'Meccanica',
    color: 'teal',
    service: 'mechanical',
    keys: ['mechanical_new_customer', 'mechanical_new', 'mechanical_new_admin', 'mechanical_modified'],
  },
  {
    label: 'Firma & Contratto',
    color: 'violet',
    keys: ['signature_request_link', 'document_signature_link', 'signature_reminder_whatsapp', 'signature_otp_whatsapp'],
  },
  {
    label: 'Pagamento',
    color: 'emerald',
    keys: ['payment_link_customer', 'payment_received_extension', 'payment_received_extension_admin', 'payment_received_damages', 'payment_received_damages_admin', 'booking_confirmed_da_saldare'],
  },
  {
    label: 'Cauzione & Annullamento',
    color: 'amber',
    keys: ['deposit_return_iban', 'booking_cancelled_whatsapp', 'website_booking_cancelled_customer'],
  },
  {
    label: 'Admin Alerts',
    color: 'rose',
    keys: ['admin_new_website_quote', 'admin_no_cauzione_request'],
  },
  {
    label: 'Marketing / Wallet / Fidelity',
    color: 'pink',
    keys: ['review_request_whatsapp', 'birthday_message', 'wallet_bonus_credit', 'fidelity_voucher_whatsapp'],
  },
]

/**
 * Filtra EVENT_GROUPS in base al target_service_type del template.
 *   - 'all' / vuoto    → tutti i gruppi
 *   - 'rental'         → nasconde Lavaggio + Meccanica
 *   - 'car_wash'       → nasconde Noleggio + Meccanica
 *   - 'mechanical'     → nasconde Noleggio + Lavaggio
 *   - 'prime_wash'     → nasconde Noleggio (mostra Lavaggio + Meccanica)
 * I gruppi non legati a un singolo servizio (Firma, Pagamento, Cauzione,
 * Admin Alerts, Marketing) sono sempre visibili.
 */
function eventGroupsForServiceType(svc: string | null | undefined): typeof EVENT_GROUPS {
  const s = (svc || 'all').toLowerCase()
  if (s === 'all') return EVENT_GROUPS
  return EVENT_GROUPS.filter(g => {
    if (!g.service) return true
    if (s === 'prime_wash') return g.service === 'car_wash' || g.service === 'mechanical'
    return g.service === s
  })
}

/** Dato un service_type, restituisce il set di event keys incompatibili
    (cioè da rimuovere automaticamente dagli handled_events del template). */
function incompatibleEventsForServiceType(svc: string | null | undefined): Set<string> {
  const allowed = new Set<string>()
  for (const g of eventGroupsForServiceType(svc)) {
    for (const k of g.keys) allowed.add(k)
  }
  const incompat = new Set<string>()
  for (const g of EVENT_GROUPS) {
    for (const k of g.keys) {
      if (!allowed.has(k)) incompat.add(k)
    }
  }
  return incompat
}

/**
 * Restituisce una lista di righe in italiano descrivendo TUTTI i
 * filtri "advanced" attivi sul template. Solo i filtri esplicitamente
 * impostati appaiono — quelli al valore di default (es. "all", null)
 * vengono omessi così la lista non si gonfia di righe inutili.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function listActiveFilters(t: Record<string, any>): string[] {
  const out: string[] = []

  // Tipo servizio
  const svc = (t.target_service_type || 'all').toLowerCase()
  if (svc !== 'all') {
    const map: Record<string, string> = { rental: 'Noleggio', car_wash: 'Lavaggio', mechanical: 'Meccanica' }
    out.push(`Tipo servizio: solo ${map[svc] || svc}`)
  }

  // Cauzione
  const dep = (t.target_with_deposit || 'all').toLowerCase()
  if (dep !== 'all') {
    const map: Record<string, string> = {
      yes: 'solo con cauzione',
      no: 'solo senza cauzione',
      vehicle: 'solo con cauzione veicolo',
      standard: 'solo con cauzione standard (in denaro)',
    }
    out.push(`Cauzione: ${map[dep] || dep}`)
  }

  // Targa
  if (t.target_plate && String(t.target_plate).trim()) {
    out.push(`Targa specifica: ${t.target_plate}`)
  }

  // Metodo pagamento
  const pm = (t.target_payment_method || 'all').toLowerCase()
  if (pm !== 'all') out.push(`Metodo pagamento: solo ${pm}`)

  // Importo
  const amtMin = t.target_amount_min
  const amtMax = t.target_amount_max
  if (amtMin != null || amtMax != null) {
    const lo = amtMin != null ? `€${amtMin}` : '—'
    const hi = amtMax != null ? `€${amtMax}` : '—'
    out.push(`Importo: ${lo} → ${hi}`)
  }

  // Membership tier
  if (t.target_membership_tier && t.target_membership_tier !== 'all') {
    out.push(`Tier DR7 Club: ${t.target_membership_tier}`)
  }

  // Prenotazioni precedenti del cliente
  const pbMin = t.target_min_prev_bookings
  const pbMax = t.target_max_prev_bookings
  if (pbMin != null || pbMax != null) {
    out.push(`Prenotazioni precedenti del cliente: ${pbMin ?? '0'} → ${pbMax ?? '∞'}`)
  }

  // Durata noleggio (giorni)
  const dMin = t.target_rental_duration_min
  const dMax = t.target_rental_duration_max
  if (dMin != null || dMax != null) {
    out.push(`Durata noleggio: ${dMin ?? '1'} → ${dMax ?? '∞'} giorni`)
  }

  // Tag cliente
  if (t.target_customer_tags && String(t.target_customer_tags).trim()) {
    out.push(`Tag cliente: ${t.target_customer_tags}`)
  }

  // Residenza
  if (t.target_residency && t.target_residency !== 'all') {
    out.push(`Residenza: ${t.target_residency}`)
  }

  // Età cliente
  const aMin = t.target_age_min
  const aMax = t.target_age_max
  if (aMin != null || aMax != null) {
    out.push(`Età cliente: ${aMin ?? '—'} → ${aMax ?? '—'} anni`)
  }

  // Ora pickup
  const hMin = t.target_pickup_hour_min
  const hMax = t.target_pickup_hour_max
  if (hMin != null || hMax != null) {
    const fmt = (h: number | null | undefined) => h == null ? '—' : `${String(h).padStart(2, '0')}:00`
    out.push(`Ora ritiro: ${fmt(hMin)} → ${fmt(hMax)}`)
  }

  // Canale acquisizione
  if (t.target_source_channel && t.target_source_channel !== 'all') {
    out.push(`Canale acquisizione: ${t.target_source_channel}`)
  }

  // Provincia
  if (t.target_province && String(t.target_province).trim()) {
    out.push(`Provincia: ${t.target_province}`)
  }

  // Lifetime value
  if (t.target_min_lifetime_value != null) {
    out.push(`Lifetime value minimo: €${t.target_min_lifetime_value}`)
  }

  // Fatture non pagate
  if (t.target_has_unpaid_invoices != null) {
    out.push(`Fatture non pagate: ${t.target_has_unpaid_invoices ? 'sì' : 'no'}`)
  }

  // Promo precedenti
  if (t.target_used_promo_before != null) {
    out.push(`Ha usato promo in passato: ${t.target_used_promo_before ? 'sì' : 'no'}`)
  }

  // Estensioni
  const eMin = t.target_extension_count_min
  const eMax = t.target_extension_count_max
  if (eMin != null || eMax != null) {
    out.push(`Estensioni booking: ${eMin ?? '0'} → ${eMax ?? '∞'}`)
  }

  // Giorni della settimana (escludi se "tutti i giorni 0,1,2,3,4,5,6")
  const days = (t.target_days_of_week || '').split(',').map((s: string) => s.trim()).filter(Boolean)
  if (days.length > 0 && days.length < 7) {
    const sorted = days.map(Number).sort((a: number, b: number) => a - b)
    out.push(`Giorni della settimana: ${sorted.map((d: number) => DAY_LABELS_IT[d]).join(', ')}`)
  }

  // Fascia silenziosa
  if (t.quiet_hours_start != null && t.quiet_hours_end != null) {
    out.push(`Fascia silenziosa (non invia): ${String(t.quiet_hours_start).padStart(2, '0')}:00 → ${String(t.quiet_hours_end).padStart(2, '0')}:00`)
  }

  return out
}

/**
 * Calcola la prossima finestra utile in cui il cron tenterà di
 * inviare il template, basata su send_hour (Europe/Rome).
 *
 *   - send_hour valorizzato: la finestra cron è centrata su
 *     send_hour:00 Rome del giorno target (±19 min: il cron gira
 *     ogni 2 min, finestra LOOKBACK 30 min + LOOKFORWARD 8 min,
 *     centrata sul target). Mostriamo quindi "domani 09:00 Rome"
 *     o "oggi 09:00 Rome" se l'ora non è ancora passata.
 *   - send_hour null: il cron tenta ogni 2 minuti senza vincoli di
 *     ora. Mostriamo semplicemente "entro 2 minuti".
 *
 * Importante: l'invio EFFETTIVO avviene solo se una prenotazione
 * esiste con la data+ora che cade nella finestra di ricerca dei
 * candidati. Questa funzione mostra il PROSSIMO MOMENTO IN CUI IL
 * CRON CONTROLLERÀ, non la garanzia che parta davvero.
 */
function nextCronAttemptText(sendHour: number | null): string {
  if (sendHour == null) {
    return 'entro 2 minuti (cron gira di continuo)'
  }
  // Stato attuale Rome (YYYY-MM-DD HH:mm)
  const now = new Date()
  const romeNow = now.toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }) // "YYYY-MM-DD HH:MM:SS"
  const [datePart, timePart] = romeNow.split(' ')
  const [hh, mm] = (timePart || '00:00').split(':').map(Number)
  const nowMinutes = hh * 60 + mm
  const targetMinutes = sendHour * 60
  // Finestra cron: [target - 30 min, target + 8 min]
  const windowOpen = targetMinutes - 30
  const windowClose = targetMinutes + 8
  const hourStr = `${String(sendHour).padStart(2, '0')}:00 Rome`
  if (nowMinutes < windowOpen) {
    return `oggi alle ${hourStr} (finestra ${String(Math.floor(windowOpen / 60)).padStart(2, '0')}:${String(windowOpen % 60).padStart(2, '0')}–${String(Math.floor(windowClose / 60)).padStart(2, '0')}:${String(windowClose % 60).padStart(2, '0')})`
  }
  if (nowMinutes <= windowClose) {
    return `ADESSO — il cron è nella finestra utile (${hourStr} ±19 min)`
  }
  // Finestra di oggi già chiusa → prossima è domani
  const tomorrow = new Date(`${datePart}T00:00:00`)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowDate = tomorrow.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit' })
  return `domani ${tomorrowDate} alle ${hourStr} (finestra ${String(Math.floor(windowOpen / 60)).padStart(2, '0')}:${String(windowOpen % 60).padStart(2, '0')}–${String(Math.floor(windowClose / 60)).padStart(2, '0')}:${String(windowClose % 60).padStart(2, '0')})`
}

/**
 * Costruisce un riassunto in italiano semplice di QUANDO partirà
 * davvero un template. Considera DUE fonti distinte di invio:
 *   1. Il cron `process-scheduled-system-messages-cron` (controllato da
 *      is_automatic + trigger_event/offset/send_hour/target_*).
 *   2. Eventi di codice che chiamano `renderTemplate('<legacy_key>')`
 *      e vengono instradati a questo template via OLD_TO_PRO. Questi
 *      partono indipendentemente da is_automatic — la chiave Pro è
 *      derivata da `message_key`.
 *
 * Restituisce una lista di righe (una per ogni canale che fa partire
 * il template). Se nessun canale è attivo, l'unica riga è "Manuale —
 * invio solo a mano dall'admin".
 */
function buildScheduleSummary(
  t: { message_key?: string; label?: string | null; is_automatic?: boolean; trigger_event?: string; trigger_offset_hours?: number; send_hour?: number | null; target_status?: string | null; target_category?: string | null },
  categoryLabels: Record<string, string>,
): string[] {
  const lines: string[] = []

  // Eventi di codice che instradano qui — usa SIA message_key SIA label.
  // I template custom (message_key `pro_custom_*`) la cui label corrisponde
  // a uno slot canonico (es. "Conferma Noleggio") vengono riconosciuti
  // tramite LABEL_FALLBACKS, esattamente come fa il resolver server.
  const eventTriggers = getProKeyEventTriggers(t.message_key, t.label)

  // Quando il template è guidato da eventi di codice, il vero
  // momento di invio è l'evento — il cron è solo configurazione
  // residua e mostrare "Cron · invia 24h prima…" è fuorviante.
  // Mostriamo SOLO gli eventi. Il toggle Automatico resta nel pannello
  // di automazione per chi volesse aggiungere un cron secondario,
  // ma il preview Programmazione non lo riflette.
  if (eventTriggers.length > 0) {
    // Template guidato da eventi di codice: il cron lo ignora a monte
    // (vedi process-scheduled-system-messages-cron.ts, skip per
    // eventTriggers.length > 0), quindi il toggle "Automatico" sui
    // template event-driven è di fatto irrilevante. Mostriamo solo le
    // righe Evento e basta — niente cron, niente warning sull'Automatico.
    for (const ev of eventTriggers) {
      lines.push(`Evento · ${ev}`)
    }
    // Per i template event-driven mostriamo comunque i filtri advanced
    // attivi (cauzione, payment method, tier, ecc.) così l'admin sa che
    // l'invio è condizionato anche per il path event-driven (anche se,
    // a oggi, il path event-driven NON applica gli stessi filtri del
    // cron — è un limite noto: callback come signature-complete
    // chiamano renderTemplate diretto. I filtri qui sotto valgono come
    // promemoria di cosa il template "dice di volere".
    for (const f of listActiveFilters(t)) {
      lines.push(`Filtro · ${f}`)
    }
    return lines
  }

  // Da qui in poi: nessun evento di codice instrada a questo template.
  // Quindi il cron è l'UNICA via di invio automatico — mostralo se
  // attivo, altrimenti il template è davvero manuale.
  if (t.is_automatic) {
    // Il triggerLabel contiene già "prima/dopo" (es. "Prima della
    // riconsegna"); strippare quel prefisso dal label prima di
    // concatenare il nostro "${offset}h prima/dopo", altrimenti
    // otteniamo "24h prima prima della riconsegna".
    const rawTriggerLabel = TRIGGER_LABELS[t.trigger_event || ''] || (t.trigger_event || 'evento sconosciuto')
    const cleanTriggerLabel = rawTriggerLabel.replace(/^(prima|dopo)\s+(del|della|dell'|di)\s+/i, '$2 ').toLowerCase()
    const offset = Math.abs(Number(t.trigger_offset_hours) || 0)
    const event = String(t.trigger_event || '')
    const offsetText = offset === 0
      ? 'subito'
      : event.startsWith('before_')
        ? `${offset}h prima`
        : event.startsWith('after_') || event.startsWith('on_')
          ? `${offset}h dopo`
          : `±${offset}h`
    const sendHourText = t.send_hour == null
      ? 'subito'
      : `alle ${String(t.send_hour).padStart(2, '0')}:00 Rome`
    const statusLabel = `stato: ${statusCsvLabel(t.target_status)}`
    const cat = (t.target_category || 'all').toLowerCase()
    const catLabel = cat === 'all' || !cat
      ? 'tutti i veicoli'
      : `solo ${categoryLabels[cat] || cat}`
    lines.push(`Cron · invia ${offsetText} ${cleanTriggerLabel} · ${sendHourText} · ${statusLabel} · ${catLabel}`)
    lines.push(`Prossimo tentativo: ${nextCronAttemptText(t.send_hour ?? null)}`)
    // Filtri advanced del cron — il cron li applica davvero, quindi
    // mostrare tutti quelli attivi è essenziale per capire perché un
    // template "non parte": un filtro stretto (es. "solo cauzione
    // veicolo" o "solo Mastercard") può bloccare l'invio senza
    // segnalazione.
    for (const f of listActiveFilters(t)) {
      lines.push(`Filtro · ${f}`)
    }
  }

  if (lines.length === 0) {
    lines.push('Manuale — non parte automaticamente, solo invio a mano dall\'admin')
  }
  return lines
}

// Descrizioni in linguaggio naturale per ogni evento — mostrate sotto la select.
const TRIGGER_DESCRIPTIONS: Record<string, string> = {
    'before_pickup': 'Il messaggio parte prima del ritiro veicolo. Es. 24 ore prima per ricordare al cliente.',
    'after_pickup': 'Il messaggio parte dopo il ritiro veicolo. Es. 1 ora dopo per chiedere come e\' andato.',
    'before_dropoff': 'Il messaggio parte prima della riconsegna. Es. 24 ore prima per ricordare orario.',
    'after_dropoff': 'Il messaggio parte dopo la riconsegna. Es. 1 ora dopo per richiesta IBAN cauzione.',
    'on_booking': 'Il messaggio parte quando la prenotazione viene creata. Es. 0 ore = subito.',
    'on_payment': 'Il messaggio parte quando il pagamento viene ricevuto.',
    'on_signature': 'Il messaggio parte dopo che il cliente firma il contratto.',
    'on_extension': 'Il messaggio parte dopo una proroga del noleggio.',
    'on_preventivo': 'I preventivi usano un canale separato (vedi Preventivi). Non gestito dal cron.',
    'on_cauzione_created': 'Quando viene aperta una nuova cauzione (in CauzioniTab). Offset 0 = subito.',
    'on_cauzione_due': 'Quando manca poco alla scadenza_cauzione (offset = giorni prima della scadenza).',
    'on_cauzione_overdue': 'Quando la cauzione e\' scaduta (data passata) e non ancora chiusa.',
    'on_cauzione_collected': 'Quando admin segna la cauzione come incassata.',
    'on_cauzione_refunded': 'Quando admin segna la cauzione come restituita al cliente.',
    'on_first_booking': 'Solo alla PRIMA prenotazione di un cliente nuovo. Perfetto per messaggio di benvenuto.',
    'on_inactive_30d': 'Cliente che non prenota da 30 giorni. Cron giornaliero.',
    'on_inactive_90d': 'Cliente che non prenota da 90 giorni. Cron giornaliero.',
    'on_doc_uploaded': 'Quando il cliente carica un documento (patente, CI). Offset 0 = subito.',
    'on_doc_verified': 'Quando admin verifica il documento. Offset 0 = subito.',
    'on_payment_failed': 'Quando un pagamento Nexi fallisce. Offset 0 = subito.',
    'on_payment_link_expired': 'Quando un link di pagamento scade senza pagamento.',
    'on_scadenza_3d': 'Per qualunque scadenza in Scadenze (assicurazione, bollo, ecc.). 3 giorni prima.',
    'on_scadenza_7d': 'Stesso ma 7 giorni prima.',
    'before_signature': 'Promemoria al cliente di firmare il contratto. Offset = ore PRIMA del pickup. Parte solo se signature_signed_at e\' ancora vuoto.',
    'after_signature_review': 'Richiesta recensione X giorni dopo la firma (es. 7 = una settimana dopo). Offset in ore.',
    'on_late_return': 'Quando l\'auto e\' in ritardo oltre la grace di Centralina Pro (default 90 min prima dell\'orario pickup nel giorno di rientro). Cron giornaliero.',
    'before_birthday': 'Compleanno cliente. Default 10 giorni prima dal cron esistente. Offset in ore non modifica (e\' fisso a 10 giorni).',
    'on_review_received': 'Recensione Google ricevuta. Trigger MANUALE: si fa fire da admin via /trigger-system-event quando arriva una review (richiede integrazione esterna).',
    'on_promo_gap': 'Gap di disponibilita\' di un veicolo (4-48h tra due booking). Cron ogni 10 minuti tramite maxi-promo-gap-cron.',
    'on_cauzione_partial_capture': 'Quando l\'admin incassa solo una parte della cauzione (es. €100 su €500 di danno). Inline in CauzioniTab.',
}

// Le categorie veicolo sono caricate dinamicamente da
// centralina_pro_config.config.categories (proCategories nel main component).
// Niente lista hardcoded — l'admin definisce le sue categorie in Centralina
// Pro e quelle si propagano qui in tempo reale.

// ── Legenda variabili template ────────────────────────────────────────────────
// Mirror esatto delle variabili sostituite dai code-path:
//   send-whatsapp-notification (comuni), nexi-nuovo-addebito (email),
//   nexi-payment-callback (link pagamento), signature-* (OTP/firma),
//   send-birthday-messages, cancel-unpaid-nexi-bookings, review-send,
//   generate-penalty-invoice, maxi-promo-gap-cron, promo-incassi-cron.
// Aggiornare in coppia col code-path.
type TemplateVar = { key: string; description: string; example?: string; aliases?: string[] }
type RecipeSnippet = { label: string; snippet: string; preview?: string }
type VarGroup = { label: string; scope: 'common' | 'specific'; scopeNote?: string; items: TemplateVar[]; recipes?: RecipeSnippet[] }
const TEMPLATE_VAR_GROUPS: VarGroup[] = [
    // ═══ SEMPRE DISPONIBILI ═══════════════════════════════════════════════════
    {
        label: 'Cliente',
        scope: 'common',
        items: [
            { key: 'nome', description: 'Solo il nome del cliente', example: 'Marco' },
            { key: 'customer_name', description: 'Nome e cognome completo', example: 'Marco Bianchi', aliases: ['cliente'] },
            { key: 'customer_email', description: 'Email del cliente', example: 'marco@esempio.it' },
            { key: 'customer_phone', description: 'Numero di telefono del cliente', example: '+39 349 1234567' },
        ],
    },
    {
        label: 'Prenotazione',
        scope: 'common',
        items: [
            { key: 'booking_id', description: 'Codice breve della prenotazione', example: 'A1B2C3D4', aliases: ['booking_ref', 'bookingRef'] },
            { key: 'vehicle_name', description: "Modello dell'auto", example: 'Audi RS3' },
            { key: 'plate', description: "Targa dell'auto", example: 'AB123CD', aliases: ['targa'] },
            { key: 'service_name', description: 'Tipo di servizio (lavaggio, tagliando, ecc.)', example: 'Lavaggio Premium', aliases: ['servizio'] },
        ],
    },
    {
        label: 'Luoghi',
        scope: 'common',
        items: [
            { key: 'pickup_location', description: 'Indirizzo di ritiro', example: 'DR7 Cagliari, Via Sonnino 1' },
            { key: 'dropoff_location', description: 'Indirizzo di riconsegna (se vuoto usa il ritiro)', example: 'DR7 Cagliari' },
        ],
    },
    {
        label: 'Date e orari (noleggio)',
        scope: 'common',
        items: [
            { key: 'pickup_date', description: 'Data di ritiro', example: '12/05/2026' },
            { key: 'pickup_time', description: 'Orario di ritiro', example: '11:00' },
            { key: 'dropoff_date', description: 'Data di riconsegna', example: '15/05/2026' },
            { key: 'dropoff_time', description: 'Orario di riconsegna', example: '10:00' },
        ],
    },
    {
        label: 'Date e orari (lavaggio / meccanica)',
        scope: 'common',
        items: [
            { key: 'date', description: "Data dell'appuntamento", example: 'lunedì 12 maggio 2026' },
            { key: 'time', description: "Orario dell'appuntamento", example: '15:30' },
        ],
    },
    {
        label: 'Pagamento',
        scope: 'common',
        items: [
            { key: 'total', description: 'Importo totale in euro', example: '450,00', aliases: ['totale', 'importo', 'amount'] },
            { key: 'payment_status', description: 'Stato del pagamento', example: 'Pagato / Da saldare', aliases: ['pagamento', 'payment_info'] },
            { key: 'deposit', description: 'Cauzione (importo) o "Senza cauzione"', example: '€500 - In attesa' },
        ],
    },
    {
        label: 'Assicurazione e Km',
        scope: 'common',
        items: [
            { key: 'insurance', description: 'Nome assicurazione scelta dal cliente', example: 'Kasko Black' },
            { key: 'km_info', description: 'Km inclusi nel noleggio (numero o "Illimitati")', example: '300 Km / Illimitati' },
            { key: 'km_illimitati', description: 'Riga "Km Illimitati = X,XX" coerente con le altre voci. Se incluso senza sovrapprezzo: "Km Illimitati = Incluso". Vuoto se km limitati (riga rimossa, anche il bullet).', example: 'Km Illimitati = 500,00', aliases: ['unlimited_km'] },
            { key: 'km_illimitati_importo', description: 'Solo l\'importo del pacchetto km illimitati (senza label). Vuoto se non applicabile.', example: '€500,00' },
            { key: 'km_package', description: 'Pacchetto/i km extra acquistati (formato coerente con le altre voci: "<Servizio> <km> Km = <importo>"). Una riga per servizio.', example: 'Pacchetto KM Extra 300 Km = 200,00' },
        ],
    },
    {
        label: 'Note',
        scope: 'common',
        items: [
            { key: 'notes', description: 'Note inserite in prenotazione', example: 'Cliente arriva in serata', aliases: ['note', 'nota'] },
        ],
    },
    {
        label: 'Marketing & Link',
        scope: 'common',
        scopeNote: "Configurabili in Marketing → Social Links. Lì puoi anche aggiungere link personalizzati extra (es. {tiktok}, {youtube}); ognuno diventa una variabile dal titolo che gli dai.",
        items: [
            { key: 'website', description: 'URL del sito DR7', example: 'https://dr7empire.com', aliases: ['sito'] },
            { key: 'review_link', description: 'Link recensione Google', example: 'https://g.page/r/.../review' },
            { key: 'instagram', description: 'URL profilo Instagram', example: 'https://instagram.com/dr7empire' },
            { key: 'facebook', description: 'URL pagina Facebook', example: 'https://facebook.com/dr7empire' },
        ],
    },

    // ═══ DISPONIBILI SOLO IN FLUSSI SPECIFICI ═════════════════════════════════
    {
        label: 'Email Addebito',
        scope: 'specific',
        scopeNote: 'Solo nei template "Email Addebito — Corpo" / "— Oggetto" (flusso Addebito MIT).',
        items: [
            { key: 'contract_ref', description: 'Riferimento del contratto / prenotazione', example: 'DR7-A1B2C3D4' },
            { key: 'causale', description: "Motivo dell'addebito", example: 'Danni carrozzeria' },
        ],
    },
    {
        label: 'Link di Pagamento (Pay by Link)',
        scope: 'specific',
        scopeNote: 'Solo nei template "Richiesta Pagamento" / "Link Pagamento" inviati con Nexi paybylink.',
        items: [
            { key: 'link', description: 'URL completo del link di pagamento Nexi', aliases: ['payment_link'] },
        ],
    },
    {
        label: 'OTP Firma Contratto',
        scope: 'specific',
        scopeNote: 'Solo nel template OTP firma (signature_otp_whatsapp / pro_richiesta_otp).',
        items: [
            { key: 'otp', description: 'Codice OTP a 6 cifre', example: '482917' },
            { key: 'expiryMinutes', description: 'Minuti di validita\' del codice', example: '10' },
        ],
    },
    {
        label: 'Link Firma Documento',
        scope: 'specific',
        scopeNote: 'Solo nei template che inviano un link di firma (document_signature_link / signature_request_link / pro_richiesta_firma).',
        items: [
            { key: 'signerName', description: 'Nome di chi deve firmare', example: 'Marco Bianchi' },
            { key: 'docName', description: 'Nome del documento da firmare', example: 'Contratto DR7-A1B2C3D4', aliases: ['contractNumber'] },
            { key: 'signingUrl', description: 'Link diretto alla pagina di firma' },
        ],
    },
    {
        label: 'Compleanno Cliente',
        scope: 'specific',
        scopeNote: 'Solo nel template Compleanno (birthday_message), riempite dal cron giornaliero.',
        items: [
            { key: 'codice', description: 'Codice sconto generico', example: 'DR7-BIRTH-9F2A' },
            { key: 'codice_supercar', description: 'Codice sconto Supercar' },
            { key: 'codice_noleggio', description: 'Codice sconto noleggio (alias di codice_supercar)' },
            { key: 'codice_lavaggio', description: 'Codice sconto lavaggio premium' },
        ],
    },
    {
        label: 'Cancellazione Prenotazione',
        scope: 'specific',
        scopeNote: 'Solo quando il cron cancel-unpaid-nexi-bookings annulla una prenotazione non pagata.',
        items: [
            { key: 'custName', description: 'Nome cliente' },
            { key: 'bookingRef', description: 'Riferimento prenotazione cancellata' },
            { key: 'link_status', description: 'Stato del link Nexi (disattivato / non trovato)', example: 'disattivato' },
        ],
    },
    {
        label: 'Cashback / Bonus Wallet',
        scope: 'specific',
        scopeNote: 'Solo quando un pagamento card genera cashback DR7 Club (wallet_bonus_credit).',
        items: [
            { key: 'custName', description: 'Nome cliente' },
            { key: 'bonusEur', description: 'Importo cashback in euro', example: '12,00' },
            { key: 'cardLabel', description: 'Tipo carta usata', example: 'Credito / Bancomat' },
            { key: 'percentLabel', description: 'Percentuale cashback applicata', example: '3% / 6%' },
            { key: 'newBalance', description: 'Nuovo saldo wallet dopo il bonus', example: '120,00' },
        ],
    },
    {
        label: 'Voucher Fidelity / Codice Sconto',
        scope: 'specific',
        scopeNote: 'Solo nei template voucher fidelity (250 punti) o codice sconto post-recensione.',
        items: [
            { key: 'codice', description: 'Codice sconto univoco', example: 'DR7-FID-9F2A', aliases: ['code'] },
        ],
    },
    {
        label: 'Fattura PDF',
        scope: 'specific',
        scopeNote: 'Solo quando viene allegata una fattura via WhatsApp (penalty_invoice_pdf_whatsapp / invoice_pdf_whatsapp).',
        items: [
            { key: 'numero_fattura', description: 'Numero progressivo della fattura', example: '2026/00123' },
        ],
    },
    {
        label: 'Maxi Promo Gap / Promo Incassi',
        scope: 'specific',
        scopeNote: 'Solo nei template promozionali generati dai cron (maxi-promo-gap / promo-incassi).',
        items: [
            { key: 'gap_days', description: "Numero di giorni di gap di disponibilita'" },
            { key: 'percentage', description: 'Sconto percentuale offerto', example: '15%' },
            { key: 'hint_link', description: 'Link diretto alla prenotazione del veicolo' },
        ],
    },
    {
        label: 'Preventivo — Veicolo & Date',
        scope: 'specific',
        scopeNote: 'Solo nei template "Preventivo WhatsApp" / "Preventivo senza sconto".',
        items: [
            { key: 'vehicle_year', description: 'Anno modello in formato compatto', example: 'MY2024' },
            { key: 'vehicle_specs', description: 'Specs complete (nome + anno + cv + 0-100)', example: 'Porsche Macan GTS my 2024 440cv 0-100 3,9s' },
            { key: 'vehicle_specs_short', description: 'Solo specs tecniche, senza nome veicolo', example: '440 CV • 0-100 km/h in 3,9s' },
            { key: 'rental_days', description: 'Numero di giorni di noleggio', example: '6' },
            { key: 'daily_rate', description: 'Tariffa giornaliera a listino', example: '€149,00' },
            { key: 'rental_total', description: 'Totale noleggio (giorni × tariffa)', example: '€894,00' },
        ],
    },
    {
        label: 'Preventivo — Voci di costo (per riga)',
        scope: 'specific',
        scopeNote: 'Usali al posto di {pricing_lines} per scegliere quali voci appaiono nel messaggio. Vuoto se la voce non si applica.',
        items: [
            { key: 'rental_line', description: 'Riga noleggio completa', example: '6 giorni — €149,00/giorno = €894,00' },
            { key: 'insurance_line', description: 'Riga assicurazione', example: 'Kasko Base = €534,00' },
            { key: 'lavaggio_line', description: 'Riga lavaggio finale (se incluso)', example: 'Lavaggio Finale = €9,90' },
            { key: 'no_cauzione_line', description: 'Riga No Cauzione (se richiesta)', example: 'No cauzione = €147,00' },
            { key: 'km_line', description: 'Riga km inclusi o illimitati', example: 'Km inclusi: 360 Km' },
            { key: 'second_driver_line', description: 'Riga secondo guidatore', example: 'Secondo guidatore = €60,00' },
            { key: 'dr7_flex_line', description: 'Riga DR7 Flex', example: 'DR7 Flex = €54,00' },
            { key: 'cauzione_veicoli_line', description: 'Riga cauzione veicoli', example: 'Cauzione veicolo = €1.500,00' },
            { key: 'delivery_line', description: 'Riga consegna a domicilio', example: 'Consegna = €40,00' },
            { key: 'pickup_line', description: 'Riga ritiro a domicilio', example: 'Ritiro = €40,00' },
            { key: 'experience_line', description: 'Riga servizi experience', example: 'Servizi experience = €120,00' },
            { key: 'pricing_lines', description: 'Tutte le voci sopra concatenate (legacy)', example: '6 giorni — €149,00/giorno = €894,00\\nKasko Base = €534,00\\n...' },
        ],
    },
    {
        label: 'Preventivo — Totali & Coefficienti',
        scope: 'specific',
        scopeNote: 'Solo nei template Preventivo. Coefficienti opt-in via checkbox al momento dell\'invio.',
        items: [
            { key: 'subtotal_listino', description: 'Subtotale a listino (prima dei coefficienti Pro)', example: '€1.575,00' },
            { key: 'subtotal', description: 'Subtotale dopo coefficienti', example: '€1.434,22' },
            { key: 'total', description: 'Totale finale (sconto applicato se presente)', example: '€1.290,00' },
            { key: 'coefficienti', description: 'Blocco multilinea con tutti i coefficienti applicati', example: 'Coefficienti applicati:\\n- Stagione: x1,15\\n...' },
            { key: 'coefficiente_combinato', description: 'Solo il moltiplicatore combinato', example: 'x1,2143' },
        ],
    },
    {
        label: 'Preventivo — Prezzo & Sconto',
        scope: 'specific',
        scopeNote: 'Solo due variabili da ricordare: {total} e\' SEMPRE il prezzo finale (con o senza sconto), {sconto} e\' la riga sconto (vuota se non c\'e\').',
        items: [
            { key: 'total', description: 'Il prezzo finale (sempre valorizzato)', example: '€1.290,00' },
            { key: 'sconto', description: 'Riga sconto pronta (vuota se nessuno sconto)', example: 'sconto valido 24h €1.290,00', aliases: ['sconto_line'] },
        ],
        recipes: [
            {
                label: 'Preventivo senza sconto',
                snippet: 'Prezzo: {total}',
                preview: 'Prezzo: €1.575,00',
            },
            {
                label: 'Preventivo con sconto (la riga sconto si nasconde se non applicato)',
                snippet: 'Prezzo: {total}\n{sconto}',
                preview: 'Prezzo: €1.290,00\nsconto valido 24h €1.290,00',
            },
        ],
    },
]

function TemplateVarLegend({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
    const [expanded, setExpanded] = useState(defaultOpen)
    // Carica i link personalizzati creati in Marketing → Social Links
    // (centralina_pro_config.config.marketing.custom_links). Ogni link
    // genera un chip aggiuntivo sotto "Marketing & Link" con la propria
    // variabile {<slug>}. Aggiornamento real-time via postgres_changes:
    // l'admin aggiunge un link nel sub-tab Social Links → la legenda qui
    // ne mostra il chip al prossimo render senza refresh.
    const [customLinks, setCustomLinks] = useState<Array<{ slug: string; title: string; url: string }>>([])
    // Stato di "configurato" dei 4 link fissi: se admin svuota il valore in
    // Social Links, il chip corrispondente sparisce dalla legenda. Cosi'
    // l'admin sa subito quali variabili torneranno effettivamente piene.
    const [marketingFixed, setMarketingFixed] = useState<{
        website: boolean; review_link: boolean; instagram: boolean; facebook: boolean
    }>({ website: true, review_link: true, instagram: true, facebook: true })
    useEffect(() => {
        let cancelled = false
        const loadMarketing = async () => {
            const { data } = await supabase
                .from('centralina_pro_config')
                .select('config')
                .eq('id', 'main')
                .maybeSingle()
            if (cancelled) return
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mk = ((data?.config || {}) as any).marketing || {}
            // Custom links
            const raw = Array.isArray(mk.custom_links) ? mk.custom_links : []
            const list: Array<{ slug: string; title: string; url: string }> = []
            for (const l of raw as Array<{ title?: string; url?: string }>) {
                if (typeof l?.title !== 'string' || typeof l?.url !== 'string') continue
                if (!l.url.trim()) continue
                const slug = l.title.toLowerCase().trim()
                    .replace(/[^a-z0-9\s\-_]/g, '')
                    .replace(/[\s\-]+/g, '_')
                    .replace(/_+/g, '_')
                    .replace(/^_|_$/g, '')
                    .substring(0, 30)
                if (slug) list.push({ slug, title: l.title, url: l.url })
            }
            setCustomLinks(list)
            // Fixed: chip visibile solo se URL non vuoto
            setMarketingFixed({
                website: typeof mk.website_url === 'string' && mk.website_url.trim().length > 0,
                review_link: typeof mk.google_review_link === 'string' && mk.google_review_link.trim().length > 0,
                instagram: typeof mk.instagram_url === 'string' && mk.instagram_url.trim().length > 0,
                facebook: typeof mk.facebook_url === 'string' && mk.facebook_url.trim().length > 0,
            })
        }
        loadMarketing()
        const sub = supabase
            .channel('legend-marketing-sync')
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'centralina_pro_config', filter: 'id=eq.main' },
                () => loadMarketing())
            .subscribe()
        return () => { cancelled = true; sub.unsubscribe() }
    }, [])

    const copy = (k: string) => {
        navigator.clipboard?.writeText(`{${k}}`)
        toast.success(`{${k}} copiato — incollalo nel messaggio`)
    }
    // Inietta i custom_links nel gruppo "Marketing & Link" come chip extra,
    // e nasconde i 4 chip fissi quando il rispettivo URL e' vuoto in
    // Marketing → Social Links.
    const groupsWithCustomLinks: VarGroup[] = TEMPLATE_VAR_GROUPS.map(g => {
        if (g.label !== 'Marketing & Link') return g
        const visibleFixed = g.items.filter(it => {
            if (it.key === 'website') return marketingFixed.website
            if (it.key === 'review_link') return marketingFixed.review_link
            if (it.key === 'instagram') return marketingFixed.instagram
            if (it.key === 'facebook') return marketingFixed.facebook
            return true
        })
        const extras: TemplateVar[] = customLinks.map(l => ({
            key: l.slug,
            description: `${l.title} (link personalizzato)`,
            example: l.url,
        }))
        return { ...g, items: [...visibleFixed, ...extras] }
    }).filter(g => g.items.length > 0)
    const totalVars = groupsWithCustomLinks.reduce((s, g) => s + g.items.length, 0)
    return (
        <div className="mt-2 rounded-lg border border-dr7-gold/30 bg-dr7-gold/5 overflow-hidden">
            <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-theme-text-primary hover:bg-dr7-gold/10 transition-colors"
            >
                <span className="flex items-center gap-2 text-left">
                    <svg className="w-4 h-4 text-dr7-gold shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <span>Quali campi posso inserire nel messaggio?</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-dr7-gold/20 text-dr7-gold text-[10px] font-bold">
                        {totalVars} disponibili
                    </span>
                </span>
                <svg
                    className={`w-3.5 h-3.5 text-theme-text-muted transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                </svg>
            </button>
            {expanded && (
                <div className="px-3 pb-3 space-y-4 border-t border-dr7-gold/20">
                    <div className="text-[12px] text-theme-text-secondary mt-3 leading-relaxed">
                        Scrivi il messaggio in italiano normale e quando vuoi inserire un dato del cliente o della prenotazione,
                        usa una di queste etichette tra parentesi graffe (es. <code className="bg-theme-bg-tertiary px-1 rounded text-dr7-gold">{'{nome}'}</code>).
                        Quando il messaggio viene inviato, ogni etichetta viene sostituita automaticamente con il dato reale.
                        <br/>
                        <span className="text-theme-text-muted">Tocca un'etichetta per copiarla negli appunti.</span>
                    </div>

                    {/* FORMATTAZIONE WhatsApp */}
                    <div>
                        <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-sky-500/20">
                            <span className="px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/40 text-[9px] font-bold uppercase tracking-wide">Formattazione</span>
                            <span className="text-[10px] text-theme-text-muted">Caratteri speciali e sintassi WhatsApp — passano nel messaggio cosi' come li scrivi</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {([
                                { code: '•', label: 'Bullet point', preview: '• Voce 1\n• Voce 2', tip: 'Mac: ⌥+8 — Win: Alt+0149' },
                                { code: '·', label: 'Bullet piccolo', preview: '· Voce' },
                                { code: '*testo*', label: 'Grassetto', preview: '*Totale*: €1.290' },
                                { code: '_testo_', label: 'Corsivo', preview: '_valido 24h_' },
                                { code: '~testo~', label: 'Barrato', preview: '~€1.500~ €1.290' },
                                { code: '```testo```', label: 'Monospaziato', preview: '```DR7-A1B2C3```' },
                            ] as const).map(f => (
                                <button
                                    key={f.code}
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard?.writeText(f.code)
                                        toast.success(`${f.code} copiato`)
                                    }}
                                    className="flex items-start gap-2 px-2 py-2 rounded border border-theme-border bg-theme-bg-secondary hover:border-sky-500/50 hover:bg-sky-500/5 text-left transition-colors"
                                    title={'tip' in f ? f.tip : 'Tocca per copiare'}
                                >
                                    <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded text-dr7-gold text-[11px] shrink-0">{f.code}</code>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[11px] font-semibold text-theme-text-primary">{f.label}</div>
                                        <div className="text-[10px] text-theme-text-muted whitespace-pre-line truncate">{f.preview}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* SEMPRE DISPONIBILI */}
                    <div>
                        <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-emerald-500/20">
                            <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[9px] font-bold uppercase tracking-wide">Sempre disponibili</span>
                            <span className="text-[10px] text-theme-text-muted">Funzionano in ogni template Pro inviato in flussi prenotazione</span>
                        </div>
                        <div className="space-y-3">
                            {groupsWithCustomLinks.filter(g => g.scope === 'common').map(group => (
                                <div key={group.label}>
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted mb-1.5">
                                        {group.label}
                                    </div>
                                    {group.scopeNote && (
                                        <div className="text-[10px] text-theme-text-muted/80 italic mb-1.5 leading-tight">{group.scopeNote}</div>
                                    )}
                                    <div className="flex flex-wrap gap-1.5">
                                        {group.items.map(v => (
                                            <button
                                                key={v.key}
                                                type="button"
                                                onClick={() => copy(v.key)}
                                                title={[
                                                    v.description,
                                                    v.example ? `Esempio: ${v.example}` : null,
                                                    v.aliases?.length ? `Alias: ${v.aliases.map(a => `{${a}}`).join(', ')}` : null,
                                                ].filter(Boolean).join('\n')}
                                                className="group inline-flex flex-col items-start px-2 py-1.5 rounded-md bg-theme-bg-primary border border-theme-border hover:border-dr7-gold/60 hover:bg-dr7-gold/5 transition-colors text-left"
                                            >
                                                <code className="font-mono text-[11px] text-dr7-gold leading-tight">{`{${v.key}}`}</code>
                                                <span className="text-[10px] text-theme-text-secondary leading-tight">
                                                    {v.description}
                                                </span>
                                                {v.example && (
                                                    <span className="text-[9px] text-theme-text-muted leading-tight">
                                                        es. {v.example}
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* SOLO IN FLUSSI SPECIFICI */}
                    <div>
                        <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-amber-500/20">
                            <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/40 text-[9px] font-bold uppercase tracking-wide">Solo in flussi specifici</span>
                            <span className="text-[10px] text-theme-text-muted">Funzionano solo se il template viene usato nel flusso indicato</span>
                        </div>
                        <div className="space-y-3">
                            {TEMPLATE_VAR_GROUPS.filter(g => g.scope === 'specific').map(group => (
                                <div key={group.label}>
                                    <div className="flex items-baseline gap-2 mb-1.5">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-theme-text-muted">{group.label}</div>
                                    </div>
                                    {group.scopeNote && (
                                        <div className="text-[10px] text-theme-text-muted/80 italic mb-1.5 leading-tight">{group.scopeNote}</div>
                                    )}
                                    <div className="flex flex-wrap gap-1.5">
                                        {group.items.map(v => (
                                            <button
                                                key={v.key}
                                                type="button"
                                                onClick={() => copy(v.key)}
                                                title={[
                                                    v.description,
                                                    v.example ? `Esempio: ${v.example}` : null,
                                                    v.aliases?.length ? `Alias: ${v.aliases.map(a => `{${a}}`).join(', ')}` : null,
                                                ].filter(Boolean).join('\n')}
                                                className="group inline-flex flex-col items-start px-2 py-1.5 rounded-md bg-theme-bg-primary border border-amber-500/20 hover:border-amber-500/60 hover:bg-amber-500/5 transition-colors text-left"
                                            >
                                                <code className="font-mono text-[11px] text-amber-300 leading-tight">{`{${v.key}}`}</code>
                                                <span className="text-[10px] text-theme-text-secondary leading-tight">
                                                    {v.description}
                                                </span>
                                                {v.example && (
                                                    <span className="text-[9px] text-theme-text-muted leading-tight">
                                                        es. {v.example}
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                    {group.recipes && group.recipes.length > 0 && (
                                        <div className="mt-3 pt-2 border-t border-amber-500/15">
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300/70 mb-1.5">Snippet pronti</div>
                                            <div className="space-y-1.5">
                                                {group.recipes.map((r, i) => (
                                                    <button
                                                        key={i}
                                                        type="button"
                                                        onClick={() => {
                                                            navigator.clipboard?.writeText(r.snippet)
                                                            toast.success(`"${r.label}" copiato`)
                                                        }}
                                                        className="block w-full text-left rounded-md border border-amber-500/20 bg-theme-bg-primary hover:border-amber-500/60 hover:bg-amber-500/5 transition-colors p-2"
                                                    >
                                                        <div className="text-[10px] text-amber-300/90 font-semibold mb-1">{r.label}</div>
                                                        <code className="block font-mono text-[11px] text-theme-text-primary break-all whitespace-pre-wrap">{r.snippet}</code>
                                                        {r.preview && (
                                                            <div className="text-[10px] text-theme-text-muted mt-1 italic">
                                                                Esempio: {r.preview}
                                                            </div>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// Organized by KIND of message (purpose), not by service.
// All pro_* keys start with empty body — admin fills them in from scratch.
type ProTemplateDef = { key: string; label: string; description: string }
const PRO_MESSAGE_CATEGORIES: { label: string; templates: ProTemplateDef[] }[] = [
  // Wrapper messages — top of the list, never numbered.
  {
    label: 'Wrapper Messaggio',
    templates: [
      { key: 'pro_wrapper_header', label: 'Header Messaggio', description: 'Testo in cima a ogni messaggio (opzionale)' },
      { key: 'pro_wrapper_footer', label: 'Footer Messaggio', description: 'Testo in fondo a ogni messaggio (opzionale)' },
    ],
  },
  {
    label: 'Conferma',
    templates: [
      { key: 'pro_conferma_noleggio',          label: 'Conferma Noleggio',             description: 'Conferma al cliente dopo creazione prenotazione noleggio' },
      { key: 'pro_conferma_lavaggio',          label: 'Conferma Lavaggio',             description: 'Conferma al cliente dopo prenotazione lavaggio' },
      { key: 'pro_conferma_meccanica',         label: 'Conferma Meccanica',            description: 'Conferma al cliente dopo prenotazione meccanica' },
      { key: 'pro_conferma_da_saldare',        label: 'Conferma Prenotazione Da Saldare', description: 'Quando admin spunta "Conferma Prenotazione" su un booking ancora da saldare (riusato anche per i pagamenti ricevuti — estensione/danni/top-up — finche\' non avranno slot dedicati)' },
      { key: 'pro_conferma_contratto_firmato', label: 'Conferma Contratto Firmato',    description: 'Conferma dopo firma contratto' },
      { key: 'pro_conferma_preventivo',        label: 'Conferma Preventivo Inviato',   description: 'Conferma invio preventivo al cliente' },
    ],
  },
  {
    label: 'Modifica',
    templates: [
      { key: 'pro_modifica_noleggio',  label: 'Modifica Noleggio',  description: 'Comunicazione al cliente dopo modifica di una prenotazione noleggio' },
      { key: 'pro_modifica_lavaggio',  label: 'Modifica Lavaggio',  description: 'Comunicazione al cliente dopo modifica di una prenotazione lavaggio' },
      { key: 'pro_modifica_meccanica', label: 'Modifica Meccanica', description: 'Comunicazione al cliente dopo modifica di una prenotazione meccanica' },
    ],
  },
  {
    label: 'Email',
    templates: [
      { key: 'pro_email_addebito',         label: 'Email Addebito — Corpo',    description: 'Corpo dell\'email di comunicazione addebito (var: {customer_name}, {contract_ref}, {amount}, {causale})' },
      { key: 'pro_email_addebito_subject', label: 'Email Addebito — Oggetto',  description: 'Oggetto dell\'email di addebito (var: {contract_ref})' },
    ],
  },
  {
    label: 'Promemoria',
    templates: [
      { key: 'pro_promemoria_pickup',        label: 'Promemoria Ritiro',         description: 'Promemoria prima del ritiro veicolo' },
      { key: 'pro_promemoria_dropoff',       label: 'Promemoria Riconsegna',     description: 'Promemoria prima della riconsegna veicolo' },
      { key: 'pro_promemoria_checkin',       label: 'Promemoria Check-in',       description: 'Promemoria check-in lavaggio / meccanica' },
      { key: 'pro_promemoria_checkout',      label: 'Promemoria Check-out',      description: 'Promemoria check-out lavaggio / meccanica' },
      { key: 'pro_promemoria_firma',         label: 'Promemoria Firma',          description: 'Promemoria firma contratto pendente' },
      { key: 'pro_promemoria_pagamento',     label: 'Promemoria Pagamento',      description: 'Promemoria pagamento da saldare' },
      { key: 'pro_promemoria_appuntamento',  label: 'Promemoria Appuntamento',   description: 'Promemoria generico appuntamento' },
    ],
  },
  {
    label: 'Richieste al Cliente',
    templates: [
      { key: 'pro_richiesta_pagamento',  label: 'Richiesta Pagamento',        description: 'Invio link di pagamento al cliente' },
      { key: 'pro_richiesta_firma',      label: 'Richiesta Firma',            description: 'Invio link firma contratto' },
      { key: 'pro_richiesta_otp',        label: 'Richiesta OTP',              description: 'Invio codice OTP per conferma firma' },
      { key: 'pro_richiesta_iban',       label: 'Richiesta IBAN',             description: 'Richiesta IBAN per rimborso cauzione' },
      { key: 'pro_richiesta_documenti',  label: 'Richiesta Documenti',        description: 'Richiesta documenti aggiuntivi al cliente' },
    ],
  },
  {
    label: 'Notifiche Admin',
    templates: [
      { key: 'pro_admin_nuova_prenotazione', label: 'Admin: Nuova Prenotazione', description: 'Alert interno per nuova prenotazione' },
      { key: 'pro_admin_nuovo_preventivo',   label: 'Admin: Nuovo Preventivo',   description: 'Alert interno per nuovo preventivo dal sito' },
      { key: 'pro_admin_contratto_firmato',  label: 'Admin: Contratto Firmato',  description: 'Alert interno dopo firma contratto' },
      { key: 'pro_admin_pagamento_ricevuto', label: 'Admin: Pagamento Ricevuto', description: 'Alert interno dopo pagamento ricevuto' },
      { key: 'pro_admin_annullamento',       label: 'Admin: Annullamento',       description: 'Alert interno per annullamento prenotazione' },
      { key: 'pro_admin_carta_bloccata',     label: 'Admin: Carta Bloccata',     description: 'Alert interno per carta prepagata bloccata' },
    ],
  },
  {
    label: 'Documenti',
    templates: [
      { key: 'pro_documento_contratto', label: 'Invio Contratto PDF',  description: 'Messaggio che accompagna il PDF del contratto' },
      { key: 'pro_documento_fattura',   label: 'Invio Fattura PDF',    description: 'Messaggio che accompagna il PDF della fattura' },
      { key: 'pro_documento_penale',    label: 'Invio Penale PDF',     description: 'Messaggio che accompagna il PDF della penale' },
      { key: 'pro_documento_ricevuta',  label: 'Invio Ricevuta',       description: 'Messaggio che accompagna la ricevuta di pagamento' },
    ],
  },
  {
    label: 'Annullamenti & Rimborsi',
    templates: [
      { key: 'pro_annullamento_cliente', label: 'Annullamento al Cliente', description: 'Comunicazione annullamento prenotazione al cliente' },
      { key: 'pro_rimborso_iniziato',    label: 'Rimborso Iniziato',       description: 'Notifica al cliente che il rimborso è in lavorazione' },
      { key: 'pro_rimborso_completato',  label: 'Rimborso Completato',     description: 'Notifica al cliente a rimborso completato' },
    ],
  },
  {
    label: 'Marketing',
    templates: [
      { key: 'pro_marketing_recensione', label: 'Richiesta Recensione', description: 'Richiesta di recensione dopo il servizio' },
      { key: 'pro_marketing_compleanno', label: 'Messaggio Compleanno', description: 'Auguri di compleanno al cliente' },
      { key: 'pro_marketing_referral',   label: 'Codice Referral',      description: 'Invio codice referral al cliente' },
      { key: 'pro_marketing_rinnovo',    label: 'Promemoria Rinnovo',   description: 'Promemoria rinnovo membership DR7 Club' },
      { key: 'pro_wallet_bonus_cliente', label: 'Bonus Wallet Cliente', description: 'Notifica bonus wallet accreditato al cliente' },
    ],
  },
  {
    label: 'Richieste Preventivo (sito)',
    templates: [
      { key: 'pro_aviation_quote_request', label: 'Richiesta Preventivo Aviation', description: 'Template WhatsApp inviato dal sito (/aviation-quote-request + /helicopter-quote-request) — token: {service}, {nome}, {email}, {telefono}, {partenza}, {arrivo}, {data_partenza}, {data_ritorno}, {passeggeri}, {note}' },
      { key: 'pro_booking_helicopter_inquiry', label: 'Richiesta Elicottero (BookingPage)', description: 'WhatsApp inviato dalla pagina /booking quando il cliente richiede preventivo elicottero — token: {nome}, {email}, {telefono}, {partenza}, {arrivo}, {data_partenza}, {ora_partenza}, {data_ritorno}, {ora_ritorno}, {passeggeri}' },
      { key: 'pro_booking_jet_inquiry', label: 'Richiesta Jet (BookingPage)', description: 'WhatsApp inviato dalla pagina /booking quando il cliente richiede preventivo jet privato — stessi token dell\'elicottero' },
      { key: 'pro_booking_yacht_confirm', label: 'Conferma Yacht (BookingPage)', description: 'WhatsApp inviato dalla pagina /booking dopo conferma yacht — token: {nome}, {email}, {telefono}, {yacht_name}, {marina}, {check_in}, {check_out}, {nights}, {passeggeri}, {totale}' },
    ],
  },
  {
    label: 'Pagamento Riuscito (sito)',
    templates: [
      { key: 'pro_payment_success_rental', label: 'PaymentSuccess — Noleggio', description: 'WhatsApp inviato dalla pagina /payment-success per prenotazione auto/yacht/jet/helicopter — token: {id}, {cliente}, {email}, {telefono}, {veicolo}, {ritiro}, {ora_ritiro}, {riconsegna}, {ora_riconsegna}, {totale}, {stato_pagamento}' },
      { key: 'pro_payment_success_appointment', label: 'PaymentSuccess — Appuntamento (lavaggio/meccanica)', description: 'WhatsApp inviato dalla pagina /payment-success per car wash / meccanica — token: {id}, {cliente}, {email}, {telefono}, {servizio}, {data}, {ora}, {totale}, {stato_pagamento}' },
    ],
  },
  {
    label: 'Wrapper Messaggio',
    templates: [
      { key: 'pro_wrapper_header', label: 'Header Messaggio', description: 'Testo in cima a ogni messaggio (opzionale)' },
      { key: 'pro_wrapper_footer', label: 'Footer Messaggio', description: 'Testo in fondo a ogni messaggio (opzionale)' },
    ],
  },
]

const ALL_PRO_TEMPLATES: ProTemplateDef[] = PRO_MESSAGE_CATEGORIES.flatMap(c => c.templates)

// Wrappers are never numbered and never bulk-deleted by "Elimina non attivi"
const WRAPPER_KEYS = new Set(['pro_wrapper_header', 'pro_wrapper_footer'])


export default function MessaggiSistemaProTab() {
    // Template state
    const [templates, setTemplates] = useState<SystemMessage[]>([])
    const [loading, setLoading] = useState(true)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editBody, setEditBody] = useState('')
    const [editLabel, setEditLabel] = useState('')
    const [saving, setSaving] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    // New template form
    const [showNewForm, setShowNewForm] = useState(false)
    // Custom variables management (Sprint autonomia 3)
    const [showCustomVars, setShowCustomVars] = useState(false)
    const [customVarsList, setCustomVarsList] = useState<Array<{
        id: string; key: string; value: string; description: string | null; is_enabled: boolean
    }>>([])
    const [newCustomVarKey, setNewCustomVarKey] = useState('')
    const [newCustomVarValue, setNewCustomVarValue] = useState('')
    const [newCustomVarDescription, setNewCustomVarDescription] = useState('')
    const [newLabel, setNewLabel] = useState('')
    const [newDescription, setNewDescription] = useState('')
    const [newBody, setNewBody] = useState('')
    const [newIsAutomatic, setNewIsAutomatic] = useState(false)
    const [newTriggerEvent, setNewTriggerEvent] = useState('before_dropoff')
    const [newTriggerOffset, setNewTriggerOffset] = useState(24)
    const [newSendHour, setNewSendHour] = useState<number | null>(9)
    const [newTargetCategory, setNewTargetCategory] = useState('all')
    // Stati prenotazione esplicitamente selezionati nel form di creazione.
    // Default `confirmed,active` per retro-compat: prima era hardcoded e
    // l'admin non aveva modo di saperlo. Set vuoto = "tutti gli stati".
    const [newTargetStatus, setNewTargetStatus] = useState<Set<string>>(new Set(['confirmed', 'active']))

    // Diagnostica per ogni template: ultimi invii dal cron + bottone di
    // test che bypassa finestra temporale, dedup e filtri. Il test
    // NON usa booking fittizie: l'admin sceglie una prenotazione REALE
    // tra le ultime salvate in DB, così le variabili del template
    // vengono sostituite con dati veri.
    const [expandedDiagnostics, setExpandedDiagnostics] = useState<Set<string>>(new Set())
    // Pannello "Filtri avanzati" per-template — collapsible, default chiuso.
    // Permette all'admin di editare days_of_week / cauzione / payment method
    // / amount range / quiet hours senza ricreare il template.
    const [expandedAdvanced, setExpandedAdvanced] = useState<Set<string>>(new Set())
    const [templateSendLogs, setTemplateSendLogs] = useState<Record<string, Array<{ id: string; booking_id: string | null; customer_phone: string | null; status: string; error: string | null; created_at: string }>>>({})
    const [loadingLogsFor, setLoadingLogsFor] = useState<string | null>(null)
    const [testPhones, setTestPhones] = useState<Record<string, string>>({})
    const [testBookingIds, setTestBookingIds] = useState<Record<string, string>>({})
    const [testingId, setTestingId] = useState<string | null>(null)
    // Elenco delle ultime prenotazioni reali, caricate dal DB al primo
    // utilizzo della diagnostica. Servono per popolare la dropdown
    // "Seleziona prenotazione" del test — l'admin sceglie SOLO da dati
    // veri presenti in `bookings`, niente record sintetici.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [recentBookings, setRecentBookings] = useState<any[]>([])
    const [recentBookingsLoading, setRecentBookingsLoading] = useState(false)
    const [recentBookingsLoaded, setRecentBookingsLoaded] = useState(false)
    // Filtri avanzati (migration 20260509)
    const [newTargetServiceType, setNewTargetServiceType] = useState('all')
    const [newTargetWithDeposit, setNewTargetWithDeposit] = useState('all')
    const [newTargetPaymentMethod, setNewTargetPaymentMethod] = useState('all')
    const [newTargetAmountMin, setNewTargetAmountMin] = useState('')
    const [newTargetAmountMax, setNewTargetAmountMax] = useState('')
    // Giorni settimana attivi (0=Dom, 1=Lun,...6=Sab). Default tutti.
    const [newTargetDays, setNewTargetDays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]))
    const [newQuietHoursEnabled, setNewQuietHoursEnabled] = useState(false)
    const [newQuietStart, setNewQuietStart] = useState<number>(22)
    const [newQuietEnd, setNewQuietEnd] = useState<number>(7)
    // Sprint autonomia 1: 5 nuovi filtri pubblico
    const [newTargetMembershipTier, setNewTargetMembershipTier] = useState('all')
    const [newTargetMinPrevBookings, setNewTargetMinPrevBookings] = useState('')
    const [newTargetRentalDurationMin, setNewTargetRentalDurationMin] = useState('')
    const [newTargetRentalDurationMax, setNewTargetRentalDurationMax] = useState('')
    const [newTargetCustomerTags, setNewTargetCustomerTags] = useState('')
    // Sprint autonomia 2: 12 ulteriori filtri
    const [newTargetResidency, setNewTargetResidency] = useState('all')
    const [newTargetMaxPrevBookings, setNewTargetMaxPrevBookings] = useState('')
    const [newTargetAgeMin, setNewTargetAgeMin] = useState('')
    const [newTargetAgeMax, setNewTargetAgeMax] = useState('')
    const [newTargetPickupHourMin, setNewTargetPickupHourMin] = useState('')
    const [newTargetPickupHourMax, setNewTargetPickupHourMax] = useState('')
    const [newTargetSourceChannel, setNewTargetSourceChannel] = useState('all')
    const [newTargetProvince, setNewTargetProvince] = useState('')
    const [newTargetMinLifetimeValue, setNewTargetMinLifetimeValue] = useState('')
    const [newTargetHasUnpaidInvoices, setNewTargetHasUnpaidInvoices] = useState<'any' | 'yes' | 'no'>('any')
    const [newTargetUsedPromoBefore, setNewTargetUsedPromoBefore] = useState<'any' | 'yes' | 'no'>('any')
    const [newTargetExtensionCountMin, setNewTargetExtensionCountMin] = useState('')
    const [newTargetExtensionCountMax, setNewTargetExtensionCountMax] = useState('')

    /**
     * Riporta TUTTI i campi del form "Nuovo Messaggio" ai default. Va
     * invocata sia quando si apre il form (così non si trascina lo stato
     * della sessione precedente) sia quando si annulla. Prima il bug era
     * che soltanto label/description/body venivano resettati al Cancel:
     * `is_automatic` e i campi schedule (trigger_event, offset, send_hour,
     * target_status, ecc.) restavano dalla volta precedente e potevano
     * finire silenziosamente nell'insert successivo, generando il caso
     * "ho selezionato Automatico ma in lista appare Manuale" o viceversa.
     */
    function resetNewForm() {
        setNewLabel('')
        setNewDescription('')
        setNewBody('')
        setNewIsAutomatic(false)
        setNewTriggerEvent('before_dropoff')
        setNewTriggerOffset(24)
        setNewSendHour(9)
        setNewTargetCategory('all')
        setNewTargetStatus(new Set(['confirmed', 'active']))
        setNewTargetServiceType('all')
        setNewTargetWithDeposit('all')
        setNewTargetPaymentMethod('all')
        setNewTargetAmountMin('')
        setNewTargetAmountMax('')
        setNewTargetDays(new Set([0, 1, 2, 3, 4, 5, 6]))
        setNewQuietHoursEnabled(false)
        setNewQuietStart(22)
        setNewQuietEnd(7)
        setNewTargetMembershipTier('all')
        setNewTargetMinPrevBookings('')
        setNewTargetRentalDurationMin('')
        setNewTargetRentalDurationMax('')
        setNewTargetCustomerTags('')
        setNewTargetResidency('all')
        setNewTargetMaxPrevBookings('')
        setNewTargetAgeMin('')
        setNewTargetAgeMax('')
        setNewTargetPickupHourMin('')
        setNewTargetPickupHourMax('')
        setNewTargetSourceChannel('all')
        setNewTargetProvince('')
        setNewTargetMinLifetimeValue('')
        setNewTargetHasUnpaidInvoices('any')
        setNewTargetUsedPromoBefore('any')
        setNewTargetExtensionCountMin('')
        setNewTargetExtensionCountMax('')
    }
    // Categorie reali caricate da Centralina Pro (config.categories) — niente
    // hardcoded fallback. Aggiornamento real-time via postgres_changes.
    const [proCategories, setProCategories] = useState<Array<{ id: string; label: string }>>([])
    // Tier DR7 Club caricati DINAMICAMENTE da Centralina Pro
    // (centralina_pro_config.config.dr7_club.tiers). Niente lista hardcoded —
    // se il boss aggiunge "Diamond" in Centralina Pro, qui appare in tempo reale.
    const [proTiers, setProTiers] = useState<Array<{ id: string; label: string }>>([])
    // Source channels caricati DINAMICAMENTE dai valori effettivamente
    // presenti in customers_extended.source. Niente lista hardcoded —
    // se il boss importa clienti da TikTok, "tiktok" appare nel dropdown.
    const [sourceChannels, setSourceChannels] = useState<string[]>([])
    useEffect(() => {
        let cancelled = false
        const loadChannels = async () => {
            const { data } = await supabase
                .from('customers_extended')
                .select('source')
                .not('source', 'is', null)
                .limit(1000)
            if (cancelled || !data) return
            // Distinct + ordinati
            const seen = new Set<string>()
            for (const row of data) {
                const v = (row as { source?: unknown }).source
                if (typeof v === 'string' && v.trim()) seen.add(v.trim())
            }
            setSourceChannels(Array.from(seen).sort())
        }
        loadChannels()
        return () => { cancelled = true }
    }, [])
    // Payment methods caricati da payment_method_config table (admin-managed).
    const [paymentMethods, setPaymentMethods] = useState<Array<{ key: string; label: string }>>([])
    useEffect(() => {
        let cancelled = false
        const load = async () => {
            const { data } = await supabase
                .from('payment_method_config')
                .select('key, label, is_enabled, sort_order')
                .eq('is_enabled', true)
                .order('sort_order', { ascending: true })
            if (cancelled || !data) return
            setPaymentMethods(
                data
                    .filter((r: { key?: unknown; label?: unknown }) => typeof r?.key === 'string' && typeof r?.label === 'string')
                    .map((r: { key: string; label: string }) => ({ key: r.key, label: r.label }))
            )
        }
        load()
        return () => { cancelled = true }
    }, [])
    useEffect(() => {
        let cancelled = false
        const load = async () => {
            const { data } = await supabase
                .from('centralina_pro_config')
                .select('config')
                .eq('id', 'main')
                .maybeSingle()
            if (cancelled) return
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const config = (data?.config || {}) as any
            const cats = config.categories
            if (Array.isArray(cats)) {
                setProCategories(
                    cats.filter((c: { id?: unknown; label?: unknown }) => typeof c?.id === 'string' && typeof c?.label === 'string')
                )
            }
            // Estrai i tier attivi dal DR7 Club
            const tiersRaw = config.dr7_club?.tiers
            if (Array.isArray(tiersRaw)) {
                setProTiers(
                    tiersRaw
                        .filter((t: { id?: unknown; label?: unknown; is_active?: unknown }) =>
                            typeof t?.id === 'string'
                            && typeof t?.label === 'string'
                            && t.is_active !== false)
                        .map((t: { id: string; label: string }) => ({ id: t.id, label: t.label }))
                )
            } else {
                setProTiers([])
            }
        }
        load()
        const sub = supabase
            .channel('msgpro-categories-sync')
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'centralina_pro_config', filter: 'id=eq.main' },
                () => load())
            .subscribe()
        return () => { cancelled = true; sub.unsubscribe() }
    }, [])
    const [creatingNew, setCreatingNew] = useState(false)

    // Send section state
    const [sendMode, setSendMode] = useState<'template' | 'free'>('template')
    const [selectedTemplateId, setSelectedTemplateId] = useState('')
    const [freeText, setFreeText] = useState('')
    const [customerSearch, setCustomerSearch] = useState('')
    const [customerResults, setCustomerResults] = useState<CustomerResult[]>([])
    const [selectedCustomers, setSelectedCustomers] = useState<CustomerResult[]>([])
    const [searching, setSearching] = useState(false)
    const [sending, setSending] = useState(false)
    const [sendProgress, setSendProgress] = useState({ current: 0, total: 0 })
    const [showResults, setShowResults] = useState(false)
    const searchRef = useRef<HTMLDivElement>(null)

    // Sent messages log
    const [sentLogs, setSentLogs] = useState<SentMessageLog[]>([])
    const [logsLoading, setLogsLoading] = useState(false)

    useEffect(() => {
        loadTemplates()
        loadSentLogs()
    }, [])

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setShowResults(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // Carica le variabili custom (riusate via {key} nei template)
    async function loadCustomVariables() {
        const { data, error } = await supabase
            .from('system_message_variables')
            .select('id, key, value, description, is_enabled')
            .order('key', { ascending: true })
        if (error) {
            console.error('loadCustomVariables error:', error)
            return
        }
        if (Array.isArray(data)) setCustomVarsList(data)
    }
    useEffect(() => { loadCustomVariables() }, [])

    async function handleCreateCustomVar() {
        const key = newCustomVarKey.trim()
        if (!key) { toast.error('La chiave e\' obbligatoria'); return }
        // Validate: only [a-z0-9_]
        if (!/^[a-z0-9_]+$/.test(key)) {
            toast.error('Solo lettere minuscole, numeri e underscore (es. address_main)')
            return
        }
        const { error } = await supabase
            .from('system_message_variables')
            .insert({
                key,
                value: newCustomVarValue,
                description: newCustomVarDescription.trim() || null,
                is_enabled: true,
            })
        if (error) {
            toast.error(`Errore: ${error.message}`)
            return
        }
        toast.success(`Variabile {${key}} creata`)
        setNewCustomVarKey('')
        setNewCustomVarValue('')
        setNewCustomVarDescription('')
        loadCustomVariables()
    }

    async function handleUpdateCustomVar(id: string, patch: Partial<{ value: string; description: string | null; is_enabled: boolean }>) {
        const { error } = await supabase
            .from('system_message_variables')
            .update(patch)
            .eq('id', id)
        if (error) { toast.error(`Errore: ${error.message}`); return }
        setCustomVarsList(prev => prev.map(v => v.id === id ? { ...v, ...patch } : v))
    }

    async function handleDeleteCustomVar(id: string, key: string) {
        if (!confirm(`Eliminare la variabile {${key}}? I template che la usano lasceranno il testo "{${key}}" grezzo.`)) return
        const { error } = await supabase
            .from('system_message_variables')
            .delete()
            .eq('id', id)
        if (error) { toast.error(`Errore: ${error.message}`); return }
        toast.success(`Variabile {${key}} eliminata`)
        setCustomVarsList(prev => prev.filter(v => v.id !== id))
    }

    async function loadTemplates() {
        setLoading(true)
        try {
            // Fetch every pro_* row AND any pro_custom_* the admin created
            const { data, error } = await supabase
                .from('system_messages')
                .select('*')
                .like('message_key', 'pro_%')
                .order('created_at', { ascending: true })

            if (error) throw error
            let rows = data || []

            // Auto-seed all pro_* rows ONLY on first-ever visit (zero rows exist).
            // After that, respect user deletions — a deleted template must stay deleted.
            const missing = rows.length === 0
                ? ALL_PRO_TEMPLATES
                : []
            if (missing.length > 0) {
                const toInsert = missing.map(t => ({
                    message_key: t.key,
                    label: t.label,
                    description: t.description,
                    message_body: '',
                    is_automatic: false,
                    is_enabled: false,
                    include_header: false,
                    trigger_event: 'before_dropoff',
                    trigger_offset_hours: 24,
                    send_hour: 9,
                    target_category: 'all',
                    target_status: 'confirmed,active',
                }))
                const { data: inserted, error: insErr } = await supabase
                    .from('system_messages')
                    .insert(toInsert)
                    .select()
                if (insErr) {
                    console.error('Auto-seed pro templates failed:', insErr)
                } else if (inserted) {
                    rows = [...rows, ...inserted]
                }
            }

            // One-time cleanup: flip include_header=false on untouched seeded rows
            // (empty body + manual + disabled = admin hasn't configured yet)
            const untouchedWithHeader = rows.filter(r =>
                r.include_header === true &&
                !r.message_body &&
                r.is_automatic === false &&
                r.is_enabled === false
            )
            if (untouchedWithHeader.length > 0) {
                const ids = untouchedWithHeader.map(r => r.id)
                const { error: upErr } = await supabase
                    .from('system_messages')
                    .update({ include_header: false })
                    .in('id', ids)
                if (upErr) {
                    console.error('Reset include_header on untouched pro rows failed:', upErr)
                } else {
                    rows = rows.map(r => ids.includes(r.id) ? { ...r, include_header: false } : r)
                }
            }

            setTemplates(rows)
        } catch (err: unknown) {
            console.error('Error loading templates:', err)
            toast.error('Errore caricamento messaggi')
        } finally {
            setLoading(false)
        }
    }

    async function loadSentLogs() {
        setLogsLoading(true)
        try {
            const { data, error } = await supabase
                .from('sent_messages_log')
                .select('*')
                .order('sent_at', { ascending: false })
                .limit(100)

            if (error && error.code !== '42P01') throw error
            setSentLogs(data || [])
        } catch (err: unknown) {
            console.error('Error loading sent logs:', err)
        } finally {
            setLogsLoading(false)
        }
    }

    async function handleSaveEdit(id: string) {
        const trimmedLabel = editLabel.trim()
        if (!trimmedLabel) {
            toast.error('Il titolo non può essere vuoto')
            return
        }
        setSaving(true)
        try {
            // Try the Netlify function first (service-role, bypasses RLS).
            // Fall back to direct supabase.update() if the function errors.
            const updatedAt = new Date().toISOString()
            const payload = { message_body: editBody, label: trimmedLabel }
            let saved = false
            try {
                const response = await authFetch('/.netlify/functions/update-system-message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, ...payload })
                })
                if (response.ok) {
                    saved = true
                } else {
                    const result = await response.json().catch(() => ({}))
                    console.warn('[Pro] update-system-message fn failed, falling back:', result)
                }
            } catch (fnErr) {
                console.warn('[Pro] update-system-message fn threw, falling back:', fnErr)
            }

            if (!saved) {
                const { data, error } = await supabase
                    .from('system_messages')
                    .update({ ...payload, updated_at: updatedAt })
                    .eq('id', id)
                    .select()
                    .single()
                if (error) throw error
                if (!data) throw new Error('Nessuna riga aggiornata')
            }

            // Re-fetch to be certain DB state matches UI
            const { data: fresh } = await supabase
                .from('system_messages')
                .select('*')
                .eq('id', id)
                .single()
            if (fresh) {
                setTemplates(prev => prev.map(t => t.id === id ? fresh : t))
            } else {
                setTemplates(prev => prev.map(t => t.id === id ? { ...t, ...payload, updated_at: updatedAt } : t))
            }
            setEditingId(null)
            toast.success('Messaggio salvato')
        } catch (err: unknown) {
            const _errMsg = err instanceof Error ? err.message : String(err)
            console.error('Error saving template:', err)
            toast.error('Errore salvataggio: ' + _errMsg)
        } finally {
            setSaving(false)
        }
    }

    async function handleCreateTemplate() {
        if (!newLabel.trim()) {
            toast.error('Il nome del messaggio è obbligatorio')
            return
        }
        setCreatingNew(true)
        const messageKey = 'pro_custom_' + newLabel
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 40) + '_' + Date.now()

        try {
            const { data, error } = await supabase
                .from('system_messages')
                .insert({
                    message_key: messageKey,
                    label: newLabel.trim(),
                    description: newDescription.trim(),
                    message_body: newBody.trim(),
                    is_automatic: newIsAutomatic,
                    is_enabled: true,
                    trigger_event: newTriggerEvent,
                    trigger_offset_hours: newTriggerOffset,
                    send_hour: newSendHour,
                    target_category: newTargetCategory,
                    // Stati esplicitamente scelti dall'admin nel form. Se
                    // l'utente non ne ha selezionato nessuno passa stringa
                    // vuota = "tutti gli stati" (la cron tratta vuoto come
                    // fallback al default `confirmed,active`).
                    target_status: Array.from(newTargetStatus).join(','),
                    target_service_type: newTargetServiceType,
                    target_with_deposit: newTargetWithDeposit,
                    target_payment_method: newTargetPaymentMethod,
                    target_amount_min: newTargetAmountMin ? parseFloat(newTargetAmountMin) : null,
                    target_amount_max: newTargetAmountMax ? parseFloat(newTargetAmountMax) : null,
                    target_days_of_week: Array.from(newTargetDays).sort((a, b) => a - b).join(','),
                    quiet_hours_start: newQuietHoursEnabled ? newQuietStart : null,
                    quiet_hours_end: newQuietHoursEnabled ? newQuietEnd : null,
                    target_membership_tier: newTargetMembershipTier === 'all' ? null : newTargetMembershipTier,
                    target_min_prev_bookings: newTargetMinPrevBookings ? parseInt(newTargetMinPrevBookings, 10) : null,
                    target_rental_duration_min: newTargetRentalDurationMin ? parseInt(newTargetRentalDurationMin, 10) : null,
                    target_rental_duration_max: newTargetRentalDurationMax ? parseInt(newTargetRentalDurationMax, 10) : null,
                    target_customer_tags: newTargetCustomerTags.trim() || null,
                    target_residency: newTargetResidency === 'all' ? null : newTargetResidency,
                    target_max_prev_bookings: newTargetMaxPrevBookings ? parseInt(newTargetMaxPrevBookings, 10) : null,
                    target_age_min: newTargetAgeMin ? parseInt(newTargetAgeMin, 10) : null,
                    target_age_max: newTargetAgeMax ? parseInt(newTargetAgeMax, 10) : null,
                    target_pickup_hour_min: newTargetPickupHourMin ? parseInt(newTargetPickupHourMin, 10) : null,
                    target_pickup_hour_max: newTargetPickupHourMax ? parseInt(newTargetPickupHourMax, 10) : null,
                    target_source_channel: newTargetSourceChannel === 'all' ? null : newTargetSourceChannel,
                    target_province: newTargetProvince.trim() || null,
                    target_min_lifetime_value: newTargetMinLifetimeValue ? parseFloat(newTargetMinLifetimeValue) : null,
                    target_has_unpaid_invoices: newTargetHasUnpaidInvoices === 'any' ? null : newTargetHasUnpaidInvoices === 'yes',
                    target_used_promo_before: newTargetUsedPromoBefore === 'any' ? null : newTargetUsedPromoBefore === 'yes',
                    target_extension_count_min: newTargetExtensionCountMin ? parseInt(newTargetExtensionCountMin, 10) : null,
                    target_extension_count_max: newTargetExtensionCountMax ? parseInt(newTargetExtensionCountMax, 10) : null,
                })
                .select()
                .single()

            if (error) throw error
            setTemplates(prev => [...prev, data])
            setShowNewForm(false)
            setNewLabel('')
            setNewDescription('')
            setNewBody('')
            setNewIsAutomatic(false)
            setNewTriggerEvent('before_dropoff')
            setNewTriggerOffset(24)
            setNewSendHour(9)
            setNewTargetCategory('all')
            setNewTargetStatus(new Set(['confirmed', 'active']))
            toast.success('Nuovo messaggio Pro creato')
        } catch (err: unknown) {
            const _errMsg = err instanceof Error ? err.message : String(err)
            console.error('Error creating template:', err)
            toast.error('Errore creazione: ' + _errMsg)
        } finally {
            setCreatingNew(false)
        }
    }

    async function handleToggleAutomatic(template: SystemMessage) {
        try {
            const newVal = !template.is_automatic
            const { error } = await supabase
                .from('system_messages')
                .update({ is_automatic: newVal, updated_at: new Date().toISOString() })
                .eq('id', template.id)
            if (error) throw error
            setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, is_automatic: newVal } : t))
            toast.success(newVal ? 'Invio automatico attivato' : 'Invio automatico disattivato')
        } catch (err: unknown) {
            const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + _errMsg)
        }
    }

    async function handleToggleEnabled(template: SystemMessage) {
        try {
            const newVal = !template.is_enabled
            const { error } = await supabase
                .from('system_messages')
                .update({ is_enabled: newVal, updated_at: new Date().toISOString() })
                .eq('id', template.id)
            if (error) throw error
            setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, is_enabled: newVal } : t))
            toast.success(newVal ? 'Messaggio attivato' : 'Messaggio disattivato')
        } catch (err: unknown) {
            const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + _errMsg)
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function handleUpdateAutomation(templateId: string, field: string, value: any) {
        try {
            const { error } = await supabase
                .from('system_messages')
                .update({ [field]: value, updated_at: new Date().toISOString() })
                .eq('id', templateId)
            if (error) throw error
            setTemplates(prev => prev.map(t => t.id === templateId ? { ...t, [field]: value } : t))
        } catch (err: unknown) {
            const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore: ' + _errMsg)
        }
    }

    /** Carica gli ultimi 10 invii dal cron per uno specifico template. */
    async function loadTemplateSendLog(templateId: string) {
        setLoadingLogsFor(templateId)
        try {
            const { data, error } = await supabase
                .from('system_message_send_log')
                .select('id, booking_id, customer_phone, status, error, created_at')
                .eq('system_message_id', templateId)
                .order('created_at', { ascending: false })
                .limit(10)
            if (error && error.code !== '42P01') throw error
            setTemplateSendLogs(prev => ({ ...prev, [templateId]: data || [] }))
        } catch (err) {
            console.error('Error loading template send log:', err)
            setTemplateSendLogs(prev => ({ ...prev, [templateId]: [] }))
        } finally {
            setLoadingLogsFor(null)
        }
    }

    function toggleDiagnostics(template: SystemMessage) {
        setExpandedDiagnostics(prev => {
            const next = new Set(prev)
            if (next.has(template.id)) {
                next.delete(template.id)
            } else {
                next.add(template.id)
                // Lazy-load logs the first time the panel opens for this template
                if (!templateSendLogs[template.id]) loadTemplateSendLog(template.id)
                // Lazy-load the recent-bookings list once (shared across templates)
                if (!recentBookingsLoaded && !recentBookingsLoading) loadRecentBookings()
            }
            return next
        })
    }

    /** Carica le ultime 30 prenotazioni reali (in ordine di creazione)
        per popolare la dropdown di selezione del test. Solo dati veri:
        l'admin sceglie una prenotazione esistente, niente sintetico. */
    async function loadRecentBookings() {
        setRecentBookingsLoading(true)
        try {
            const { data, error } = await supabase
                .from('bookings')
                .select('id, customer_name, customer_phone, vehicle_name, pickup_date, dropoff_date, appointment_date, status, payment_status, service_type, created_at')
                .order('created_at', { ascending: false })
                .limit(30)
            if (error) throw error
            setRecentBookings(data || [])
            setRecentBookingsLoaded(true)
        } catch (err) {
            console.error('Error loading recent bookings:', err)
            setRecentBookings([])
        } finally {
            setRecentBookingsLoading(false)
        }
    }

    /**
     * Invia un messaggio di prova al numero indicato usando esattamente lo
     * stesso pipeline del cron (send-whatsapp-notification → renderTemplate
     * dal DB → Green API). Bypassa finestra temporale e dedup: serve a
     * verificare che il TEMPLATE arrivi correttamente, non che le regole
     * di scheduling siano soddisfatte.
     *
     * NIENTE DATI HARDCODED: l'admin sceglie una PRENOTAZIONE REALE dalla
     * dropdown e la funzione carica quella riga completa da Supabase. Le
     * variabili del template ({nome}, {vehicle_name}, {pickup_date}…)
     * vengono quindi sostituite con i valori effettivi di quella booking,
     * esattamente come farebbe il cron.
     */
    async function handleTestSend(template: SystemMessage) {
        const phoneRaw = (testPhones[template.id] || '').trim()
        if (!phoneRaw) {
            toast.error('Inserisci un numero di telefono per il test')
            return
        }
        const phone = phoneRaw.replace(/[^\d+]/g, '')
        if (phone.length < 8) {
            toast.error('Numero di telefono non valido')
            return
        }
        const bookingId = (testBookingIds[template.id] || '').trim()
        if (!bookingId) {
            toast.error('Seleziona una prenotazione reale dalla lista')
            return
        }
        if (!template.message_body || !template.message_body.trim()) {
            toast.error('Il template è vuoto: scrivi prima il messaggio')
            return
        }
        setTestingId(template.id)
        try {
            // Carica la riga COMPLETA della prenotazione scelta — la
            // dropdown ha solo le colonne minime; send-whatsapp-notification
            // ha bisogno dei booking_details per sostituire tutte le
            // variabili del template.
            const { data: realBooking, error: bkErr } = await supabase
                .from('bookings')
                .select('*')
                .eq('id', bookingId)
                .single()
            if (bkErr || !realBooking) {
                toast.error('Prenotazione non trovata: ' + (bkErr?.message || bookingId))
                return
            }
            const res = await authFetch('/.netlify/functions/send-whatsapp-notification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    booking: realBooking,
                    customPhone: phone,
                    messageKey: template.message_key,
                }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error('Errore invio test: ' + (json?.message || `HTTP ${res.status}`))
                return
            }
            if (json?.skipped) {
                toast.error(`Test saltato: ${json.reason || json.message || 'template non disponibile'}`)
                return
            }
            toast.success(`Test inviato a ${phone}`)
        } catch (err: unknown) {
            const _errMsg = err instanceof Error ? err.message : String(err)
            toast.error('Errore di rete: ' + _errMsg)
        } finally {
            setTestingId(null)
        }
    }

    async function handleDeleteTemplate(template: SystemMessage) {
        if (!confirm(`Eliminare definitivamente il messaggio "${template.label}"?\n\nQuesta operazione non è reversibile.`)) return

        try {
            let deleted = false
            try {
                const res = await authFetch('/.netlify/functions/delete-system-message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: template.id }),
                })
                const json = await res.json().catch(() => ({}))
                if (res.ok && !json?.error) {
                    deleted = true
                } else {
                    console.warn('[Pro] delete-system-message fn failed, falling back:', json)
                }
            } catch (fnErr) {
                console.warn('[Pro] delete-system-message fn threw, falling back:', fnErr)
            }

            if (!deleted) {
                const { error } = await supabase
                    .from('system_messages')
                    .delete()
                    .eq('id', template.id)
                if (error) throw error
            }

            // Verify the row is really gone before updating UI
            const { data: stillThere } = await supabase
                .from('system_messages')
                .select('id')
                .eq('id', template.id)
                .maybeSingle()
            if (stillThere) throw new Error('Il messaggio non è stato rimosso dal database')

            setTemplates(prev => prev.filter(t => t.id !== template.id))
            toast.success('Messaggio eliminato')
        } catch (err: unknown) {
            const _errMsg = err instanceof Error ? err.message : String(err)
            console.error('Error deleting template:', err)
            toast.error('Errore eliminazione: ' + _errMsg)
        }
    }

    async function searchCustomers(query: string) {
        setCustomerSearch(query)
        if (query.length < 2) {
            setCustomerResults([])
            setShowResults(false)
            return
        }

        setSearching(true)
        setShowResults(true)
        try {
            const q = query.toLowerCase()
            const { data: byName } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, telefono')
                .or(`nome.ilike.%${q}%,cognome.ilike.%${q}%`)
                .limit(20)

            const cleanQ = query.replace(/[\s\-+()]/g, '')
            const { data: byPhone } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, telefono')
                .ilike('telefono', `%${cleanQ}%`)
                .limit(10)

            const merged = new Map<string, CustomerResult>()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const process = (items: any[] | null) => {
                items?.forEach(c => {
                    if (c.telefono && !merged.has(c.id)) {
                        merged.set(c.id, {
                            id: c.id,
                            nome: c.nome || '',
                            cognome: c.cognome || '',
                            telefono: c.telefono,
                            full_name: `${c.nome || ''} ${c.cognome || ''}`.trim() || 'Cliente',
                        })
                    }
                })
            }
            process(byName)
            process(byPhone)

            const selectedIds = new Set(selectedCustomers.map(c => c.id))
            setCustomerResults(Array.from(merged.values()).filter(c => !selectedIds.has(c.id)))
        } catch (err: unknown) {
            console.error('Error searching customers:', err)
        } finally {
            setSearching(false)
        }
    }

    function addCustomer(customer: CustomerResult) {
        setSelectedCustomers(prev => [...prev, customer])
        setCustomerResults(prev => prev.filter(c => c.id !== customer.id))
        setCustomerSearch('')
        setShowResults(false)
    }

    function removeCustomer(id: string) {
        setSelectedCustomers(prev => prev.filter(c => c.id !== id))
    }

    function getMessageText(): string {
        if (sendMode === 'free') return freeText
        const template = templates.find(t => t.id === selectedTemplateId)
        return template?.message_body || ''
    }

    function getPreviewText(): string {
        const text = getMessageText()
        if (!text) return ''
        const firstName = selectedCustomers.length > 0
            ? (selectedCustomers[0].nome || selectedCustomers[0].full_name.split(' ')[0])
            : '{nome}'
        return text.replace(/\{nome\}/g, firstName)
    }

    function cleanPhone(phone: string): string {
        let cleaned = phone.replace(/[\s\-+()]/g, '').replace(/[^\d]/g, '')
        if (cleaned.startsWith('00')) {
            cleaned = cleaned.substring(2)
        }
        if (cleaned.length === 10) {
            cleaned = '39' + cleaned
        }
        return cleaned
    }

    async function handleSend() {
        const messageText = getMessageText()
        if (!messageText.trim()) {
            toast.error('Scrivi o seleziona un messaggio')
            return
        }
        if (selectedCustomers.length === 0) {
            toast.error('Seleziona almeno un cliente')
            return
        }

        const customersWithPhone = selectedCustomers.filter(c => c.telefono)
        if (customersWithPhone.length === 0) {
            toast.error('Nessun cliente selezionato ha un numero di telefono')
            return
        }

        if (!confirm(`Inviare il messaggio WhatsApp a ${customersWithPhone.length} cliente/i?`)) return

        setSending(true)
        setSendProgress({ current: 0, total: customersWithPhone.length })
        let successCount = 0
        let failCount = 0

        for (let i = 0; i < customersWithPhone.length; i++) {
            const customer = customersWithPhone[i]
            const firstName = customer.nome || customer.full_name.split(' ')[0]
            const personalizedMessage = messageText.replace(/\{nome\}/g, firstName)
            const phone = cleanPhone(customer.telefono)

            setSendProgress({ current: i + 1, total: customersWithPhone.length })

            try {
                const response = await fetch('/.netlify/functions/send-whatsapp-notification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        customMessage: personalizedMessage,
                        customPhone: phone,
                        skipHeader: sendMode === 'free'
                          || !(templates.find(t => t.id === selectedTemplateId)?.include_header),
                    }),
                })

                const result = await response.json()
                if (response.ok && result.success) {
                    successCount++
                    const templateLabel = sendMode === 'template'
                        ? templates.find(t => t.id === selectedTemplateId)?.label || null
                        : null
                    await supabase.from('sent_messages_log').insert({
                        customer_id: customer.id,
                        customer_name: customer.full_name,
                        customer_phone: phone,
                        message_text: personalizedMessage,
                        template_label: templateLabel,
                        status: 'sent',
                    })
                } else {
                    failCount++
                    console.error(`Failed to send to ${customer.full_name}:`, result)
                }
            } catch (err) {
                failCount++
                console.error(`Error sending to ${customer.full_name}:`, err)
            }

            if (i < customersWithPhone.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1500))
            }
        }

        setSending(false)
        setSendProgress({ current: 0, total: 0 })

        if (successCount > 0) {
            toast.success(`Inviato a ${successCount} cliente/i`)
        }
        if (failCount > 0) {
            toast.error(`${failCount} invio/i fallito/i`)
        }

        if (successCount > 0) {
            setSelectedCustomers([])
            setFreeText('')
            loadSentLogs()
        }
    }

    if (loading) {
        return <div className="text-center py-10 text-dr7-gold">Caricamento messaggi...</div>
    }

    // Canonical sort order: follow PRO_MESSAGE_CATEGORIES declaration, then any custom pro_custom_*
    const keyOrder: Record<string, number> = {}
    ALL_PRO_TEMPLATES.forEach((t, i) => { keyOrder[t.key] = i })
    const sortedTemplates = [...templates].sort((a, b) => {
        const ai = keyOrder[a.message_key] ?? 9999
        const bi = keyOrder[b.message_key] ?? 9999
        if (ai !== bi) return ai - bi
        return (a.label || '').localeCompare(b.label || '')
    })

    // Dynamic numbering: 1..N for every non-wrapper template currently in DB, in sorted order.
    // Wrappers (pro_wrapper_header, pro_wrapper_footer) never get a number.
    const templateNumberById: Record<string, number> = {}
    sortedTemplates
        .filter(t => !WRAPPER_KEYS.has(t.message_key))
        .forEach((t, i) => { templateNumberById[t.id] = i + 1 })

    const q = searchQuery.trim().toLowerCase()
    const filteredTemplates = q
        ? sortedTemplates.filter(t =>
            (t.label || '').toLowerCase().includes(q) ||
            (t.description || '').toLowerCase().includes(q) ||
            (t.message_body || '').toLowerCase().includes(q) ||
            (t.message_key || '').toLowerCase().includes(q)
          )
        : sortedTemplates

    return (
        <div className="space-y-8">
            {/* ═══════════ SECTION A: Template Manager (Pro) ═══════════ */}
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-bold text-theme-text-primary">Messaggi di Sistema Pro</h3>
                        <p className="text-theme-text-primary text-sm">Template dei messaggi WhatsApp organizzati per tipologia</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowCustomVars(!showCustomVars)}
                            className={`px-4 py-2.5 rounded-full font-semibold text-sm transition-colors border ${
                                showCustomVars
                                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                                    : 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border hover:bg-theme-bg-hover'
                            }`}
                            title="Variabili custom riusabili nei template"
                        >
                            {`{variabili}`} ({customVarsList.length})
                        </button>
                        <button
                            onClick={() => {
                                // Reset i campi del form ogni volta che si apre,
                                // così non si trascina lo stato della sessione
                                // precedente (es. is_automatic lasciato a true).
                                if (!showNewForm) resetNewForm()
                                setShowNewForm(!showNewForm)
                            }}
                            className="px-5 py-2.5 rounded-full font-semibold text-sm transition-colors bg-dr7-gold text-white hover:bg-[#0A8FA3]"
                        >
                            + Nuovo Messaggio
                        </button>
                    </div>
                </div>

                {/* CUSTOM VARIABLES PANEL */}
                {showCustomVars && (
                    <div className="bg-theme-bg-secondary rounded-xl border border-emerald-500/30 p-5 space-y-4 animate-fadeIn">
                        <div className="flex justify-between items-start">
                            <div>
                                <h4 className="text-base font-bold text-theme-text-primary">Variabili custom</h4>
                                <p className="text-theme-text-muted text-xs mt-1">
                                    Definisci stringhe riusabili (es. indirizzo, promo stagionale). Inseriscile nei template come <code className="px-1.5 py-0.5 rounded bg-theme-bg-tertiary text-emerald-300">{`{chiave}`}</code> — vengono sostituite automaticamente.
                                </p>
                            </div>
                        </div>

                        {/* New variable form */}
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 p-3 rounded-lg bg-theme-bg-tertiary border border-theme-border">
                            <div className="md:col-span-3">
                                <input
                                    type="text"
                                    value={newCustomVarKey}
                                    onChange={e => setNewCustomVarKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                                    placeholder="chiave (es. address_main)"
                                    className="w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm font-mono"
                                />
                            </div>
                            <div className="md:col-span-5">
                                <input
                                    type="text"
                                    value={newCustomVarValue}
                                    onChange={e => setNewCustomVarValue(e.target.value)}
                                    placeholder="valore (es. DR7 Cagliari, Via Sonnino 1)"
                                    className="w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm"
                                />
                            </div>
                            <div className="md:col-span-3">
                                <input
                                    type="text"
                                    value={newCustomVarDescription}
                                    onChange={e => setNewCustomVarDescription(e.target.value)}
                                    placeholder="nota (opz.)"
                                    className="w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm"
                                />
                            </div>
                            <button
                                onClick={handleCreateCustomVar}
                                disabled={!newCustomVarKey.trim()}
                                className="md:col-span-1 px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-sm font-semibold hover:bg-emerald-500/30 disabled:opacity-50"
                            >
                                +
                            </button>
                        </div>

                        {/* Existing variables list */}
                        {customVarsList.length === 0 ? (
                            <div className="text-center py-6 text-theme-text-muted text-sm">
                                Nessuna variabile definita. Aggiungine una sopra.
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {customVarsList.map(v => (
                                    <div key={v.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 p-2 rounded-lg bg-theme-bg-tertiary border border-theme-border items-center">
                                        <div className="md:col-span-3 font-mono text-sm text-emerald-300">
                                            {`{${v.key}}`}
                                        </div>
                                        <div className="md:col-span-5">
                                            <input
                                                type="text"
                                                defaultValue={v.value}
                                                onBlur={e => {
                                                    if (e.target.value !== v.value) handleUpdateCustomVar(v.id, { value: e.target.value })
                                                }}
                                                className="w-full px-3 py-1.5 rounded bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm"
                                            />
                                        </div>
                                        <div className="md:col-span-2 text-xs text-theme-text-muted truncate">
                                            {v.description || '—'}
                                        </div>
                                        <div className="md:col-span-1 flex items-center justify-center">
                                            <label className="inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={v.is_enabled}
                                                    onChange={e => handleUpdateCustomVar(v.id, { is_enabled: e.target.checked })}
                                                    className="w-4 h-4 accent-emerald-500"
                                                />
                                            </label>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteCustomVar(v.id, v.key)}
                                            className="md:col-span-1 px-2 py-1.5 rounded text-xs font-semibold bg-red-500/10 text-red-300 hover:bg-red-500/20 border border-red-500/30"
                                        >
                                            Elimina
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <p className="text-[11px] text-theme-text-muted">
                            Suggerimento: i template editor mostrano le variabili sopra come placeholder. La sostituzione avviene a send-time — modifica il valore qui e tutti i template si aggiornano subito.
                        </p>
                    </div>
                )}

                {/* New Template Form */}
                {showNewForm && (
                    <div className="bg-theme-bg-secondary rounded-xl border border-dr7-gold/30 p-5 space-y-4 animate-fadeIn">
                        <h4 className="font-semibold text-theme-text-primary">Nuovo Template Pro</h4>
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Nome del messaggio</label>
                            <input
                                type="text"
                                value={newLabel}
                                onChange={e => setNewLabel(e.target.value)}
                                placeholder="es. Promemoria appuntamento"
                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Testo del messaggio</label>
                            <textarea
                                value={newBody}
                                onChange={e => setNewBody(e.target.value)}
                                rows={5}
                                placeholder="Buongiorno {nome},&#10;&#10;..."
                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 font-mono text-sm"
                            />
                            <TemplateVarLegend />
                            <p className="text-[11px] text-theme-text-muted mt-1.5">Esempio rapido: <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded text-dr7-gold">{"{nome}"}</code> verrà sostituito col nome del cliente.</p>
                        </div>

                        <div className="border border-theme-border rounded-lg p-4">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={newIsAutomatic}
                                    onChange={e => setNewIsAutomatic(e.target.checked)}
                                    className="w-5 h-5 rounded border-theme-border accent-dr7-gold"
                                />
                                <div>
                                    <span className="text-sm font-semibold text-theme-text-primary">Invio Automatico</span>
                                    <p className="text-xs text-theme-text-muted">Il messaggio verrà inviato automaticamente quando le condizioni sono soddisfatte</p>
                                </div>
                            </label>

                            {newIsAutomatic && (
                                <>
                                <div className="mt-3 mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-300/90 leading-relaxed">
                                    Il messaggio verrà inviato automaticamente da un cron che gira ogni 2 minuti. Per ogni cliente verrà inviato una sola volta (no doppioni).
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2">
                                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Evento</label>
                                        <select value={newTriggerEvent} onChange={e => setNewTriggerEvent(e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                            {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                                                <option key={k} value={k}>{v}</option>
                                            ))}
                                        </select>
                                        <p className="text-[11px] text-theme-text-muted mt-1.5">
                                            {TRIGGER_DESCRIPTIONS[newTriggerEvent] || ''}
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Quanto prima/dopo (ore)</label>
                                        <input type="number" value={newTriggerOffset} onChange={e => setNewTriggerOffset(parseInt(e.target.value) || 0)}
                                            className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
                                        <p className="text-xs text-theme-text-muted mt-1">1 = 1 ora · 24 = 1 giorno · 48 = 2 giorni · 0 = subito</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Ora di invio (Roma)</label>
                                        <select value={newSendHour ?? ''} onChange={e => setNewSendHour(e.target.value === '' ? null : parseInt(e.target.value))}
                                            className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                            <option value="">Appena possibile</option>
                                            {Array.from({ length: 24 }, (_, i) => (
                                                <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-theme-text-muted mb-1">Categoria veicolo</label>
                                        <select value={newTargetCategory} onChange={e => setNewTargetCategory(e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                            <option value="all">Tutti i veicoli</option>
                                            {proCategories.map(c => (
                                                <option key={c.id} value={c.id}>{c.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-xs font-medium text-theme-text-muted mb-1">
                                            Stati prenotazione ammessi
                                            <span className="ml-1 text-[10px] text-theme-text-muted/70 font-normal">
                                                ({newTargetStatus.size === 0 ? 'tutti gli stati' : `${newTargetStatus.size} selezionati`})
                                            </span>
                                        </label>
                                        <div className="flex flex-wrap gap-1.5">
                                            {BOOKING_STATUS_OPTIONS.map(opt => {
                                                const checked = newTargetStatus.has(opt.value)
                                                return (
                                                    <button
                                                        type="button"
                                                        key={opt.value}
                                                        onClick={() => {
                                                            setNewTargetStatus(prev => {
                                                                const next = new Set(prev)
                                                                if (next.has(opt.value)) next.delete(opt.value)
                                                                else next.add(opt.value)
                                                                return next
                                                            })
                                                        }}
                                                        className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                                                            checked
                                                                ? 'bg-dr7-gold/20 border-dr7-gold/60 text-dr7-gold'
                                                                : 'bg-theme-bg-tertiary border-theme-border text-theme-text-muted hover:border-theme-text-muted'
                                                        }`}
                                                    >
                                                        {opt.label}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                        <p className="text-[11px] text-theme-text-muted mt-1.5">
                                            Il messaggio parte SOLO per prenotazioni in uno di questi stati. Lascia vuoto per accettare tutti gli stati. <strong>Importante:</strong> per i trigger "Alla creazione della prenotazione" su sito (cliente non ancora pagato) seleziona anche "In attesa".
                                        </p>
                                    </div>
                                </div>

                                {/* Filtri avanzati — phase 1 */}
                                <div className="mt-4 pt-4 border-t border-theme-border/40">
                                    <div className="text-[11px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Filtri avanzati</div>
                                    <p className="text-[11px] text-theme-text-muted mb-3 italic">
                                        Restringi quando il messaggio parte. Esempio: solo prenotazioni noleggio con cauzione, solo metodo carta, importo minimo €500.
                                    </p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-theme-text-muted mb-1">Tipo servizio</label>
                                            <select value={newTargetServiceType} onChange={e => setNewTargetServiceType(e.target.value)}
                                                className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                                <option value="all">Tutti i servizi</option>
                                                <option value="rental">Noleggio</option>
                                                <option value="prime_wash">Prime Wash (Lavaggio + Meccanica)</option>
                                                <option value="car_wash">Solo Lavaggio</option>
                                                <option value="mechanical">Solo Meccanica</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-theme-text-muted mb-1">Cauzione</label>
                                            <select value={newTargetWithDeposit} onChange={e => setNewTargetWithDeposit(e.target.value)}
                                                className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                                <option value="all">Tutte le prenotazioni</option>
                                                <option value="yes">Con cauzione</option>
                                                <option value="no">Senza cauzione</option>
                                                <option value="vehicle">Veicoli come cauzione</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-theme-text-muted mb-1">Metodo pagamento</label>
                                            <select value={newTargetPaymentMethod} onChange={e => setNewTargetPaymentMethod(e.target.value)}
                                                className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                                <option value="all">Tutti i metodi</option>
                                                {paymentMethods.map(pm => (
                                                    <option key={pm.key} value={pm.key}>{pm.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-theme-text-muted mb-1">Importo min (€)</label>
                                            <input
                                                type="number"
                                                value={newTargetAmountMin}
                                                onChange={e => setNewTargetAmountMin(e.target.value)}
                                                placeholder="vuoto = nessun limite"
                                                className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-theme-text-muted mb-1">Importo max (€)</label>
                                            <input
                                                type="number"
                                                value={newTargetAmountMax}
                                                onChange={e => setNewTargetAmountMax(e.target.value)}
                                                placeholder="vuoto = nessun limite"
                                                className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm"
                                            />
                                        </div>
                                    </div>

                                    {/* Giorni settimana — togli il check per non inviare in quel giorno */}
                                    <div className="mt-3">
                                        <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Giorni di invio (Roma)</label>
                                        <div className="flex flex-wrap gap-1.5">
                                            {[
                                                { d: 1, lbl: 'Lun' },
                                                { d: 2, lbl: 'Mar' },
                                                { d: 3, lbl: 'Mer' },
                                                { d: 4, lbl: 'Gio' },
                                                { d: 5, lbl: 'Ven' },
                                                { d: 6, lbl: 'Sab' },
                                                { d: 0, lbl: 'Dom' },
                                            ].map(({ d, lbl }) => {
                                                const active = newTargetDays.has(d)
                                                return (
                                                    <button
                                                        key={d}
                                                        type="button"
                                                        onClick={() => {
                                                            setNewTargetDays(prev => {
                                                                const next = new Set(prev)
                                                                if (next.has(d)) next.delete(d)
                                                                else next.add(d)
                                                                return next
                                                            })
                                                        }}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                                            active
                                                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                                                                : 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border'
                                                        }`}
                                                    >
                                                        {lbl}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                        <p className="text-[11px] text-theme-text-muted mt-1">
                                            Togli un giorno per NON inviare in quel giorno. Default: tutti i 7 giorni attivi.
                                        </p>
                                    </div>

                                    {/* Quiet hours — fascia oraria silenziosa (es. 22:00-07:00) */}
                                    <div className="mt-3 pt-3 border-t border-theme-border/50">
                                        <label className="flex items-center gap-2 mb-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={newQuietHoursEnabled}
                                                onChange={e => setNewQuietHoursEnabled(e.target.checked)}
                                                className="w-4 h-4 rounded accent-emerald-500"
                                            />
                                            <span className="text-xs font-medium text-theme-text-primary">Fascia silenziosa (Roma)</span>
                                        </label>
                                        {newQuietHoursEnabled && (
                                            <div className="grid grid-cols-2 gap-2 max-w-sm">
                                                <div>
                                                    <label className="block text-[11px] text-theme-text-muted mb-1">Da</label>
                                                    <select
                                                        value={newQuietStart}
                                                        onChange={e => setNewQuietStart(parseInt(e.target.value, 10))}
                                                        className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm"
                                                    >
                                                        {Array.from({ length: 24 }, (_, h) => (
                                                            <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-[11px] text-theme-text-muted mb-1">A (esclusa)</label>
                                                    <select
                                                        value={newQuietEnd}
                                                        onChange={e => setNewQuietEnd(parseInt(e.target.value, 10))}
                                                        className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm"
                                                    >
                                                        {Array.from({ length: 24 }, (_, h) => (
                                                            <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        )}
                                        <p className="text-[11px] text-theme-text-muted mt-1">
                                            Niente messaggi in questa fascia. Esempio: 22-07 = silenzio dalle 22:00 alle 06:59 del mattino dopo.
                                        </p>
                                    </div>

                                    {/* Sprint autonomia 1: filtri pubblico avanzati */}
                                    <div className="mt-3 pt-3 border-t border-theme-border/50">
                                        <div className="text-[11px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Filtri pubblico (audience targeting)</div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Tier DR7 Club</label>
                                                <select
                                                    value={newTargetMembershipTier}
                                                    onChange={e => setNewTargetMembershipTier(e.target.value)}
                                                    className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm"
                                                >
                                                    <option value="all">Tutti i tier</option>
                                                    <option value="free">Senza membership</option>
                                                    {proTiers.map(t => (
                                                        <option key={t.id} value={t.id}>{t.label}</option>
                                                    ))}
                                                </select>
                                                {proTiers.length === 0 && (
                                                    <p className="text-[11px] text-theme-text-muted mt-1">
                                                        Nessun tier configurato. Aggiungi tier in Centralina Pro &gt; DR7 Club.
                                                    </p>
                                                )}
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Min prenotazioni precedenti</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={newTargetMinPrevBookings}
                                                    onChange={e => setNewTargetMinPrevBookings(e.target.value)}
                                                    placeholder="vuoto = nessun min"
                                                    className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm"
                                                />
                                                <p className="text-[11px] text-theme-text-muted mt-1">Es. 5 = solo clienti con almeno 5 prenotazioni precedenti.</p>
                                            </div>
                                            {/* Durata noleggio (giorni): rental only. Lavaggio /
                                                meccanica non hanno una "durata in giorni". */}
                                            {!['prime_wash', 'car_wash', 'mechanical'].includes(newTargetServiceType) && (
                                                <div>
                                                    <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Durata noleggio (giorni)</label>
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={newTargetRentalDurationMin}
                                                            onChange={e => setNewTargetRentalDurationMin(e.target.value)}
                                                            placeholder="min"
                                                            className="w-1/2 px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm"
                                                        />
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={newTargetRentalDurationMax}
                                                            onChange={e => setNewTargetRentalDurationMax(e.target.value)}
                                                            placeholder="max"
                                                            className="w-1/2 px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm"
                                                        />
                                                    </div>
                                                    <p className="text-[11px] text-theme-text-muted mt-1">Es. 7-30 = solo noleggi settimanali/mensili.</p>
                                                </div>
                                            )}
                                            <div className="md:col-span-2">
                                                <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Tag cliente (CSV)</label>
                                                <input
                                                    type="text"
                                                    value={newTargetCustomerTags}
                                                    onChange={e => setNewTargetCustomerTags(e.target.value)}
                                                    placeholder="es. vip,turista,sardo"
                                                    className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm"
                                                />
                                                <p className="text-[11px] text-theme-text-muted mt-1">Match se il cliente ha almeno UNO di questi tag (separati da virgola). Vuoto = nessuna restrizione.</p>
                                            </div>
                                        </div>

                                        {/* Sub-section: filtri demografici / geografici */}
                                        <div className="mt-3 pt-3 border-t border-theme-border/30">
                                            <div className="text-[11px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Demografia & geografia</div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Residenza</label>
                                                    <select value={newTargetResidency} onChange={e => setNewTargetResidency(e.target.value)}
                                                        className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                                        <option value="all">Tutti</option>
                                                        <option value="resident">Residenti Sardegna</option>
                                                        <option value="non_resident">Non residenti (turisti)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Provincia (CSV)</label>
                                                    <input type="text" value={newTargetProvince} onChange={e => setNewTargetProvince(e.target.value)}
                                                        placeholder="es. CA,SS,NU,OR"
                                                        className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Eta' (anni)</label>
                                                    <div className="flex gap-2">
                                                        <input type="number" min="0" value={newTargetAgeMin} onChange={e => setNewTargetAgeMin(e.target.value)}
                                                            placeholder="min" className="w-1/2 px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
                                                        <input type="number" min="0" value={newTargetAgeMax} onChange={e => setNewTargetAgeMax(e.target.value)}
                                                            placeholder="max" className="w-1/2 px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Source channel</label>
                                                    <select value={newTargetSourceChannel} onChange={e => setNewTargetSourceChannel(e.target.value)}
                                                        className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                                        <option value="all">Tutti</option>
                                                        {sourceChannels.map(s => (
                                                            <option key={s} value={s}>{s}</option>
                                                        ))}
                                                    </select>
                                                    {sourceChannels.length === 0 && (
                                                        <p className="text-[11px] text-theme-text-muted mt-1">
                                                            Nessun source ancora registrato. Aggiungi i clienti con il loro canale di provenienza.
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Sub-section: comportamento / storico */}
                                        <div className="mt-3 pt-3 border-t border-theme-border/30">
                                            <div className="text-[11px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Comportamento & storico</div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Max prenotazioni precedenti</label>
                                                    <input type="number" min="0" value={newTargetMaxPrevBookings} onChange={e => setNewTargetMaxPrevBookings(e.target.value)}
                                                        placeholder="vuoto = nessun max"
                                                        className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
                                                    <p className="text-[11px] text-theme-text-muted mt-1">Es. 0 = primo cliente, 2 = primi 3 noleggi.</p>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Spesa storica minima (€)</label>
                                                    <input type="number" min="0" step="50" value={newTargetMinLifetimeValue} onChange={e => setNewTargetMinLifetimeValue(e.target.value)}
                                                        placeholder="vuoto = nessun min"
                                                        className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
                                                    <p className="text-[11px] text-theme-text-muted mt-1">LTV — somma totale spesa storicamente.</p>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Fatture insolute</label>
                                                    <select value={newTargetHasUnpaidInvoices} onChange={e => setNewTargetHasUnpaidInvoices(e.target.value as 'any' | 'yes' | 'no')}
                                                        className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                                        <option value="any">Indifferente</option>
                                                        <option value="yes">Solo con insoluti</option>
                                                        <option value="no">Solo senza insoluti</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Ha gia' usato un codice promo</label>
                                                    <select value={newTargetUsedPromoBefore} onChange={e => setNewTargetUsedPromoBefore(e.target.value as 'any' | 'yes' | 'no')}
                                                        className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                                        <option value="any">Indifferente</option>
                                                        <option value="yes">Solo chi ha gia' usato</option>
                                                        <option value="no">Solo chi non ha mai usato</option>
                                                    </select>
                                                </div>
                                                {/* Proroghe: rental only. Lavaggio / meccanica non si
                                                    estendono. */}
                                                {!['prime_wash', 'car_wash', 'mechanical'].includes(newTargetServiceType) && (
                                                    <div className="md:col-span-2">
                                                        <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Numero proroghe storiche</label>
                                                        <div className="flex gap-2">
                                                            <input type="number" min="0" value={newTargetExtensionCountMin} onChange={e => setNewTargetExtensionCountMin(e.target.value)}
                                                                placeholder="min" className="w-1/2 px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
                                                            <input type="number" min="0" value={newTargetExtensionCountMax} onChange={e => setNewTargetExtensionCountMax(e.target.value)}
                                                                placeholder="max" className="w-1/2 px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm" />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Sub-section: orario pickup */}
                                        <div className="mt-3 pt-3 border-t border-theme-border/30">
                                            <div className="text-[11px] font-bold uppercase tracking-wider text-theme-text-muted mb-2">Orario pickup</div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div className="md:col-span-2">
                                                    <label className="block text-xs font-medium text-theme-text-muted mb-1.5">Fascia oraria pickup (Roma)</label>
                                                    <div className="flex gap-2">
                                                        <select value={newTargetPickupHourMin} onChange={e => setNewTargetPickupHourMin(e.target.value)}
                                                            className="w-1/2 px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                                            <option value="">Min: qualunque</option>
                                                            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                                                        </select>
                                                        <select value={newTargetPickupHourMax} onChange={e => setNewTargetPickupHourMax(e.target.value)}
                                                            className="w-1/2 px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-sm">
                                                            <option value="">Max: qualunque</option>
                                                            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                                                        </select>
                                                    </div>
                                                    <p className="text-[11px] text-theme-text-muted mt-1">Es. 06-09 = solo pickup mattina presto.</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                </>
                            )}
                        </div>

                        {/* Anteprima Programmazione live — usa esattamente la
                            stessa logica usata nella card della lista, così
                            ciò che vedi qui prima di salvare è ESATTAMENTE
                            quello che vedrai nel template salvato. Niente più
                            "ho selezionato Automatico e in lista appare Manuale". */}
                        {(() => {
                            const previewTpl = {
                                message_key: 'pro_custom_<verrà_generato_al_salvataggio>',
                                // Passing the label lets buildScheduleSummary
                                // detect via LABEL_FALLBACKS if the template
                                // will respond to code events (e.g. label
                                // "Conferma Noleggio" → fires on booking
                                // creation anche per chiavi pro_custom_*).
                                label: newLabel,
                                is_automatic: newIsAutomatic,
                                trigger_event: newTriggerEvent,
                                trigger_offset_hours: newTriggerOffset,
                                send_hour: newSendHour,
                                target_status: Array.from(newTargetStatus).join(','),
                                target_category: newTargetCategory,
                            }
                            const lines = buildScheduleSummary(previewTpl, Object.fromEntries(proCategories.map(c => [c.id, c.label])))
                            const hasCron = lines.some(l => l.startsWith('Cron ·'))
                            return (
                                <div className={`px-3 py-2 rounded-lg border text-xs ${
                                    hasCron
                                        ? 'bg-emerald-500/5 border-emerald-500/30 text-emerald-300/95'
                                        : 'bg-theme-bg-primary border-theme-border/50 text-theme-text-muted'
                                }`}>
                                    <div className="font-semibold mb-1">Anteprima Programmazione (dopo salvataggio)</div>
                                    <ul className="space-y-0.5">
                                        {lines.map((l, i) => (
                                            <li key={i} className="flex gap-1.5">
                                                <span className="text-theme-text-muted/80 shrink-0">›</span>
                                                <span>{l}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    <p className="text-[10px] text-theme-text-muted/80 mt-1.5">
                                        Se vuoi che parta automaticamente assicurati che "Invio Automatico" qui sopra sia spuntato e che lo stato della prenotazione di test sia tra gli "Stati ammessi".
                                    </p>
                                </div>
                            )
                        })()}

                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => { setShowNewForm(false); resetNewForm() }}
                                className="px-4 py-2 rounded-full text-sm font-medium bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover transition-colors"
                            >
                                Annulla
                            </button>
                            <button
                                onClick={handleCreateTemplate}
                                disabled={creatingNew || !newLabel.trim()}
                                className="px-5 py-2 rounded-full text-sm font-semibold bg-dr7-gold text-white hover:bg-[#0A8FA3] transition-colors disabled:opacity-50"
                            >
                                {creatingNew ? 'Salvataggio...' : 'Crea Messaggio'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Search */}
                <div className="relative">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Cerca messaggio (es. compleanno, noleggio, firma...)"
                        className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 text-sm"
                    />
                    <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text-primary text-lg leading-none"
                            aria-label="Svuota ricerca"
                        >
                            &times;
                        </button>
                    )}
                </div>

                {/* Template list — flat */}
                <div className="space-y-2">
                    {filteredTemplates.length === 0 && (
                        <div className="text-center py-8 text-theme-text-muted border border-theme-border rounded-lg">
                            {q ? `Nessun messaggio trovato per "${searchQuery}"` : 'Nessun messaggio'}
                        </div>
                    )}
                    {filteredTemplates.map((template) => (
                                        <details key={template.id} className={`border rounded-lg overflow-hidden ${template.is_enabled === false ? 'border-red-500/30 opacity-60' : 'border-theme-border'}`}>
                                            <summary className="px-4 py-3 cursor-pointer hover:bg-theme-bg-hover/30">
                                                <div className="flex items-center gap-3">
                                                    <button
                                                        onClick={(e) => { e.preventDefault(); handleToggleEnabled(template) }}
                                                        className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${template.is_enabled !== false ? 'bg-green-500' : 'bg-gray-600'}`}
                                                    >
                                                        <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${template.is_enabled !== false ? 'left-5' : 'left-0.5'}`} />
                                                    </button>
                                                    {templateNumberById[template.id] && (
                                                        <span className="shrink-0 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-dr7-gold/20 text-dr7-gold text-[11px] font-bold">
                                                            {templateNumberById[template.id]}
                                                        </span>
                                                    )}
                                                    <span className="font-semibold text-theme-text-primary text-sm min-w-0">{template.label}</span>
                                                    {/* message_key visibile: serve per diagnosticare
                                                        se la chiave è quella canonica (pro_*) o un
                                                        pro_custom_* (a cui i callback di codice non
                                                        sanno arrivare → niente "Evento" nel preview). */}
                                                    <code
                                                        className="hidden md:inline-block shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono text-theme-text-muted bg-theme-bg-tertiary/60 border border-theme-border/40 max-w-[220px] truncate"
                                                        title={template.message_key}
                                                    >
                                                        {template.message_key}
                                                    </code>
                                                    <div className="flex items-center gap-1.5 ml-auto shrink-0">
                                                        <button
                                                            onClick={(e) => { e.preventDefault(); handleToggleAutomatic(template) }}
                                                            className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                                                template.is_automatic
                                                                    ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                                                                    : 'bg-purple-600/20 text-purple-400 hover:bg-purple-600/30'
                                                            }`}
                                                        >
                                                            {template.is_automatic ? 'Automatico' : 'Manuale'}
                                                        </button>
                                                        {template.is_enabled === false && (
                                                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-600/20 text-red-400">OFF</span>
                                                        )}
                                                        <button
                                                            onClick={(e) => {
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                const newVal = !template.include_header
                                                                authFetch('/.netlify/functions/update-system-message', {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ id: template.id, include_header: newVal })
                                                                }).then(res => {
                                                                    if (!res.ok) { toast.error('Errore aggiornamento'); return }
                                                                    setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, include_header: newVal } : t))
                                                                    toast.success(newVal ? 'Header/Footer attivato' : 'Header/Footer disattivato')
                                                                }).catch(() => toast.error('Errore di rete'))
                                                            }}
                                                            className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                                                template.include_header
                                                                    ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
                                                                    : 'bg-gray-600/20 text-gray-500 hover:bg-gray-600/30'
                                                            }`}
                                                        >
                                                            {template.include_header ? 'H/F ✓' : 'H/F ✗'}
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                const newVal = !template.send_email
                                                                authFetch('/.netlify/functions/update-system-message', {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ id: template.id, send_email: newVal })
                                                                }).then(res => {
                                                                    if (!res.ok) { toast.error('Errore aggiornamento'); return }
                                                                    setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, send_email: newVal } : t))
                                                                    toast.success(newVal ? 'Invio email attivato' : 'Invio email disattivato')
                                                                }).catch(() => toast.error('Errore di rete'))
                                                            }}
                                                            title="Invia anche via email lo stesso testo del WhatsApp"
                                                            className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                                                                template.send_email
                                                                    ? 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'
                                                                    : 'bg-gray-600/20 text-gray-500 hover:bg-gray-600/30'
                                                            }`}
                                                        >
                                                            {template.send_email ? 'Email ✓' : 'Email ✗'}
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteTemplate(template) }}
                                                            title="Elimina definitivamente"
                                                            aria-label="Elimina"
                                                            className="p-1.5 rounded-full bg-red-600/20 text-red-400 hover:bg-red-600/40 hover:text-red-300 transition-colors"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <polyline points="3 6 5 6 21 6" />
                                                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                                                <path d="M10 11v6" />
                                                                <path d="M14 11v6" />
                                                                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                                <p className="text-xs text-theme-text-primary mt-1 ml-[52px]">{template.description}</p>
                                            </summary>

                                            <div className="p-4 border-t border-theme-border space-y-3">
                                                {template.send_email && (
                                                    <div className="px-3 py-2.5 rounded-lg bg-emerald-600/5 border border-emerald-600/20">
                                                        <label className="block text-[11px] font-medium uppercase tracking-wide text-emerald-400 mb-1">
                                                            Oggetto email
                                                        </label>
                                                        <input
                                                            type="text"
                                                            defaultValue={template.email_subject || ''}
                                                            placeholder={`(default: ${template.label})`}
                                                            onBlur={(e) => {
                                                                const newVal = e.target.value.trim() || null
                                                                if (newVal === (template.email_subject || null)) return
                                                                authFetch('/.netlify/functions/update-system-message', {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ id: template.id, email_subject: newVal })
                                                                }).then(res => {
                                                                    if (!res.ok) { toast.error('Errore aggiornamento oggetto'); return }
                                                                    setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, email_subject: newVal } : t))
                                                                    toast.success('Oggetto email aggiornato')
                                                                }).catch(() => toast.error('Errore di rete'))
                                                            }}
                                                            className="w-full px-3 py-2 rounded-md bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                                                        />
                                                        <p className="text-[11px] text-theme-text-muted mt-1.5">
                                                            Il corpo email è lo stesso del WhatsApp. Se lasci vuoto, l'oggetto sarà il titolo del template.
                                                        </p>
                                                    </div>
                                                )}
                                                {/* Programmazione — preview sempre visibile.
                                                    Una riga per OGNI canale che farà partire il
                                                    template: cron (se is_automatic) + eventi di
                                                    codice instradati via OLD_TO_PRO (es. conferma
                                                    prenotazione, callback Nexi, firma contratto).
                                                    Se nessun canale è attivo → "Manuale". */}
                                                {(() => {
                                                    const lines = buildScheduleSummary(template, Object.fromEntries(proCategories.map(c => [c.id, c.label])))
                                                    const hasEvent = lines.some(l => l.startsWith('Evento ·'))
                                                    const hasCron = lines.some(l => l.startsWith('Cron ·'))
                                                    const isManual = !hasEvent && !hasCron
                                                    const containerClass = isManual
                                                        ? 'bg-theme-bg-primary border-theme-border/50 text-theme-text-muted'
                                                        : 'bg-emerald-500/5 border-emerald-500/30 text-emerald-300/95'
                                                    return (
                                                        <div className={`px-3 py-2 rounded-lg border text-xs ${containerClass}`}>
                                                            <div className="font-semibold mb-1">Programmazione</div>
                                                            <ul className="space-y-0.5">
                                                                {lines.map((l, i) => (
                                                                    <li key={i} className="flex gap-1.5">
                                                                        <span className="text-theme-text-muted/80 shrink-0">›</span>
                                                                        <span>{l}</span>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )
                                                })()}

                                                {/* Cron config (trigger_event/offset/send_hour/target_*)
                                                    sempre visibile per i template non event-driven, anche
                                                    quando Automatico è OFF — così l'admin può configurare
                                                    la programmazione PRIMA di attivarla, e verificarla
                                                    dopo. Una nota gialla compare quando Automatico è OFF
                                                    per chiarire che le modifiche sono salvate ma il cron
                                                    non le sta ancora usando.
                                                    Per i template event-driven (Conferma Noleggio,
                                                    Wallet Bonus, Firma, ecc.) il cron viene saltato a
                                                    monte e il blocco resta nascosto: l'admin vede solo
                                                    le righe "Evento ·" nel preview Programmazione. */}
                                                {getProKeyEventTriggers(template.message_key, template.label).length === 0 && (
                                                    <div className="rounded-lg bg-theme-bg-primary border border-theme-border/50 p-3 space-y-2">
                                                        {!template.is_automatic && (
                                                            <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md px-2 py-1.5">
                                                                <span className="font-semibold">Automatico è OFF</span> — le impostazioni qui sotto sono salvate ma il cron non le userà finché non clicchi il badge "Manuale" in alto per metterlo a "Automatico".
                                                            </div>
                                                        )}
                                                        <div className="flex flex-wrap items-center gap-3">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                                                                <select value={template.trigger_event || 'before_dropoff'}
                                                                    onChange={e => handleUpdateAutomation(template.id, 'trigger_event', e.target.value)}
                                                                    className="text-xs bg-transparent border-none text-theme-text-secondary focus:outline-none cursor-pointer">
                                                                    {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                                                                        <option key={k} value={k}>{v}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                            <span className="text-theme-text-muted text-xs">―</span>
                                                            <div className="flex items-center gap-1">
                                                                <input type="number" value={template.trigger_offset_hours || 24}
                                                                    onChange={e => handleUpdateAutomation(template.id, 'trigger_offset_hours', parseInt(e.target.value) || 0)}
                                                                    className="w-12 text-xs text-center bg-dr7-gold/15 text-dr7-gold font-bold rounded-full px-2 py-1 border-none focus:outline-none" />
                                                                <span className="text-xs text-dr7-gold font-bold">ore</span>
                                                            </div>
                                                            <span className="text-theme-text-muted text-xs">―</span>
                                                            <div className="flex items-center gap-1">
                                                                <select value={template.send_hour ?? ''}
                                                                    onChange={e => handleUpdateAutomation(template.id, 'send_hour', e.target.value === '' ? null : parseInt(e.target.value))}
                                                                    className="text-xs bg-transparent border-none text-theme-text-secondary focus:outline-none cursor-pointer">
                                                                    <option value="">Subito</option>
                                                                    {Array.from({ length: 24 }, (_, i) => (
                                                                        <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                            <span className="text-theme-text-muted text-xs">―</span>
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                                                                <select value={template.target_category || 'all'}
                                                                    onChange={e => handleUpdateAutomation(template.id, 'target_category', e.target.value)}
                                                                    className="text-xs bg-transparent border-none text-theme-text-secondary focus:outline-none cursor-pointer">
                                                                    <option value="all">Tutti i veicoli</option>
                                                                    {proCategories.map(c => (
                                                                        <option key={c.id} value={c.id}>{c.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        {/* Stati prenotazione (target_status) — pillole on/off.
                                                            Prima erano hardcoded a 'confirmed,active' senza UI;
                                                            risultato: i messaggi non partivano su prenotazioni
                                                            in stato `pending` (es. on_booking pre-pagamento)
                                                            e l'admin non aveva modo di accorgersene. */}
                                                        <div className="pt-2 border-t border-theme-border/40">
                                                            <div className="flex items-center justify-between mb-1.5">
                                                                <span className="text-[11px] uppercase tracking-wider text-theme-text-muted font-semibold">Stati ammessi</span>
                                                                <span className="text-[10px] text-theme-text-muted">
                                                                    {(() => {
                                                                        const set = parseStatusCsv(template.target_status)
                                                                        return set.size === 0 ? 'tutti gli stati' : `${set.size} selezionati`
                                                                    })()}
                                                                </span>
                                                            </div>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {BOOKING_STATUS_OPTIONS.map(opt => {
                                                                    const set = parseStatusCsv(template.target_status)
                                                                    const checked = set.has(opt.value)
                                                                    return (
                                                                        <button
                                                                            type="button"
                                                                            key={opt.value}
                                                                            onClick={() => {
                                                                                const next = new Set(set)
                                                                                if (next.has(opt.value)) next.delete(opt.value)
                                                                                else next.add(opt.value)
                                                                                handleUpdateAutomation(template.id, 'target_status', Array.from(next).join(','))
                                                                            }}
                                                                            className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                                                                                checked
                                                                                    ? 'bg-dr7-gold/20 border-dr7-gold/60 text-dr7-gold'
                                                                                    : 'bg-theme-bg-tertiary border-theme-border text-theme-text-muted hover:border-theme-text-muted'
                                                                            }`}
                                                                        >
                                                                            {opt.label}
                                                                        </button>
                                                                    )
                                                                })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Eventi gestiti dal codice — DB-driven routing.
                                                    L'admin sceglie quali eventi legacy (rental_new_customer,
                                                    carwash_new_customer, payment callbacks, ecc.) sono
                                                    serviti da QUESTO template. Sostituisce la mappa
                                                    hardcoded OLD_TO_PRO: salvato in
                                                    `system_messages.handled_events` (text[]) e il resolver
                                                    server lo consulta PRIMA del fallback storico. Cambiare
                                                    chi gestisce un evento adesso non richiede dev. */}
                                                <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-3">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="text-[11px] uppercase tracking-wider text-blue-300/90 font-semibold">
                                                            Eventi gestiti da questo template
                                                        </span>
                                                        <span className="text-[10px] text-theme-text-muted">
                                                            {(template.handled_events?.length ?? 0)} assegnati
                                                        </span>
                                                    </div>
                                                    <p className="text-[10px] text-theme-text-muted leading-snug">
                                                        Spunta gli eventi che vuoi instradare a questo template. Una spunta sposta l'evento qui sopra anche se prima era gestito altrove. Lascia tutto vuoto per usare il routing storico.
                                                    </p>

                                                    {/* Auto-rileva: word-overlap tra label/body del template e
                                                        le descrizioni degli eventi. Aggiunge solo eventi che
                                                        NON sono già selezionati, così se l'admin clicca per
                                                        sbaglio non perde la sua configurazione. Nessuna mappa
                                                        di pattern hardcoded — usa solo le descrizioni italiane
                                                        già presenti nei metadati degli eventi. */}
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const raw = suggestEventsForTemplate(template)
                                                                // Filtra suggestions per restare coerenti con il
                                                                // target_service_type del template — niente eventi
                                                                // noleggio su un template Solo Lavaggio.
                                                                const incompat = incompatibleEventsForServiceType(template.target_service_type)
                                                                const suggested = raw.filter(ev => !incompat.has(ev))
                                                                if (suggested.length === 0) {
                                                                    toast('Nessun evento rilevato dal nome/contenuto del template. Aggiungi parole più descrittive nella label o nel corpo, o assegna gli eventi manualmente qui sotto.', { icon: 'ℹ️', duration: 6000 })
                                                                    return
                                                                }
                                                                const current = new Set(template.handled_events || [])
                                                                let added = 0
                                                                for (const ev of suggested) {
                                                                    if (!current.has(ev)) { current.add(ev); added++ }
                                                                }
                                                                if (added === 0) {
                                                                    toast('Eventi suggeriti già tutti assegnati a questo template.', { icon: '👍' })
                                                                    return
                                                                }
                                                                handleUpdateAutomation(template.id, 'handled_events', Array.from(current))
                                                                toast.success(`${added} event${added === 1 ? 'o' : 'i'} aggiunti automaticamente.`)
                                                            }}
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-blue-500/20 hover:bg-blue-500/30 border border-blue-400/50 text-blue-100 font-medium transition-colors"
                                                            title="Analizza il nome e il testo di questo template e tick automaticamente gli eventi correlati."
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1M3 12h1M20 12h1M5.6 5.6l.7.7M18.4 5.6l-.7.7M12 18a6 6 0 100-12 6 6 0 000 12z" />
                                                            </svg>
                                                            Auto-rileva eventi dal nome del template
                                                        </button>
                                                        {(template.handled_events?.length ?? 0) > 0 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    if (!confirm('Rimuovere TUTTI gli eventi assegnati a questo template?')) return
                                                                    handleUpdateAutomation(template.id, 'handled_events', [])
                                                                    toast.success('Eventi rimossi.')
                                                                }}
                                                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-theme-bg-tertiary hover:bg-theme-bg-hover border border-theme-border text-theme-text-muted font-medium transition-colors"
                                                            >
                                                                Svuota tutti
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="space-y-2.5">
                                                        {eventGroupsForServiceType(template.target_service_type).map(group => {
                                                            const colorMap: Record<string, { dot: string; pillOn: string; pillTxt: string }> = {
                                                                blue:    { dot: 'bg-blue-400',    pillOn: 'bg-blue-500/25 border-blue-400/70',       pillTxt: 'text-blue-100' },
                                                                cyan:    { dot: 'bg-cyan-400',    pillOn: 'bg-cyan-500/25 border-cyan-400/70',       pillTxt: 'text-cyan-100' },
                                                                teal:    { dot: 'bg-teal-400',    pillOn: 'bg-teal-500/25 border-teal-400/70',       pillTxt: 'text-teal-100' },
                                                                violet:  { dot: 'bg-violet-400',  pillOn: 'bg-violet-500/25 border-violet-400/70',   pillTxt: 'text-violet-100' },
                                                                emerald: { dot: 'bg-emerald-400', pillOn: 'bg-emerald-500/25 border-emerald-400/70', pillTxt: 'text-emerald-100' },
                                                                amber:   { dot: 'bg-amber-400',   pillOn: 'bg-amber-500/25 border-amber-400/70',     pillTxt: 'text-amber-100' },
                                                                rose:    { dot: 'bg-rose-400',    pillOn: 'bg-rose-500/25 border-rose-400/70',       pillTxt: 'text-rose-100' },
                                                                pink:    { dot: 'bg-pink-400',    pillOn: 'bg-pink-500/25 border-pink-400/70',       pillTxt: 'text-pink-100' },
                                                            }
                                                            const colors = colorMap[group.color] || colorMap.blue
                                                            const knownKeys = group.keys.filter(k => EVENT_LABELS_IT[k as keyof typeof EVENT_LABELS_IT])
                                                            if (knownKeys.length === 0) return null
                                                            const assignedInGroup = knownKeys.filter(k => (template.handled_events || []).includes(k)).length
                                                            return (
                                                                <div key={group.label} className="space-y-1.5">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                                                                        <span className="text-[10px] uppercase tracking-wider font-bold text-theme-text-muted">
                                                                            {group.label}
                                                                        </span>
                                                                        {assignedInGroup > 0 && (
                                                                            <span className="text-[9px] text-theme-text-muted/70">
                                                                                ({assignedInGroup}/{knownKeys.length})
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex flex-col gap-1 pl-3.5">
                                                                        {knownKeys.map(eventKey => {
                                                                            const desc = EVENT_LABELS_IT[eventKey as keyof typeof EVENT_LABELS_IT] || eventKey
                                                                            const assigned = (template.handled_events || []).includes(eventKey)
                                                                            return (
                                                                                <button
                                                                                    type="button"
                                                                                    key={eventKey}
                                                                                    onClick={() => {
                                                                                        const current = new Set(template.handled_events || [])
                                                                                        if (current.has(eventKey)) current.delete(eventKey)
                                                                                        else current.add(eventKey)
                                                                                        handleUpdateAutomation(template.id, 'handled_events', Array.from(current))
                                                                                    }}
                                                                                    title={`Legacy key: ${eventKey}`}
                                                                                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left border transition-colors ${
                                                                                        assigned
                                                                                            ? `${colors.pillOn} ${colors.pillTxt}`
                                                                                            : 'bg-theme-bg-tertiary/50 border-theme-border/60 text-theme-text-muted hover:bg-theme-bg-hover hover:border-theme-text-muted'
                                                                                    }`}
                                                                                >
                                                                                    <span className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${assigned ? 'bg-current border-current' : 'border-theme-border'}`}>
                                                                                        {assigned && (
                                                                                            <svg className="w-2.5 h-2.5 text-theme-bg-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                                                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                                                            </svg>
                                                                                        )}
                                                                                    </span>
                                                                                    <span className="text-xs leading-snug">{desc}</span>
                                                                                </button>
                                                                            )
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>

                                                {/* Filtri avanzati per-template — pannello collapsible.
                                                    Espone TUTTI i filtri che il cron applica oltre a
                                                    trigger + stato + categoria. Prima erano impostabili
                                                    solo al momento della creazione e poi nascosti per
                                                    sempre: cambiare giorni della settimana, metodo
                                                    pagamento, tipo cauzione, ecc. richiedeva ricreare
                                                    il template. Visibile anche per template event-driven
                                                    perché il cron interagisce con questi filtri se mai
                                                    il template tornasse cron-driven (e per trasparenza). */}
                                                <div className="rounded-lg border border-theme-border/40 bg-theme-bg-primary/40">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setExpandedAdvanced(prev => {
                                                                const next = new Set(prev)
                                                                if (next.has(template.id)) next.delete(template.id)
                                                                else next.add(template.id)
                                                                return next
                                                            })
                                                        }}
                                                        className="w-full px-3 py-2 flex items-center justify-between text-xs text-theme-text-secondary hover:bg-theme-bg-hover transition-colors"
                                                    >
                                                        <span className="flex items-center gap-2">
                                                            <svg className={`w-3.5 h-3.5 transition-transform ${expandedAdvanced.has(template.id) ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                                            </svg>
                                                            <span className="font-medium">Filtri avanzati</span>
                                                        </span>
                                                        <span className="text-[10px] text-theme-text-muted">
                                                            {listActiveFilters(template).length === 0 ? 'nessun filtro extra' : `${listActiveFilters(template).length} attivi`}
                                                        </span>
                                                    </button>

                                                    {expandedAdvanced.has(template.id) && (
                                                        <div className="border-t border-theme-border/40 p-3 space-y-3">
                                                            {/* Days of week — la causa più frequente di "non parte di sabato/domenica" */}
                                                            <div>
                                                                <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1.5">
                                                                    Giorni della settimana
                                                                    <span className="ml-1 text-[10px] text-theme-text-muted/70 font-normal normal-case tracking-normal">
                                                                        ({(() => {
                                                                            const days = (template.target_days_of_week || '0,1,2,3,4,5,6').split(',').filter(Boolean)
                                                                            return days.length === 7 ? 'tutti i giorni' : `${days.length} selezionati`
                                                                        })()})
                                                                    </span>
                                                                </label>
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {DAY_LABELS_IT.map((dayLabel, idx) => {
                                                                        const daysCsv = template.target_days_of_week ?? '0,1,2,3,4,5,6'
                                                                        const days = new Set(daysCsv.split(',').map((s: string) => s.trim()).filter(Boolean))
                                                                        const checked = days.has(String(idx))
                                                                        return (
                                                                            <button
                                                                                type="button"
                                                                                key={idx}
                                                                                onClick={() => {
                                                                                    const next = new Set(days)
                                                                                    if (next.has(String(idx))) next.delete(String(idx))
                                                                                    else next.add(String(idx))
                                                                                    const csv = Array.from(next).map(Number).sort((a, b) => a - b).join(',')
                                                                                    handleUpdateAutomation(template.id, 'target_days_of_week', csv)
                                                                                }}
                                                                                className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                                                                                    checked
                                                                                        ? 'bg-dr7-gold/20 border-dr7-gold/60 text-dr7-gold'
                                                                                        : 'bg-theme-bg-tertiary border-theme-border text-theme-text-muted hover:border-theme-text-muted'
                                                                                }`}
                                                                            >
                                                                                {dayLabel}
                                                                            </button>
                                                                        )
                                                                    })}
                                                                </div>
                                                                <p className="text-[10px] text-theme-text-muted mt-1.5 leading-snug">
                                                                    Il cron invia SOLO se "oggi" (Europe/Rome) è uno dei giorni selezionati. Tutti i giorni = nessun filtro.
                                                                </p>
                                                            </div>

                                                            {/* Tipo servizio + Cauzione + Metodo pagamento + Tier — quattro select compatte */}
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div>
                                                                    <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Tipo servizio</label>
                                                                    <select
                                                                        value={template.target_service_type || 'all'}
                                                                        onChange={e => {
                                                                            const newSvc = e.target.value
                                                                            // Quando cambia il tipo servizio, rimuovi automaticamente
                                                                            // gli eventi handled_events incompatibili così la UI
                                                                            // resta coerente (no eventi noleggio su un template lavaggio).
                                                                            const incompat = incompatibleEventsForServiceType(newSvc)
                                                                            const cleaned = (template.handled_events || []).filter(k => !incompat.has(k))
                                                                            handleUpdateAutomation(template.id, 'target_service_type', newSvc)
                                                                            if (cleaned.length !== (template.handled_events?.length ?? 0)) {
                                                                                handleUpdateAutomation(template.id, 'handled_events', cleaned)
                                                                                const removed = (template.handled_events?.length ?? 0) - cleaned.length
                                                                                toast(`${removed} event${removed === 1 ? 'o' : 'i'} incompatibili rimossi automaticamente.`, { icon: '🧹' })
                                                                            }
                                                                        }}
                                                                        className="w-full px-2 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                                                                    >
                                                                        <option value="all">Tutti i servizi</option>
                                                                        <option value="rental">Solo Noleggio</option>
                                                                        <option value="prime_wash">Solo Prime Wash (Lavaggio + Meccanica)</option>
                                                                        <option value="car_wash">Solo Lavaggio</option>
                                                                        <option value="mechanical">Solo Meccanica</option>
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Cauzione</label>
                                                                    <select
                                                                        value={template.target_with_deposit || 'all'}
                                                                        onChange={e => handleUpdateAutomation(template.id, 'target_with_deposit', e.target.value)}
                                                                        className="w-full px-2 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                                                                    >
                                                                        <option value="all">Qualsiasi</option>
                                                                        <option value="yes">Solo con cauzione</option>
                                                                        <option value="no">Solo senza cauzione</option>
                                                                        <option value="vehicle">Solo cauzione veicolo</option>
                                                                        <option value="standard">Solo cauzione standard (denaro)</option>
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Metodo pagamento</label>
                                                                    <select
                                                                        value={template.target_payment_method || 'all'}
                                                                        onChange={e => handleUpdateAutomation(template.id, 'target_payment_method', e.target.value)}
                                                                        className="w-full px-2 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                                                                    >
                                                                        <option value="all">Qualsiasi metodo</option>
                                                                        <option value="card">Solo carta</option>
                                                                        <option value="wallet">Solo wallet</option>
                                                                        <option value="cash">Solo contanti</option>
                                                                        <option value="bonifico">Solo bonifico</option>
                                                                        <option value="nexi">Solo Nexi</option>
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Tier DR7 Club</label>
                                                                    <select
                                                                        value={template.target_membership_tier || 'all'}
                                                                        onChange={e => handleUpdateAutomation(template.id, 'target_membership_tier', e.target.value === 'all' ? null : e.target.value)}
                                                                        className="w-full px-2 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                                                                    >
                                                                        <option value="all">Tutti i tier</option>
                                                                        {proTiers.map(t => (
                                                                            <option key={t.id} value={t.id}>{t.label}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                            </div>

                                                            {/* Range importo + targa specifica */}
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div>
                                                                    <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Importo min (€)</label>
                                                                    <input
                                                                        type="number"
                                                                        value={template.target_amount_min ?? ''}
                                                                        onChange={e => handleUpdateAutomation(template.id, 'target_amount_min', e.target.value === '' ? null : parseFloat(e.target.value))}
                                                                        placeholder="—"
                                                                        className="w-full px-2 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Importo max (€)</label>
                                                                    <input
                                                                        type="number"
                                                                        value={template.target_amount_max ?? ''}
                                                                        onChange={e => handleUpdateAutomation(template.id, 'target_amount_max', e.target.value === '' ? null : parseFloat(e.target.value))}
                                                                        placeholder="—"
                                                                        className="w-full px-2 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                                                                    />
                                                                </div>
                                                                <div className="col-span-2">
                                                                    <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Targa specifica</label>
                                                                    <input
                                                                        type="text"
                                                                        value={template.target_plate ?? ''}
                                                                        onChange={e => handleUpdateAutomation(template.id, 'target_plate', e.target.value.trim() === '' ? null : e.target.value.trim().toUpperCase())}
                                                                        placeholder="Lascia vuoto per tutti i veicoli"
                                                                        className="w-full px-2 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-dr7-gold/40 font-mono uppercase"
                                                                    />
                                                                </div>
                                                            </div>

                                                            {/* Fascia silenziosa */}
                                                            <div>
                                                                <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Fascia silenziosa (non invia in queste ore)</label>
                                                                <div className="flex items-center gap-2">
                                                                    <select
                                                                        value={template.quiet_hours_start ?? ''}
                                                                        onChange={e => handleUpdateAutomation(template.id, 'quiet_hours_start', e.target.value === '' ? null : parseInt(e.target.value))}
                                                                        className="flex-1 px-2 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                                                                    >
                                                                        <option value="">Nessuna</option>
                                                                        {Array.from({ length: 24 }, (_, i) => (
                                                                            <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                                                                        ))}
                                                                    </select>
                                                                    <span className="text-theme-text-muted text-xs">→</span>
                                                                    <select
                                                                        value={template.quiet_hours_end ?? ''}
                                                                        onChange={e => handleUpdateAutomation(template.id, 'quiet_hours_end', e.target.value === '' ? null : parseInt(e.target.value))}
                                                                        className="flex-1 px-2 py-1.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                                                                    >
                                                                        <option value="">Nessuna</option>
                                                                        {Array.from({ length: 24 }, (_, i) => (
                                                                            <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                <p className="text-[10px] text-theme-text-muted mt-1 leading-snug">
                                                                    Es. 22:00 → 07:00 = silenzio notturno (il messaggio non parte tra le 22 e le 7).
                                                                </p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Diagnostica per-template: ultimi invii + bottone Invia di prova.
                                                    Sempre disponibile (anche per template manuali) così l'admin
                                                    può capire al volo se il template parte e a chi arriva. */}
                                                <div className="rounded-lg border border-theme-border/40 bg-theme-bg-primary/40">
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleDiagnostics(template)}
                                                        className="w-full px-3 py-2 flex items-center justify-between text-xs text-theme-text-secondary hover:bg-theme-bg-hover transition-colors"
                                                    >
                                                        <span className="flex items-center gap-2">
                                                            <svg className={`w-3.5 h-3.5 transition-transform ${expandedDiagnostics.has(template.id) ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                                            </svg>
                                                            <span className="font-medium">Diagnostica · Ultimi invii e Test</span>
                                                        </span>
                                                        <span className="text-[10px] text-theme-text-muted">
                                                            {templateSendLogs[template.id]?.length != null
                                                                ? `${templateSendLogs[template.id].length} eventi`
                                                                : 'apri per caricare'}
                                                        </span>
                                                    </button>

                                                    {expandedDiagnostics.has(template.id) && (
                                                        <div className="border-t border-theme-border/40 p-3 space-y-3">
                                                            {/* Test invio — solo dati REALI: l'admin sceglie una
                                                                prenotazione esistente dalla dropdown e il numero
                                                                arriva precompilato dal cliente di quella
                                                                prenotazione (modificabile). Nessun valore
                                                                inventato. */}
                                                            <div className="space-y-1.5">
                                                                <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold">Invia di prova</label>
                                                                <select
                                                                    value={testBookingIds[template.id] || ''}
                                                                    onChange={e => {
                                                                        const bid = e.target.value
                                                                        setTestBookingIds(prev => ({ ...prev, [template.id]: bid }))
                                                                        // Auto-fill phone from the selected booking
                                                                        // (admin can still edit it before sending).
                                                                        const picked = recentBookings.find(b => b.id === bid)
                                                                        if (picked?.customer_phone) {
                                                                            setTestPhones(prev => ({ ...prev, [template.id]: String(picked.customer_phone) }))
                                                                        }
                                                                    }}
                                                                    className="w-full px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                                                                >
                                                                    <option value="">{recentBookingsLoading ? 'Caricamento prenotazioni…' : 'Seleziona una prenotazione reale…'}</option>
                                                                    {recentBookings.map(b => {
                                                                        const date = b.pickup_date || b.appointment_date || b.created_at
                                                                        const when = date ? new Date(date).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: '2-digit' }) : ''
                                                                        const name = b.customer_name || '(senza nome)'
                                                                        const veh = b.vehicle_name || b.service_type || ''
                                                                        const short = String(b.id).slice(0, 8)
                                                                        return (
                                                                            <option key={b.id} value={b.id}>
                                                                                {when} · {name}{veh ? ` · ${veh}` : ''} · {short}
                                                                            </option>
                                                                        )
                                                                    })}
                                                                </select>
                                                                <div className="flex gap-2">
                                                                    <input
                                                                        type="tel"
                                                                        value={testPhones[template.id] || ''}
                                                                        onChange={e => setTestPhones(prev => ({ ...prev, [template.id]: e.target.value }))}
                                                                        placeholder="Numero di telefono del destinatario"
                                                                        className="flex-1 px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleTestSend(template)}
                                                                        disabled={testingId === template.id || !template.is_enabled || !template.message_body || !testBookingIds[template.id]}
                                                                        className="px-3 py-2 rounded-lg bg-dr7-gold/20 hover:bg-dr7-gold/30 text-dr7-gold text-xs font-semibold border border-dr7-gold/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                                                    >
                                                                        {testingId === template.id ? 'Invio…' : 'Invia di prova'}
                                                                    </button>
                                                                </div>
                                                                <p className="text-[10px] text-theme-text-muted leading-snug">
                                                                    Usa i dati di una prenotazione vera caricata dal DB. Bypassa finestra temporale, dedup e filtri di stato. Il telefono è precompilato dal cliente della prenotazione scelta ma puoi modificarlo per inviare a un numero diverso.
                                                                </p>
                                                            </div>

                                                            {/* Ultimi invii dal cron */}
                                                            <div className="space-y-1.5">
                                                                <div className="flex items-center justify-between">
                                                                    <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold">Ultimi invii (cron)</label>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => loadTemplateSendLog(template.id)}
                                                                        disabled={loadingLogsFor === template.id}
                                                                        className="text-[10px] text-blue-400 hover:text-blue-300 disabled:opacity-40"
                                                                    >
                                                                        {loadingLogsFor === template.id ? 'Ricarico…' : 'Ricarica'}
                                                                    </button>
                                                                </div>
                                                                {templateSendLogs[template.id] == null || loadingLogsFor === template.id ? (
                                                                    <div className="text-[11px] text-theme-text-muted italic">Caricamento…</div>
                                                                ) : templateSendLogs[template.id].length === 0 ? (
                                                                    <div className="text-[11px] text-theme-text-muted italic">
                                                                        Nessun invio registrato. Possibili cause: il template non ha mai matchato una prenotazione, oppure il cron non è ancora partito da quando hai salvato.
                                                                    </div>
                                                                ) : (
                                                                    <ul className="space-y-1 max-h-48 overflow-y-auto">
                                                                        {templateSendLogs[template.id].map(log => {
                                                                            const statusColor = log.status === 'sent'
                                                                                ? 'text-emerald-400'
                                                                                : log.status === 'skipped'
                                                                                    ? 'text-amber-400'
                                                                                    : 'text-red-400'
                                                                            return (
                                                                                <li key={log.id} className="flex items-start gap-2 px-2 py-1.5 rounded bg-theme-bg-tertiary/50 text-[11px]">
                                                                                    <span className={`font-semibold ${statusColor} shrink-0`}>{log.status}</span>
                                                                                    <span className="text-theme-text-muted shrink-0">
                                                                                        {new Date(log.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                                                    </span>
                                                                                    {log.customer_phone && (
                                                                                        <span className="text-theme-text-secondary font-mono shrink-0">{log.customer_phone}</span>
                                                                                    )}
                                                                                    {log.error && (
                                                                                        <span className="text-red-400/80 truncate" title={log.error}>{log.error}</span>
                                                                                    )}
                                                                                </li>
                                                                            )
                                                                        })}
                                                                    </ul>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {editingId === template.id ? (
                                                    <div className="space-y-3">
                                                        <div>
                                                            <label className="block text-xs font-medium text-theme-text-primary mb-1">Titolo</label>
                                                            <input
                                                                type="text"
                                                                value={editLabel}
                                                                onChange={e => setEditLabel(e.target.value)}
                                                                placeholder="Titolo del messaggio"
                                                                className="w-full px-4 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 text-sm"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-theme-text-primary mb-1">Messaggio</label>
                                                            <textarea
                                                                value={editBody}
                                                                onChange={e => setEditBody(e.target.value)}
                                                                rows={6}
                                                                placeholder="Buongiorno {nome},&#10;&#10;..."
                                                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 font-mono text-sm"
                                                            />
                                                            <TemplateVarLegend />
                            <p className="text-[11px] text-theme-text-muted mt-1.5">Esempio rapido: <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded text-dr7-gold">{"{nome}"}</code> verrà sostituito col nome del cliente.</p>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <pre className="px-4 py-3 rounded-lg bg-theme-bg-primary text-xs text-theme-text-secondary whitespace-pre-wrap max-h-72 overflow-y-auto border border-theme-border">
                                                            {template.message_body}
                                                        </pre>
                                                        {template.include_header === true && (
                                                            <p className="text-[11px] text-amber-400 mt-1">
                                                                Wrapper attivo: header/footer da “Intestazione/Piè di pagina” verranno aggiunti automaticamente.
                                                            </p>
                                                        )}
                                                    </>
                                                )}

                                                <div className="flex gap-2 justify-end">
                                                    {editingId === template.id ? (
                                                        <>
                                                            <button onClick={() => setEditingId(null)}
                                                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover transition-colors">Annulla</button>
                                                            <button onClick={() => handleSaveEdit(template.id)} disabled={saving}
                                                                className="px-3 py-1.5 rounded-full text-xs font-semibold bg-dr7-gold text-white hover:bg-[#0A8FA3] transition-colors disabled:opacity-50">
                                                                {saving ? 'Salvataggio...' : 'Salva'}
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button onClick={() => { setEditingId(template.id); setEditBody(template.message_body); setEditLabel(template.label) }}
                                                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover transition-colors">Modifica</button>
                                                            <button onClick={() => handleDeleteTemplate(template)}
                                                                className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors">Elimina</button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </details>
                                    ))}
                </div>
            </div>

            {/* ═══════════ SECTION B: Invia Messaggio Manuale ═══════════ */}
            <details className="border border-theme-border rounded-lg overflow-hidden">
                <summary className="p-4 cursor-pointer hover:bg-theme-bg-hover/30 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-600/20 text-green-400">INVIO</span>
                        <span className="font-medium text-theme-text-primary">Invia Messaggio Manuale</span>
                    </div>
                    <span className="text-xs text-theme-text-muted">Template o testo libero via WhatsApp</span>
                </summary>
                <div className="p-4 border-t border-theme-border space-y-4">

                    <div className="flex gap-2">
                        <button
                            onClick={() => setSendMode('template')}
                            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                sendMode === 'template'
                                    ? 'bg-dr7-gold text-white'
                                    : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                            }`}
                        >
                            Da Template
                        </button>
                        <button
                            onClick={() => setSendMode('free')}
                            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                                sendMode === 'free'
                                    ? 'bg-dr7-gold text-white'
                                    : 'bg-theme-bg-tertiary text-theme-text-muted hover:bg-theme-bg-hover'
                            }`}
                        >
                            Testo Libero
                        </button>
                    </div>

                    {sendMode === 'template' ? (
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Seleziona template</label>
                            <select
                                value={selectedTemplateId}
                                onChange={e => setSelectedTemplateId(e.target.value)}
                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50"
                            >
                                <option value="">-- Scegli un messaggio --</option>
                                {templates.filter(t => t.message_body).map(t => (
                                    <option key={t.id} value={t.id}>{t.label}</option>
                                ))}
                            </select>
                        </div>
                    ) : (
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Messaggio</label>
                            <textarea
                                value={freeText}
                                onChange={e => setFreeText(e.target.value)}
                                rows={5}
                                placeholder="Buongiorno {nome},&#10;&#10;..."
                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50 font-mono text-sm"
                            />
                            <TemplateVarLegend />
                            <p className="text-[11px] text-theme-text-muted mt-1.5">Esempio rapido: <code className="bg-theme-bg-tertiary px-1.5 py-0.5 rounded text-dr7-gold">{"{nome}"}</code> verrà sostituito col nome del cliente.</p>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">Destinatari</label>

                        {selectedCustomers.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2">
                                {selectedCustomers.map(c => (
                                    <span
                                        key={c.id}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-dr7-gold/20 text-dr7-gold border border-dr7-gold/30"
                                    >
                                        {c.full_name}
                                        <button
                                            onClick={() => removeCustomer(c.id)}
                                            className="hover:text-red-400 transition-colors text-lg leading-none"
                                        >
                                            &times;
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}

                        <div ref={searchRef} className="relative">
                            <input
                                type="text"
                                value={customerSearch}
                                onChange={e => searchCustomers(e.target.value)}
                                onFocus={() => { if (customerResults.length > 0) setShowResults(true) }}
                                placeholder="Cerca per nome o telefono..."
                                className="w-full px-4 py-2.5 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-dr7-gold/50"
                            />
                            {searching && (
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-muted text-sm">
                                    Ricerca...
                                </div>
                            )}

                            {showResults && customerResults.length > 0 && (
                                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl max-h-60 overflow-y-auto">
                                    {customerResults.map(c => (
                                        <button
                                            key={c.id}
                                            onClick={() => addCustomer(c)}
                                            className="w-full text-left px-4 py-2.5 hover:bg-theme-bg-hover transition-colors border-b border-theme-border last:border-0"
                                        >
                                            <span className="font-medium text-theme-text-primary">{c.full_name}</span>
                                            <span className="text-theme-text-muted text-sm ml-2">{c.telefono}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {showResults && customerSearch.length >= 2 && customerResults.length === 0 && !searching && (
                                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl px-4 py-3 text-theme-text-muted text-sm">
                                    Nessun cliente trovato con numero di telefono
                                </div>
                            )}
                        </div>
                    </div>

                    {getMessageText() && (
                        <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Anteprima</label>
                            <pre className="px-4 py-3 rounded-lg bg-theme-bg-tertiary border border-theme-border text-theme-text-secondary text-sm whitespace-pre-wrap font-sans">
                                {getPreviewText()}
                            </pre>
                        </div>
                    )}

                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleSend}
                            disabled={sending || !getMessageText().trim() || selectedCustomers.length === 0}
                            className="px-6 py-2.5 rounded-full font-semibold text-sm transition-colors bg-dr7-gold text-white hover:bg-[#0A8FA3] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {sending
                                ? `Invio ${sendProgress.current}/${sendProgress.total}...`
                                : `Invia WhatsApp (${selectedCustomers.length})`
                            }
                        </button>
                        {sending && (
                            <span className="text-theme-text-muted text-sm">
                                Invio in corso... Non chiudere la pagina
                            </span>
                        )}
                    </div>
                </div>
            </details>

            {/* ═══════════ SECTION C: Storico Messaggi Inviati ═══════════ */}
            <div className="space-y-3">
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-bold text-theme-text-primary">Storico Messaggi Inviati</h3>
                    <button
                        onClick={loadSentLogs}
                        className="px-4 py-2 rounded-full text-sm font-medium bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover transition-colors"
                    >
                        Aggiorna
                    </button>
                </div>

                {logsLoading ? (
                    <div className="text-center py-6 text-dr7-gold">Caricamento storico...</div>
                ) : sentLogs.length === 0 ? (
                    <div className="text-center py-8 text-theme-text-muted border border-theme-border rounded-lg">
                        Nessun messaggio inviato ancora
                    </div>
                ) : (
                    <div className="space-y-2">
                        {sentLogs.map(log => (
                            <details key={log.id} className="border border-theme-border rounded-lg overflow-hidden">
                                <summary className="p-3 cursor-pointer hover:bg-theme-bg-hover/30 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-600/20 text-green-400">
                                            {log.status === 'sent' ? 'Inviato' : log.status}
                                        </span>
                                        {log.template_label && (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-600/20 text-blue-400">
                                                {log.template_label}
                                            </span>
                                        )}
                                        <span className="font-medium text-theme-text-primary text-sm">{log.customer_name}</span>
                                        <span className="text-xs text-theme-text-muted font-mono">{log.customer_phone}</span>
                                    </div>
                                    <span className="text-xs text-theme-text-muted">
                                        {new Date(log.sent_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </summary>
                                <pre className="p-4 bg-theme-bg-primary text-xs text-theme-text-secondary whitespace-pre-wrap border-t border-theme-border max-h-72 overflow-y-auto">
                                    {log.message_text}
                                </pre>
                            </details>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
