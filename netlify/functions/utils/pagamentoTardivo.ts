/**
 * Pagamento arrivato DOPO la scadenza del link: si accetta o si ferma?
 *
 * 01/10/2026: il link Pay-by-Link vive 1 ora per il gestionale, ma a Nexi si
 * puo' passare solo una DATA di scadenza (minimo il giorno dopo): il link resta
 * pagabile fino alle 23:59 del giorno seguente. Il callback scartava ogni
 * pagamento oltre 1h05 con stato `expired_late_payment` — la carta era gia'
 * addebitata, la prenotazione restava non pagata e nessuno rimborsava.
 * 8 casi reali (29,90 / 650 / 350 / 25 / 104,65 / 25 / 25 / 30 euro).
 *
 * Regola: un pagamento che Nexi CONFERMA e' denaro incassato e non si perde.
 *   - si accetta come un pagamento normale, marcato `pagamento_tardivo`;
 *   - NON si accetta quando segnarlo pagato sarebbe sbagliato (prenotazione
 *     annullata o cancellata, oppure gia' saldata con un altro metodo): la
 *     transazione resta `expired_late_payment` e scatta un allarme allo staff,
 *     che decide il rimborso a mano. Mai un rimborso automatico da qui.
 *
 * Funzione PURA: nessuna query, nessuna rete. Il callback le passa i dati gia'
 * letti. Cosi' la decisione e' coperta da test.
 */

/** Tolleranza dopo la scadenza per i ritardi di elaborazione Nexi. */
export const TOLLERANZA_SCADENZA_MS = 5 * 60 * 1000

const STATI_PAGATO = new Set(['paid', 'completed', 'succeeded'])
const STATI_ANNULLATO = new Set(['cancelled', 'annullata'])
const VOCE_IN_ATTESA = new Set(['nexi_pay_by_link', 'pending', ''])

export type MotivoBlocco =
    | 'prenotazione_annullata'
    | 'prenotazione_non_trovata'
    | 'gia_pagata_altro_metodo'

export type EsitoPagamentoTardivo =
    | { tipo: 'nei_tempi' }
    | { tipo: 'accetta_tardivo'; secondiRitardo: number; nota: string }
    | { tipo: 'blocca'; secondiRitardo: number; motivo: MotivoBlocco; nota: string }

export interface PrenotazionePerTardivo {
    status?: string | null
    payment_status?: string | null
    payment_method?: string | null
    price_total?: number | null
    amount_paid?: number | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    booking_details?: Record<string, any> | null
}

export interface InputPagamentoTardivo {
    /** Nexi ha confermato l'ordine (notifica OK + verifica server-to-server). */
    pagatoSuNexi: boolean
    /** metadata.payment_link_expires_at (o link_expires_at) della transazione. */
    scadenzaLink: string | null | undefined
    adesso: Date
    /** metadata.payment_purpose: booking, booking_topup, extension, danni, penali, danni_penali, cauzione... */
    scopo: string | null | undefined
    /** La transazione ha un booking_id. */
    haPrenotazione: boolean
    /** La prenotazione letta dal DB (null se booking_id presente ma riga sparita). */
    prenotazione: PrenotazionePerTardivo | null
    /**
     * La transazione era `superseded` (sostituita da un link piu' recente):
     * va controllata anche se pagata entro l'ora, perche' il debito potrebbe
     * essere gia' stato saldato col link nuovo.
     */
    linkSostituito?: boolean
    tolleranzaMs?: number
}

function low(v: unknown): string {
    return String(v ?? '').trim().toLowerCase()
}

/** La prenotazione risulta gia' saldata per lo scopo di QUESTO link? */
export function giaSaldataPerScopo(scopo: string, b: PrenotazionePerTardivo): boolean {
    const d = b.booking_details || {}
    const pagata = STATI_PAGATO.has(low(b.payment_status))

    if (scopo === 'extension') {
        const ext = Array.isArray(d.extension_history) ? d.extension_history : []
        // Estensione con cambio auto: la riga figlia E' l'estensione.
        if (d.parent_booking_id) return pagata
        // Nessuna estensione in attesa = l'ultima e' gia' stata segnata pagata
        // (contanti, bonifico, carta al banco...).
        return ext.length > 0 && !ext.some((e: { payment_status?: string }) => VOCE_IN_ATTESA.has(low(e?.payment_status)))
    }

    if (scopo === 'danni' || scopo === 'penali' || scopo === 'danni_penali') {
        const chiavi = scopo === 'danni' ? ['danni'] : scopo === 'penali' ? ['penalties'] : ['danni', 'penalties']
        const voci = chiavi.flatMap(k => (Array.isArray(d[k]) ? d[k] : []))
        return voci.length > 0 && !voci.some((v: { paymentStatus?: string }) => VOCE_IN_ATTESA.has(low(v?.paymentStatus)))
    }

    if (scopo === 'booking_topup') {
        const totale = Number(b.price_total) || 0
        const pagato = Number(d.amountPaid ?? d.amount_paid ?? b.amount_paid ?? 0) || 0
        return totale > 0 && pagato >= totale - 1
    }

    // booking (e scopi sconosciuti): stessa guardia del ramo "REGULAR BOOKING".
    return pagata || !!d.nexi_paid_at
}

export function decidiPagamentoTardivo(i: InputPagamentoTardivo): EsitoPagamentoTardivo {
    if (!i.pagatoSuNexi) return { tipo: 'nei_tempi' }
    const scadenza = i.scadenzaLink ? new Date(i.scadenzaLink) : null
    const scadenzaValida = !!scadenza && Number.isFinite(scadenza.getTime())
    const tolleranza = i.tolleranzaMs ?? TOLLERANZA_SCADENZA_MS
    const scaduto = scadenzaValida && i.adesso.getTime() > scadenza!.getTime() + tolleranza
    if (!scaduto && !i.linkSostituito) return { tipo: 'nei_tempi' }

    const secondiRitardo = scaduto ? Math.round((i.adesso.getTime() - scadenza!.getTime()) / 1000) : 0
    const ritardo = !scaduto
        ? 'su un link gia\' sostituito da uno piu\' recente,'
        : secondiRitardo >= 3600
            ? `${Math.floor(secondiRitardo / 3600)}h ${Math.round((secondiRitardo % 3600) / 60)}min dopo la scadenza del link,`
            : `${Math.round(secondiRitardo / 60)}min dopo la scadenza del link,`
    const scopo = low(i.scopo) || 'booking'

    // Link senza prenotazione (tab Clienti) o cauzione: non c'e' niente che
    // possa risultare gia' saldato altrove, il pagamento si registra.
    if (!i.haPrenotazione || scopo === 'cauzione') {
        return { tipo: 'accetta_tardivo', secondiRitardo, nota: `Pagato ${ritardo} accettato (incasso confermato da Nexi).` }
    }

    const b = i.prenotazione
    if (!b) {
        return {
            tipo: 'blocca', secondiRitardo, motivo: 'prenotazione_non_trovata',
            nota: `Pagato ${ritardo} ma la prenotazione non esiste piu'. Verificare e rimborsare a mano se dovuto.`,
        }
    }
    if (STATI_ANNULLATO.has(low(b.status))) {
        return {
            tipo: 'blocca', secondiRitardo, motivo: 'prenotazione_annullata',
            nota: `Pagato ${ritardo} ma la prenotazione e' annullata. Ricontattare il cliente: riattivare o rimborsare a mano.`,
        }
    }
    if (giaSaldataPerScopo(scopo, b)) {
        return {
            tipo: 'blocca', secondiRitardo, motivo: 'gia_pagata_altro_metodo',
            nota: `Pagato ${ritardo} ma risulta gia' saldato (${b.payment_method || 'altro metodo'}). Possibile doppio incasso: verificare e rimborsare a mano.`,
        }
    }
    return { tipo: 'accetta_tardivo', secondiRitardo, nota: `Pagato ${ritardo} accettato (incasso confermato da Nexi).` }
}
