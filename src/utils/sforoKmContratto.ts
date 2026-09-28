/**
 * Sforo Km: la regola del CONTRATTO, una sola per contratto e Danni/Penali.
 *
 * 28/09/2026 — la penale "Sforo Km" di Danni/Penali leggeva solo
 * `bookings.km_overage_fee`, che non viene mai salvato (0 prenotazioni su 22
 * negli ultimi 60 giorni). La riga restava a 0 EUR/km e disabilitata, e gli
 * operatori scrivevano l'importo a mano. Il contratto invece, quando quel campo
 * manca, stampa la tariffa di Centralina Pro > Km > <categoria> > sforo.
 * Da qui leggono entrambi: la penale costa quello che c'e' scritto sul
 * contratto firmato dal cliente.
 */

type Numero = number | string | null | undefined

export interface VoceKmCentralina {
    id?: string
    sforo?: Numero
}

export interface PrenotazioneSforo {
    km_overage_fee?: Numero
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    booking_details?: any
}

function positivo(v: Numero): number | null {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Tariffa EUR/km stampata sul contratto: prima quella fissata sulla
 * prenotazione, poi Centralina Pro per la categoria del veicolo
 * (supercars/supercar/exotic sono la stessa categoria). 0 = nessuna tariffa.
 */
export function tariffaSforoKm(
    booking: PrenotazioneSforo,
    kmCentralina: unknown,
    categoria: string | null | undefined,
): number {
    const fissata = positivo(booking.km_overage_fee)
    if (fissata) return fissata
    if (!Array.isArray(kmCentralina)) return 0
    const cat = String(categoria || '').toLowerCase().trim()
    if (!cat) return 0
    const alias = (cat === 'supercars' || cat === 'supercar' || cat === 'exotic')
        ? ['supercars', 'supercar', 'exotic']
        : [cat]
    for (const a of alias) {
        const voce = (kmCentralina as VoceKmCentralina[]).find(k => String(k?.id || '').toLowerCase() === a)
        const v = positivo(voce?.sforo)
        if (v) return v
    }
    return 0
}

/**
 * Km inclusi nel contratto. Riconosce le due forme:
 *  - gestionale: booking_details.km_limit (gia' comprensivo dei km_packages,
 *    sommati al salvataggio) o unlimited_km / 'Illimitati';
 *  - sito: booking_details.kmPackage.includedKm (gia' base + pacchetto),
 *    type/distance 'unlimited' o includedKm >= 9999.
 * `totale` = 0 quando il numero non e' ricavabile (formati storici
 * "100/giorno", che il contratto converte dai giorni di noleggio).
 */
export function kmInclusiContratto(bookingDetails: unknown): { illimitati: boolean; totale: number } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bd = (bookingDetails || {}) as any
    const pkg = bd.kmPackage || {}
    const includedKm = Number(pkg.includedKm)
    const illimitati = bd.unlimited_km === true
        || bd.km_limit === 'Illimitati'
        || pkg.type === 'unlimited'
        || pkg.distance === 'unlimited'
        || includedKm >= 9999
    if (illimitati) return { illimitati: true, totale: 0 }

    const base = positivo(bd.km_limit == null ? null : String(bd.km_limit)) || 0
    const pacchettiGestionale = Array.isArray(bd.km_packages)
        ? (bd.km_packages as Array<{ total_km?: Numero }>).reduce((acc, p) => acc + (positivo(p?.total_km) || 0), 0)
        : 0
    const dalSito = Number.isFinite(includedKm) && includedKm > 0 && includedKm < 9999 ? includedKm : 0

    // km_limit include gia' i pacchetti del gestionale: non si risommano
    // (contratto a 300 km su una prenotazione da 200, direzione 03/06/2026).
    if (pacchettiGestionale > 0) return { illimitati: false, totale: base }
    if (dalSito > 0) return { illimitati: false, totale: dalSito }
    return { illimitati: false, totale: base }
}
