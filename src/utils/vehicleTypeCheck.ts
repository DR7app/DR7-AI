/**
 * Repli sul CHECK `bookings_vehicle_type_check`.
 *
 * Su Mare / Aria / Soggiorni la riga nasce con il tipo del mezzo ('boat',
 * 'helicopter', 'stay'), ma il CHECK su `bookings.vehicle_type` e' rimasto
 * quello dei tempi in cui esisteva solo il noleggio auto: il DATABASE rifiuta
 * la riga con SQLSTATE 23514 e il salvataggio fallisce.
 *
 * La migrazione `20260825_bookings_vehicle_type_business.sql` allarga il
 * vincolo, ma va eseguita a mano in Supabase. Finche' non e' passata, meglio
 * salvare SENZA quel campo (NULL e' sempre ammesso da un CHECK) che perdere
 * quello che l'operatore ha appena scritto.
 *
 * Nota: per le Uscite Straordinarie il business NON dipende da questa colonna
 * — `uscitaBusinessOf` legge prima `booking_details.uscita.business` — quindi
 * il repli non sposta un'uscita di Mare dentro Terra.
 */

/** L'errore e' il CHECK sul tipo di mezzo (e non un altro vincolo)? */
export function isVehicleTypeCheckError(
    e: { code?: string; message?: string; details?: string } | null | undefined
): boolean {
    return !!e && e.code === '23514' && /vehicle_type/i.test(`${e.message || ''} ${e.details || ''}`)
}

/** La stessa riga senza `vehicle_type`. */
export function senzaVehicleType<T extends { vehicle_type?: unknown }>(payload: T): Omit<T, 'vehicle_type'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { vehicle_type, ...resto } = payload
    return resto
}

/** Avviso da mostrare quando il repli e' scattato: dice cosa fare per toglierlo. */
export const AVVISO_VEHICLE_TYPE =
    'Salvato, ma il database non accetta ancora il tipo di mezzo di questo business. Esegui la migrazione 20260825_bookings_vehicle_type_business.sql in Supabase.'
