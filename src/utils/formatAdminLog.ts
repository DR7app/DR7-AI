// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Details = Record<string, any> | null | undefined

export interface AdminLogEntry {
  action: string
  entity_type: string | null
  entity_id: string | null
  details: Details
}

// Helper for log call sites — formats a booking-like object into the shape
// expected by formatAdminLog. Pass whatever extra fields you want to merge.
export function bookingLogDetails(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  b: any,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const fmt = (iso: string | null | undefined) => {
    if (!iso) return null
    try {
      return new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })
    } catch { return null }
  }
  return {
    customer: b?.customer_name || null,
    phone: b?.customer_phone || null,
    vehicle: b?.vehicle_name || null,
    plate: b?.vehicle_plate || null,
    pickup: fmt(b?.pickup_date || b?.appointment_date),
    dropoff: fmt(b?.dropoff_date),
    amount: b?.price_total,
    ...extra,
  }
}

function eur(v: unknown): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  if (!Number.isFinite(n)) return ''
  return `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function shortId(id: string | null | undefined): string {
  return id ? id.substring(0, 8) : ''
}

function customer(d: Details): string {
  return d?.customer || d?.customer_name || d?.name || ''
}

function phone(d: Details): string {
  return d?.phone || d?.customer_phone || ''
}

function joinParts(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(' · ')
}

// Maps action → human-readable summary line. Returns both a title and an optional
// recipient/meta line. Meant to replace the generic "customer: X, amount: Y" render.
export function formatAdminLog(log: AdminLogEntry): { title: string; meta: string } {
  const d = log.details || {}
  const id = shortId(log.entity_id)
  const cust = customer(d)
  const ph = phone(d)

  switch (log.action) {
    case 'login':
      return { title: 'Accesso al pannello', meta: d.email || '' }

    // ─── Bookings ────────────────────────────────────────────────────────
    case 'create_booking':
      return {
        title: 'Prenotazione creata',
        meta: joinParts(
          cust,
          d.vehicle || d.vehicle_name,
          d.plate,
          d.pickup && d.dropoff && `${d.pickup} → ${d.dropoff}`,
          d.amount && eur(d.amount)
        ),
      }
    case 'edit_booking':
      return {
        title: 'Prenotazione modificata',
        meta: joinParts(cust, d.vehicle, d.changes, id && `#${id}`),
      }
    case 'delete_booking':
      return { title: 'Prenotazione eliminata', meta: joinParts(cust, id && `#${id}`) }
    case 'extend_booking':
      return {
        title: 'Noleggio esteso',
        meta: joinParts(cust, d.new_dropoff && `nuova riconsegna ${d.new_dropoff}`, d.amount && eur(d.amount)),
      }

    // ─── Contracts ───────────────────────────────────────────────────────
    case 'generate_contract':
      return {
        title: 'Contratto generato',
        meta: joinParts(cust, d.vehicle, d.plate, d.pickup && d.dropoff && `${d.pickup} → ${d.dropoff}`),
      }
    case 'resend_contract':
      return {
        title: 'Link firma contratto re-inviato',
        meta: joinParts(cust, ph && `📱 ${ph}`),
      }

    // ─── Fatture ─────────────────────────────────────────────────────────
    case 'generate_fattura':
      return {
        title: 'Fattura generata',
        meta: joinParts(cust, d.number && `n° ${d.number}`, d.amount && eur(d.amount)),
      }
    case 'delete_fattura':
      return { title: 'Fattura eliminata', meta: joinParts(d.number && `n° ${d.number}`, cust) }
    case 'send_sdi':
      return { title: 'Fattura inviata a SDI', meta: joinParts(d.number && `n° ${d.number}`, cust) }

    // ─── Payments ────────────────────────────────────────────────────────
    case 'mark_paid':
      return {
        title: 'Pagamento segnato',
        meta: joinParts(cust, d.method && `metodo: ${d.method}`, d.amount && eur(d.amount), d.type),
      }
    case 'mark_extension_paid':
      return {
        title: 'Estensione segnata pagata',
        meta: joinParts(cust, d.extension_index !== undefined && `estensione #${d.extension_index + 1}`),
      }
    case 'mark_booking_extensions_paid':
      return { title: 'Prenotazione + estensioni pagate', meta: joinParts(cust) }
    case 'mark_all_customer_paid':
      return { title: 'Tutto pagato per cliente', meta: joinParts(cust, d.total && eur(d.total)) }
    case 'mark_fattura_item_paid':
      return { title: 'Voce fattura segnata pagata', meta: joinParts(d.number && `n° ${d.number}`, cust) }
    case 'mark_type_paid':
      return { title: `${d.type || 'Tipo'} segnato pagato`, meta: joinParts(cust) }
    case 'partial_payment':
      return { title: 'Pagamento parziale', meta: joinParts(cust, d.amount && eur(d.amount)) }

    // ─── Deletes (unpaid) ────────────────────────────────────────────────
    case 'delete_extension':
      return { title: 'Estensione eliminata', meta: joinParts(cust) }
    case 'delete_unpaid_booking':
      return { title: 'Prenotazione non pagata eliminata', meta: joinParts(cust) }

    // ─── Danni / Penali ──────────────────────────────────────────────────
    case 'create_danni':
      return {
        title: 'Danno creato',
        meta: joinParts(cust, d.amount && eur(d.amount), d.status, d.paymentMethod),
      }
    case 'create_penalty':
      return {
        title: 'Penale creata',
        meta: joinParts(cust, d.amount && eur(d.amount), d.status, d.paymentMethod),
      }
    case 'create_danni_penali':
      return {
        title: 'Danno + Penale',
        meta: joinParts(cust, d.amount && eur(d.amount), d.status, d.paymentMethod),
      }

    // ─── Car wash ────────────────────────────────────────────────────────
    case 'create_carwash':
      return {
        title: 'Lavaggio creato',
        meta: joinParts(cust, d.service, d.plate, d.appointment && d.appointment),
      }
    case 'delete_carwash':
      return { title: 'Lavaggio eliminato', meta: joinParts(cust, d.plate) }
    case 'generate_carwash_fattura':
      return { title: 'Fattura lavaggio generata', meta: joinParts(cust, d.amount && eur(d.amount)) }

    // ─── Mechanical ──────────────────────────────────────────────────────
    case 'create_mechanical':
      return { title: 'Meccanica creata', meta: joinParts(cust, d.service, d.plate) }
    case 'delete_mechanical':
      return { title: 'Meccanica eliminata', meta: joinParts(cust, d.plate) }
    case 'generate_mechanical_fattura':
      return { title: 'Fattura meccanica generata', meta: joinParts(cust, d.amount && eur(d.amount)) }

    // ─── Customers ───────────────────────────────────────────────────────
    case 'edit_customer':
      return { title: 'Cliente modificato', meta: cust || id }
    case 'delete_customer':
      return { title: 'Cliente eliminato', meta: cust || id }
    case 'update_customer_status':
      return { title: 'Stato cliente aggiornato', meta: joinParts(cust, d.status) }

    // ─── Preventivi (added in Phase 2) ───────────────────────────────────
    case 'preventivo_created':
      return {
        title: 'Preventivo creato',
        meta: joinParts(
          d.number && `#${d.number}`,
          cust,
          d.vehicle,
          d.total && eur(d.total),
          d.pickup && d.dropoff && `${d.pickup} → ${d.dropoff}`
        ),
      }
    case 'preventivo_updated':
      return {
        title: 'Preventivo aggiornato',
        meta: joinParts(d.number && `#${d.number}`, cust, d.total && eur(d.total)),
      }
    case 'preventivo_sent':
      return {
        title: 'Preventivo inviato via WhatsApp',
        meta: joinParts(
          d.number && `#${d.number}`,
          cust || 'cliente',
          ph && `📱 ${ph}`,
          d.total && eur(d.total)
        ),
      }
    case 'preventivo_converted':
      return {
        title: 'Preventivo convertito in prenotazione',
        meta: joinParts(d.number && `#${d.number}`, cust),
      }
    case 'preventivo_deleted':
      return {
        title: 'Preventivo eliminato',
        meta: joinParts(d.number && `#${d.number}`, cust),
      }
    case 'preventivo_rejected':
      return {
        title: 'Preventivo rifiutato',
        meta: joinParts(d.number && `#${d.number}`, cust, d.reason),
      }

    // ─── WhatsApp (added in Phase 2) ─────────────────────────────────────
    case 'whatsapp_sent':
      return {
        title: 'WhatsApp inviato',
        meta: joinParts(
          d.template && `template: ${d.template}`,
          cust || 'cliente',
          ph && `📱 ${ph}`
        ),
      }
    case 'whatsapp_free_text':
      return {
        title: 'Messaggio libero WhatsApp',
        meta: joinParts(
          d.recipients_count && `${d.recipients_count} destinatari`,
          d.preview && `"${String(d.preview).slice(0, 60)}…"`
        ),
      }
    case 'whatsapp_bulk_send':
      return {
        title: 'Invio massivo WhatsApp',
        meta: joinParts(
          d.template && `template: ${d.template}`,
          d.sent_count && `${d.sent_count} inviati`,
          d.failed_count && `${d.failed_count} falliti`
        ),
      }

    // ─── Misc ────────────────────────────────────────────────────────────
    case 'send_trustera_document':
      return { title: 'Trustera documento inviato', meta: joinParts(d.document, d.signer && `→ ${d.signer}`) }
    case 'delete_trustera_document':
      return { title: 'Documento Trustera eliminato', meta: '' }
    case 'cassa_cauzione':
      return { title: 'Cauzione (cassa)', meta: joinParts(cust, d.amount && eur(d.amount), d.type) }
    case 'limitation_override_approved':
      return { title: 'Limitazione sbloccata via OTP', meta: joinParts(d.target, d.reason) }

    // ─── Centralina Pro ──────────────────────────────────────────────────
    case 'centralina_pro_updated':
      return {
        title: 'Centralina Pro aggiornata',
        meta: joinParts(
          d.changes_count && `${d.changes_count} modifica/e`,
          Array.isArray(d.changes) && d.changes.length > 0 && (d.changes as string[]).slice(0, 4).join(', ')
        ),
      }

    // ─── Messaggi di Sistema Pro ─────────────────────────────────────────
    case 'system_message_updated':
      return {
        title: 'Template messaggio aggiornato',
        meta: joinParts(d.label || d.template, d.body_preview && `"${String(d.body_preview).slice(0, 60)}…"`),
      }
    case 'system_message_toggled':
      return {
        title: 'Template messaggio toggle',
        meta: joinParts(
          d.label || d.template,
          d.field && `${d.field}: ${d.value ? 'ON' : 'OFF'}`
        ),
      }
    case 'system_message_created':
      return {
        title: 'Template messaggio creato',
        meta: joinParts(d.label, d.template && `(${d.template})`),
      }

    default:
      // Unknown action: show action + whatever keys exist
      return {
        title: log.action.replace(/_/g, ' '),
        meta: Object.entries(d).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · '),
      }
  }
}

// Concise entity label shown under the action — e.g. "prenotazione #abc12345"
export function formatEntityLabel(log: AdminLogEntry): string {
  if (!log.entity_type && !log.entity_id) return ''
  const typeLabels: Record<string, string> = {
    booking: 'prenotazione',
    carwash_booking: 'lavaggio',
    mechanical_booking: 'meccanica',
    customer: 'cliente',
    fattura: 'fattura',
    preventivo: 'preventivo',
    contract: 'contratto',
    cauzione: 'cauzione',
    signature: 'firma',
    limitation: 'limitazione',
    session: 'sessione',
  }
  const t = log.entity_type ? typeLabels[log.entity_type] || log.entity_type : ''
  const id = shortId(log.entity_id)
  if (t && id) return `${t} #${id}`
  if (t) return t
  if (id) return `#${id}`
  return ''
}
