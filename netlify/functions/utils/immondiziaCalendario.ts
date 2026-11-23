/**
 * Calendario Immondizia: quali ritiri cadono in un giorno, e quale messaggio
 * di Messaggi di Sistema Pro e' "il messaggio del ritiro".
 *
 * 23/11/2026 (direzione): il giorno dell'invio lo decide SOLO il calendario
 * della tab Immondizia (anche "ogni mese il giorno 30"). Prima il messaggio
 * "Ritiro spazzatura" aveva una sua programmazione (giorni, ogni N
 * settimane, date) indipendente dal calendario: e' partito lunedi' 23/11
 * mentre il calendario diceva il 30. E il promemoria serale del calendario
 * mandava un secondo messaggio: due invii per lo stesso ritiro.
 * Usato da process-scheduled-system-messages-cron e immondizia-reminder-cron.
 */

export interface RegolaRitiro {
    tipo_rifiuto: string
    mode: string
    day_of_week: number | null
    pickup_date: string | null
    note?: string | null
}

// 23/10/2026: ogni 2 settimane = ogni 14 giorni dal primo ritiro (pickup_date);
// ogni mese = stesso giorno del primo ritiro, o l'ultimo del mese se piu' corto.
// Date YYYY-MM-DD confrontate in UTC: nessun fuso orario in mezzo.
export function ritiroRicorrente(mode: string, primo: string | null, giorno: string): boolean {
    if (!primo || giorno < primo) return false
    const [ay, am, ad] = primo.split('-').map(Number)
    const [gy, gm, gd] = giorno.split('-').map(Number)
    if (mode === 'biweekly') {
        const diff = Math.round((Date.UTC(gy, gm - 1, gd) - Date.UTC(ay, am - 1, ad)) / 86400000)
        return diff % 14 === 0
    }
    if (mode === 'monthly') {
        const ultimo = new Date(Date.UTC(gy, gm, 0)).getUTCDate()
        return gd === Math.min(ad, ultimo)
    }
    return false
}

/** Regole del calendario che hanno un ritiro nel giorno YYYY-MM-DD. */
export function ritiriDelGiorno<R extends RegolaRitiro>(regole: R[], giorno: string): R[] {
    const [y, m, d] = giorno.split('-').map(Number)
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
    return regole.filter(r =>
        // Settimanale: dal primo ritiro in poi, se indicato.
        (r.mode === 'weekly' && r.day_of_week === dow && (!r.pickup_date || giorno >= r.pickup_date)) ||
        (r.mode === 'date' && r.pickup_date === giorno) ||
        ((r.mode === 'biweekly' || r.mode === 'monthly') && ritiroRicorrente(r.mode, r.pickup_date, giorno))
    )
}

/** Il messaggio programmato del ritiro (stesso filtro della tab Immondizia). */
export function isMessaggioSpazzatura(tpl: { label?: string | null; message_key?: string | null; trigger_event?: string | null }): boolean {
    if (tpl.trigger_event && tpl.trigger_event !== 'on_schedule') return false
    const t = `${tpl.label || ''} ${tpl.message_key || ''}`.toLowerCase()
    return t.includes('spazzatura') || t.includes('immondizia')
}
