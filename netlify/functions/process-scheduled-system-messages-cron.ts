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
 * Cadenza cron: ogni 15 minuti. Finestra leggermente sovrapposta per non perdere sends
 * se un cron precedente fallisce.
 */
import { schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

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

const cronHandler = async () => {
    const now = Date.now();
    console.log(`[scheduled-msgs] cron fired at ${new Date(now).toISOString()}`);

    // 1. Carica tutti i template automatici attivi
    const { data: templates, error: tplErr } = await supabase
        .from('system_messages')
        .select('id, message_key, label, is_automatic, is_enabled, trigger_event, trigger_offset_hours, send_hour, target_category, target_status')
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

    for (const tpl of templates as SystemMessage[]) {
        // Skip eventi non gestiti (preventivo gestito altrove)
        if (tpl.trigger_event === 'on_preventivo') continue;

        // Filtri
        const statuses = (tpl.target_status || 'confirmed,active')
            .split(',').map(s => s.trim()).filter(Boolean);

        // 2. Carica candidati (limita per evitare scan tabella intera)
        let q = supabase.from('bookings').select('*');
        if (statuses.length > 0) q = q.in('status', statuses);
        // Ottimizzazione: per before_pickup/after_pickup ecc. restringiamo per data
        // intorno alla finestra utile = (now ± window) ∓ offset.
        // Tradotto: pickup_date ∈ [now - offset - lookback, now - offset + lookforward]
        // Non applichiamo questo filtro per on_booking/on_payment/on_signature/on_extension
        // dove l'event_time non vive in un singolo timestamp colonna.
        const offsetH = tpl.trigger_offset_hours || 0;
        if (tpl.trigger_event === 'before_pickup' || tpl.trigger_event === 'after_pickup') {
            const sign = tpl.trigger_event === 'before_pickup' ? +1 : -1;
            const lo = new Date(now + sign * offsetH * 3600 * 1000 - LOOKBACK_MS).toISOString();
            const hi = new Date(now + sign * offsetH * 3600 * 1000 + LOOKFORWARD_MS).toISOString();
            q = q.gte('pickup_date', lo).lte('pickup_date', hi);
        } else if (tpl.trigger_event === 'before_dropoff' || tpl.trigger_event === 'after_dropoff') {
            const sign = tpl.trigger_event === 'before_dropoff' ? +1 : -1;
            const lo = new Date(now + sign * offsetH * 3600 * 1000 - LOOKBACK_MS).toISOString();
            const hi = new Date(now + sign * offsetH * 3600 * 1000 + LOOKFORWARD_MS).toISOString();
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
        }
        // on_signature / on_extension: niente filtro perche' i timestamp sono dentro JSONB

        const { data: candidates, error: bkErr } = await q.limit(500);
        if (bkErr) {
            console.error(`[scheduled-msgs] bookings fetch failed for ${tpl.label}:`, bkErr.message);
            continue;
        }
        if (!candidates?.length) continue;

        for (const booking of candidates as Booking[]) {
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

            // Dedup: gia' inviato?
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

            // Invia
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

                await supabase.from('system_message_send_log').insert({
                    system_message_id: tpl.id,
                    booking_id: booking.id,
                    customer_phone: booking.customer_phone,
                    status: ok ? (resp?.skipped ? 'skipped' : 'sent') : 'error',
                    error: ok ? null : `HTTP ${res.status}: ${JSON.stringify(resp)?.slice(0, 200)}`,
                });

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
                try {
                    await supabase.from('system_message_send_log').insert({
                        system_message_id: tpl.id,
                        booking_id: booking.id,
                        customer_phone: booking.customer_phone,
                        status: 'error',
                        error: msg.slice(0, 500),
                    });
                } catch { /* dedup race ok */ }
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

export const handler = schedule('*/15 * * * *', cronHandler);
