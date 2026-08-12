/**
 * Giorni lavorativi italiani — usato per la scadenza di restituzione cauzione.
 *
 * REGOLA (direzione, 2026-08-10):
 *   - lavorativi = lunedi'-venerdi';
 *   - esclusi TUTTI i festivi;
 *   - il conteggio parte dal PRIMO giorno lavorativo DOPO la restituzione:
 *     se l'auto torna venerdi', il giorno 1 e' il lunedi' successivo;
 *   - la scadenza e' il 14esimo giorno lavorativo (valore storico, confermato
 *     dalla direzione il 12/08: il commit 219f636c lo aveva fissato a 14 di
 *     proposito). Il difetto era un altro: i FESTIVI non venivano esclusi.
 *
 * Perche' esiste questo file: `sync-booking-cauzione` non escludeva i FESTIVI.
 * Natale, Ferragosto, Pasqua, 25 aprile venivano contati come giorni
 * lavorativi, quindi nei periodi di festa la scadenza cadeva fino a 4 giorni
 * prima del dovuto e le cauzioni venivano sollecitate e restituite troppo
 * presto. Il numero di giorni (14) era corretto.
 *
 * L'elenco dei festivi e' lo stesso mostrato dai calendari del gestionale
 * (src/data/italianHolidays.ts): duplicato qui perche' le Netlify Functions
 * vengono bundulate a parte e non devono dipendere dal codice dell'app.
 * Aggiornando un anno, aggiornare ENTRAMBI i file.
 */

/** Festivi nazionali. Pasqua e Lunedi' dell'Angelo cambiano ogni anno. */
export const FESTIVI_IT: string[] = [
    // 2025
    '2025-01-01', '2025-01-06', '2025-04-20', '2025-04-21', '2025-04-25',
    '2025-05-01', '2025-06-02', '2025-08-15', '2025-11-01', '2025-12-08',
    '2025-12-25', '2025-12-26',
    // 2026
    '2026-01-01', '2026-01-06', '2026-04-05', '2026-04-06', '2026-04-25',
    '2026-05-01', '2026-06-02', '2026-08-15', '2026-11-01', '2026-12-08',
    '2026-12-25', '2026-12-26',
    // 2027
    '2027-01-01', '2027-01-06', '2027-03-28', '2027-03-29', '2027-04-25',
    '2027-05-01', '2027-06-02', '2027-08-15', '2027-11-01', '2027-12-08',
    '2027-12-25', '2027-12-26',
]

const FESTIVI_SET = new Set(FESTIVI_IT)

/** 'YYYY-MM-DD' da una data, usando i componenti LOCALI (niente shift di fuso). */
function ymd(d: Date): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const g = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${g}`
}

/** true se e' sabato, domenica o festivo. */
export function isNonLavorativo(d: Date): boolean {
    const dow = d.getDay()
    if (dow === 0 || dow === 6) return true
    return FESTIVI_SET.has(ymd(d))
}

/**
 * Scadenza a N giorni lavorativi dalla restituzione del veicolo.
 *
 * @param dataRestituzione 'YYYY-MM-DD' (o ISO: si usa solo la parte data)
 * @param giorni numero di giorni lavorativi (default 14)
 * @returns 'YYYY-MM-DD' del giorno di scadenza
 *
 * Esempio: restituzione venerdi' 07/08/2026 -> giorno 1 = lunedi' 10/08,
 * scadenza = 14esimo giorno lavorativo, festivi esclusi.
 */
export function scadenzaGiorniLavorativi(dataRestituzione: string, giorni = 14): string {
    // Parsing esplicito dei componenti: `new Date('2026-08-07')` viene letto
    // come UTC e in Europe/Rome puo' retrocedere di un giorno.
    const [y, m, g] = String(dataRestituzione).slice(0, 10).split('-').map(Number)
    const cur = new Date(y, (m || 1) - 1, g || 1)

    // Si parte dal giorno DOPO la restituzione e si salta al primo lavorativo.
    cur.setDate(cur.getDate() + 1)
    while (isNonLavorativo(cur)) cur.setDate(cur.getDate() + 1)

    // Quello raggiunto e' il giorno lavorativo n.1: ne servono altri (giorni-1).
    let contati = 1
    while (contati < giorni) {
        cur.setDate(cur.getDate() + 1)
        if (!isNonLavorativo(cur)) contati++
    }
    return ymd(cur)
}
