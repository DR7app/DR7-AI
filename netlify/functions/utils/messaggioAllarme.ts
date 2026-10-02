/**
 * Invio del messaggio collegato a un allarme — usato da alarm-send-message
 * (bottone o riserva dal browser) e da alarm-engine-cron (motore sul server).
 *
 * Il testo NON e' qui: vive in Messaggi di Sistema Pro, come tutti gli altri.
 * Il destinatario va risolto, e da dove dipende dall'allarme: una
 * prenotazione, una riga `cauzioni` che punta a un cliente, oppure (allarmi
 * Lead) un preventivo, un carrello Nexi o un invito.
 *
 * Con `eventId` l'occorrenza si "prenota" prima di spedire:
 * alarm_events.messaggio_cliente_at passa da NULL a adesso in una sola UPDATE.
 * Chi arriva secondo trova la riga gia' presa e non spedisce: un messaggio per
 * occorrenza, qualunque sia il numero di giri (server + schede). L'esito resta
 * scritto in messaggio_cliente_esito.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const SITE_URL = process.env.URL || 'https://platform.dr7ai.com'

export interface RichiestaMessaggioAllarme {
    alarmId?: string
    entityId: string
    templateKey: string
    eventId?: string
}

export type EsitoMessaggioAllarme =
    | { sent: true; phone: string }
    | { sent: false; reason: string; message: string; notFound?: boolean }

export async function inviaMessaggioAllarme(
    sb: SupabaseClient,
    { alarmId, entityId, templateKey, eventId }: RichiestaMessaggioAllarme,
): Promise<EsitoMessaggioAllarme> {
    if (eventId) {
        const { data: presa, error: errPresa } = await sb
            .from('alarm_events')
            .update({ messaggio_cliente_at: new Date().toISOString() })
            .eq('id', eventId)
            .is('messaggio_cliente_at', null)
            .select('id')
        if (errPresa || !presa || presa.length === 0) {
            return { sent: false, reason: 'already_sent', message: 'Messaggio gia\' inviato per questo allarme' }
        }
    }
    const segnaEsito = async (esito: string) => {
        if (!eventId) return
        await sb.from('alarm_events').update({ messaggio_cliente_esito: esito }).eq('id', eventId)
    }

    let phone = ''
    let nome = ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let booking: any = null

    if (String(alarmId || '').startsWith('cauzione')) {
        // L'entita' e' una riga `cauzioni`: il telefono sta in anagrafica.
        const { data: cauz } = await sb
            .from('cauzioni')
            .select('id, cliente_id')
            .eq('id', entityId)
            .maybeSingle()
        if (!cauz) {
            await segnaEsito('destinatario_non_trovato')
            return { sent: false, reason: 'not_found', message: 'Cauzione non trovata', notFound: true }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = cauz as any
        if (c.cliente_id) {
            const x = await daAnagrafica(sb, c.cliente_id, '')
            phone = x.phone
            nome = x.nome
        }
    } else {
        const { data: bk } = await sb
            .from('bookings')
            .select('*')
            .eq('id', entityId)
            .maybeSingle()
        if (bk) {
            booking = bk
            phone = String(booking.customer_phone || booking.guest_phone || booking.booking_details?.customer?.phone || '')
            nome = String(booking.customer_name || booking.guest_name || '')
        } else {
            // 02/10/2026: gli allarmi Lead aprono la pratica su un preventivo,
            // un carrello Nexi o un invito, non su una prenotazione. Prima qui
            // si rispondeva 404 e il messaggio scelto in Centralina Pro non
            // partiva mai, senza lasciare traccia.
            const altro = await destinatarioSenzaPrenotazione(sb, String(entityId))
            if (!altro) {
                await segnaEsito('destinatario_non_trovato')
                return { sent: false, reason: 'not_found', message: 'Prenotazione non trovata', notFound: true }
            }
            phone = altro.phone
            nome = altro.nome
        }
    }

    if (!phone.replace(/\D/g, '')) {
        await segnaEsito('no_phone')
        return { sent: false, reason: 'no_phone', message: 'Il cliente non ha un numero di telefono in scheda' }
    }

    // Il corpo lo compone send-whatsapp-notification dal template Pro: se il
    // template e' spento o vuoto, o l'invio WhatsApp e' fermo in System
    // Control, risponde `skipped` e non parte niente. Nessun testo scritto qui.
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
        await segnaEsito(out?.reason || 'send_failed')
        return {
            sent: false,
            reason: out?.reason || 'send_failed',
            message: out?.reason === 'pro_template_unavailable'
                ? 'Il messaggio scelto non esiste, e\' spento oppure e\' vuoto in Messaggi di Sistema Pro'
                : (out?.message || 'Invio non riuscito'),
        }
    }

    await segnaEsito('inviato')
    return { sent: true, phone }
}

/**
 * Destinatario di un allarme la cui pratica non e' una prenotazione: preventivo
 * (lead_preventivo_*), carrello Nexi abbandonato (lead_prenotazione_abbandonata),
 * invito a compilare i dati (lead_invito_non_compilato). Stesso id che il
 * motore scrive in alarm_events.booking_id.
 */
async function destinatarioSenzaPrenotazione(sb: SupabaseClient, id: string): Promise<{ phone: string; nome: string } | null> {
    const { data: prev } = await sb
        .from('preventivi')
        .select('customer_name, customer_phone, customer_id')
        .eq('id', id)
        .maybeSingle()
    if (prev) {
        const phone = String(prev.customer_phone || '')
        if (phone || !prev.customer_id) return { phone, nome: String(prev.customer_name || '') }
        return await daAnagrafica(sb, prev.customer_id, String(prev.customer_name || ''))
    }
    const { data: carrello } = await sb
        .from('pending_nexi_bookings')
        .select('booking_data')
        .eq('id', id)
        .maybeSingle()
    if (carrello) {
        const d = (carrello.booking_data || {}) as Record<string, unknown>
        return {
            phone: String(d.customer_phone || d.guest_phone || ''),
            nome: String(d.customer_name || d.guest_name || ''),
        }
    }
    const { data: invito } = await sb
        .from('customer_invites')
        .select('customer_id')
        .eq('id', id)
        .maybeSingle()
    if (invito) {
        if (!invito.customer_id) return { phone: '', nome: '' }
        return await daAnagrafica(sb, invito.customer_id, '')
    }
    return null
}

async function daAnagrafica(sb: SupabaseClient, clienteId: string, nomeNoto: string): Promise<{ phone: string; nome: string }> {
    const { data: x } = await sb
        .from('customers_extended')
        .select('nome, cognome, ragione_sociale, denominazione, tipo_cliente, telefono')
        .eq('id', clienteId)
        .maybeSingle()
    if (!x) return { phone: '', nome: nomeNoto }
    const nome = x.tipo_cliente === 'azienda'
        ? String(x.ragione_sociale || x.denominazione || '')
        : `${x.nome || ''} ${x.cognome || ''}`.trim()
    return { phone: String(x.telefono || ''), nome: nome || nomeNoto }
}
