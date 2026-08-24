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
 * Cadenza cron: ogni 8 minuti, allineata a netlify.toml (prima il codice
 * dichiarava ogni 2 minuti e il toml ogni 8: la stessa finestra poteva essere
 * ritentata 4 volte piu' spesso). Finestra
 * leggermente sovrapposta per non perdere sends se un cron precedente
 * fallisce.
 */
import { schedule } from '@netlify/functions';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { matchesAdvancedFilters, matchesServiceType, passesCustomerFilters, loadPaymentMethodAliases, loadResidentProvinces } from './utils/triggerSystemMessageEvent';
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
    // 2026-08-05 — programmazione ricorrente + destinatari configurabili.
    send_minute?: number | null;
    recurrence_start_date?: string | null;
    recurrence_end_date?: string | null;
    recipient_mode?: string | null;
    recipient_phones?: string | null;
    recipient_admin_roles?: string | null;
    handled_events?: string[] | null;
}

const LOOKBACK_MS = 30 * 60 * 1000;  // 30 min: forgive previous-cron failures
const LOOKFORWARD_MS = 8 * 60 * 1000; // 8 min: small overlap with next cron run (15min interval)

// Quiet hours (ora di Roma): NESSUN messaggio automatico esce tra le 22:00 e le
// 07:00. Copre l'intero cron (template clienti + promemoria autista + rimborso
// cauzioni). Prima le colonne quiet_hours_start/end esistevano ma non venivano
// mai applicate: qualsiasi messaggio poteva partire di notte.
// SMTP condiviso con le altre funzioni (info@dr7.app): serve all'avviso di
// scadenza cauzione quando in Centralina Pro e' impostata anche un'email.
const avvisoTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.secureserver.net',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
});

const QUIET_START_HOUR = 22; // incluso: da 22:00
const QUIET_END_HOUR = 7;    // escluso: fino alle 06:59, riparte alle 07:00

/** Ora corrente (0-23) nel fuso Europe/Rome. */
function getRomeHour(nowMs: number): number {
    return Number(
        new Date(nowMs).toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).slice(0, 2)
    );
}

/** True se l'ora di Roma cade nella fascia silenziosa [22:00, 07:00). */
function isRomeQuietHours(nowMs: number): boolean {
    const h = getRomeHour(nowMs);
    return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

// ── Programmazione ricorrente a calendario (trigger_event = 'on_schedule') ────
//
// Slegata dalle prenotazioni: l'admin sceglie i giorni della settimana, l'ora
// e i minuti (Roma), un eventuale intervallo di date e i destinatari. Serve
// per i messaggi che NON hanno una pratica di riferimento — es. "ogni sabato
// alle 18:30 manda la promo della vettura X a questa lista di numeri".
export const RECURRING_EVENT = 'on_schedule';

/** Finestra di tolleranza dopo l'orario configurato (il cron gira ogni 8 min). */
const RECURRING_WINDOW_MIN = 20;

interface RomeParts {
    /** 0 = domenica ... 6 = sabato — stessa convenzione di target_days_of_week. */
    dow: number;
    hour: number;
    minute: number;
    /** yyyy-mm-dd nel fuso di Roma (chiave di dedup giornaliera). */
    date: string;
}

/** Scompone "adesso" nel fuso Europe/Rome (giorno settimana, ora, minuti, data). */
function getRomeParts(nowMs: number): RomeParts {
    const d = new Date(nowMs);
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome',
        weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
    const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        dow: dowMap[String(parts.weekday)] ?? 0,
        hour: Number(parts.hour) === 24 ? 0 : Number(parts.hour),
        minute: Number(parts.minute),
        date: `${parts.year}-${parts.month}-${parts.day}`,
    };
}

/** True se il template e' una programmazione ricorrente a calendario. */
function isRecurringTemplate(tpl: SystemMessage): boolean {
    return tpl.trigger_event === RECURRING_EVENT;
}

/**
 * True se "adesso" (Roma) cade nella finestra di invio della ricorrenza:
 * giorno della settimana selezionato, dentro l'intervallo di date, e orario
 * compreso tra [ora:minuti configurati, +RECURRING_WINDOW_MIN].
 */
function recurringDueNow(tpl: SystemMessage, nowMs: number): boolean {
    const rome = getRomeParts(nowMs);

    // Giorni della settimana: CSV 0-6 (0 = domenica).
    // 2026-08-05: per una RICORRENZA il CSV vuoto significa "nessun giorno
    // scelto" → non parte. Prima valeva "tutti i giorni": bastava svuotare la
    // selezione per far partire il messaggio ogni giorno senza averlo chiesto.
    // (Il CSV vuoto resta "nessun filtro" per gli eventi legati a una pratica,
    // che non passano di qui.)
    const daysCsv = (tpl.target_days_of_week ?? '').trim();
    const days = daysCsv.split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n));
    if (days.length === 0) {
        console.log(`[scheduled-msgs] ricorrenza "${tpl.label}": nessun giorno selezionato — non parte`);
        return false;
    }
    if (!days.includes(rome.dow)) return false;

    // Intervallo di validita' (date incluse).
    if (tpl.recurrence_start_date && rome.date < tpl.recurrence_start_date) return false;
    if (tpl.recurrence_end_date && rome.date > tpl.recurrence_end_date) return false;

    // Orario: send_hour = null significa "appena possibile" → mezzanotte non ha
    // senso per una ricorrenza, quindi trattiamo null come 9:00 (stesso default
    // storico del resto del cron).
    const targetHour = tpl.send_hour == null ? 9 : Number(tpl.send_hour);
    const targetMinute = Number(tpl.send_minute ?? 0) || 0;
    const nowMin = rome.hour * 60 + rome.minute;
    const targetMin = targetHour * 60 + targetMinute;
    return nowMin >= targetMin && nowMin < targetMin + RECURRING_WINDOW_MIN;
}

/** Un destinatario risolto dalla configurazione del template. */
interface ResolvedRecipient {
    nome: string;
    phone: string;
    email?: string | null;
}

/** Normalizza un numero a sole cifre (Green API rifiuta i caratteri nascosti). */
function normalizePhoneDigits(raw: string): string {
    return String(raw || '').replace(/\D/g, '');
}

/**
 * Risolve i destinatari configurati dall'admin sul template.
 * NB: 'customer' non passa di qui — resta il percorso storico booking-anchored.
 */
async function resolveConfiguredRecipients(tpl: SystemMessage): Promise<ResolvedRecipient[]> {
    const mode = (tpl.recipient_mode || 'customer').trim();
    const out = new Map<string, ResolvedRecipient>();

    if (mode === 'custom_phones') {
        for (const part of String(tpl.recipient_phones || '').split(/[,;\n]/)) {
            const phone = normalizePhoneDigits(part);
            if (phone.length >= 8 && !out.has(phone)) out.set(phone, { nome: 'Destinatario', phone });
        }
        return [...out.values()];
    }

    if (mode === 'admin_roles') {
        const roles = String(tpl.recipient_admin_roles || '')
            .split(',').map(s => s.trim()).filter(Boolean);
        if (roles.length === 0) return [];
        // Role tag = voce `role:<tag>` dentro admins.permissions[] (useAdminRole).
        const { data: admins } = await supabase
            .from('admins')
            .select('nome, contatto_interno, permissions');
        for (const a of (admins || []) as Array<{ nome?: string; contatto_interno?: string; permissions?: string[] }>) {
            const perms = Array.isArray(a.permissions) ? a.permissions : [];
            const match = roles.some(r => perms.includes(`role:${r}`)) || perms.includes('*');
            if (!match) continue;
            const phone = normalizePhoneDigits(a.contatto_interno || '');
            if (phone.length >= 8 && !out.has(phone)) out.set(phone, { nome: a.nome || 'Staff', phone });
        }
        return [...out.values()];
    }

    if (mode === 'all_customers') {
        // 2026-08-23: la select era senza paginazione, quindi PostgREST
        // tagliava a 1000 righe e i clienti oltre la millesima non ricevevano
        // MAI il messaggio — silenziosamente, senza errore.
        const rows: Array<{ nome?: string; cognome?: string; telefono?: string; email?: string }> = [];
        for (let page = 0; page < 50; page++) {
            const { data: batch } = await supabase
                .from('customers_extended')
                .select('nome, cognome, telefono, email')
                .not('telefono', 'is', null)
                .order('id', { ascending: true })
                .range(page * 1000, page * 1000 + 999);
            const got = (batch || []) as typeof rows;
            rows.push(...got);
            if (got.length < 1000) break;
        }
        for (const c of rows) {
            const phone = normalizePhoneDigits(c.telefono || '');
            if (phone.length >= 8 && !out.has(phone)) {
                out.set(phone, {
                    nome: [c.nome, c.cognome].filter(Boolean).join(' ') || 'Cliente',
                    phone,
                    email: c.email || null,
                });
            }
        }
        return [...out.values()];
    }

    // 2026-08-23 — nuovo modo "clienti con noleggio in corso".
    //
    // Prima l'unico broadcast possibile era `all_customers`: TUTTA l'anagrafica,
    // senza guardare le prenotazioni. Un messaggio pensato per "chi ha adesso
    // l'auto" finiva quindi anche ai clienti del lavaggio e a chi non ha nulla
    // in corso, mentre i filtri "Tipo servizio" e "Stati ammessi" non venivano
    // nemmeno letti su questo percorso (non c'e' una prenotazione da filtrare).
    // Qui i destinatari nascono DALLE prenotazioni, e i due filtri valgono.
    if (mode === 'active_bookings') {
        const nowIso = new Date().toISOString();
        const rows: BookingRow[] = [];
        for (let page = 0; page < 20; page++) {
            const { data: batch } = await supabase
                .from('bookings')
                .select('id, customer_name, customer_phone, customer_email, status, service_type, pickup_date, dropoff_date, appointment_date, booking_details')
                .not('status', 'in', '(cancelled,annullata,completed,completata)')
                .lte('pickup_date', nowIso)
                .gte('dropoff_date', nowIso)
                .order('id', { ascending: true })
                .range(page * 1000, page * 1000 + 999);
            const got = (batch || []) as unknown as BookingRow[];
            rows.push(...got);
            if (got.length < 1000) break;
        }

        // Stati ammessi: se l'admin ne ha scelti, valgono anche qui.
        const statusCsv = tpl.target_status;
        const allowed = statusCsv == null
            ? null // nessuna scelta esplicita: non restringere oltre "in corso"
            : new Set(statusCsv.split(',').map(x => x.trim()).filter(Boolean));

        for (const b of rows) {
            if (allowed && allowed.size > 0 && !allowed.has(String(b.status || ''))) continue;
            if (!matchesServiceType(tpl, b)) continue;
            const bd = (b.booking_details || {}) as Record<string, unknown>;
            const cust = (bd.customer || {}) as Record<string, unknown>;
            const phone = normalizePhoneDigits(String(b.customer_phone || cust.phone || ''));
            if (phone.length < 8 || out.has(phone)) continue;
            out.set(phone, {
                nome: String(b.customer_name || cust.fullName || 'Cliente'),
                phone,
                email: (b.customer_email as string) || (cust.email as string) || null,
            });
        }
        return [...out.values()];
    }

    return [];
}

interface BookingRow {
    id: string;
    customer_name?: string | null;
    customer_phone?: string | null;
    customer_email?: string | null;
    status?: string | null;
    service_type?: string | null;
    pickup_date?: string | null;
    dropoff_date?: string | null;
    appointment_date?: string | null;
    booking_details?: Record<string, unknown> | null;
}

/**
 * Processa un template con programmazione ricorrente: se "adesso" e' nella
 * finestra, invia ai destinatari configurati. Dedup per (template, giorno) su
 * ciascun destinatario, così il messaggio parte una sola volta anche se il
 * cron gira piu' volte dentro la finestra.
 */
async function processRecurringSchedule(
    tpl: SystemMessage,
    now: number
): Promise<{ sent: number; skipped: number; errors: number }> {
    if (!recurringDueNow(tpl, now)) return { sent: 0, skipped: 0, errors: 0 };

    const recipients = await resolveConfiguredRecipients(tpl);
    if (recipients.length === 0) {
        console.log(`[scheduled-msgs] ricorrenza "${tpl.label}": nessun destinatario configurato (mode=${tpl.recipient_mode})`);
        return { sent: 0, skipped: 1, errors: 0 };
    }

    const dayKey = getRomeParts(now).date;
    let sent = 0, skipped = 0, errors = 0;

    for (const r of recipients) {
        // entityId = chiave di dedup: un invio per destinatario per giornata.
        const entityId = `recur-${tpl.id}-${dayKey}-${r.phone}`;
        const res = await fireToCustomer(tpl, entityId, r.nome, r.email ?? null, r.phone, {
            // Variabili disponibili nel testo anche senza prenotazione.
            targa: tpl.target_plate || '',
            vehicle_plate: tpl.target_plate || '',
        });
        if (res.sent) sent++;
        else if (res.skipped) skipped++;
        if (res.error) errors++;
    }

    console.log(`[scheduled-msgs] ricorrenza "${tpl.label}" (${dayKey}): ${sent} inviati, ${skipped} saltati, ${errors} errori`);
    return { sent, skipped, errors };
}

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

// 2026-08-06 — system_message_send_log.booking_id e' UUID NOT NULL, ma diversi
// percorsi usano chiavi TESTUALI come entity id (`recur-<tpl>-<data>-<tel>`,
// `inactive-<email>-<gg>d`, `scadenza-<id>-<gg>d`). Su una colonna uuid quelle
// query danno errore di cast: la select tornava vuota e l'insert falliva, quindi
// il dedup non registrava NULLA e il messaggio ripartiva a ogni giro del cron
// (il caso "un messaggio ogni pochi minuti"). Qui le chiavi non-UUID diventano
// un UUID v5 deterministico, cosi' il vincolo UNIQUE funziona davvero. Gli id
// gia' UUID (booking, cauzione, customer) passano invariati: il dedup storico
// resta valido e nulla viene rimandato.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEDUP_NAMESPACE = 'b7c1f0de-3a54-4c2f-9a1e-5d6c8f2b4a70';

function dedupKey(entityId: string): string {
    if (UUID_RE.test(entityId)) return entityId;
    const hash = createHash('sha1')
        .update(Buffer.from(DEDUP_NAMESPACE.replace(/-/g, ''), 'hex'))
        .update(entityId, 'utf8')
        .digest();
    const b = Buffer.from(hash.subarray(0, 16));
    b[6] = (b[6] & 0x0f) | 0x50; // versione 5
    b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
    const h = b.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function fireToCustomer(
    tpl: SystemMessage,
    entityId: string,
    custName: string,
    custEmail: string | null,
    custPhone: string | null,
    extraVars: Record<string, unknown> = {}
): Promise<{ sent: boolean; skipped: boolean; error: boolean }> {
    if (!custPhone) return { sent: false, skipped: true, error: false };

    // Dedup. NB: la chiave passa da dedupKey() perche' system_message_send_log
    // .booking_id e' UUID: le chiavi testuali (recur-*, inactive-*, scadenza-*)
    // facevano fallire SIA la select SIA l'insert → nessun log → il messaggio
    // ripartiva a OGNI giro del cron. Vedi dedupKey().
    const logKey = dedupKey(entityId);
    const { data: existing, error: dedupErr } = await supabase
        .from('system_message_send_log')
        .select('id')
        .eq('system_message_id', tpl.id)
        .eq('booking_id', logKey)
        .maybeSingle();
    // Fail-closed: se non riusciamo a verificare il dedup NON inviamo. Meglio un
    // messaggio in meno che lo stesso messaggio a ripetizione.
    if (dedupErr) {
        console.error(`[scheduled-msgs] dedup non verificabile per ${tpl.message_key}/${entityId} — non invio:`, dedupErr.message);
        return { sent: false, skipped: true, error: true };
    }
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

    // "Claim" PRIMA di inviare, come nel percorso booking-anchored: il vincolo
    // UNIQUE(system_message_id, booking_id) rende l'invio at-most-once anche se
    // due tick del cron si sovrappongono. Prima si inviava e POI si loggava: se
    // il log falliva, il giro dopo il messaggio ripartiva.
    const { data: claim, error: claimErr } = await supabase
        .from('system_message_send_log')
        .insert({
            system_message_id: tpl.id,
            booking_id: logKey,
            customer_phone: custPhone,
            status: 'sending',
        })
        .select('id')
        .maybeSingle();
    if (claimErr || !claim?.id) {
        console.log(`[scheduled-msgs] claim fallito per ${tpl.message_key}/${entityId} (gia' inviato o log KO) — skip${claimErr ? ': ' + claimErr.message : ''}`);
        return { sent: false, skipped: true, error: !!claimErr };
    }

    const baseUrl = process.env.URL || 'https://platform.dr7ai.com';
    try {
        const res = await fetch(`${baseUrl}/.netlify/functions/send-whatsapp-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ booking: syntheticBooking, messageKey: tpl.message_key, customPhone: custPhone }),
        });
        const ok = res.ok;
        let resp: any = null;
        try { resp = await res.json(); } catch { /* ignore */ }
        await supabase.from('system_message_send_log')
            .update({
                status: ok ? (resp?.skipped ? 'skipped' : 'sent') : 'error',
                error: ok ? null : `HTTP ${res.status}`,
            })
            .eq('id', claim.id);
        if (!ok) return { sent: false, skipped: false, error: true };
        return { sent: !resp?.skipped, skipped: !!resp?.skipped, error: false };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // La riga di claim resta a bloccare il doppio invio: per ritentare a
        // mano si cancella la riga di log.
        await supabase.from('system_message_send_log')
            .update({ status: 'error', error: msg.slice(0, 500) })
            .eq('id', claim.id);
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

// Promemoria autista 12h prima della corsa straordinaria (service_type
// 'uscita_straordinaria'). Destinatari = gli autisti della card
// (booking_details.uscita.autisti[].phone), NON il cliente. Testo dal template
// Pro 'pro_promemoria_autista' (editabile). Dedup: flag
// booking_details.uscita.autista_reminder_sent_at — una passata per card manda
// a TUTTI i suoi autisti, poi non ripete. Blocco dedicato perche' il loop
// cliente invia a customer_phone (vuoto sulle uscite) e la dedup del send_log
// e' per (template, booking), non per singolo autista.
async function processUscitaAutistaReminders(now: number): Promise<{ sent: number; skipped: number; errors: number }> {
    let sent = 0, skipped = 0, errors = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // 2026-07-12: trova il template autista per KEY o per LABEL (robusto anche
    // se creato dalla UI con key pro_custom_*), e richiede cron_approved come
    // il resto dei promemoria (parte solo se approvato dall'admin).
    const { data: tplRows } = await supabase
        .from('system_messages')
        .select('message_body, is_enabled, cron_approved, message_key, label')
        .or('message_key.eq.pro_promemoria_autista,label.ilike.%autista%')
        .order('updated_at', { ascending: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tpl = (tplRows || []).find((r: any) => r.is_enabled !== false && r.cron_approved === true && !!r.message_body);
    if (!tpl) return { sent, skipped, errors };

    const OFFSET_MS = 12 * 3600 * 1000;
    // pickup - 12h ∈ [now - LOOKBACK, now + LOOKFORWARD]  →  pickup ∈ [now+12h-LOOKBACK, now+12h+LOOKFORWARD]
    const lo = new Date(now + OFFSET_MS - LOOKBACK_MS).toISOString();
    const hi = new Date(now + OFFSET_MS + LOOKFORWARD_MS).toISOString();
    const { data: rows } = await supabase
        .from('bookings')
        .select('id, pickup_date, status, booking_details')
        .eq('service_type', 'uscita_straordinaria')
        .not('status', 'in', '(cancelled,annullata,completed,completata)')
        .gte('pickup_date', lo)
        .lte('pickup_date', hi);

    const baseUrl = process.env.URL || 'https://platform.dr7ai.com';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const b of (rows || []) as any[]) {
        const uscita = b.booking_details?.uscita;
        if (!uscita) continue;
        if (uscita.autista_reminder_sent_at) { skipped++; continue; }
        const autisti = Array.isArray(uscita.autisti) ? uscita.autisti : [];
        for (const a of autisti) {
            const phone = a?.phone;
            if (!phone) continue;
            const firstName = String(a.full_name || '').trim().split(/\s+/)[0] || 'Autista';
            const body = String(tpl.message_body).split('{nome}').join(firstName);
            try {
                const res = await fetch(`${baseUrl}/.netlify/functions/send-whatsapp-notification`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ customPhone: phone, customMessage: body, type: 'Promemoria Servizio Autista' }),
                });
                if (res.ok) sent++; else errors++;
            } catch { errors++; }
        }
        // Marca la card come gia' avvisata (anche se 0 autisti con telefono:
        // evita ri-tentativi infiniti sulla stessa card).
        await supabase.from('bookings')
            .update({ booking_details: { ...b.booking_details, uscita: { ...uscita, autista_reminder_sent_at: new Date().toISOString() } } })
            .eq('id', b.id);
    }
    return { sent, skipped, errors };
}

/**
 * Promemoria STAFF (Valerio/Ilenia) delle cauzioni bonifico in scadenza OGGI da
 * restituire manualmente. Manda UN riepilogo WhatsApp per destinatario con
 * importo/intestatario/IBAN pronti. Parte SOLO se il template
 * pro_cauzioni_rimborso_staff e' is_enabled + cron_approved (toggle in Messaggi
 * di Sistema Pro). Anti-doppio-invio via cauzioni.rimborso_reminder_sent_on.
 * Destinatari = direzione (valerio@/ilenia@dr7.app) via admins.contatto_interno.
 */
/**
 * Avviso automatico "Scadenza cauzione" (spec 22/07/2026) — FASE 5-6.
 * Un messaggio PER cauzione il giorno esatto della scadenza restituzione, con
 * scelta automatica della variante A (bonifico) / B (IBAN mancante) / C (pre-auth).
 * Anti-duplicato a DB via cauzioni_scadenza_log.chiave_antidup (UNIQUE).
 * Template pro_scadenza_cauzione_a/b/c gestiti da Messaggi di Sistema Pro
 * (is_enabled + cron_approved). Orario 08:00 (send_hour del template).
 */
// Destinatari staff cauzioni: numeri configurati in Centralina
// (config.notifications.cauzioni_staff_phones, separati da virgola/riga/;) +
// fallback ad admins.contatto_interno di valerio@/ilenia@dr7.app. Dedup.
async function resolveCauzioniStaffRecipients(): Promise<{ nome: string; phone: string }[]> {
    const out = new Map<string, { nome: string; phone: string }>();
    // 1) numeri configurati
    try {
        const { data } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const notif = (data?.config as any)?.notifications || {};
        const raw = String(notif.cauzioni_staff_phones || '');
        for (const part of raw.split(/[\n,;]+/)) {
            const phone = part.replace(/\D/g, '');
            if (phone.length >= 8) out.set(phone, { nome: 'Staff', phone });
        }
    } catch { /* config opzionale */ }
    // 2) fallback admins.contatto_interno
    try {
        const { data: admins } = await supabase
            .from('admins').select('email, nome, contatto_interno')
            .in('email', ['valerio@dr7.app', 'ilenia@dr7.app']);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const a of (admins || []) as any[]) {
            const phone = String(a.contatto_interno || '').replace(/\D/g, '');
            if (phone.length >= 8 && !out.has(phone)) out.set(phone, { nome: a.nome || 'Staff', phone });
        }
    } catch { /* ignore */ }
    return [...out.values()];
}

/**
 * Configurazione dell'avviso di scadenza cauzione (Centralina Pro > Cauzioni).
 * Se la migration 20260824_cauzioni_avviso_scadenza_config.sql non e' ancora
 * stata eseguita si torna al comportamento storico: avviso il giorno stesso,
 * solo WhatsApp allo staff, automatico.
 */
async function loadAvvisoCauzioneConfig(): Promise<{
    modalita: 'automatico' | 'manuale';
    offsets: number[];
    whatsapp: string[];
    email: string[];
}> {
    const fallback = { modalita: 'automatico' as const, offsets: [0], whatsapp: [] as string[], email: [] as string[] };
    try {
        const { data, error } = await supabase
            .from('cauzioni_config')
            .select('avviso_modalita, avviso_offsets, avviso_whatsapp, avviso_email')
            .eq('id', 'main')
            .maybeSingle();
        if (error || !data) return fallback;
        const split = (v: unknown) => String(v || '')
            .split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
        const offsets = Array.isArray(data.avviso_offsets) && data.avviso_offsets.length > 0
            ? data.avviso_offsets.map(Number).filter(n => Number.isInteger(n) && n >= -3 && n <= 3)
            : [0];
        return {
            modalita: data.avviso_modalita === 'manuale' ? 'manuale' : 'automatico',
            offsets: offsets.length > 0 ? offsets : [0],
            whatsapp: split(data.avviso_whatsapp).map(x => x.replace(/\D/g, '')).filter(x => x.length >= 8),
            email: split(data.avviso_email).filter(x => /\S+@\S+\.\S+/.test(x)),
        };
    } catch { return fallback; }
}

/** Data (Rome, YYYY-MM-DD) spostata di `giorni` rispetto a oggi. */
function romeDatePlus(now: number, giorni: number): string {
    const d = new Date(now + giorni * 86400000);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}

export async function processScadenzaCauzioneAvviso(now: number, opts?: { force?: boolean }): Promise<{ sent: number; skipped: number; errors: number; reason?: string }> {
    let sent = 0, skipped = 0, errors = 0;
    const force = opts?.force === true;

    // 1) Template varianti approvate (toggle ON/OFF in Messaggi di Sistema Pro).
    const { data: tplRows } = await supabase
        .from('system_messages')
        .select('message_key, message_body, is_enabled, cron_approved, send_hour')
        .in('message_key', ['pro_scadenza_cauzione_a', 'pro_scadenza_cauzione_b', 'pro_scadenza_cauzione_c']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tplByVariant: Record<string, any> = {};
    (tplRows || []).forEach((r: { message_key: string; is_enabled: boolean; cron_approved: boolean; message_body: string }) => {
        if (r.is_enabled !== false && r.message_body && (force || r.cron_approved === true)) {
            tplByVariant[r.message_key.slice(-1).toUpperCase()] = r; // A / B / C
        }
    });
    if (Object.keys(tplByVariant).length === 0) {
        return { sent, skipped, errors, reason: force
            ? 'Nessun template "Scadenza Cauzione" attivo in Messaggi di Sistema Pro'
            : undefined };
    }

    const cfg = await loadAvvisoCauzioneConfig();
    // In modalita' manuale il cron non manda niente: parte solo da "Invia ora".
    if (!force && cfg.modalita === 'manuale') return { sent, skipped, errors };

    // 2) Gate orario: dall'ora del template (Rome, default 8) in poi, mai di notte.
    const todayRome = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
    if (!force) {
        if (isRomeQuietHours(now)) return { sent, skipped, errors };
        const romeHour = getRomeHour(now);
        const sendHour = Number((Object.values(tplByVariant)[0] as { send_hour: number | null })?.send_hour ?? 8);
        if (romeHour < sendHour || romeHour >= QUIET_START_HOUR) return { sent, skipped, errors };
    }

    // 3) Cauzioni cui l'avviso tocca OGGI. Un offset di -1 (un giorno prima)
    //    guarda le cauzioni che scadono domani; +2 quelle scadute due giorni fa.
    const targetDates = [...new Set(cfg.offsets.map(o => romeDatePlus(now, -o)))];
    const { data: cauzRows } = await supabase
        .from('cauzioni')
        .select('*')
        .in('scadenza_cauzione', targetDates)
        .eq('stato_restituzione', 'DA_RESTITUIRE')
        .not('stato', 'in', '(Restituita,Sbloccata,Bloccata,Danno)');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const due = (cauzRows || []).filter((c: any) => {
        if (!force && c.scadenza_avviso_sent_on === todayRome) return false;
        const incassataOPreauth = !!c.data_incasso || c.metodo === 'preautorizzazione';
        return incassataOPreauth;
    });
    if (due.length === 0) {
        return { sent, skipped, errors, reason: force
            ? `Nessuna cauzione da avvisare (scadenza ${targetDates.join(', ')})`
            : undefined };
    }

    // Nomi cliente
    const { validateIban } = await import('../../src/utils/ibanValidation');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clienteIds = [...new Set(due.map((c: any) => c.cliente_id).filter(Boolean))];
    const nameMap: Record<string, string> = {};
    if (clienteIds.length > 0) {
        const { data: custs } = await supabase
            .from('customers_extended')
            .select('id, nome, cognome, ragione_sociale, denominazione, tipo_cliente')
            .in('id', clienteIds as string[]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (custs || []).forEach((c: any) => {
            const azienda = c.tipo_cliente === 'azienda' ? (c.ragione_sociale || c.denominazione) : null;
            nameMap[c.id] = azienda || `${c.nome || ''} ${c.cognome || ''}`.trim() || 'Cliente';
        });
    }

    // Destinatari: quelli scelti in Centralina Pro > Cauzioni; se non ce ne
    // sono si ricade sui numeri staff gia' configurati.
    const recipients = cfg.whatsapp.length > 0
        ? cfg.whatsapp.map(phone => ({ nome: 'Staff', phone }))
        : await resolveCauzioniStaffRecipients();
    if (recipients.length === 0 && cfg.email.length === 0) {
        return { sent, skipped, errors, reason: 'Nessun destinatario: imposta numero WhatsApp o email in Centralina Pro > Cauzioni' };
    }

    const baseUrl = process.env.URL || 'https://platform.dr7ai.com';
    const fmtEur = (n: number) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const c of due as any[]) {
        // 5) importo da restituire = incassato - trattenuto. Se <= 0 -> NON_DOVUTA.
        const incassato = Number(c.importo || 0);
        const trattenuto = Number(c.importo_trattenuto || 0);
        const daRestituire = Math.round((incassato - trattenuto) * 100) / 100;
        if (daRestituire <= 0) {
            await supabase.from('cauzioni').update({ stato_restituzione: 'NON_DOVUTA' }).eq('id', c.id);
            skipped++;
            continue;
        }

        // 4) Scelta variante A/B/C.
        const ibanCheck = validateIban(c.iban || '');
        let variant: 'A' | 'B' | 'C';
        if (c.metodo === 'preautorizzazione') variant = 'C';
        else if (!ibanCheck.valid) variant = 'B';
        else variant = 'A';
        const tpl = tplByVariant[variant];
        if (!tpl) { skipped++; continue; } // variante spenta: non inviare

        // 7) Anti-duplicato: claim-first sul log (UNIQUE su chiave_antidup).
        const chiave = `SCADENZA_CAUZIONE:${c.id}:${todayRome}`;
        const dest = recipients.map((r: { nome: string }) => r.nome).join(', ');
        const { error: logErr } = await supabase.from('cauzioni_scadenza_log').insert({
            cauzione_id: c.id, message_code: 'SCADENZA_CAUZIONE', variante: variant,
            destinatari: dest, canali: cfg.email.length > 0 ? 'whatsapp,email' : 'whatsapp',
            chiave_antidup: chiave, esito: { status: 'pending' },
        });
        if (logErr) { skipped++; continue; } // gia' inviato oggi (conflict) o errore: non doppiare

        // 8) Corpo: sostituzione variabili, soppressione righe con valore vuoto
        //    (banca / trattenute) come da spec ("mai € 0,00").
        const nome = nameMap[c.cliente_id] || 'Cliente';
        const vars: Record<string, string> = {
            cliente: nome,
            numero_contratto: c.contratto_numero || c.numero_contratto || '—',
            veicolo: c.veicolo_nome || c.veicolo || '—',
            targa: c.veicolo_targa || c.targa || '—',
            data_riconsegna: c.data_restituzione_veicolo ? new Date(c.data_restituzione_veicolo + 'T00:00:00').toLocaleDateString('it-IT') : '—',
            data_scadenza: new Date(String(c.scadenza_cauzione) + 'T00:00:00').toLocaleDateString('it-IT'),
            intestatario_rimborso: c.intestatario_conto || nome,
            importo_da_restituire: fmtEur(daRestituire),
            iban_rimborso: c.iban ? ibanCheck.normalized : '',
            banca: c.banca || '',
            importo_cauzione: fmtEur(incassato),
            importo_trattenuto: trattenuto > 0 ? fmtEur(trattenuto) : '',
        };
        let body = String(tpl.message_body);
        for (const [k, v] of Object.entries(vars)) body = body.split(`{{${k}}}`).join(v);
        // Rimuovi le righe rimaste con valore vuoto (Banca:, Trattenute applicate:, IBAN:).
        body = body.split('\n').filter(line => {
            const m = line.match(/:\s*(?:€\s*)?$/); // riga che finisce con ":" o ": €" senza valore
            return !m;
        }).join('\n');

        // 9) Invio (WhatsApp allo staff). Email/in-app: FASE 7 (alarm) / follow-up.
        let ok = false;
        for (const r of recipients) {
            try {
                const res = await fetch(`${baseUrl}/.netlify/functions/send-whatsapp-notification`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ customPhone: r.phone, customMessage: body, type: 'Scadenza Cauzione' }),
                });
                if (res.ok) ok = true; else errors++;
            } catch { errors++; }
        }
        // Email: stesso testo, agli indirizzi scelti in Centralina Pro.
        for (const to of cfg.email) {
            try {
                await avvisoTransporter.sendMail({
                    from: '"DR7 Cauzioni" <info@dr7.app>',
                    to,
                    subject: `Scadenza cauzione — ${nome}`,
                    text: body,
                    html: `<pre style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px;white-space:pre-wrap">${
                        body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    }</pre>`,
                });
                ok = true;
            } catch { errors++; }
        }
        if (ok) {
            sent++;
            await supabase.from('cauzioni').update({ scadenza_avviso_sent_on: todayRome }).eq('id', c.id);
            await supabase.from('cauzioni_scadenza_log').update({ esito: { status: 'sent' } }).eq('chiave_antidup', chiave);
        } else {
            // invio fallito: libera il claim cosi' riprova al giro dopo.
            await supabase.from('cauzioni_scadenza_log').delete().eq('chiave_antidup', chiave);
        }
    }

    return { sent, skipped, errors };
}

export async function processCauzioniRimborsoStaffReminder(now: number, opts?: { force?: boolean }): Promise<{ sent: number; skipped: number; errors: number; reason?: string }> {
    let sent = 0, skipped = 0, errors = 0;
    const force = opts?.force === true;

    // 1) Template. In modalita' force basta is_enabled + body (ignora cron_approved:
    //    il tasto "Invia ora" serve proprio a testare prima di attivare il cron).
    // SOLO il template canonico creato in Messaggi di Sistema Pro
    // (message_key = 'pro_cauzioni_rimborso_staff'). Niente match per label:
    // cosi' non si prende MAI una variante che non hai creato tu.
    const { data: tplRows } = await supabase
        .from('system_messages')
        .select('message_body, is_enabled, cron_approved, send_hour, message_key, label')
        .eq('message_key', 'pro_cauzioni_rimborso_staff')
        .order('updated_at', { ascending: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tpl = (tplRows || []).find((r: any) => r.is_enabled !== false && !!r.message_body && (force || r.cron_approved === true));
    if (!tpl) return { sent, skipped, errors, reason: force ? 'Template "Promemoria Rimborso Cauzioni (Staff)" non trovato o disabilitato in Messaggi di Sistema Pro' : 'Template non approvato per il cron (attiva Cron ON)' };

    // 2) Gate orario (saltato in force).
    const todayRome = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }); // YYYY-MM-DD
    if (!force) {
        if (isRomeQuietHours(now)) return { sent, skipped, errors };
        const romeHour = getRomeHour(now);
        const sendHour = tpl.send_hour == null ? 9 : Number(tpl.send_hour);
        if (romeHour < sendHour || romeHour >= QUIET_START_HOUR) return { sent, skipped, errors };
    }

    // 3) Cauzioni da restituire OGGI o GIA' SCADUTE (QUALSIASI metodo: bonifico,
    //    carta, contanti), non ancora restituite/incassate, non gia' incluse in
    //    un promemoria di oggi. NB: <= oggi cosi' copre anche le scadute nei
    //    giorni precedenti — allineato al pannello "Da Restituire" (days<=0).
    //    Prima era filtrato a metodo='bonifico': le cauzioni su CARTA (la maggior
    //    parte della flotta) non venivano mai promemoria-te.
    // NB: NON filtriamo su data_incasso. Nei dati reali TUTTE le cauzioni attive
    // (carta e bonifico) hanno data_incasso valorizzato (= quando il deposito e'
    // stato registrato), non significa "trattenuta". Il vero criterio "da
    // restituire" e' lo STATO non terminale — lo stesso del KPI "Scadute".
    const { data: cauz } = await supabase
        .from('cauzioni')
        .select('id, cliente_id, importo, iban, intestatario_conto, metodo, stato, data_incasso, scadenza_cauzione, rimborso_reminder_sent_on')
        .lte('scadenza_cauzione', todayRome)
        .not('stato', 'in', '(Restituita,Sbloccata,Bloccata,Danno,Incassata)');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const due = (cauz || []).filter((c: any) => force || c.rimborso_reminder_sent_on !== todayRome);
    if (due.length === 0) return { sent, skipped, errors, reason: `Nessuna cauzione da restituire (scadenza <= ${todayRome})` };

    // 4) Nomi cliente + IBAN/intestatario del CLIENTE (fallback: spesso l'IBAN e'
    //    salvato sulla scheda cliente, non sulla singola cauzione).
    const clienteIds = [...new Set(due.map((c: { cliente_id: string }) => c.cliente_id).filter(Boolean))];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nameMap: Record<string, string> = {};
    const custIbanMap: Record<string, string> = {};
    const custIntestMap: Record<string, string> = {};
    if (clienteIds.length > 0) {
        const { data: custs } = await supabase
            .from('customers_extended')
            .select('id, nome, cognome, denominazione, ragione_sociale, tipo_cliente, iban, iban_intestatario')
            .in('id', clienteIds as string[]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (custs || []).forEach((c: any) => {
            const azienda = c.tipo_cliente === 'azienda' ? (c.ragione_sociale || c.denominazione) : null;
            nameMap[c.id] = (azienda || `${c.nome || ''} ${c.cognome || ''}`.trim() || 'Cliente');
            if (c.iban && String(c.iban).trim()) custIbanMap[c.id] = String(c.iban).trim();
            if (c.iban_intestatario && String(c.iban_intestatario).trim()) custIntestMap[c.id] = String(c.iban_intestatario).trim();
        });
    }

    // 5) Lista testo + totale.
    const totale = due.reduce((s: number, c: { importo: number }) => s + Number(c.importo || 0), 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lista = due.map((c: any) => {
        const nome = nameMap[c.cliente_id] || 'Cliente';
        const imp = Number(c.importo).toFixed(2);
        // FORMATO UNICO per TUTTE le cauzioni (carta e bonifico): la cauzione si
        // restituisce SEMPRE via bonifico all'IBAN del cliente, a prescindere da
        // come e' stata presa. Ogni riga ha intestatario + IBAN.
        // PRIORITA' alla scheda cliente (customers_extended.iban / iban_intestatario):
        // e' il campo "Dati per il rimborso cauzione" che l'admin gestisce ed e' la
        // fonte di verita' (la copia sulla cauzione puo' essere vecchia = spesso il
        // NOME del cliente di default, che confonde chi fa i bonifici — bug 31/07).
        const iban = custIbanMap[c.cliente_id] || (c.iban && String(c.iban).trim()) || 'IBAN MANCANTE';
        const intest = custIntestMap[c.cliente_id] || (c.intestatario_conto && String(c.intestatario_conto).trim()) || 'INTESTATARIO MANCANTE';
        return `• ${nome} — € ${imp}\n  Intestatario: ${intest}\n  IBAN: ${iban}`;
    }).join('\n\n');

    const body = String(tpl.message_body)
        .split('{data}').join(new Date(todayRome + 'T00:00:00').toLocaleDateString('it-IT'))
        .split('{count}').join(String(due.length))
        .split('{totale}').join(totale.toFixed(2))
        .split('{lista}').join(lista);
    // Se il template non contiene {lista}, accoda comunque la lista (fail-safe).
    const finalBody = String(tpl.message_body).includes('{lista}') ? body : `${body}\n\n${lista}`;

    // 6) Destinatari: numeri configurati in Centralina (notifications.
    //    cauzioni_staff_phones) + fallback ad admins.contatto_interno di
    //    valerio@/ilenia@. Cosi' non dipende dal fatto che gli admin abbiano
    //    il contatto interno valorizzato.
    const recipients = await resolveCauzioniStaffRecipients();

    if (recipients.length === 0) {
        console.warn('[cauzioni-rimborso-staff] nessun destinatario con telefono valido (admins.contatto_interno)');
        return { sent, skipped: skipped + due.length, errors, reason: 'Nessun destinatario: valerio@/ilenia@dr7.app senza "contatto interno" (numero WhatsApp)' };
    }

    const baseUrl = process.env.URL || 'https://platform.dr7ai.com';
    for (const r of recipients) {
        try {
            const res = await fetch(`${baseUrl}/.netlify/functions/send-whatsapp-notification`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // skipHeader: invia ESATTAMENTE il testo del template Centralina Pro
                // (pro_cauzioni_rimborso_staff) senza aggiungere header/footer globali.
                body: JSON.stringify({ customPhone: r.phone, customMessage: finalBody, skipHeader: true, type: 'Promemoria Rimborso Cauzioni' }),
            });
            if (res.ok) sent++; else errors++;
        } catch { errors++; }
    }

    // 7) Marca le cauzioni incluse (anti doppio invio) — solo se abbiamo inviato.
    if (sent > 0) {
        await supabase
            .from('cauzioni')
            .update({ rimborso_reminder_sent_on: todayRome })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .in('id', due.map((c: any) => c.id));
    }

    return { sent, skipped, errors };
}

const cronHandler = async () => {
    const now = Date.now();
    console.log(`[scheduled-msgs] cron fired at ${new Date(now).toISOString()}`);

    // Quiet hours: non inviare NULLA tra le 22:00 e le 07:00 (Rome). I messaggi
    // il cui target cade di notte partiranno al primo giro dopo le 07:00.
    //
    // ECCEZIONE (2026-08-05): le programmazioni ricorrenti (`on_schedule`) hanno
    // un orario scelto esplicitamente dall'admin. Se sceglie le 23:00 deve
    // partire alle 23:00. Durante le quiet hours il cron processa quindi SOLO
    // quei template — tutto il resto (booking-anchored) resta silenziato come
    // prima, quindi la protezione anti mass-send notturno non cambia.
    const quietHours = isRomeQuietHours(now);
    if (quietHours) {
        console.log(`[scheduled-msgs] quiet hours (Rome ${getRomeHour(now)}:00) — solo programmazioni ricorrenti`);
    }

    // 1. Carica tutti i template automatici attivi
    const BASE_COLUMNS = 'id, message_key, label, is_automatic, is_enabled, cron_approved, trigger_event, trigger_offset_hours, send_hour, target_category, target_status, target_service_type, target_with_deposit, target_plate, target_payment_method, target_amount_min, target_amount_max, target_days_of_week, quiet_hours_start, quiet_hours_end, target_membership_tier, target_min_prev_bookings, target_max_prev_bookings, target_rental_duration_min, target_rental_duration_max, target_customer_tags, target_residency, target_age_min, target_age_max, target_pickup_hour_min, target_pickup_hour_max, target_source_channel, target_province, target_min_lifetime_value, target_has_unpaid_invoices, target_used_promo_before, target_extension_count_min, target_extension_count_max';
    // Colonne della migration 20260805 (ricorrenze + destinatari). Se la
    // migration non e' ancora stata eseguita, PostgREST fallisce la select:
    // in quel caso si riparte con le sole colonne storiche, così il cron
    // continua a lavorare esattamente come prima invece di morire.
    // 2026-08-23: `handled_events` viaggia qui e non in BASE_COLUMNS di
    // proposito — se la colonna mancasse, la select cade nel fallback storico
    // invece di far morire il cron (lezione del lockout del 2026-08-14).
    const RECURRING_COLUMNS = 'send_minute, recurrence_start_date, recurrence_end_date, recipient_mode, recipient_phones, recipient_admin_roles, handled_events';

    let templates: SystemMessage[] | null = null;
    let tplErr: { message: string } | null = null;

    const withRecurring = await supabase
        .from('system_messages')
        .select(`${BASE_COLUMNS}, ${RECURRING_COLUMNS}`)
        .eq('is_automatic', true)
        .eq('is_enabled', true);
    templates = (withRecurring.data as unknown as SystemMessage[] | null);
    tplErr = withRecurring.error;

    if (tplErr) {
        console.warn('[scheduled-msgs] select con colonne ricorrenza fallita, fallback alle colonne storiche:', tplErr.message);
        const fallback = await supabase
            .from('system_messages')
            .select(BASE_COLUMNS)
            .eq('is_automatic', true)
            .eq('is_enabled', true);
        templates = (fallback.data as unknown as SystemMessage[] | null);
        tplErr = fallback.error;
    }

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
    // 2026-07-12 GATE AUTONOMIA ADMIN. L'invio automatico e' governato dal flag
    // DB `cron_approved` (colonna system_messages): un template parte SOLO se
    // is_automatic + is_enabled (gia' filtrati nella query) + cron_approved.
    // Cosi' parte ESCLUSIVAMENTE cio' che l'admin approva dalla UI — niente
    // allowlist hardcoded ne' env SCHEDULED_MSGS_ALLOWLIST (che prima potevano
    // bloccare heli/lavaggio anche con i template attivi, o all'opposto far
    // partire template mis-flaggati). Default cron_approved = false → i template
    // mis-flaggati restano SPENTI (stessa sicurezza anti mass-send del
    // 2026-05-13). Le guardie sotto (OLD_TO_PRO legacy + event-driven) restano
    // come difesa in profondita'.

    for (const tpl of templates as SystemMessage[]) {
        // Gate: parte SOLO cio' che l'admin ha approvato per il cron.
        if (!(tpl as { cron_approved?: boolean }).cron_approved) continue;

        // ── Programmazione ricorrente a calendario ────────────────────────
        // Va valutata PRIMA delle guardie legacy/event-driven: un template
        // ricorrente non e' legato a nessuna prenotazione, quindi non deve
        // essere scartato dai controlli pensati per i template booking-anchored
        // (che matchano per label/message_key).
        if (isRecurringTemplate(tpl)) {
            const r = await processRecurringSchedule(tpl, now);
            totalSent += r.sent; totalSkipped += r.skipped; totalErrors += r.errors;
            continue;
        }

        // Fuori dalle ricorrenze, durante le quiet hours non parte nulla.
        if (quietHours) continue;

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
            // 2026-07-11 FIX: i lavaggi/meccanica (car_wash) NON hanno pickup_date
            // (usano appointment_date) → il filtro solo su pickup_date li
            // escludeva e il promemoria "giorno prima lavaggio" non partiva mai.
            // Ora matchiamo pickup_date OPPURE appointment_date nella finestra.
            // getEventTimeMs sceglie poi il campo giusto per-riga.
            q = q.or(`and(pickup_date.gte.${lo},pickup_date.lte.${hi}),and(appointment_date.gte.${lo},appointment_date.lte.${hi})`);
            // 2026-05-30: il gate "pagato O confermato" per il promemoria ritiro
            // è applicato per-booking nel loop sotto (serve leggere anche
            // manually_confirmed da booking_details, non filtrabile bene in SQL).
        } else if (tpl.trigger_event === 'before_dropoff' || tpl.trigger_event === 'after_dropoff') {
            const sign = tpl.trigger_event === 'before_dropoff' ? +1 : -1;
            const lo = new Date(now + sign * offsetH * 3600 * 1000 - wideBackMs).toISOString();
            const hi = new Date(now + sign * offsetH * 3600 * 1000 + wideFwdMs).toISOString();
            // Stesso fix: includi appointment_date (car_wash/meccanica non hanno dropoff_date).
            q = q.or(`and(dropoff_date.gte.${lo},dropoff_date.lte.${hi}),and(appointment_date.gte.${lo},appointment_date.lte.${hi})`);
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
                const baseUrl = process.env.URL || 'https://platform.dr7ai.com';
                const res = await fetch(`${baseUrl}/.netlify/functions/send-whatsapp-notification`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // 2026-06-04 BUG FIX: passare customPhone ESPLICITO.
                    // send-whatsapp-notification NON ricava più il telefono da
                    // booking.customer_phone (hardening post-incidente): senza
                    // customPhone tornava sempre skipped → il "promemoria ritiro
                    // 24h" non partiva (81 skip dal 2026-05-30).
                    body: JSON.stringify({
                        booking,
                        messageKey: tpl.message_key,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        customPhone: booking.customer_phone || (booking.booking_details as any)?.customer?.phone || null,
                    }),
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

    // I blocchi dedicati qui sotto (autista, cauzioni) restano soggetti alle
    // quiet hours come prima: durante la fascia silenziosa il cron arriva fin
    // qui solo per le programmazioni ricorrenti, quindi si esce.
    if (quietHours) {
        console.log(`[scheduled-msgs] quiet hours — done (solo ricorrenti). sent=${totalSent} skipped=${totalSkipped} errors=${totalErrors}`);
        return {
            statusCode: 200,
            body: JSON.stringify({ ok: true, quietHours: true, sent: totalSent, skipped: totalSkipped, errors: totalErrors }),
        };
    }

    // Promemoria autista corsa straordinaria (destinatari = autisti, blocco dedicato).
    try {
        const rA = await processUscitaAutistaReminders(now);
        totalSent += rA.sent; totalSkipped += rA.skipped; totalErrors += rA.errors;
    } catch (e) {
        console.error('[scheduled-msgs] processUscitaAutistaReminders failed:', e);
    }

    // Avviso "Scadenza cauzione" per-cauzione (varianti A/B/C, 08:00).
    try {
        const rS = await processScadenzaCauzioneAvviso(now);
        totalSent += rS.sent; totalSkipped += rS.skipped; totalErrors += rS.errors;
    } catch (e) {
        console.error('[scheduled-msgs] processScadenzaCauzioneAvviso failed:', e);
    }

    // Promemoria staff (Valerio/Ilenia) rimborso cauzioni in scadenza oggi.
    try {
        const rC = await processCauzioniRimborsoStaffReminder(now);
        totalSent += rC.sent; totalSkipped += rC.skipped; totalErrors += rC.errors;
    } catch (e) {
        console.error('[scheduled-msgs] processCauzioniRimborsoStaffReminder failed:', e);
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
export const handler = schedule('*/8 * * * *', cronHandler);
