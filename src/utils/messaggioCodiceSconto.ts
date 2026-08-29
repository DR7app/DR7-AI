/**
 * Testo del messaggio con cui si manda un CODICE SCONTO al cliente.
 *
 * 29/08/2026 (direzione): era scritto dentro CodiciScontoTab, quindi non
 * modificabile. Ora vive nei template Pro e questo file e' l'unico punto che
 * li carica e ne sostituisce i token — cosi' il tab Codice Sconto e la
 * creazione del codice dicono esattamente la stessa cosa.
 *
 * Due eventi, due momenti diversi:
 *  - `discount_code_created`      alla creazione di un codice intestato a un
 *                                 cliente (parte da solo SOLO se l'admin ha
 *                                 assegnato un template a questo evento);
 *  - `discount_code_manual_send`  quando l'admin manda il codice dal tab.
 */
import { supabase } from '../supabaseClient'

export interface CodicePerMessaggio {
    code: string
    scope?: string[] | null
    value_type: string
    value_amount: number
    minimum_spend?: number | null
    valid_until?: string | null
}

const ETICHETTE_SCOPE: Record<string, string> = {
    noleggio: 'Noleggio',
    lavaggi: 'Lavaggi',
    supercar: 'Supercar',
    utilitarie: 'Utilitarie',
    tutti_i_servizi: 'Tutti',
}

/** "tutti_i_servizi" non si mostra mai al cliente: diventa "Tutti". */
export function etichetteServizi(scope?: string[] | null): string {
    const voci = (scope || []).map(s => ETICHETTE_SCOPE[s] || s)
    return voci.join(', ') || 'tutti i servizi'
}

/**
 * Template Pro dell'evento richiesto. Ordine: chi ha l'evento assegnato in
 * "Eventi gestiti da questo template", poi la key canonica, poi il label
 * (i template ricreati a mano hanno key pro_custom_*). Il codice sconto
 * post-recensione e' un altro template e resta fuori.
 */
export async function caricaTemplateCodiceSconto(evento: string): Promise<string | null> {
    try {
        const { data } = await supabase
            .from('system_messages')
            .select('message_key, message_body, is_enabled, label, handled_events')
        const righe = (data || []) as Array<{
            message_key: string
            message_body: string | null
            is_enabled: boolean | null
            label: string | null
            handled_events: string[] | null
        }>
        const usabile = (r: typeof righe[number]) => r.is_enabled !== false && !!r.message_body
        const perEvento = righe.find(r => (r.handled_events || []).includes(evento) && usabile(r))
        if (perEvento) return perEvento.message_body
        const diretto = righe.find(r => r.message_key === 'pro_marketing_invio_codice_sconto' && usabile(r))
        if (diretto) return diretto.message_body
        const perLabel = righe.find(r => {
            const lbl = (r.label || '').toLowerCase()
            return lbl.includes('codice sconto') && !lbl.includes('recensione') && usabile(r)
        })
        return perLabel?.message_body || null
    } catch {
        return null
    }
}

/**
 * Token sostituiti nel body. Senza template si usa il testo di sempre, cosi'
 * l'invio non si ferma mai per una configurazione mancante.
 */
export function componiMessaggioCodiceSconto(
    body: string | null,
    code: CodicePerMessaggio,
    nome = '',
): string {
    const servizi = etichetteServizi(code.scope)
    const validita = code.valid_until ? new Date(code.valid_until).toLocaleDateString('it-IT') : ''
    const valore = code.value_type === 'percentage'
        ? `${code.value_amount}%`
        : `€${Number(code.value_amount).toFixed(2)}`
    const spesaMinima = code.minimum_spend ? `\nSpesa minima: €${Number(code.minimum_spend).toFixed(2)}` : ''
    const token: Record<string, string> = {
        nome,
        codice: code.code,
        valore,
        servizi,
        validita,
        spesa_minima: spesaMinima,
        sito: 'www.dr7.app',
    }
    if (body) {
        return body.replace(/\{(\w+)\}/g, (intero, chiave: string) =>
            token[chiave] !== undefined ? token[chiave] : intero)
    }
    return `Ciao${nome ? ` ${nome}` : ''},\n\nEcco il tuo codice sconto DR7 di ${valore} su ${servizi}:\n\n*${code.code}*\n\nValido fino al ${validita}.${spesaMinima}\n\nLo puoi usare al check-out su www.dr7.app\n\nGrazie,\n*DR7*`
}

/** Numero in forma accettata da Green API (solo cifre, prefisso 39). */
export function numeroWhatsapp(telefono?: string | null): string | null {
    let clean = String(telefono || '').replace(/\D/g, '')
    if (!clean) return null
    if (clean.startsWith('00')) clean = clean.slice(2)
    if (clean.startsWith('0')) clean = '39' + clean.slice(1)
    if (!clean.startsWith('39') && clean.length === 10) clean = '39' + clean
    return clean.length >= 11 ? clean : null
}
