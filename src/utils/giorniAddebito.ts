import { getLateReturnGraceMinutes } from './vehicleAvailability'

/**
 * Giorni di addebito di un noleggio — UNICA formula lato admin.
 *
 * 19/09/2026 (direzione): prenotazione e preventivo contavano i giorni con
 * `ceil(ore / 24)` mentre contratto, fattura e sito usano i giorni di
 * calendario piu' la grace sul ritardo di riconsegna. Stessa prenotazione,
 * due numeri diversi: ritiro 21/09 10:00 e riconsegna 23/09 09:00 faceva
 * 2 giorni nel gestionale e 3 in contratto — e ogni voce (kasko, km,
 * cauzione, secondo guidatore) veniva moltiplicata per il numero sbagliato.
 *
 * Questa funzione e' il gemello client di
 * `netlify/functions/utils/computeRentalBillingDays.ts`: giorni di calendario
 * (mezzanotte-mezzanotte) e, sui noleggi di piu' giorni, +1 giorno se la
 * riconsegna supera (ora di ritiro - grace). La grace e' quella di
 * Centralina Pro > Automazioni > "Grace ritardo riconsegna" (default 90').
 *
 * Ritorna sempre almeno 1.
 */
export function giorniDiAddebito(pickup: Date | null, dropoff: Date | null): number {
    if (!(pickup instanceof Date) || !(dropoff instanceof Date)) return 1
    if (Number.isNaN(pickup.getTime()) || Number.isNaN(dropoff.getTime())) return 1
    if (dropoff <= pickup) return 1

    const pDate = new Date(pickup); pDate.setHours(0, 0, 0, 0)
    const rDate = new Date(dropoff); rDate.setHours(0, 0, 0, 0)
    const diffDaysCalendar = Math.round((rDate.getTime() - pDate.getTime()) / (1000 * 60 * 60 * 24))

    let billingDays = Math.max(1, diffDaysCalendar)

    if (diffDaysCalendar > 0) {
        const grace = getLateReturnGraceMinutes()
        const pickupMinutes = pickup.getHours() * 60 + pickup.getMinutes()
        const returnMinutes = dropoff.getHours() * 60 + dropoff.getMinutes()
        if (returnMinutes > pickupMinutes - grace) billingDays += 1
    }

    return billingDays
}

/** Come sopra, partendo dai campi del form (data ISO + ora HH:MM). */
export function giorniDiAddebitoDaCampi(
    pickupDate: string,
    pickupTime: string,
    returnDate: string,
    returnTime: string,
): number {
    if (!pickupDate || !returnDate) return 0
    const pickup = new Date(`${pickupDate}T${pickupTime || '10:00'}`)
    const dropoff = new Date(`${returnDate}T${returnTime || '10:00'}`)
    return giorniDiAddebito(pickup, dropoff)
}
