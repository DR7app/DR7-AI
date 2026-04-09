/**
 * Seed system_messages table with all real notification templates.
 * Safe to run multiple times — uses upsert on message_key.
 * Call via: POST /.netlify/functions/seed-system-messages
 */
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const MESSAGES = [
  // ── CAR RENTAL ──
  {
    message_key: 'rental_new',
    label: 'Nuova Prenotazione Noleggio',
    description: 'Inviato all\'admin quando si crea una nuova prenotazione noleggio',
    message_body: `*NUOVA PRENOTAZIONE NOLEGGIO*

*ID:* DR7-{booking_id}
*Cliente:* {customer_name}
*Email:* {customer_email}
*Telefono:* {customer_phone}
*Veicolo:* {vehicle_name} ({plate})
*Ritiro:* {pickup_date} alle {pickup_time}
*Riconsegna:* {dropoff_date} alle {dropoff_time}
*Luogo Ritiro:* {pickup_location}
*Assicurazione:* {insurance}
*Totale:* €{total}
*Cauzione:* {deposit}
*KM:* {km_info}
*Pagamento:* {payment_status}`,
    is_automatic: true,
    is_enabled: true,
    include_header: true,
    trigger_event: 'on_booking',
    target_category: 'all',
  },
  {
    message_key: 'rental_new_customer',
    label: 'Conferma Prenotazione Noleggio (Cliente)',
    description: 'Inviato al cliente per conferma prenotazione noleggio',
    message_body: `Salve {nome},

Confermiamo la sua prenotazione.

*CONFERMA PRENOTAZIONE NOLEGGIO*

*ID:* DR7-{booking_id}
*Veicolo:* {vehicle_name}
*Ritiro:* {pickup_date} alle {pickup_time}
*Riconsegna:* {dropoff_date} alle {dropoff_time}
*Luogo Ritiro:* {pickup_location}
*Assicurazione:* {insurance}
*Totale:* €{total}
*KM:* {km_info}
*Pagamento:* {payment_status}

Cordiali Saluti,
DR7`,
    is_automatic: true,
    is_enabled: true,
    include_header: true,
    trigger_event: 'on_booking',
    target_category: 'all',
  },
  {
    message_key: 'rental_modified',
    label: 'Modifica Prenotazione Noleggio',
    description: 'Inviato all\'admin quando si modifica una prenotazione noleggio',
    message_body: `*MODIFICA PRENOTAZIONE NOLEGGIO*

*ID:* DR7-{booking_id}
*Cliente:* {customer_name}
*Email:* {customer_email}
*Telefono:* {customer_phone}
*Veicolo:* {vehicle_name} ({plate})
*Ritiro:* {pickup_date} alle {pickup_time}
*Riconsegna:* {dropoff_date} alle {dropoff_time}
*Luogo Ritiro:* {pickup_location}
*Assicurazione:* {insurance}
*Totale:* €{total}
*Cauzione:* {deposit}
*KM:* {km_info}
*Pagamento:* {payment_status}`,
    is_automatic: true,
    is_enabled: true,
    include_header: true,
    trigger_event: 'on_booking',
    target_category: 'all',
  },

  // ── CAR WASH ──
  {
    message_key: 'carwash_new_admin',
    label: 'Nuova Prenotazione Autolavaggio (Admin)',
    description: 'Inviato all\'admin quando si crea una nuova prenotazione autolavaggio',
    message_body: `🚗 *NUOVA PRENOTAZIONE AUTOLAVAGGIO*

*ID:* DR7-{booking_id}
*Cliente:* {customer_name}
*Email:* {customer_email}
*Telefono:* {customer_phone}
*Servizio:* {service_name}
*Targa:* {plate}
*Data e Ora:* {date} alle {time}
*Servizio Aggiuntivo:* {extras}
*Totale:* €{total}
*Pagamento:* {payment_status}
*Note:* {notes}`,
    is_automatic: true,
    is_enabled: true,
    include_header: false,
    trigger_event: 'on_booking',
    target_category: 'all',
  },
  {
    message_key: 'carwash_new',
    label: 'Conferma Prenotazione Autolavaggio (Cliente)',
    description: 'Inviato al cliente per conferma appuntamento autolavaggio',
    message_body: `Salve {nome},

Confermiamo il suo appuntamento.

*NUOVA PRENOTAZIONE AUTOLAVAGGIO*

*ID:* DR7-{booking_id}
*Servizio:* {service_name}
*Targa:* {plate}
*Data e Ora:* {date} alle {time}
*Servizio Aggiuntivo:* {extras}
*Totale:* €{total}
*Pagamento:* {payment_status}
*Note:* {notes}

Cordiali Saluti,
DR7`,
    is_automatic: true,
    is_enabled: true,
    include_header: true,
    trigger_event: 'on_booking',
    target_category: 'all',
  },
  {
    message_key: 'carwash_modified',
    label: 'Modifica Prenotazione Autolavaggio',
    description: 'Inviato al cliente per modifica appuntamento autolavaggio',
    message_body: `Salve {nome},

Confermiamo la modifica del suo appuntamento.

*MODIFICA PRENOTAZIONE AUTOLAVAGGIO*

*ID:* DR7-{booking_id}
*Servizio:* {service_name}
*Targa:* {plate}
*Data e Ora:* {date} alle {time}
*Servizio Aggiuntivo:* {extras}
*Totale:* €{total}
*Pagamento:* {payment_status}
*Note:* {notes}

Cordiali Saluti,
DR7`,
    is_automatic: true,
    is_enabled: true,
    include_header: true,
    trigger_event: 'on_booking',
    target_category: 'all',
  },

  // ── MECHANICAL ──
  {
    message_key: 'mechanical_new',
    label: 'Nuova Prenotazione Meccanica',
    description: 'Inviato al cliente per conferma appuntamento meccanica',
    message_body: `Salve {nome},

Confermiamo il suo appuntamento.

*NUOVA PRENOTAZIONE MECCANICA*

*ID:* DR7-{booking_id}
*Servizio:* {service_name}
*Data e Ora:* {date} alle {time}
*Totale:* €{total}
*Pagamento:* {payment_status}
*Note:* {notes}

Cordiali Saluti,
DR7`,
    is_automatic: true,
    is_enabled: true,
    include_header: true,
    trigger_event: 'on_booking',
    target_category: 'all',
  },

  // ── EXTENSION ──
  {
    message_key: 'extension_admin',
    label: 'Estensione Noleggio (Admin)',
    description: 'Inviato all\'admin quando si conferma un\'estensione',
    message_body: `*ESTENSIONE PRENOTAZIONE NOLEGGIO*

*ID:* DR7-{booking_id}
*Cliente:* {customer_name}
*Veicolo precedente:* {old_vehicle}
*Nuovo veicolo:* {new_vehicle} ({plate})
*Riconsegna precedente:* {old_return_date} alle {old_return_time}
*Nuova riconsegna:* {new_return_date} alle {new_return_time}
*Importo aggiuntivo:* €{additional_amount}
*Nuovo totale:* €{new_total}
*Km:* {km_info}
*Pagamento estensione:* {payment_status}`,
    is_automatic: true,
    is_enabled: true,
    include_header: true,
    trigger_event: 'on_booking',
    target_category: 'all',
  },
  {
    message_key: 'extension_customer',
    label: 'Estensione Noleggio (Cliente)',
    description: 'Inviato al cliente per conferma estensione',
    message_body: `Salve {nome},

Confermiamo l'estensione della sua prenotazione.

*ESTENSIONE PRENOTAZIONE NOLEGGIO*

*ID:* DR7-{booking_id}
*Nuovo veicolo:* {new_vehicle}
*Riconsegna precedente:* {old_return_date} alle {old_return_time}
*Nuova riconsegna:* {new_return_date} alle {new_return_time}
*Km:* {km_info}
*Importo aggiuntivo:* €{additional_amount}
*Nuovo totale:* €{new_total}
*Pagamento estensione:* {payment_status}

Cordiali Saluti,
DR7`,
    is_automatic: true,
    is_enabled: true,
    include_header: true,
    trigger_event: 'on_booking',
    target_category: 'all',
  },

  // ── REMINDERS ──
  {
    message_key: 'extension_offer_supercar',
    label: 'Proposta Estensione (Supercar)',
    description: 'Inviato il giorno prima della riconsegna per noleggi >24h (supercar/exotic)',
    message_body: `Salve,

la contattiamo per informarla che, qualora avesse necessità di prolungare il noleggio, restiamo a disposizione per verificarne la disponibilità.

In caso di estensione, possiamo riservarle uno sconto dedicato sul periodo aggiuntivo.

Qualora lo desiderasse, le chiediamo gentilmente di indicarci per quanto tempo intende eventualmente prolungare, così da poter valutare la soluzione più conveniente.

Restiamo in attesa di un suo cortese riscontro.
Grazie.

Cordiali saluti,
DR7`,
    is_automatic: true,
    is_enabled: true,
    include_header: false,
    trigger_event: 'before_dropoff',
    trigger_offset_hours: 24,
    target_category: 'exotic',
  },
  {
    message_key: 'extension_offer_urban',
    label: 'Proposta Estensione (Urban/Standard)',
    description: 'Inviato il giorno prima della riconsegna per noleggi >24h (urban/standard)',
    message_body: `Salve {nome},

La contattiamo per informarla che, qualora avesse necessità di prolungare il noleggio, restiamo a disposizione per verificarne la disponibilità.

In caso di estensione, possiamo riservarle uno sconto dedicato sul periodo aggiuntivo.

Qualora lo desiderasse, le chiediamo gentilmente di indicarci per quanto tempo intende eventualmente prolungare, così da poter valutare la soluzione più conveniente.

Cordiali saluti,
DR7`,
    is_automatic: true,
    is_enabled: true,
    include_header: false,
    trigger_event: 'before_dropoff',
    trigger_offset_hours: 24,
    target_category: 'urban',
  },
  {
    message_key: 'iban_request',
    label: 'Richiesta IBAN (Cauzione)',
    description: 'Inviato il giorno dopo la riconsegna per richiedere IBAN rimborso cauzione',
    message_body: `Salve {nome},

La ringraziamo per aver scelto i nostri servizi.

Al fine di procedere con la restituzione della cauzione, Le chiediamo cortesemente di comunicarci il Suo IBAN completo e il nominativo dell'intestatario del conto.

Il rimborso verrà effettuato tramite bonifico ordinario entro il quattordicesimo giorno lavorativo, come da condizioni contrattuali.

Cordiali saluti,
DR7`,
    is_automatic: true,
    is_enabled: true,
    include_header: false,
    trigger_event: 'after_dropoff',
    trigger_offset_hours: 24,
    target_category: 'all',
  },

  // ── CHECK-IN / CHECK-OUT ──
  {
    message_key: 'checkin_reminder',
    label: 'Promemoria Ritiro (Check-in)',
    description: 'Inviato il giorno del ritiro del veicolo',
    message_body: `Ciao {nome}!

Ti ricordiamo il ritiro del tuo veicolo previsto per *oggi*.

*Veicolo:* {vehicle_name}
*Targa:* {plate}
*Orario Ritiro:* {pickup_time}
*Luogo:* {pickup_location}
*Cauzione:* {deposit}

Ti aspettiamo! Per qualsiasi necessita non esitare a contattarci.

_DR7 Empire_`,
    is_automatic: true,
    is_enabled: true,
    include_header: false,
    trigger_event: 'before_pickup',
    trigger_offset_hours: 0,
    target_category: 'all',
  },
  {
    message_key: 'checkout_reminder',
    label: 'Promemoria Riconsegna (Check-out)',
    description: 'Inviato il giorno della riconsegna del veicolo',
    message_body: `Ciao {nome}!

Ti ricordiamo la riconsegna del veicolo prevista per *oggi*.

*Veicolo:* {vehicle_name}
*Targa:* {plate}
*Orario Riconsegna:* {return_time}
*Luogo:* {dropoff_location}
*Cauzione:* {deposit}
_La cauzione verra restituita entro 14 giorni lavorativi dalla riconsegna._

Ti preghiamo di riconsegnare il veicolo nelle stesse condizioni in cui lo hai ritirato.

Grazie per aver scelto DR7 Empire!`,
    is_automatic: true,
    is_enabled: true,
    include_header: false,
    trigger_event: 'before_dropoff',
    trigger_offset_hours: 0,
    target_category: 'all',
  },

  // ── REVIEW ──
  {
    message_key: 'review_request',
    label: 'Richiesta Recensione',
    description: 'Inviato 60-120 minuti dopo la riconsegna',
    message_body: `Ciao {nome} 👋🏻

Grazie per aver scelto DR7 Empire!

La tua opinione è fondamentale per noi. Se ti fa piacere, lasciaci una recensione a 5 stelle raccontando la tua esperienza ⭐

In segno di gratitudine, inviandoci uno screenshot della recensione riceverai un buono sconto da €100 sul tuo prossimo noleggio e uno da €10 sul tuo prossimo lavaggio 🎁

Clicca qui per lasciare la recensione 👇🏻
https://g.page/r/CQwgJt7OYpsfEBM/review

Grazie mille!
Dubai Rent 7.0 S.p.A.`,
    is_automatic: true,
    is_enabled: true,
    include_header: false,
    trigger_event: 'after_dropoff',
    trigger_offset_hours: 1,
    target_category: 'all',
  },

  // ── BIRTHDAY ──
  {
    message_key: 'birthday_greeting',
    label: 'Auguri Compleanno (10 giorni prima)',
    description: 'Inviato 10 giorni prima del compleanno del cliente',
    message_body: `Ciao {nome} 👋🏻

mancano esattamente 10 giorni a una data speciale: il tuo compleanno 🥳

Non vogliamo anticipare gli auguri, ma fare qualcosa di più autentico: riconoscere il tuo valore, prima ancora di celebrarlo.

In qualità di nostro cliente, abbiamo il piacere di riservarti un pensiero dedicato, in linea con il tuo stile 🎁

Per questo ti abbiamo riservato:

Credito personale di €100 utilizzabile per un noleggio DR7

Buono sconto di €10 per un lavaggio auto DR7

CODICE SCONTO: {codice}

Non è solo un regalo, ma un invito a concederti un'esperienza che ti rappresenti: potente, elegante, inconfondibile.

Ti basterà rispondere a questo messaggio per attivare il tuo credito. Saremo lieti di accompagnarti nella scelta 👇🏻

Con stima,
Dubai Rent 7.0 S.p.A.
Ogni compleanno merita uno stile all'altezza.`,
    is_automatic: true,
    is_enabled: true,
    include_header: false,
    trigger_event: 'before_pickup',
    trigger_offset_hours: 240,
    target_category: 'all',
  },

  // ── PAYMENT ──
  {
    message_key: 'payment_reminder',
    label: 'Promemoria Pagamento',
    description: 'Inviato quando si rigenera un link di pagamento per prenotazione non pagata',
    message_body: `Gentile {customer_name},

Le ricordiamo che il pagamento per la prenotazione #{booking_ref} è ancora in sospeso.

Per completare il pagamento di €{total}, clicchi sul seguente link sicuro:
{payment_link}

⚠️ Il link scade tra 1 ora. In assenza di pagamento, la prenotazione verrà automaticamente annullata.

Grazie per la collaborazione.`,
    is_automatic: false,
    is_enabled: true,
    include_header: false,
    trigger_event: 'on_payment',
    target_category: 'all',
  },

  // ── PREVENTIVO ──
  {
    message_key: 'preventivo_send',
    label: 'Invio Preventivo al Cliente',
    description: 'Inviato al cliente via WhatsApp quando si invia un preventivo',
    message_body: `Preventivo {vehicle_specs}

{rental_days}gg x {daily_rate}/g = {rental_total}
{insurance_line}
{lavaggio_line}
{no_cauzione_line}
{km_illimitati_line}
{second_driver_line}
{extras_lines}

Totale = {subtotal}
{sconto_line}`,
    is_automatic: false,
    is_enabled: true,
    include_header: false,
    trigger_event: 'on_preventivo',
    target_category: 'all',
  },

  // ── WELCOME ──
  {
    message_key: 'welcome_registration',
    label: 'Benvenuto Registrazione',
    description: 'Inviato via WhatsApp/email dopo la registrazione sul sito',
    message_body: `Gentile {customer_name},

La ringraziamo per essersi registrato sul nostro sito e per aver scelto di entrare nel mondo *DR7*.

Con la Sua registrazione, entra ufficialmente in un ecosistema esclusivo dedicato alla mobilità premium, ai servizi personalizzati e a un'esperienza superiore.

Per darle il benvenuto, abbiamo appena accreditato *10€ di credito omaggio* sul Suo wallet *DR7*, già disponibili e utilizzabili per le Sue prossime prenotazioni.

Inoltre, ogni acquisto Le permetterà di accumulare ulteriore credito: più utilizza i servizi *DR7*, più il Suo wallet crescerà nel tempo.

La invitiamo ad approfittarne subito per prenotare il Suo servizio e vivere in prima persona lo standard *DR7*: rapido, elegante e senza compromessi.

Può procedere immediatamente da qui:
https://dr7empire.com/

Restiamo a Sua completa disposizione.

Cordiali saluti,
*DR7*`,
    is_automatic: true,
    is_enabled: true,
    include_header: false,
    trigger_event: 'on_booking',
    target_category: 'all',
  },
]

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Delete ALL old messages first — replace with real ones only
    const validKeys = MESSAGES.map(m => m.message_key)
    await supabase
      .from('system_messages')
      .delete()
      .not('message_key', 'in', `(${validKeys.join(',')})`)

    // Also delete any that aren't in our list (catches old junk)
    const { data: existing } = await supabase.from('system_messages').select('message_key')
    if (existing) {
      const toDelete = existing.filter(e => !validKeys.includes(e.message_key))
      for (const old of toDelete) {
        await supabase.from('system_messages').delete().eq('message_key', old.message_key)
      }
    }

    // Upsert all real messages
    for (const msg of MESSAGES) {
      const { error } = await supabase
        .from('system_messages')
        .upsert(
          {
            message_key: msg.message_key,
            label: msg.label,
            description: msg.description,
            message_body: msg.message_body,
            is_automatic: msg.is_automatic,
            is_enabled: msg.is_enabled,
            include_header: msg.include_header,
            trigger_event: msg.trigger_event,
            trigger_offset_hours: (msg as any).trigger_offset_hours || 0,
            target_category: msg.target_category,
            target_status: 'all',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'message_key' }
        )

      if (error) {
        console.error(`Error upserting ${msg.message_key}:`, error)
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, count: MESSAGES.length }),
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}
