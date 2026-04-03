import { Handler, schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const NEXI_API_KEY = process.env.NEXI_API_KEY!;
const NEXI_BASE_URL = 'https://xpay.nexigroup.com/api/phoenix-0.0/psp/api/v1';

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

/**
 * Deactivate a Nexi pay-by-link so the customer can no longer pay.
 * Uses DELETE /v2/orders/paybylink/{linkId} or cancels via orderId lookup.
 */
async function deactivateNexiLink(orderId: string): Promise<boolean> {
    if (!NEXI_API_KEY || !orderId) return false;

    try {
        // First, look up the order to find the linkId
        const orderRes = await fetch(`${NEXI_BASE_URL}/orders/${orderId}`, {
            headers: { 'X-Api-Key': NEXI_API_KEY, 'Correlation-Id': crypto.randomUUID() }
        });

        if (!orderRes.ok) {
            console.log(`[expire-unpaid-nexi] Order lookup failed for ${orderId}: ${orderRes.status}`);
            return false;
        }

        const orderData = await orderRes.json();
        const links = orderData.paymentLink || [];
        const activeLink = links.find((l: any) => l.status === 'ACTIVE');

        if (!activeLink?.linkId) {
            console.log(`[expire-unpaid-nexi] No active link found for ${orderId}`);
            return false;
        }

        // Cancel the link via Nexi API
        const cancelUrl = NEXI_BASE_URL.replace('/v1', '/v2') + `/orders/paybylink/${activeLink.linkId}`;
        const cancelRes = await fetch(cancelUrl, {
            method: 'DELETE',
            headers: {
                'X-Api-Key': NEXI_API_KEY,
                'Correlation-Id': crypto.randomUUID(),
            }
        });

        if (cancelRes.ok || cancelRes.status === 204) {
            console.log(`[expire-unpaid-nexi] Nexi link ${activeLink.linkId} deactivated for order ${orderId}`);
            return true;
        } else {
            const errText = await cancelRes.text();
            console.warn(`[expire-unpaid-nexi] Failed to deactivate link ${activeLink.linkId}: ${cancelRes.status} ${errText.substring(0, 200)}`);
            return false;
        }
    } catch (err: any) {
        console.warn(`[expire-unpaid-nexi] Error deactivating link for ${orderId}: ${err.message}`);
        return false;
    }
}

/**
 * Expire Unpaid Nexi Bookings — Scheduled Job (every 5 minutes)
 *
 * LOGIC (single source of truth — see bookingPaymentService.ts):
 *   1. Find bookings where:
 *      - status = 'pending_payment'
 *      - payment_status = 'unpaid'
 *      - payment_link_expires_at < NOW()  (explicit expiry field)
 *      OR (legacy fallback):
 *      - payment_method = 'Nexi Pay by Link'
 *      - payment_status IN ('pending', 'unpaid')
 *      - status IN ('pending', 'confirmed', 'pending_payment')
 *      - created_at < 1 hour ago
 *      - paid_at IS NULL
 *   2. For each: deactivate Nexi link, set status='expired', payment_status='expired', expired_at=now()
 *   3. Notify customer + admin via WhatsApp
 *
 * IDEMPOTENCY: status='expired' bookings are never re-processed (query excludes them).
 *
 * RACE CONDITION SAFETY:
 *   - Uses conditional update: only updates if status is still pending_payment/pending/confirmed
 *   - If webhook confirmed payment between query and update, the update will match 0 rows
 *     (because status is already 'confirmed' and payment_status is 'paid')
 */
const cancelHandler: Handler = async () => {
    try {
        console.log('[expire-unpaid-nexi] Running...');
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

        // ── PRIMARY QUERY: Use payment_link_expires_at (new field) ──
        const { data: expiredByField, error: err1 } = await supabase
            .from('bookings')
            .select('id, customer_name, customer_phone, customer_email, vehicle_name, service_type, created_at, booking_details, status, payment_status')
            .eq('status', 'pending_payment')
            .eq('payment_status', 'unpaid')
            .lt('payment_link_expires_at', now.toISOString())
            .is('paid_at', null);

        // ── LEGACY FALLBACK: For bookings created before migration ──
        const { data: expiredLegacy, error: err2 } = await supabase
            .from('bookings')
            .select('id, customer_name, customer_phone, customer_email, vehicle_name, service_type, created_at, booking_details, status, payment_status')
            .eq('payment_method', 'Nexi Pay by Link')
            .in('payment_status', ['pending', 'unpaid'])
            .in('status', ['pending', 'confirmed', 'pending_payment'])
            .lt('created_at', oneHourAgo)
            .is('paid_at', null);

        if (err1) console.error('[expire-unpaid-nexi] Primary query error:', err1);
        if (err2) console.error('[expire-unpaid-nexi] Legacy query error:', err2);

        // Merge and deduplicate
        const seen = new Set<string>();
        const allExpired: typeof expiredByField = [];
        for (const list of [expiredByField, expiredLegacy]) {
            if (!list) continue;
            for (const b of list) {
                if (!seen.has(b.id)) {
                    seen.add(b.id);
                    allExpired.push(b);
                }
            }
        }

        if (allExpired.length === 0) {
            console.log('[expire-unpaid-nexi] No expired bookings found');
            return { statusCode: 200, body: JSON.stringify({ expired: 0 }) };
        }

        console.log(`[expire-unpaid-nexi] Found ${allExpired.length} expired bookings to process`);

        let expiredCount = 0;
        for (const booking of allExpired) {
            const bookingRef = booking.id.substring(0, 8).toUpperCase();
            const bookingType = booking.service_type === 'car_wash' ? 'lavaggio' : 'noleggio';

            console.log(`[expire-unpaid-nexi] Processing ${bookingType} #${bookingRef} (status=${booking.status}, payment=${booking.payment_status})`);

            // 1. Deactivate the Nexi payment link so customer can't pay anymore
            const nexiOrderId = booking.booking_details?.nexi_order_id;
            let linkDeactivated = false;
            if (nexiOrderId) {
                linkDeactivated = await deactivateNexiLink(nexiOrderId);
            }

            // 2. CONDITIONAL UPDATE: Only expire if still in a pending state
            // This prevents race conditions with the payment webhook
            const { data: updated, error: updateErr } = await supabase
                .from('bookings')
                .update({
                    status: 'expired',
                    payment_status: 'expired',
                    expired_at: now.toISOString(),
                    booking_details: {
                        ...(booking.booking_details || {}),
                        expired_reason: 'Pagamento Nexi non ricevuto entro 1 ora',
                        expired_at: now.toISOString(),
                        nexi_link_deactivated: linkDeactivated,
                    }
                })
                .eq('id', booking.id)
                .in('status', ['pending_payment', 'pending', 'confirmed'])  // Guard: don't overwrite paid bookings
                .neq('payment_status', 'paid')  // Guard: never expire a paid booking
                .is('paid_at', null)  // Guard: never expire if payment already recorded
                .select('id');

            if (updateErr) {
                console.error(`[expire-unpaid-nexi] Update error for ${bookingRef}:`, updateErr);
                continue;
            }

            if (!updated || updated.length === 0) {
                console.log(`[expire-unpaid-nexi] Booking ${bookingRef} was already confirmed/paid — skipping (race condition handled)`);
                continue;
            }

            expiredCount++;
            console.log(`[expire-unpaid-nexi] Expired ${bookingType} #${bookingRef} (${booking.customer_name}), link deactivated: ${linkDeactivated}`);

            // Also mark the nexi_transaction as expired
            if (nexiOrderId) {
                await supabase
                    .from('nexi_transactions')
                    .update({ status: 'expired', updated_at: now.toISOString() })
                    .eq('order_id', nexiOrderId)
                    .eq('status', 'pending');  // Only if still pending
            }

            // Notify customer via WhatsApp
            const custPhone = booking.customer_phone || booking.booking_details?.customer?.phone;
            if (custPhone) {
                const custName = booking.customer_name || 'Cliente';
                try {
                    await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/send-whatsapp-notification`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customPhone: custPhone,
                            customMessage: `⚠️ *Prenotazione scaduta*\n\nGentile ${custName},\n\nLa prenotazione #${bookingRef} è stata annullata perché il pagamento non è stato ricevuto entro 1 ora.\n\nIl link di pagamento è stato disattivato.\n\nSe desidera prenotare nuovamente, ci contatti.\n\nDR7`
                        })
                    });
                } catch (whatsappErr) {
                    console.error(`[expire-unpaid-nexi] WhatsApp notification failed for ${bookingRef}:`, whatsappErr);
                }
            }

            // 4. Notify admin
            const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || '393457905205';
            if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                try {
                    await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chatId: `${NOTIFICATION_PHONE}@c.us`,
                            message: `⏰ *PRENOTAZIONE SCADUTA*\n\n*Tipo:* ${bookingType}\n*Cliente:* ${booking.customer_name}\n*Veicolo:* ${booking.vehicle_name || 'N/A'}\n*ID:* #${bookingRef}\n\nMotivo: Pagamento non ricevuto entro 1 ora.\nLink Nexi: ${linkDeactivated ? 'disattivato' : 'non trovato/già scaduto'}`
                        })
                    });
                } catch (adminNotifyErr) {
                    console.error(`[expire-unpaid-nexi] Admin notification failed for ${bookingRef}:`, adminNotifyErr);
                }
            }
        }

        console.log(`[expire-unpaid-nexi] Done. Expired ${expiredCount} bookings.`);
        return { statusCode: 200, body: JSON.stringify({ expired: expiredCount, checked: allExpired.length }) };

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[expire-unpaid-nexi] Error:', message);
        return { statusCode: 500, body: JSON.stringify({ error: message }) };
    }
};

// Run every 5 minutes for faster expiration detection
export const handler = schedule('*/5 * * * *', cancelHandler);
