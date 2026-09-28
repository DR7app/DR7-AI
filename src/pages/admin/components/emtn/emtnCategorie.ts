/**
 * Categorie EMTN e voci del cliente allegabili a una segnalazione.
 * Stesso elenco del server (emtn-event-create.ts, ALLOWED_TYPES).
 */

export const EMTN_CATEGORIE: { id: string; label: string; helper: string }[] = [
    { id: 'UNPAID_DAMAGE', label: 'Danno non saldato', helper: 'Riparazioni dovute non pagate' },
    { id: 'UNPAID_PENALTY', label: 'Penale non saldata', helper: 'Penali addebitate non pagate' },
    { id: 'INSOLVENCY',    label: 'Insoluto',          helper: 'Fatture non pagate' },
    { id: 'NON_RETURN',    label: 'Mancata restituzione', helper: 'Veicolo non riconsegnato' },
    { id: 'THEFT_REPORTED', label: 'Furto con denuncia', helper: 'Sottrazione con denuncia formale' },
    { id: 'LEGAL_EVENT',   label: 'Evento legale',     helper: 'Procedimento legale documentato' },
]

/** Una voce del cliente (danno, penale o importo da saldare) da allegare. */
export interface EMTNVoce {
    key: string
    kind: 'danno' | 'penale' | 'insoluto'
    label: string
    vehicle: string | null
    eventDate: string | null
    amount: number
    remaining: number
    bookingId: string
}

/** La categoria che una voce porta con se' quando viene aggiunta. */
export const CATEGORIA_DI_VOCE: Record<EMTNVoce['kind'], string> = {
    danno: 'UNPAID_DAMAGE',
    penale: 'UNPAID_PENALTY',
    insoluto: 'INSOLVENCY',
}
