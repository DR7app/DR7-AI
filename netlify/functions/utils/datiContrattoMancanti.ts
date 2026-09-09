/**
 * Cosa manca alla scheda cliente perche' il contratto esca pieno.
 *
 * Sta qui e non dentro un tab del gestionale perche' il contratto si genera
 * da piu' punti — Prenotazioni, Contratti ("Rigenera"), Preventivi accettati,
 * salvataggio della prenotazione — e ognuno di questi si era dimenticato il
 * controllo almeno una volta. Il controllo vero e' uno solo: quello che fa
 * `generate-contract` prima di stampare.
 *
 * L'elenco e' quello delle CASELLE del contratto, non quello della fattura:
 * alla fattura non servono patente e nascita.
 */

export type ClienteContratto = Record<string, unknown> | null | undefined

/** Etichette italiane, le stesse che mostra il popup del gestionale. */
export const ETICHETTE_CAMPI: Record<string, string> = {
    nome: 'Nome',
    cognome: 'Cognome',
    codice_fiscale: 'Codice fiscale',
    sesso: 'Sesso',
    indirizzo: 'Indirizzo',
    citta_residenza: 'Citta di residenza',
    provincia_residenza: 'Provincia',
    codice_postale: 'CAP',
    data_nascita: 'Data di nascita',
    luogo_nascita: 'Luogo di nascita',
    telefono: 'Telefono',
    email: 'E-mail',
    numero_patente: 'Numero patente',
    emessa_da: 'Patente emessa da',
    data_rilascio_patente: 'Data rilascio patente',
    scadenza_patente: 'Scadenza patente',
    denominazione: 'Ragione sociale',
    partita_iva: 'Partita IVA',
    sede_legale: 'Sede legale',
}

const pieno = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== ''

/**
 * I campi vuoti sulla scheda. Lista vuota = il contratto esce completo.
 * `cliente` nullo = nessuna scheda collegata: manca tutto.
 */
export function datiContrattoMancanti(cliente: ClienteContratto): string[] {
    const c = (cliente || {}) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    const tipo = String(c.tipo_cliente || 'persona_fisica')
    const mancanti: string[] = []

    if (tipo === 'azienda' || tipo === 'pubblica_amministrazione') {
        if (!pieno(c.denominazione) && !pieno(c.ragione_sociale)) mancanti.push('denominazione')
        if (!pieno(c.partita_iva) && !pieno(c.codice_fiscale)) mancanti.push('partita_iva')
        if (!pieno(c.sede_legale) && !pieno(c.sede_operativa) && !pieno(c.indirizzo)) mancanti.push('sede_legale')
        if (!pieno(c.telefono)) mancanti.push('telefono')
        if (!pieno(c.email)) mancanti.push('email')
        return mancanti
    }

    if (!pieno(c.nome)) mancanti.push('nome')
    if (!pieno(c.cognome)) mancanti.push('cognome')
    if (!pieno(c.codice_fiscale)) mancanti.push('codice_fiscale')
    if (!pieno(c.sesso) && !pieno(c.metadata?.sesso)) mancanti.push('sesso')
    if (!pieno(c.indirizzo)) mancanti.push('indirizzo')
    if (!pieno(c.citta_residenza) && !pieno(c.citta)) mancanti.push('citta_residenza')
    if (!pieno(c.provincia_residenza) && !pieno(c.provincia)) mancanti.push('provincia_residenza')
    if (!pieno(c.codice_postale) && !pieno(c.cap)) mancanti.push('codice_postale')
    if (!pieno(c.data_nascita)) mancanti.push('data_nascita')
    if (!pieno(c.luogo_nascita)) mancanti.push('luogo_nascita')
    if (!pieno(c.telefono)) mancanti.push('telefono')
    if (!pieno(c.email)) mancanti.push('email')
    if (!pieno(c.numero_patente) && !pieno(c.patente) && !pieno(c.metadata?.patente?.numero)) mancanti.push('numero_patente')
    if (!pieno(c.emessa_da) && !pieno(c.metadata?.patente?.ente)) mancanti.push('emessa_da')
    if (!pieno(c.data_rilascio_patente) && !pieno(c.metadata?.patente?.rilascio)) mancanti.push('data_rilascio_patente')
    if (!pieno(c.scadenza_patente) && !pieno(c.data_scadenza_patente) && !pieno(c.metadata?.patente?.scadenza)) mancanti.push('scadenza_patente')
    return mancanti
}

/** "Codice fiscale, Data di nascita, Numero patente" — per il messaggio. */
export function elencoLeggibile(campi: string[]): string {
    return campi.map(c => ETICHETTE_CAMPI[c] || c).join(', ')
}
