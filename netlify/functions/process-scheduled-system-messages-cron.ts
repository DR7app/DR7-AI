/**
 * Cron — processa i messaggi automatici creati in Messaggi di Sistema Pro.
 *
 * Per ogni system_messages con is_automatic=true e is_enabled=true:
 *   1. Calcola il momento target = event_time ± trigger_offset_hours
 *   2. Se "now" cade nella finestra [target - 30min, target + 8min]
 *      e il template non e' gia' stato inviato a questa booking
 *      (system_message_send_log UNIQUE), invia via
 *      /.netlify/functions/send-whatsapp-notification e logga.
 *
 * Eventi supportati:
 *   - before_pickup, after_pickup    → booking.pickup_date (rental) o appointment_date (lavaggio/meccanica)
 *   - before_dropoff, after_dropoff  → booking.dropoff_date (rental) o appointment_date
 *   - on_booking                     → booking.created_at
 *   - on_payment                     → booking.updated_at quando payment_status diventa pagato
 *   - on_signature                   → booking.booking_details.signature_signed_at
 *   - on_extension                   → ultima extension_history entry created_at
 *   - on_preventivo                  → SKIP (preventivi vivono in altra tabella, gia' gestiti)
 *
 * send_hour: se valorizzato, sposta il target a quell'ora (Rome) del giorno target.
 * target_status: filtro su booking.status (CSV "confirmed,active" → IN ["confirmed","active"]).
 * target_category: 'all' o categoria veicolo (matching su vehicle_category top-level oppure
 *                  booking_details.vehicle.category).
 *
 * Cadenza cron: ogni 2 minuti (allineata a netlify.toml). Finestra
 * leggermente sovrapposta per non perdere sends se un cron precedente
 * fallisce.
 */
import { schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { matchesAdvancedFilters, passesCustomerFilters, loadPaymentMethodAliases, loadResidentProvinces } from './utils/triggerSystemMessageEvent';
import { getProKeyEventTriggers, OLD_TO_PRO } from '../../src/utils/proTemplateRouting';
import { getAdminNotificationPhone } from './utils/notificationPhone';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Booking = any;

interface SystemMessage {
    id: string;
    message_key: string;
    label: string;
    is_automatic: boolean;
    is_enabled: boolean;
    trigger_event: string;
    trigger_offset_hours: number;
    send_hour: number | null;
    target_category: string;
    target_status: string;
    target_service_type?: string;
    target_with_deposit?: string;
    target_plate?: string | null;
    target_payment_method?: string;
    target_amount_min?: number | null;
    target_amount_max?: number | null;
    target_days_of_week?: string;
    quiet_hours_start?: number | null;
    quiet_hours_end?: number | null;
    target_membership_tier?: string | null;
    target_min_prev_bookings?: number | null;
    target_rental_duration_min?: number | null;
    target_rental_duration_max?: number | null;
    target_customer_tags?: string | null;
}

const LOOKBACK_MS = 30 * 60 * 1000;  // 30 min: forgive previous-cron failures
const LOOKFORWARD_MS = 8 * 60 * 1000; // 8 min: small overlap with next cron run (15min interval)

/**
 * Restituisce il timestamp UTC dell'evento per la booking, o null se non applicabile.
 */
function getEventTimeMs(booking: Booking, event: string): number | null {
    const isRental = !booking.service_type || (booking.service_type !== 'car_wash' && booking.service_type !== 'mechanical_service' && booking.service_type !== 'mechanical');
    const apt = booking.appointment_date as string | null;

    switch (event) {
        case 'before_pickup':
        case 'after_pickup': {
            const t = isRental ? booking.pickup_date : apt;
            return t ? new Date(t).getTime() : null;
        }
        case 'before_dropoff':
        case 'after_dropoff': {
            const t = isRental ? (booking.dropoff_date || booking.pickup_date) : apt;
            return t ? new Date(t).getTime() : null;
        }
        case 'on_booking': {
            const t = booking.booked_at || booking.created_at;
            return t ? new Date(t).getTime() : null;
        }
        case 'on_payment': {
            const paid = booking.payment_status === 'paid' || booking.payment_status === 'succeeded' || booking.payment_status === 'completed';
            if (!paid) return null;
            const t = booking.updated_at || booking.created_at;
            return t ? new Date(t).getTime() : null;
        }
        case 'on_signature': {
            const t = booking.booking_details?.signature_signed_at || booking.booking_details?.contract?.signed_at;
            return t ? new Date(t).getTime() : null;
        }
        case 'on_extension': {
            const ext = booking.booking_details?.extension_history;
            if (!Array.isArray(ext) || ext.length === 0) return null;
            const last = ext[ext.length - 1];
            const t = last?.created_at;
            return t ? new Date(t).getTime() : null;
        }
        case 'before_signature': {
            // Promemoria firma: parte SOLO se la firma manca ancora.
            // Ancora il timestamp al pickup_date (rental) o appointment_date.
            const signed = booking.booking_details?.signature_signed_at || booking.booking_details?.contract?.signed_at;
            if (signed) return null;
            const t = isRental ? booking.pickup_date : apt;
            return t ? new Date(t).getTime() : null;
        }
        case 'after_signature_review': {
            // Recensione X giorni/ore DOPO la firma.
            const t = booking.booking_details?.signature_signed_at || booking.booking_details?.contract?.signed_at;
            return t ? new Date(t).getTime() : null;
        }
        case 'on_late_return': {
            // Ritardo riconsegna oltre la grace. Ancora a dropoff_date.
            // Il template viene mandato quando NOW > dropoff_date + grace_min
            // e l'auto non e' ancora rientrata (status != completata).
            const isReturned = booking.status === 'completed' || booking.status === 'completata';
            if (isReturned) return null;
            const t = isRental ? (booking.dropoff_date || booking.pickup_date) : apt;
            return t ? new Date(t).getTime() : null;
        }
        default:
            return null;
    }
}

/**
 * Applica send_hour (Rome) al target_time. Se send_hour e' null, ritorna target_time.
 * Sposta a "il giorno-di-target alle send_hour:00 Rome".
 */
function applySendHourRome(targetMs: number, sendHour: number | null): number {
    if (sendHour == null) return targetMs;

    const target = new Date(targetMs);
    // Estrai data Rome (YYYY-MM-DD)
    const romeDate = target.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
    const [yyyy, mm, dd] = romeDate.split('-').map(Number);

    // Costruisci "yyyy-mm-dd HH:00:00" come Rome local time, poi calcola UTC
    // sfruttando l'offset Rome al target_time.
    const sample = new Date(targetMs);
    const offsetMin = -sample.getTimezoneOffset(); // server-tz offset (probabilmente UTC = 0)
    void offsetMin;

    // Approccio robusto: costruisci la stringa ISO Rome e usa Intl per parsare l'offset.
    const isoNoTz = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T${String(sendHour).padStart(2, '0')}:00:00`;
    // Calcola Rome UTC offset al target tramite confronto formattato.
    const utcStr = new Date(targetMs).toISOString();
    const romeFmt = new Date(targetMs).toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }); // "YYYY-MM-DD HH:MM:SS"
    const utcAsRomeMs = Date.parse(utcStr.replace('Z', '')); // UTC components as if local
    const romeAsLocalMs = Date.parse(romeFmt.replace(' ', 'T'));
    const offsetMs = romeAsLocalMs - utcAsRomeMs; // ms di Rome rispetto a UTC

    // isoNoTz e' "Rome local"; convertilo a UTC sottraendo l'offset.
    const localMs = Date.parse(isoNoTz);
    return localMs - offsetMs;
}

/**
 * Calcola il target_time finale per (template, booking).
 */
function computeTargetMs(template: SystemMessage, booking: Booking): number | null {
    const eventMs = getEventTimeMs(booking, template.trigger_event);
    if (eventMs == null) return null;

    const offsetMs = (template.trigger_offset_hours || 0) * 3600 * 1000;
    let target: number;
    if (template.trigger_event.startsWith('before_')) {
        target = eventMs - offsetMs;
    } else {
        // after_* | on_* — offset positivo viene sommato
        target = eventMs + offsetMs;
    }

    return applySendHourRome(target, template.send_hour);
}

// ── Processori per eventi non-booking ────────────────────────────────────────
//
// Pattern comune per ognuno:
// 1. Carica le entità dalla loro tabella di riferimento (cauzioni / customers /
//    scadenze) con un filtro temporale che approssima la finestra utile.
// 2. Per ogni entità, calcola target_time = event_time ± offset_hours.
// 3. Se target_time ∈ [now - LOOKBACK, now + LOOKFORWARD] e non gia' inviato
//    (system_message_send_log UNIQUE), costruisce un "synthetic booking" con
//    i dati del cliente + i metadati dell'entità, lo passa a
//    send-whatsapp-notification con messageKey = tpl.message_key, e logga.
//
// system_message_send_log.booking_id viene usato come "entity_id": per le
// cauzioni e' cauzione.id, per i customers e' customer.id, per le scadenze
// e' scadenza.id. Il dedup vincola (template_id, entity_id) unique.
//
// eslint-disable @typescript-eslint/no-explicit-any

async function fireToCustomer(
    tpl: SystemMessage,
    entityId: string,
    custName: string,
    custEmail: string | null,
    custPhone: string | null,
    extraVars: Record<string, unknown> = {}
): Promise<{ sent: boolean; skipped: boolean; error: boolean }> {
    if (!custPhone) return { sent: false, skipped: true, error: false };

    // Dedup
    const { data: existing } = await supabase
        .from('system_message_send_log')
        .select('id')
        .eq('system_message_id', tpl.id)
        .eq('booking_id', entityId)
        .maybeSingle();
    if (existing?.id) return { sent: false, skipped: true, error: false };

    // Synthetic booking — i campi standard usati da send-whatsapp-notification
    // per la sostituzione delle variabili.
    const syntheticBooking = {
        id: entityId,
        customer_name: custName,
        customer_email: custEmail || '',
        customer_phone: custPhone,
        ...extraVars,
    };

    const baseUrl = process.env.URL || 'https://admin.dr7empire.com';
    try {
        const res = await fetch(`${baseUrl}/.netlify/functions/send-whatsapp-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ booking: syntheticBooking, messageKey: tpl.message_key, customPhone: custPhone }),
        });
        const ok = res.ok;
        let resp: any = null;
        try { resp = await res.json(); } catch { /* ignore */ }
        await supabase.from('system_message_send_log').insert({
            system_message_id: tpl.id,
            booking_id: entityId,
            customer_phone: custPhone,
            status: ok ? (resp?.skipped ? 'skipped' : 'sent') : 'error',
            error: ok ? null : `HTTP ${res.status}`,
        });
        if (!ok) return { sent: false, skipped: false, error: true };
        return { sent: !resp?.skipped, skipped: !!resp?.skipped, error: false };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        try {
            await supabase.from('system_message_send_log').insert({
                system_message_id: tpl.id,
                booking_id: entityId,
                customer_phone: custPhone,
                status: 'error',
                error: msg.slice(0, 500),
            });
        } catch { /* ok */ }
        return { sent: false, skipped: false, error: true };
    }
}

async function processCauzioneScadenze(tpl: SystemMessage, now: number) {
    const offsetH = tpl.trigger_offset_hours || 0;
    let sent = 0, skipped = 0, errors = 0;

    // Per on_cauzione_due: target_time = scadenza_cauzione - offset (offset prima)
    // Per on_cauzione_overdue: target_time = scadenza_cauzione + offset (offset dopo)
    const sign = tpl.trigger_event === 'on_cauzione_due' ? -1 : +1;
    const lo = new Date(now - sign * offsetH * 3600 * 1000 - LOOKBACK_MS).toISOString();
    const hi = new Date(now - sign * offsetH * 3600 * 1000 + LOOKFORWARD_MS).toISOString();

    const { data: cauzioni } = await supabase
        .from('cauzioni')
        .select('id, cliente_id, importo, scadenza_cauzione, stato, data_incasso, data_restituzione')
        .gte('scadenza_cauzione', lo)
        .lte('scadenza_cauzione', hi)
        .limit(500);

    if (!cauzioni?.length) return { sent: 0, skipped: 0, errors: 0 };

    for (const c of cauzioni as any[]) {
        // Skip cauzioni gia' chiuse (incassate / restituite / sbloccate / bloccate)
        if (c.stato === 'Restituita' || c.stato === 'Sbloccata' || c.stato === 'Bloccata' || c.data_incasso || c.data_restituzione) continue;

        // Carica i dati cliente
        const { data: cust } = await supabase
            .from('customers_extended')
            .select('nome, cognome, email, telefono, ragione_sociale')
            .eq('id', c.cliente_id)
            .maybeSingle();
        if (!cust) continue;
        const custName = cust.ragione_sociale || `${cust.nome || ''} ${cust.cognome || ''}`.trim() || cust.email || 'Cliente';

        const r = await fireToCustomer(tpl, c.id, custName, cust.email, cust.telefono, {
            deposit_amount: c.importo,
            scadenza_cauzione: c.scadenza_cauzione,
        });
        if (r.sent) sent++; else if (r.skipped) skipped++; else if (r.error) errors++;
    }

    return { sent, skipped, errors };
}

async function processInactiveCustomers(tpl: SystemMessage, now: number) {
    const days = tpl.trigger_event === 'on_inactive_30d' ? 30 : 90;
    let sent = 0, skipped = 0, errors = 0;

    // Soglia: clienti la cui ultima prenotazione e' avvenuta esattamente
    // 'days' giorni fa (con finestra LOOKBACK/LOOKFORWARD). Cosi' il
    // messaggio parte una volta sola per quel cliente quando supera la
    // soglia, non ogni giorno per tutti gli inattivi.
    const targetMs = now - days * 86400000;
    const loDate = new Date(targetMs - LOOKBACK_MS).toISOString().slice(0, 10);
    const hiDate = new Date(targetMs + LOOKFORWARD_MS).toISOString().slice(0, 10);

    // Trova bookings il cui MASSIMO created_at per cliente e' nel range
    // [loDate, hiDate]. Senza una vista materializzata, facciamo un best-effort:
    // carica i clienti con email + ultimo booking via aggregate JS.
    const { data: bookings } = await supabase
        .from('bookings')
        .select('customer_email, customer_phone, customer_name, created_at')
        .not('customer_email', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5000);
    if (!bookings?.length) return { sent: 0, skipped: 0, errors: 0 };

    // Mappa email → ultimo booking (senza considerare cancellate / non pagate)
    const lastByEmail = new Map<string, { phone: string | null; name: string; last: string }>();
    for (const b of bookings as any[]) {
        const e = String(b.customer_email || '').toLowerCase().trim();
        if (!e) continue;
        if (!lastByEmail.has(e)) {
            lastByEmail.set(e, { phone: b.customer_phone || null, name: b.customer_name || '', last: b.created_at });
        }
    }

    for (const [email, info] of lastByEmail.entries()) {
        const dateStr = info.last.slice(0, 10);
        if (dateStr < loDate || dateStr > hiDate) continue;
        const r = await fireToCustomer(tpl, `inactive-${email}-${days}d`, info.name, email, info.phone);
        if (r.sent) sent++; else if (r.skipped) skipped++; else if (r.error) errors++;
    }

    return { sent, skipped, errors };
}

async function processScadenzeAdmin(tpl: SystemMessage, now: number) {
    const days = tpl.trigger_event === 'on_scadenza_3d' ? 3 : 7;
    let sent = 0, skipped = 0, errors = 0;

    const targetMs = now + days * 86400000;
    const lo = new Date(targetMs - LOOKBACK_MS).toISOString();
    const hi = new Date(targetMs + LOOKFORWARD_MS).toISOString();

    const { data: scadenze } = await supabase
        .from('scadenze')
        .select('id, item_type, description, due_date, amount, reference_name, status')
        .gte('due_date', lo)
        .lte('due_date', hi)
        .not('status', 'in', '(completed,paid,refunded)')
        .limit(500);

    if (!scadenze?.length) return { sent: 0, skipped: 0, errors: 0 };

    // Per le scadenze admin non c'e' un cliente — invia al numero direzione
    // configurato (centralina_pro_config → env → fallback storico).
    const adminPhone = await getAdminNotificationPhone();

    for (const s of scadenze as any[]) {
        const r = await fireToCustomer(tpl, `scadenza-${s.id}-${days}d`, 'DR7 Admin', null, adminPhone, {
            scadenza_item: s.item_type,
            scadenza_description: s.description,
            scadenza_amount: s.amount,
            scadenza_reference: s.reference_name,
        });
        if (r.sent) sent++; else if (r.skipped) skipped++; else if (r.error) errors++;
    }

    return { sent, skipped, errors };
}

const cronHandler = async () => {
    const now = Date.now();
    console.log(`[scheduled-msgs] cron fired at ${new Date(now).toISOString()}`);

    // 1. Carica tutti i template automatici attivi
    const { data: templates, error: tplErr } = await supabase
        .from('system_messages')
        .select('id, message_key, label, is_automatic, is_enabled, trigger_event, trigger_offset_hours, send_hour, target_category, target_status, target_service_type, target_with_deposit, target_plate, target_payment_method, target_amount_min, target_amount_max, target_days_of_week, quiet_hours_start, quiet_hours_end, target_membership_tier, target_min_prev_bookings, target_max_prev_bookings, target_rental_duration_min, target_rental_duration_max, target_customer_tags, target_residency, target_age_min, target_age_max, target_pickup_hour_min, target_pickup_hour_max, target_source_channel, target_province, target_min_lifetime_value, target_has_unpaid_invoices, target_used_promo_before, target_extension_count_min, target_extension_count_max')
        .eq('is_automatic', true)
        .eq('is_enabled', true);

    if (tplErr) {
        console.error('[scheduled-msgs] templates fetch failed:', tplErr.message);
        return { statusCode: 500, body: tplErr.message };
    }
    if (!templates?.length) {
        console.log('[scheduled-msgs] no automatic templates');
        return { statusCode: 200, body: JSON.stringify({ ok: true, sent: 0, scanned: 0 }) };
    }

    let totalSent = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    const results: Array<{ template: string; booking_id: string; status: string; reason?: string }> = [];

    // Carica le cache config-driven (5min TTL ciascuna) prima di iniziare
    await loadPaymentMethodAliases(supabase);
    await loadResidentProvinces(supabase);

    // 2026-05-30 SAFETY ALLOWLIST. Questo cron era DISABILITATO dal 2026-05-13
    // (incident: ~1000 messaggi randomici) perché decine di template risultano
    // is_automatic+is_enabled per errore (wrapper header/footer, template
    // event-driven come fatture/link pagamento/firma forzati su uno schedule).
    // Per riattivare SOLO il "promemoria ritiro veicolo" senza far ripartire
    // tutto il resto, se la env SCHEDULED_MSGS_ALLOWLIST è impostata (CSV di
    // message_key) il cron processa ESCLUSIVAMENTE quei template e salta ogni
    // altro. Così, anche con il cron acceso, può partire solo ciò che è in
    // allowlist. Lasciare la env vuota = comportamento storico (tutti).
    // ALLOWLIST DI SICUREZZA. Questo cron era disabilitato dal 2026-05-13
    // (mass-send ~1000 msg) perché decine di template sono is_automatic+is_enabled
    // per errore (wrapper, fatture, link pagamento/firma forzati su schedule).
    // Riattivato il 2026-05-30 SOLO per il "promemoria ritiro veicolo": la
    // consegna è permessa ESCLUSIVAMENTE per i message_key in allowlist.
    // Default (senza env) = SOLO il promemoria ritiro, così funziona al deploy
    // senza dover toccare le env su Netlify. La env SCHEDULED_MSGS_ALLOWLIST
    // (CSV) può sovrascrivere l'elenco se in futuro servono altri template.
    // NB: non esiste un caso "manda tutto" — se l'allowlist fosse vuota il cron
    // non manda nulla (fail-safe anti-incident).
    const DEFAULT_ALLOWLIST = ['pro_custom_promemoria_ritiro_veicolo_1778334892254'];
    const allowlistRaw = (process.env.SCHEDULED_MSGS_ALLOWLIST || '').trim();
    const allowlist = allowlistRaw
        ? allowlistRaw.split(',').map(s => s.trim()).filter(Boolean)
        : DEFAULT_ALLOWLIST;
    if (allowlist.length === 0) {
        console.warn('[scheduled-msgs] allowlist vuota — modalità SAFE (nessun invio).');
        return { statusCode: 200, body: JSON.stringify({ ok: true, sent: 0, scanned: 0, reason: 'empty_allowlist_safe_mode' }) };
    }
    console.log(`[scheduled-msgs] ALLOWLIST attiva — solo: ${allowlist.join(', ')}`);

    for (const tpl of templates as SystemMessage[]) {
        // Allowlist gate: salta tutto ciò che non è esplicitamente consentito.
        const mk = String((tpl as { message_key?: string }).message_key || '');
        if (!allowlist.includes(mk)) continue;

        // Skip eventi non gestiti (preventivo gestito altrove)
        if (tpl.trigger_event === 'on_preventivo') continue;

        // 2026-05-19: skip i template LEGACY (message_key in OLD_TO_PRO).
        // L'admin assegna i loro eventi ai pro_* via Messaggi di Sistema Pro >
        // Programmazione (handled_events). Se questo cron continuasse a far
        // fire i legacy, il cliente riceveva 2 messaggi per lo stesso evento:
        // uno dal pro_* (via resolver/templateKey path) e uno dal legacy (qui).
        const legacyKeys = Object.keys(OLD_TO_PRO)
        if ((tpl as { message_key?: string }).message_key
            && legacyKeys.includes((tpl as { message_key?: string }).message_key as string)) {
            console.log(`[scheduled-msgs] Skipping legacy template ${tpl.label} (${tpl.message_key}) — superseded by pro_* via handled_events`)
            continue;
        }

        // Skip i template guidati da eventi di codice (Conferma Noleggio,
        // Wallet Bonus, Firma, ecc.). Il loro invio avviene quando l'evento
        // si verifica (callback Nexi, signature-complete, booking creato,
        // ecc.) — il cron NON deve aggiungere un secondo invio. Prima senza
        // questo check, un template "Conferma Noleggio" con is_automatic=true
        // e trigger=before_dropoff veniva inviato due volte: una via evento
        // alla creazione, una via cron 24h prima della riconsegna.
        const eventTriggersForTpl = getProKeyEventTriggers((tpl as { message_key?: string }).message_key, (tpl as { label?: string }).label)
        if (eventTriggersForTpl.length > 0) {
            console.log(`[scheduled-msgs] Skipping event-driven template ${tpl.label} (${tpl.message_key}) — handled by code callbacks`)
            continue;
        }

        // ── Eventi non-booking gestiti dal cron ───────────────────────────
        if (tpl.trigger_event === 'on_cauzione_due' || tpl.trigger_event === 'on_cauzione_overdue') {
            const r = await processCauzioneScadenze(tpl, now);
            totalSent += r.sent; totalSkipped += r.skipped; totalErrors += r.errors;
            continue;
        }
        if (tpl.trigger_event === 'on_inactive_30d' || tpl.trigger_event === 'on_inactive_90d') {
            const r = await processInactiveCustomers(tpl, now);
            totalSent += r.sent; totalSkipped += r.skipped; totalErrors += r.errors;
            continue;
        }
        if (tpl.trigger_event === 'on_scadenza_3d' || tpl.trigger_event === 'on_scadenza_7d') {
            const r = await processScadenzeAdmin(tpl, now);
            totalSent += r.sent; totalSkipped += r.skipped; totalErrors += r.errors;
            continue;
        }

        // Filtri
        // target_status semantics:
        //   - undefined / null  → fallback storico `confirmed,active`
        //   - stringa vuota ''  → NESSUN filtro (admin ha esplicitamente
        //     deselezionato tutti gli stati nel form: vuole TUTTI gli stati)
        //   - CSV non vuoto     → filtro IN(...stati...)
        const rawStatus = tpl.target_status
        const statuses = rawStatus == null
            ? ['confirmed', 'active']
            : rawStatus.split(',').map(s => s.trim()).filter(Boolean);

        // 2. Carica candidati (limita per evitare scan tabella intera)
        let q = supabase.from('bookings').select('*');
        if (statuses.length > 0) q = q.in('status', statuses);
        // Ottimizzazione: per before_pickup/after_pickup ecc. restringiamo per data
        // intorno alla finestra utile = (now ± window) ∓ offset.
        //
        // BUG FIX: quando send_hour è impostato (es. "24h prima del ritiro
        // alle 09:00"), il TARGET reale è send_hour:00 Rome del giorno
        // calendario corrispondente, NON pickup_date − offset esatto. Una
        // pickup tomorrow ALLE 14:00 con offset 24h e send_hour=9 produce
        // target = oggi 09:00 Rome — non oggi 14:00. Con la finestra
        // stretta ±30/+8 min sul "now + offset", l'orario di pickup non-09:00
        // veniva filtrato fuori e il cron non vedeva mai il booking
        // (sintomo: "il promemoria 24h prima del ritiro non parte se la
        // pickup non è alle 09:00"). Adesso, se send_hour è impostato,
        // espandiamo la finestra a ±24h così tutte le pickup del giorno
        // target rientrano. Il filtro fine per-booking lo fa comunque
        // computeTargetMs + il check now ∈ [target−30min, target+8min].
        const offsetH = tpl.trigger_offset_hours || 0;
        const usesSendHour = tpl.send_hour != null;
        const wideBackMs = usesSendHour ? 24 * 3600 * 1000 : LOOKBACK_MS;
        const wideFwdMs = usesSendHour ? 24 * 3600 * 1000 : LOOKFORWARD_MS;
        if (tpl.trigger_event === 'before_pickup' || tpl.trigger_event === 'after_pickup') {
            const sign = tpl.trigger_event === 'before_pickup' ? +1 : -1;
            const lo = new Date(now + sign * offsetH * 3600 * 1000 - wideBackMs).toISOString();
            const hi = new Date(now + sign * offsetH * 3600 * 1000 + wideFwdMs).toISOString();
            q = q.gte('pickup_date', lo).lte('pickup_date', hi);
            // 2026-05-30: il gate "pagato O confermato" per il promemoria ritiro
            // è applicato per-booking nel loop sotto (serve leggere anche
            // manually_confirmed da booking_details, non filtrabile bene in SQL).
        } else if (tpl.trigger_event === 'before_dropoff' || tpl.trigger_event === 'after_dropoff') {
            const sign = tpl.trigger_event === 'before_dropoff' ? +1 : -1;
            const lo = new Date(now + sign * offsetH * 3600 * 1000 - wideBackMs).toISOString();
            const hi = new Date(now + sign * offsetH * 3600 * 1000 + wideFwdMs).toISOString();
            q = q.gte('dropoff_date', lo).lte('dropoff_date', hi);
        } else if (tpl.trigger_event === 'on_booking') {
            const lo = new Date(now - offsetH * 3600 * 1000 - LOOKBACK_MS).toISOString();
            const hi = new Date(now - offsetH * 3600 * 1000 + LOOKFORWARD_MS).toISOString();
            q = q.gte('created_at', lo).lte('created_at', hi);
        } else if (tpl.trigger_event === 'on_payment') {
            // Per on_payment filtriamo su payment_status e updated_at recente
            q = q.in('payment_status', ['paid', 'succeeded', 'completed']);
            const lo = new Date(now - offsetH * 3600 * 1000 - LOOKBACK_MS).toISOString();
            const hi = new Date(now - offsetH * 3600 * 1000 + LOOKFORWARD_MS).toISOString();
            q = q.gte('updated_at', lo).lte('updated_at', hi);
        } else if (tpl.trigger_event === 'before_signature') {
            // Promemoria firma: ancorato al pickup_date come before_pickup,
            // poi computeTargetMs/getEventTimeMs filtra via signed!=null.
            // Stesso fix di before_pickup: espandi la finestra quando
            // send_hour è impostato così pickup di qualsiasi ora del
            // giorno target viene catturata.
            const lo = new Date(now + offsetH * 3600 * 1000 - wideBackMs).toISOString();
            const hi = new Date(now + offsetH * 3600 * 1000 + wideFwdMs).toISOString();
            q = q.gte('pickup_date', lo).lte('pickup_date', hi);
        } else if (tpl.trigger_event === 'on_late_return') {
            // Ritardo: dropoff_date in passato, status non completato.
            // Niente filtro per data perche' il ritardo puo' essere di ore o
            // giorni — getEventTimeMs gestisce. Filtra via status.
            q = q.not('status', 'in', '(completed,completata,cancelled,annullata)');
            const lo = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
            const hi = new Date(now).toISOString();
            q = q.gte('dropoff_date', lo).lte('dropoff_date', hi);
        }
        // on_signature / after_signature_review / on_extension: niente filtro
        // perche' i timestamp sono dentro JSONB

        const { data: candidates, error: bkErr } = await q.limit(500);
        if (bkErr) {
            console.error(`[scheduled-msgs] bookings fetch failed for ${tpl.label}:`, bkErr.message);
            continue;
        }
        if (!candidates?.length) continue;

        for (const booking of candidates as Booking[]) {
            // 2026-05-30: promemoria RITIRO → va a chi ha PAGATO **oppure** a chi
            // ha la prenotazione CONFERMATA (manually_confirmed). Confermare
            // significa "il cliente prende l'auto" anche se Da Saldare/Contanti,
            // quindi il promemoria 24h prima deve partire comunque (caso concas:
            // unpaid ma confermato). Restano esclusi i non-pagati e non-confermati.
            if (tpl.trigger_event === 'before_pickup') {
                const ps = String(booking.payment_status || '').toLowerCase()
                const isPaid = ps === 'paid' || ps === 'succeeded' || ps === 'completed'
                const isConfirmed = booking.booking_details?.manually_confirmed === true
                    || booking.status === 'confirmed'
                if (!isPaid && !isConfirmed) continue
            }

            // Filtri avanzati (service_type / cauzione / targa / metodo / importo)
            if (!matchesAdvancedFilters(tpl, booking)) continue
            if (!await passesCustomerFilters(tpl, booking, supabase)) continue

            // Filtro categoria veicolo (best-effort: prima top-level, poi booking_details)
            if (tpl.target_category && tpl.target_category !== 'all') {
                const cat =
                    booking.vehicle_category
                    || booking.booking_details?.vehicle?.category
                    || booking.booking_details?.vehicleCategory
                    || '';
                if (String(cat).toLowerCase() !== String(tpl.target_category).toLowerCase()) continue;
            }

            // Calcola target_time finale
            const targetMs = computeTargetMs(tpl, booking);
            if (targetMs == null) continue;

            // Finestra
            if (targetMs < now - LOOKBACK_MS) continue;       // troppo tardi
            if (targetMs > now + LOOKFORWARD_MS) continue;    // troppo presto

            // Dedup veloce (best-effort): salta se gia' loggato.
            const { data: existing } = await supabase
                .from('system_message_send_log')
                .select('id')
                .eq('system_message_id', tpl.id)
                .eq('booking_id', booking.id)
                .maybeSingle();
            if (existing?.id) {
                totalSkipped++;
                continue;
            }

            // 2026-05-30 ANTI-DOPPIO INVIO: "claim" PRIMA di inviare.
            // Inseriamo la riga di log con stato 'sending' SFRUTTANDO il vincolo
            // DB UNIQUE(system_message_id, booking_id). Se due cron tick si
            // sovrappongono (finestra 8min) o se la select sopra ha perso una
            // riga appena creata, il secondo insert FALLISCE sul unique → non
            // inviamo. Cosi' il messaggio parte AT-MOST-ONCE, anche in race.
            // Prima si inviava e POI si loggava: se il log falliva, il run
            // successivo non trovava la riga e RIMANDAVA il messaggio (doppio).
            const { data: claim, error: claimErr } = await supabase
                .from('system_message_send_log')
                .insert({
                    system_message_id: tpl.id,
                    booking_id: booking.id,
                    customer_phone: booking.customer_phone,
                    status: 'sending',
                })
                .select('id')
                .maybeSingle();
            if (claimErr || !claim?.id) {
                // unique violation o altro → un altro tick ha gia' preso questo invio
                console.log(`[scheduled-msgs] claim fallito per ${tpl.message_key}/${booking.id} (gia' in invio?) — skip`);
                totalSkipped++;
                continue;
            }

            // Invia (claim ottenuto: questo è l'unico tick che invierà)
            try {
                const baseUrl = process.env.URL || 'https://admin.dr7empire.com';
                const res = await fetch(`${baseUrl}/.netlify/functions/send-whatsapp-notification`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking, messageKey: tpl.message_key }),
                });

                const ok = res.ok;
                let resp: any = null;
                try { resp = await res.json(); } catch { /* ignore */ }

                // Aggiorna la riga di claim con l'esito reale.
                await supabase.from('system_message_send_log')
                    .update({
                        status: ok ? (resp?.skipped ? 'skipped' : 'sent') : 'error',
                        error: ok ? null : `HTTP ${res.status}: ${JSON.stringify(resp)?.slice(0, 200)}`,
                    })
                    .eq('id', claim.id);

                if (ok) {
                    if (resp?.skipped) totalSkipped++;
                    else totalSent++;
                    results.push({ template: tpl.label, booking_id: booking.id, status: resp?.skipped ? 'skipped' : 'sent' });
                } else {
                    totalErrors++;
                    results.push({ template: tpl.label, booking_id: booking.id, status: 'error', reason: `HTTP ${res.status}` });
                }
            } catch (e: unknown) {
                totalErrors++;
                const msg = e instanceof Error ? e.message : String(e);
                // Marca la riga claim come errore (resta a bloccare il doppio invio;
                // se vuoi ritentare manualmente, cancella la riga di log).
                await supabase.from('system_message_send_log')
                    .update({ status: 'error', error: msg.slice(0, 500) })
                    .eq('id', claim.id);
                results.push({ template: tpl.label, booking_id: booking.id, status: 'error', reason: msg });
            }
        }
    }

    console.log(`[scheduled-msgs] done. sent=${totalSent} skipped=${totalSkipped} errors=${totalErrors}`);
    return {
        statusCode: 200,
        body: JSON.stringify({
            ok: true,
            now: new Date(now).toISOString(),
            templates: templates.length,
            sent: totalSent,
            skipped: totalSkipped,
            errors: totalErrors,
            results,
        }),
    };
};

// Cadenza */2 * * * * (ogni 2 min) — DEVE corrispondere a netlify.toml
// → `[functions."process-scheduled-system-messages-cron"] schedule = "*/2 * * * *"`.
// In passato c'era un mismatch (file `*/15`, toml `*/2`) che lasciava il
// comportamento ambiguo: i messaggi automatici a volte non partivano nei
// tempi previsti perché la pianificazione effettiva era indeterminata.
export const handler = schedule('*/2 * * * *', cronHandler);
