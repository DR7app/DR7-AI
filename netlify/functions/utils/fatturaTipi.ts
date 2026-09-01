/**
 * Che cosa e' una riga di `fatture`.
 *
 * La tabella `fatture` tiene insieme quattro documenti diversi, tutti agganciati
 * allo stesso `booking_id`:
 *
 *  - la fattura PRINCIPALE della prenotazione (una sola, `extension_index` nullo);
 *  - le fatture di ESTENSIONE (`extension_index` valorizzato);
 *  - le fatture di PENALE e DANNO (`tipo_fattura` = 'penale' / 'danno');
 *  - le NOTE DI CREDITO (`tipo_fattura` = 'nota_di_credito' e varianti storiche).
 *
 * Senza questa distinzione "cerca la fattura di questa prenotazione" restituisce
 * piu' righe, e chi si aspettava una sola riga concludeva che non ce ne fosse
 * nessuna: e' cosi' che nascevano le fatture in doppio (vedi
 * generate-invoice-from-booking.ts).
 *
 * I valori storici sono piu' d'uno perche' scritti in momenti diversi del
 * progetto: si accettano tutti in lettura, se ne scrive uno solo.
 */

export const TIPI_NOTA_DI_CREDITO = ['nota_di_credito', 'nota_credito', 'TD04']
export const TIPI_PENALE_DANNO = ['penale', 'danno', 'penali', 'danni']

/**
 * Le fatture di estensione. Il tipo si scrive dal 01/09/2026; prima erano
 * indistinguibili da una fattura principale — `extension_index` non e' mai
 * stato scritto da nessuno — ed e' anche per questo che si contavano come
 * doppioni. Quelle gia' in archivio le ritipizza la migrazione, riconoscendole
 * dalle righe ("Estensione noleggio ...").
 */
export const TIPO_ESTENSIONE = 'estensione'

/** Stati che significano "il documento e' gia' uscito verso lo SDI". */
export const STATI_SDI_USCITA = ['sending', 'sent', 'delivered', 'accepted']

interface RigaFattura {
    tipo_fattura?: string | null
    stato?: string | null
    sdi_status?: string | null
    aruba_invoice_id?: string | null
}

function tipo(riga: RigaFattura): string {
    return String(riga?.tipo_fattura || '').trim().toLowerCase()
}

export function isNotaDiCredito(riga: RigaFattura): boolean {
    return TIPI_NOTA_DI_CREDITO.map(t => t.toLowerCase()).includes(tipo(riga))
}

export function isPenaleODanno(riga: RigaFattura): boolean {
    return TIPI_PENALE_DANNO.includes(tipo(riga))
}

export function isEstensione(riga: RigaFattura): boolean {
    return tipo(riga) === TIPO_ESTENSIONE
}

/**
 * La fattura principale della prenotazione: non una nota di credito, non una
 * penale/danno, non annullata. Le estensioni si escludono a monte con il filtro
 * `extension_index is null`, che il tipo non sa distinguere.
 */
export function isFatturaPrincipale(riga: RigaFattura): boolean {
    if (!riga) return false
    if (isNotaDiCredito(riga)) return false
    if (isPenaleODanno(riga)) return false
    if (isEstensione(riga)) return false
    if (String(riga.stato || '').toLowerCase() === 'cancelled') return false
    return true
}

/** Documento gia' trasmesso allo SDI: si aggiorna, non si sostituisce. */
export function isUscitaSdi(riga: RigaFattura): boolean {
    if (!riga) return false
    if (riga.aruba_invoice_id) return true
    return STATI_SDI_USCITA.includes(String(riga.sdi_status || ''))
}
