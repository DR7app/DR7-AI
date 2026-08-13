/**
 * Invio del messaggio collegato a un allarme.
 *
 * L'allarme suona, l'operatore preme "Avvisa il cliente" e parte il template
 * scelto dalla direzione in Centralina Pro > Allarmi. Il testo NON e' qui:
 * vive in Messaggi di Sistema Pro, come tutti gli altri.
 *
 * Perche' una funzione e non una fetch dal browser: il destinatario va
 * risolto, e da dove dipende dall'allarme — un allarme di rientro parte da una
 * prenotazione, uno di scadenza cauzione da una riga `cauzioni` che punta a un
 * cliente. Farlo lato client avrebbe voluto dire due query e due permessi di
 * lettura in piu' nel pannello.
 *
 * Input:  { alarmId, entityId, templateKey }
 * Output: { sent: true, phone } oppure un motivo esplicito.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'
import { getCorsOrigin } from './cors-headers'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const SITE_URL = process.env.URL || 'https://platform.dr7ai.com'

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: authErr } = await requireAuth(event as any)
    if (authErr) return authErr

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase non configurato' }) }
    }

    try {
        const { alarmId, entityId, templateKey } = JSON.parse(event.body || '{}')
        if (!entityId || !templateKey) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'entityId e templateKey sono obbligatori' }) }
        }

        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
        })

        let phone = ''
        let nome = ''
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let booking: any = null

        if (String(alarmId || '').startsWith('cauzione')) {
            // L'entita' e' una riga `cauzioni`: il telefono sta in anagrafica.
            const { data: cauz } = await sb
                .from('cauzioni')
                .select('id, cliente_id, importo, scadenza_cauzione')
                .eq('id', entityId)
                .maybeSingle()
            if (!cauz) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: 'Cauzione non trovata' }) }
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const c = cauz as any
            if (c.cliente_id) {
                const { data: cli } = await sb
                    .from('customers_extended')
                    .select('nome, cognome, ragione_sociale, denominazione, tipo_cliente, telefono')
                    .eq('id', c.cliente_id)
                    .maybeSingle()
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const x = cli as any
                if (x) {
                    phone = String(x.telefono || '')
                    nome = x.tipo_cliente === 'azienda'
                        ? String(x.ragione_sociale || x.denominazione || '')
                        : `${x.nome || ''} ${x.cognome || ''}`.trim()
                }
            }
        } else {
            const { data: bk } = await sb
                .from('bookings')
                .select('*')
                .eq('id', entityId)
                .maybeSingle()
            if (!bk) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: 'Prenotazione non trovata' }) }
            }
            booking = bk
            phone = String(booking.customer_phone || booking.guest_phone || booking.booking_details?.customer?.phone || '')
            nome = String(booking.customer_name || booking.guest_name || '')
        }

        if (!phone.replace(/\D/g, '')) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ sent: false, reason: 'no_phone', message: 'Il cliente non ha un numero di telefono in scheda' }),
            }
        }

        // Il corpo lo compone send-whatsapp-notification dal template Pro:
        // se il template e' spento o vuoto, quella funzione risponde
        // `skipped` e non parte niente. Nessun testo scritto qui.
        const res = await fetch(`${SITE_URL}/.netlify/functions/send-whatsapp-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customPhone: phone,
                templateKey,
                ...(booking ? { booking } : {}),
                templateVars: { nome: (nome.split(' ')[0] || 'Cliente'), customer_name: nome, cliente: nome },
            }),
        })
        const out = await res.json().catch(() => ({}))
        if (!res.ok || out?.skipped) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    sent: false,
                    reason: out?.reason || 'send_failed',
                    message: out?.reason === 'pro_template_unavailable'
                        ? 'Il messaggio scelto non esiste, e\' spento oppure e\' vuoto in Messaggi di Sistema Pro'
                        : (out?.message || 'Invio non riuscito'),
                }),
            }
        }

        return { statusCode: 200, headers, body: JSON.stringify({ sent: true, phone }) }
    } catch (err) {
        console.error('[alarm-send-message]', err)
        return { statusCode: 500, headers, body: JSON.stringify({ error: (err as Error).message }) }
    }
}
