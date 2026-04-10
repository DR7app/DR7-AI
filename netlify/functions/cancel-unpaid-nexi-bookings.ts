import { Handler, schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { renderTemplate } from './utils/messageTemplates';

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
            console.log(`[cancel-unpaid-nexi] Order lookup failed for ${orderId}: ${orderRes.status}`);
            return false;
        }

        const orderData = await orderRes.json();
        const links = orderData.paymentLink || [];
        const activeLink = links.find((l: any) => l.status === 'ACTIVE');

        if (!activeLink?.linkId) {
            console.log(`[cancel-unpaid-nexi] No active link found for ${orderId}`);
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
            console.log(`[cancel-unpaid-nexi] Nexi link ${activeLink.linkId} deactivated for order ${orderId}`);
            return true;
        } else {
            const errText = await cancelRes.text();
            console.warn(`[cancel-unpaid-nexi] Failed to deactivate link ${activeLink.linkId}: ${cancelRes.status} ${errText.substring(0, 200)}`);
            return false;
        }
    } catch (err: any) {
        console.warn(`[cancel-unpaid-nexi] Error deactivating link for ${orderId}: ${err.message}`);
        return false;
    }
}

const cancelHandler: Handler = async () => {
    try {
        console.log('[cancel-unpaid-nexi] Running...');

        // Find unpaid Nexi Pay by Link bookings older than 1 hour
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

        const { data: unpaidBookings, error } = await supabase
            .from('bookings')
            .select('id, customer_name, customer_phone, customer_email, vehicle_name, created_at, booking_details, payment_method')
            .eq('payment_method', 'Nexi Pay by Link')
            .in('payment_status', ['pending', 'unpaid'])
            .in('status', ['pending', 'confirmed'])
            .lt('created_at', oneHourAgo); // Pre-filter: only bookings older than 1h

        if (error) {
            console.error('[cancel-unpaid-nexi] Query error:', error);
            return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
        }

        // Filter using exact payment_link_expires_at when available
        const expiredBookings = (unpaidBookings || []).filter(booking => {
            const expiresAt = booking.booking_details?.payment_link_expires_at;
            if (expiresAt) {
                // Use exact expiration timestamp from when link was sent
                return now > new Date(expiresAt);
            }
            // Fallback: use created_at + 1 hour (for legacy bookings without expires_at)
            return now > new Date(new Date(booking.created_at).getTime() + 60 * 60 * 1000);
        });

        if (expiredBookings.length === 0) {
            console.log('[cancel-unpaid-nexi] No expired bookings to cancel');
            return { statusCode: 200, body: JSON.stringify({ cancelled: 0 }) };
        }

        console.log(`[cancel-unpaid-nexi] Found ${expiredBookings.length} expired bookings to cancel (checked ${unpaidBookings?.length || 0} candidates)`);

        let cancelled = 0;
        for (const booking of expiredBookings) {
            // 1. Deactivate the Nexi payment link so customer can't pay anymore
            const nexiOrderId = booking.booking_details?.nexi_order_id;
            let linkDeactivated = false;
            if (nexiOrderId) {
                linkDeactivated = await deactivateNexiLink(nexiOrderId);
            }

            // 2. Cancel the booking — ATOMIC: only if still payment_status=pending (prevents race with callback)
            const { data: cancelledRow } = await supabase.from('bookings').update({
                status: 'cancelled',
                payment_status: 'unpaid',
                booking_details: {
                    ...booking.booking_details,
                    cancelled_reason: 'Pagamento Nexi non ricevuto entro 1 ora',
                    cancelled_at: new Date().toISOString(),
                    nexi_link_deactivated: linkDeactivated,
                }
            }).eq('id', booking.id).in('payment_status', ['pending', 'unpaid']).select('id').maybeSingle();

            if (!cancelledRow) {
                console.log(`[cancel-unpaid-nexi] Booking ${booking.id} was already paid/updated — skipping`);
                continue;
            }

            cancelled++;
            console.log(`[cancel-unpaid-nexi] Cancelled booking ${booking.id} (${booking.customer_name}), link deactivated: ${linkDeactivated}`);

            // 3. Notify customer via WhatsApp
            const custPhone = booking.customer_phone || booking.booking_details?.customer?.phone;
            if (custPhone) {
                const custName = booking.customer_name || 'Cliente';
                const bookingRef = booking.id.substring(0, 8).toUpperCase();
                await fetch(`${process.env.URL || 'https://admin.dr7empire.com'}/.netlify/functions/send-whatsapp-notification`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        customPhone: custPhone,
                        customMessage: await renderTemplate('booking_cancelled_whatsapp', { custName, bookingRef }, `*Prenotazione annullata*\n\nGentile ${custName},\n\nLa prenotazione #${bookingRef} è stata annullata perché il pagamento non è stato ricevuto entro 1 ora.\n\nIl link di pagamento è stato disattivato.\n\nSe desidera prenotare nuovamente, ci contatti.\n\nDR7`),
                        skipHeader: true
                    })
                });
            }

            // 4. Notify admin
            const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || '393457905205';
            if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                const adminMessage = await renderTemplate('cancellation_admin_alert', { customer_name: booking.customer_name, vehicle_name: booking.vehicle_name || 'N/A', bookingRef: booking.id.substring(0, 8).toUpperCase() }, `*PRENOTAZIONE AUTO-ANNULLATA*\n\n*Cliente:* ${booking.customer_name}\n*Veicolo:* ${booking.vehicle_name || 'N/A'}\n*ID:* #${booking.id.substring(0, 8).toUpperCase()}\n\nMotivo: Pagamento Nexi non ricevuto entro 1 ora.\nLink Nexi: ${linkDeactivated ? 'disattivato' : 'non trovato/già scaduto'}`);
                await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chatId: `${NOTIFICATION_PHONE}@c.us`,
                        message: adminMessage
                    })
                });

                // Log to sent_messages_log
                try {
                    await supabase.from('sent_messages_log').insert({
                        customer_name: booking.customer_name || 'N/A',
                        customer_phone: NOTIFICATION_PHONE,
                        message_text: adminMessage,
                        template_label: 'Cancellation Notification (Admin)',
                        status: 'sent',
                    });
                } catch (logErr) {
                    console.error('Failed to log message:', logErr);
                }
            }
        }

        console.log(`[cancel-unpaid-nexi] Done. Cancelled ${cancelled} bookings.`);
        return { statusCode: 200, body: JSON.stringify({ cancelled }) };

    } catch (err: any) {
        console.error('[cancel-unpaid-nexi] Error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};

// Run every 5 minutes for tighter expiry enforcement
export const handler = schedule('*/5 * * * *', cancelHandler);
