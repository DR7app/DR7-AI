/**
 * statoSdiAruba — lettura UNICA dello stato SDI che Aruba riporta per una
 * fattura inviata, e traduzione nello stato del gestionale.
 *
 * 07/11/2026: in Fatturazione 114 fatture risultavano "Accettata" mentre su
 * Aruba erano "Scartata". Lo stato era tradotto in tre posti diversi
 * (check-sdi-status, _check-sdi-statuses, reconcile-sdi-statuses), ognuno con
 * la sua tabella: "mancata consegna" era scartata in uno e accettata
 * nell'altro, il riallineamento in blocco leggeva `status` in cima alla riga
 * (Aruba lo mette in `invoices[0].status`) e la lista sotto `invoices`/`data`
 * (Aruba la restituisce in `content`), quindi non correggeva niente. E una
 * volta "accepted" la fattura non veniva MAI piu' riletta: qualunque
 * accettata sbagliata restava tale per sempre.
 *
 * Da qui in poi: una sola tabella, Aruba e' la verita', e una notifica di
 * scarto (NS) nella risposta vince su qualunque altro stato.
 *
 * Nessuna chiamata di rete qui dentro: solo funzioni pure, testate.
 */

import { motivoScarto } from './motivoScartoSdi'

export type StatoSdi = 'accepted' | 'rejected' | 'error' | 'sent'

const s = (v: unknown) => String(v ?? '').trim()

/** "Non_Consegnata " -> "non consegnata". */
export function normalizzaStato(v: unknown): string {
    return s(v).toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// Stati delle fatture inviate come li scrive Aruba (pannello e API).
// - Consegnata / Non consegnata / Recapito impossibile: lo SDI ha ACCETTATO
//   la fattura (e' nel cassetto fiscale), cambia solo l'esito del recapito.
//   Fiscalmente valida: 'accepted' (scelta del 06/05/2026, commit b911f369).
// - Accettata / Decorrenza termini: esiti della PA, fattura valida.
// - Scartata: notifica di scarto (NS), la fattura NON esiste per lo SDI.
// - Rifiutata: la PA committente l'ha rifiutata, va rifatta: 'rejected'.
const ACCETTATA = new Set([
    'consegnata', 'consegnato',
    'mancata consegna', 'non consegnata', 'non consegnato',
    'recapito impossibile', 'impossibilita di recapito',
    'accettata', 'accettato',
    'decorrenza termini',
])
const SCARTATA = new Set(['scartata', 'scartato', 'rifiutata', 'rifiutato', 'scarto'])
const ERRORE = new Set(['errore elaborazione', 'errore consegna', 'errore'])
const IN_CORSO = new Set([
    'inviata', 'spedita', 'presa in carico', 'in elaborazione',
    'ricevuta', 'in consegna', 'in attesa',
])

/** Stato Aruba -> stato del gestionale. null = stato sconosciuto (non si tocca). */
export function mappaStatoAruba(statoAruba: unknown): StatoSdi | null {
    const st = normalizzaStato(statoAruba)
    if (!st) return null
    if (SCARTATA.has(st)) return 'rejected'
    if (ACCETTATA.has(st)) return 'accepted'
    if (ERRORE.has(st)) return 'error'
    if (IN_CORSO.has(st)) return 'sent'
    return null
}

/** Notifiche SDI presenti nella risposta Aruba (se Aruba le include). */
export function notificheAruba(remote: any): { tipo: string; descrizione: string }[] {
    const fonti = [remote?.notifications, remote?.notifiche, remote?.invoices?.[0]?.notifications]
    const out: { tipo: string; descrizione: string }[] = []
    for (const lista of fonti) {
        if (!Array.isArray(lista)) continue
        for (const n of lista) {
            if (!n || typeof n !== 'object') continue
            const tipo = s(n.docType || n.type || n.tipo || n.notificationType).toUpperCase()
            const descrizione = s(n.result || n.description || n.descrizione || n.esito)
            if (tipo) out.push({ tipo, descrizione })
        }
    }
    return out
}

export interface LetturaAruba {
    /** Il testo dello stato cosi' come lo scrive Aruba ("Scartata"). */
    statoAruba: string
    /** Stato del gestionale, o null se lo stato Aruba non e' riconosciuto. */
    stato: StatoSdi | null
    /** Descrizione dello stato / motivo dello scarto, se Aruba lo dice. */
    descrizione: string
    /** C'e' una notifica di scarto (NS) nella risposta. */
    notificaScarto: boolean
}

/**
 * Legge una risposta di getByFilename OPPURE una riga di findByUsername.
 * Lo stato vero sta in `invoices[0].status`; `status` in cima alla riga e'
 * solo un ripiego per risposte di forma diversa.
 */
export function leggiStatoAruba(remote: any): LetturaAruba {
    const fattura = remote?.invoices?.[0] || {}
    const statoAruba = s(fattura.status || fattura.invoiceStatus || remote?.status || remote?.invoiceStatus)
    const notifiche = notificheAruba(remote)
    const ns = notifiche.find(n => n.tipo === 'NS')
    let stato = mappaStatoAruba(statoAruba)
    // Una notifica di scarto e' definitiva: vince su qualunque altro stato.
    if (ns) stato = 'rejected'
    const descrizione = s(fattura.statusDescription || remote?.statusDescription) || (ns ? ns.descrizione : '')
    return { statoAruba: statoAruba || (ns ? 'Scartata' : ''), stato, descrizione, notificaScarto: !!ns }
}

/** Righe della lista Aruba (findByUsername), qualunque sia la chiave usata. */
export function righeListaAruba(result: any): any[] {
    if (Array.isArray(result)) return result
    for (const k of ['content', 'invoices', 'results', 'data', 'items']) {
        if (Array.isArray(result?.[k])) return result[k]
    }
    return []
}

/** Nome file della riga Aruba. */
export function nomeFileAruba(riga: any): string {
    return s(riga?.filename || riga?.uploadFileName || riga?.invoiceFilename || riga?.fileName)
}

export interface FatturaLocale {
    id: string
    numero_fattura?: string | null
    sdi_status?: string | null
    sdi_response?: any
    customer_tax_code?: string | null
    customer_vat?: string | null
}

export interface Aggiornamento {
    patch: Record<string, unknown>
    /** true se cambia lo stato (da registrare nello storico). */
    cambiaStato: boolean
    da: string | null
    a: string | null
    statoAruba: string
    /** false se Aruba ha risposto con uno stato che la tabella non conosce. */
    riconosciuto: boolean
    motivo: string | null
}

/** Toglie dalla risposta Aruba i campi pesanti (file firmato, PDF). */
function rispostaLeggera(remote: any): Record<string, unknown> {
    if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return {}
    const resto: Record<string, unknown> = { ...remote }
    delete resto.file
    delete resto.pdfFile
    delete resto.dataFile
    return resto
}

/**
 * Cosa scrivere sulla fattura dopo aver letto Aruba.
 * - Stato riconosciuto e diverso: si cambia (anche da 'accepted').
 * - Sempre: sdi_response con lo stato Aruba testuale e l'ora della verifica,
 *   cosi' il gestionale mostra quello che dice Aruba e la rotazione delle
 *   riverifiche va avanti.
 * - Scarto: motivo in sdi_response.motivo_scarto e notifica da rivedere.
 */
export function decidiAggiornamento(
    locale: FatturaLocale,
    remote: any,
    adesso: Date = new Date(),
): Aggiornamento {
    const lettura = leggiStatoAruba(remote)
    const da = locale.sdi_status ?? null
    const nuovo = lettura.stato
    const cambiaStato = !!nuovo && nuovo !== da

    const motivo = nuovo === 'rejected'
        ? (lettura.descrizione || motivoScarto({ invoices: [{ status: 'scartata', statusDescription: '' }] }, locale))
        : null

    const precedente = locale.sdi_response && typeof locale.sdi_response === 'object' && !Array.isArray(locale.sdi_response)
        ? locale.sdi_response
        : {}
    const sdi_response: Record<string, unknown> = {
        ...precedente,
        ...rispostaLeggera(remote),
        stato_aruba: lettura.statoAruba || null,
        verificato_il: adesso.toISOString(),
    }
    if (motivo) sdi_response.motivo_scarto = motivo
    else if (nuovo && nuovo !== 'rejected') delete sdi_response.motivo_scarto

    const patch: Record<string, unknown> = { sdi_response }
    if (cambiaStato) {
        patch.sdi_status = nuovo
        if (nuovo === 'rejected') patch.sdi_notification_seen = false
    }
    return {
        patch, cambiaStato, da, a: cambiaStato ? nuovo : da,
        statoAruba: lettura.statoAruba, riconosciuto: !!nuovo, motivo,
    }
}
