import { Handler, schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;

const cancelHandler: Handler = async () => {
    try {
        console.log('[cancel-unpaid-nexi] Running...');

        // Find bookings that:
        // 1. Have payment_method = 'Nexi Pay by Link'
        // 2. Still pending (not paid)
        // 3. Created more than 1 hour ago
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        const { data: unpaidBookings, error } = await supabase
            .from('bookings')
            .select('id, customer_name, customer_phone, customer_email, vehicle_name, created_at, booking_details')
            .eq('payment_method', 'Nexi Pay by Link')
            .eq('payment_status', 'pending')
            .in('status', ['pending'])
            .lt('created_at', oneHourAgo);

        if (error) {
            console.error('[cancel-unpaid-nexi] Query error:', error);
            return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
        }

        if (!unpaidBookings || unpaidBookings.length === 0) {
            console.log('[cancel-unpaid-nexi] No unpaid bookings to cancel');
            return { statusCode: 200, body: JSON.stringify({ cancelled: 0 }) };
        }

        console.log(`[cancel-unpaid-nexi] Found ${unpaidBookings.length} unpaid bookings to cancel`);

        let cancelled = 0;
        for (const booking of unpaidBookings) {
            // Cancel the booking
            await supabase.from('bookings').update({
                status: 'cancelled',
                payment_status: 'unpaid',
                booking_details: {
                    ...booking.booking_details,
                    cancelled_reason: 'Pagamento Nexi non ricevuto entro 1 ora',
                    cancelled_at: new Date().toISOString()
                }
            }).eq('id', booking.id);

            cancelled++;
            console.log(`[cancel-unpaid-nexi] Cancelled booking ${booking.id} (${booking.customer_name})`);

            // Notify customer via WhatsApp
            const custPhone = booking.customer_phone || booking.booking_details?.customer?.phone;
            if (custPhone && GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                let cleanPhone = custPhone.replace(/[\s\-\+\(\)]/g, '');
                if (cleanPhone.startsWith('00')) cleanPhone = cleanPhone.substring(2);
                if (cleanPhone.length === 10) cleanPhone = '39' + cleanPhone;

                await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chatId: `${cleanPhone}@c.us`,
                        message: `⚠️ *Prenotazione annullata*\n\nGentile ${booking.customer_name || 'Cliente'},\n\nLa prenotazione #${booking.id.substring(0, 8).toUpperCase()} è stata annullata perché il pagamento non è stato ricevuto entro 1 ora.\n\nSe desidera prenotare nuovamente, ci contatti.\n\nDR7 Empire`
                    })
                });
            }

            // Notify admin
            const NOTIFICATION_PHONE = process.env.NOTIFICATION_PHONE || '393457905205';
            if (GREEN_API_INSTANCE_ID && GREEN_API_TOKEN) {
                await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendMessage/${GREEN_API_TOKEN}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chatId: `${NOTIFICATION_PHONE}@c.us`,
                        message: `❌ *PRENOTAZIONE AUTO-ANNULLATA*\n\n*Cliente:* ${booking.customer_name}\n*Veicolo:* ${booking.vehicle_name || 'N/A'}\n*ID:* #${booking.id.substring(0, 8).toUpperCase()}\n\nMotivo: Pagamento Nexi non ricevuto entro 1 ora.`
                    })
                });
            }
        }

        console.log(`[cancel-unpaid-nexi] Done. Cancelled ${cancelled} bookings.`);
        return { statusCode: 200, body: JSON.stringify({ cancelled }) };

    } catch (err: any) {
        console.error('[cancel-unpaid-nexi] Error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};

// Run every 15 minutes
export const handler = schedule('*/15 * * * *', cancelHandler);
