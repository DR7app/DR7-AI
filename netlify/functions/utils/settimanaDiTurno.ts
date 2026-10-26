// 2026-10-26: ricorrenze "ogni N settimane" (messaggio spazzatura ogni 2 settimane).

/**
 * True se `giorno` cade in una settimana di turno: le settimane (da lunedi')
 * si contano da quella che contiene `inizio`, e tocca ogni `ogni` settimane.
 * Date yyyy-mm-dd confrontate in UTC: nessun fuso orario in mezzo.
 */
export function settimanaDiTurno(inizio: string | null, giorno: string, ogni: number): boolean {
    if (!inizio || giorno < inizio) return false;
    const utc = (d: string) => { const [y, m, g] = d.split('-').map(Number); return Date.UTC(y, m - 1, g); };
    // Lunedi' della settimana di una data (getUTCDay: 0 = domenica).
    const lunedi = (ms: number) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * 86400000;
    const settimane = Math.round((lunedi(utc(giorno)) - lunedi(utc(inizio))) / (7 * 86400000));
    return settimane % ogni === 0;
}
