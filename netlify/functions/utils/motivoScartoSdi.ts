/**
 * motivoScartoSdi — perche' lo SDI ha scartato una fattura.
 *
 * 01/10/2026: per DR7-2026-2102 e le fatture Saia (1908-1913) Aruba risponde
 * status "Scartata" con statusDescription VUOTA: il motivo vero sta nella
 * notifica di scarto (NS) che lo SDI manda ad Aruba, e il client Aruba di
 * questo repo (aruba-utils.ts) non ha nessuna funzione per scaricarla —
 * solo getByFilename / findByUsername, che riportano lo stato e basta. Non
 * si inventa un endpoint: si salva un motivo esplicito in
 * sdi_response.motivo_scarto, con la causa probabile quando la si riconosce
 * dai dati della fattura (CF o P.IVA che non superano il controllo).
 *
 * Per avere il testo della notifica serve aggiungere ad aruba-utils.ts la
 * chiamata alle notifiche SDI delle fatture inviate (API Aruba Fatturazione
 * Elettronica, sezione notifiche) e verificarla in staging prima dell'uso.
 */

import { validaCodiceFiscale, validaPartitaIva } from '../../../src/utils/codiceFiscaleValido'

export const MOTIVO_SCARTO_NON_DISPONIBILE =
    'Scartata dallo SDI senza motivo nella risposta Aruba. Il motivo e\' nella notifica di scarto (NS): ' +
    'aprila dal pannello Aruba Fatturazione Elettronica (fatture inviate > dettaglio > notifiche). ' +
    'Il gestionale non scarica ancora le notifiche SDI.'

const s = (v: unknown) => String(v ?? '').trim()

function statoEDescrizione(remote: any): { stato: string; descrizione: string } {
    const obj = remote?.invoices?.[0] || remote || {}
    return {
        stato: s(obj.status || obj.invoiceStatus).toLowerCase(),
        descrizione: s(obj.statusDescription || remote?.statusDescription || remote?.errorDescription),
    }
}

export function eScarto(statoRemoto: string): boolean {
    const st = s(statoRemoto).toLowerCase()
    return st === 'scartata' || st === 'rifiutata'
}

/**
 * Motivo da salvare per una fattura scartata: la descrizione Aruba se c'e',
 * altrimenti il segnaposto, con la causa probabile ricavata dalla fattura.
 * null se la risposta non e' uno scarto.
 */
export function motivoScarto(
    remote: any,
    fattura?: { customer_tax_code?: string | null; customer_vat?: string | null } | null,
): string | null {
    const { stato, descrizione } = statoEDescrizione(remote)
    if (!eScarto(stato)) return null
    if (descrizione) return descrizione

    let probabile = ''
    const piva = s(fattura?.customer_vat)
    const cf = s(fattura?.customer_tax_code)
    // Stesso ordine dell'XML: se c'e' la P.IVA si trasmette lei.
    if (piva) {
        const esito = validaPartitaIva(piva)
        if (!esito.valido) probabile = esito.motivo || ''
    } else if (cf) {
        const esito = validaCodiceFiscale(cf)
        if (!esito.valido) probabile = esito.motivo || ''
    }
    return probabile
        ? `${MOTIVO_SCARTO_NON_DISPONIBILE} Causa probabile: ${probabile}`
        : MOTIVO_SCARTO_NON_DISPONIBILE
}

/** La risposta Aruba con `motivo_scarto` aggiunto quando e' uno scarto. */
export function conMotivoScarto<T extends Record<string, any>>(
    remote: T,
    fattura?: { customer_tax_code?: string | null; customer_vat?: string | null } | null,
): T & { motivo_scarto?: string } {
    const motivo = motivoScarto(remote, fattura)
    if (!motivo || !remote || typeof remote !== 'object') return remote
    return { ...remote, motivo_scarto: motivo }
}
