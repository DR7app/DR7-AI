/**
 * Endpoint thin per far partire un evento di Messaggi di Sistema Pro
 * dal frontend (browser context). Carica l'entita' (cauzione, customer,
 * documento, ecc), costruisce il synthetic booking con i dati cliente
 * reali e chiama triggerSystemMessageEvent.
 *
 * Body atteso:
 *   { event: 'on_cauzione_created' | 'on_cauzione_collected' | ...,
 *     entityType: 'cauzione' | 'customer' | 'document',
 *     entityId: string }
 *
 * Dedupe via system_message_send_log (UNIQUE template+entity).
 */
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { triggerSystemMessageEvent } from './utils/triggerSystemMessageEvent'
import { getCorsOrigin } from './cors-headers'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' }

    try {
        const body = JSON.parse(event.body || '{}')
        const { event: eventName, entityType, entityId } = body
        if (!eventName || !entityType || !entityId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing event/entityType/entityId' }) }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let synthetic: Record<string, any> | null = null

        if (entityType === 'cauzione') {
            const { data: c } = await supabase
                .from('cauzioni')
                .select('*')
                .eq('id', entityId)
                .maybeSingle()
            if (!c) return { statusCode: 404, headers, body: JSON.stringify({ error: 'cauzione not found' }) }

            // Carica dati cliente
            const { data: cust } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, email, telefono, ragione_sociale')
                .eq('id', c.cliente_id)
                .maybeSingle()
            const custName = cust?.ragione_sociale || `${cust?.nome || ''} ${cust?.cognome || ''}`.trim() || cust?.email || 'Cliente'

            // Carica veicolo se disponibile
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let veicolo: any = null
            if (c.veicolo_id) {
                const { data: v } = await supabase.from('vehicles').select('display_name, plate, category').eq('id', c.veicolo_id).maybeSingle()
                veicolo = v
            }

            synthetic = {
                id: c.id,
                customer_name: custName,
                customer_email: cust?.email || null,
                customer_phone: cust?.telefono || null,
                vehicle_name: veicolo?.display_name || '',
                vehicle_plate: veicolo?.plate || '',
                vehicle_category: veicolo?.category || null,
                deposit_amount: Number(c.importo || 0),
                booking_details: { deposit: Number(c.importo || 0), depositOption: 'standard' },
                payment_method: c.metodo,
                status: c.stato,
                payment_status: c.data_incasso ? 'paid' : 'pending',
                price_total: Number(c.importo || 0) * 100,  // cents
            }
        } else if (entityType === 'customer') {
            const { data: cust } = await supabase
                .from('customers_extended')
                .select('id, nome, cognome, email, telefono, ragione_sociale')
                .eq('id', entityId)
                .maybeSingle()
            if (!cust) return { statusCode: 404, headers, body: JSON.stringify({ error: 'customer not found' }) }
            const custName = cust.ragione_sociale || `${cust.nome || ''} ${cust.cognome || ''}`.trim() || cust.email || 'Cliente'
            synthetic = {
                id: cust.id,
                customer_name: custName,
                customer_email: cust.email || null,
                customer_phone: cust.telefono || null,
                booking_details: {},
                status: 'active',
            }
        } else if (entityType === 'document') {
            const { data: doc } = await supabase
                .from('customer_documents')
                .select('id, customer_id, document_type, status')
                .eq('id', entityId)
                .maybeSingle()
            if (!doc) return { statusCode: 404, headers, body: JSON.stringify({ error: 'document not found' }) }
            const { data: cust } = await supabase
                .from('customers_extended')
                .select('nome, cognome, email, telefono, ragione_sociale')
                .eq('id', doc.customer_id)
                .maybeSingle()
            const custName = cust?.ragione_sociale || `${cust?.nome || ''} ${cust?.cognome || ''}`.trim() || cust?.email || 'Cliente'
            synthetic = {
                id: doc.id,
                customer_name: custName,
                customer_email: cust?.email || null,
                customer_phone: cust?.telefono || null,
                doc_type: doc.document_type,
                doc_status: doc.status,
                booking_details: {},
                status: 'active',
            }
        } else {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid entityType' }) }
        }

        const result = await triggerSystemMessageEvent({
            bookingId: entityId,
            event: eventName,
            syntheticBooking: synthetic,
            maxOffsetHours: 1,
        })

        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...result }) }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error'
        console.error('[trigger-system-event] error:', msg)
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }
    }
}
