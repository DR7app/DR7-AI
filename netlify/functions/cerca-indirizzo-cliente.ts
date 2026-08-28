import { getCorsOrigin } from './cors-headers'
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { cercaIndirizzoAltrove, indirizzoUtilizzabile } from './utils/indirizzoCliente'

/**
 * cerca-indirizzo-cliente — ricerca indirizzo intelligente per la scheda cliente.
 *
 * 28/08/2026: la sede legale scritta a meta' ("Via Salvo D'acquisto n.7", senza
 * CAP ne' comune) blocca la fattura elettronica. Quasi sempre l'indirizzo
 * completo di quel cliente esiste gia': su una fattura sua gia' accettata dal
 * SDI, o su un doppione della sua anagrafica. Questa funzione lo trova e lo
 * restituisce al form, che lo propone all'operatore.
 *
 * Sola LETTURA: non scrive niente e non inventa indirizzi.
 *
 * POST { codiceFiscale?, partitaIva?, email? }
 *   -> { trovato: true, indirizzo, fonte } | { trovato: false }
 */

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) }

    try {
        const { codiceFiscale = '', partitaIva = '', email = '' } = JSON.parse(event.body || '{}')
        if (!codiceFiscale && !partitaIva && !email) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Servono codice fiscale, partita IVA o email' }) }
        }

        const trovato = await cercaIndirizzoAltrove(supabase, {
            codiceFiscale: String(codiceFiscale || '').toUpperCase().trim(),
            partitaIva: String(partitaIva || '').toUpperCase().trim(),
            email: String(email || '').toLowerCase().trim(),
        })

        if (!trovato || !indirizzoUtilizzabile(trovato.indirizzo)) {
            return { statusCode: 200, headers, body: JSON.stringify({ trovato: false }) }
        }

        return { statusCode: 200, headers, body: JSON.stringify({ trovato: true, ...trovato }) }
    } catch (e: any) {
        console.error('[cerca-indirizzo-cliente]', e)
        return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'Errore' }) }
    }
}
