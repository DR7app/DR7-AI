/**
 * Richiesta IBAN per il rimborso di una cauzione incassata. UNICA strada di
 * invio: la usano il tasto "Segna incassata" (via richiesta-iban-cauzione),
 * il callback Nexi del link INCASSO e il recupero nel cron dei messaggi.
 *
 * 25/09/2026: la cauzione pagata col link veniva segnata Incassata ma la
 * richiesta non partiva, perche' solo il tasto la mandava. Adesso:
 *   - `cauzioni.richiesta_iban_inviata_at` si prenota PRIMA dell'invio con un
 *     update condizionato: due strade in parallelo non mandano mai due volte;
 *   - se l'invio fallisce la prenotazione si toglie, e il cron riprova;
 *   - se il cliente ha gia' dato l'IBAN non si chiede nulla.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type EsitoRichiestaIban =
    | 'inviata' | 'gia_inviata' | 'iban_presente' | 'non_trovata'
    | 'senza_telefono' | 'template_mancante' | 'errore'

export async function inviaRichiestaIbanCauzione(
    supabase: SupabaseClient,
    cauzioneId: string,
): Promise<EsitoRichiestaIban> {
    const { data: c } = await supabase
        .from('cauzioni')
        .select('id, cliente_id, importo, riferimento_contratto_id, iban, richiesta_iban_inviata_at')
        .eq('id', cauzioneId)
        .maybeSingle()
    if (!c) return 'non_trovata'
    if (c.richiesta_iban_inviata_at) return 'gia_inviata'
    if ((c.iban || '').trim()) return 'iban_presente'

    const { data: cust } = c.cliente_id
        ? await supabase.from('customers_extended')
            .select('nome, cognome, email, telefono, ragione_sociale')
            .eq('id', c.cliente_id).maybeSingle()
        : { data: null }
    const phone = (cust?.telefono || '').trim()
    if (!phone) {
        console.warn(`[richiesta-iban] cauzione ${c.id}: nessun telefono cliente`)
        return 'senza_telefono'
    }

    // Prenotazione: solo chi riesce a scrivere la data manda il messaggio.
    const { data: prenotata } = await supabase
        .from('cauzioni')
        .update({ richiesta_iban_inviata_at: new Date().toISOString() })
        .eq('id', c.id)
        .is('richiesta_iban_inviata_at', null)
        .select('id')
    if (!prenotata?.length) return 'gia_inviata'

    const customerName = cust?.ragione_sociale || `${cust?.nome || ''} ${cust?.cognome || ''}`.trim() || 'Cliente'
    const amountStr = Number(c.importo || 0).toFixed(2)
    const contractRef = (c.riferimento_contratto_id || '').substring(0, 8).toUpperCase() || 'N/A'

    let esito: EsitoRichiestaIban = 'errore'
    try {
        const res = await fetch(`${process.env.URL || 'https://platform.dr7ai.com'}/.netlify/functions/send-whatsapp-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customPhone: phone,
                templateKey: 'deposit_return_iban',
                booking: { service_type: 'rental' },
                templateVars: {
                    // Il template "Richiesta IBAN" usa {nome cliente} (con spazio):
                    // passiamo tutte le varianti così viene sempre sostituito col nome.
                    '{nome cliente}': customerName,
                    '{nome_cliente}': customerName,
                    '{nome_completo}': customerName,
                    '{cliente}': customerName,
                    '{customer_name}': customerName,
                    '{nome}': customerName.split(' ')[0] || 'Cliente',
                    '{amount}': amountStr,
                    '{importo}': amountStr,
                    '{total}': amountStr,
                    '{contract_ref}': contractRef,
                    '{contratto}': contractRef,
                },
                skipHeader: false,
            }),
        })
        const j = await res.json().catch(() => ({}))
        if (res.ok && j?.success !== false && !j?.skipped) esito = 'inviata'
        else if (j?.reason === 'pro_template_unavailable') esito = 'template_mancante'
        else console.error(`[richiesta-iban] cauzione ${c.id}: invio non riuscito`, j)
    } catch (e) {
        console.error(`[richiesta-iban] cauzione ${c.id}: invio fallito`, e)
    }

    if (esito !== 'inviata') {
        // Si toglie la prenotazione: il cron riprovera' al giro successivo.
        await supabase.from('cauzioni').update({ richiesta_iban_inviata_at: null }).eq('id', c.id)
    } else {
        console.log(`[richiesta-iban] cauzione ${c.id}: inviata a ${phone}`)
    }
    return esito
}

/**
 * Recupero per il cron: cauzioni incassate negli ultimi 3 giorni senza
 * richiesta IBAN (qualunque strada le abbia incassate: tasto, link,
 * incasso della pre-autorizzazione). La finestra evita di ripescare
 * cauzioni vecchie se un giorno la colonna venisse svuotata per errore.
 */
export async function recuperaRichiesteIbanMancanti(
    supabase: SupabaseClient,
): Promise<{ sent: number; skipped: number; errors: number }> {
    const da = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const { data: mancanti, error } = await supabase
        .from('cauzioni')
        .select('id')
        .eq('stato', 'Incassata')
        .is('richiesta_iban_inviata_at', null)
        .gte('data_incasso', da)
        .limit(50)
    if (error) {
        console.error('[richiesta-iban] recupero: query fallita', error)
        return { sent: 0, skipped: 0, errors: 1 }
    }
    let sent = 0, skipped = 0, errors = 0
    for (const r of mancanti || []) {
        const esito = await inviaRichiestaIbanCauzione(supabase, r.id)
        if (esito === 'inviata') sent++
        else if (esito === 'errore' || esito === 'template_mancante') errors++
        else skipped++
    }
    return { sent, skipped, errors }
}
