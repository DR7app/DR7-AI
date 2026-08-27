import { gzipSync } from 'node:zlib'

/**
 * Netlify limita la risposta di una function a 6 MB (6.291.556 byte esatti).
 * Oltre quella soglia NON arriva un errore applicativo: arriva un 502
 * `Function.ResponseSizeTooLarge`, e il chiamante vede semplicemente una
 * lista vuota. Con ~2.000 clienti non si vede; a 22.000 la tab Clienti
 * resta bianca.
 *
 * Qui il corpo viene compresso quando serve: 7 MB di JSON diventano circa
 * 1 MB. Il browser lo decomprime da solo grazie a `Content-Encoding: gzip`,
 * quindi nessun chiamante va toccato.
 *
 * Sotto la soglia di guardia si risponde in chiaro, per non pagare la
 * compressione su risposte piccole.
 */
const SOGLIA_BYTE = 2 * 1024 * 1024   // oltre 2 MB conviene comprimere

export function rispostaJson(
    dati: unknown,
    intestazioni: Record<string, string>,
    _accettaGzip?: boolean,
    statusCode = 200,
) {
    const testo = JSON.stringify(dati)
    const byte = Buffer.byteLength(testo)

    // La decisione dipende SOLO dalla dimensione. Netlify non inoltra
    // `accept-encoding` alla function: fidarsi di quell'header significava
    // non comprimere mai le chiamate dal browser — e prendersi il 502.
    // Ogni browser supporta gzip, quindi comprimere e' sempre sicuro qui.
    if (byte < SOGLIA_BYTE) {
        return { statusCode, headers: intestazioni, body: testo }
    }

    const compresso = gzipSync(testo)
    console.log(`[rispostaJson] ${(byte / 1048576).toFixed(2)} MB -> ${(compresso.length / 1048576).toFixed(2)} MB compressi`)
    return {
        statusCode,
        headers: { ...intestazioni, 'Content-Encoding': 'gzip' },
        body: compresso.toString('base64'),
        isBase64Encoded: true,
    }
}

/**
 * Mantenuta per compatibilita' con i chiamanti esistenti: il valore non viene
 * piu' usato per decidere. Netlify non inoltra `accept-encoding` alla
 * function, quindi qualunque controllo su quell'header risponderebbe sempre
 * "no" e la risposta resterebbe non compressa.
 */
export function accettaGzip(_headers?: Record<string, string | undefined> | null): boolean {
    return true
}
