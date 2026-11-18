/**
 * Servizi extra prenotati dal cliente (18/11/2026).
 *
 * Un cliente ha prenotato dal sito un noleggio con 6 rose: la scheda, il
 * calendario e il messaggio non lo dicevano. Le scelte stanno in
 * `booking_details.experience_services` ({ id: quantita' }) e nessuno le
 * leggeva in lettura. Lettura unica per scheda prenotazione, calendario
 * (bordo viola) e allarme "Servizi extra prenotati".
 *
 * Nomi e prezzi da Centralina Pro (experience_services). Un servizio tolto
 * dalla Centralina resta in elenco con il suo id: non deve mai sparire.
 */

export interface ServizioExtraCatalogo {
  id: string
  name?: string
  price?: number | string
  unit?: string
}

export interface ServizioExtraPrenotato {
  id: string
  nome: string
  quantita: number
  /** Prezzo unitario (per giorno se unita' = per_day). 0 = sconosciuto. */
  prezzoUnita: number
  aGiorno: boolean
  giorni: number
  /** Totale della riga in euro. 0 = sconosciuto. */
  totale: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BookingConExtra = { pickup_date?: string | null; dropoff_date?: string | null; booking_details?: any }

export function serviziExtraPrenotati(
  booking: BookingConExtra | null | undefined,
  catalogo: ServizioExtraCatalogo[] = [],
): ServizioExtraPrenotato[] {
  const bd = booking?.booking_details || {}
  const out: ServizioExtraPrenotato[] = []
  const ms = booking?.pickup_date && booking?.dropoff_date
    ? new Date(booking.dropoff_date).getTime() - new Date(booking.pickup_date).getTime()
    : 0
  const giorni = Math.max(1, Math.ceil((Number.isFinite(ms) ? ms : 0) / 86_400_000))

  const scelti = (bd.experience_services && typeof bd.experience_services === 'object') ? bd.experience_services : {}
  for (const [id, q] of Object.entries(scelti as Record<string, unknown>)) {
    const quantita = Number(q) || 0
    if (quantita <= 0) continue
    const svc = catalogo.find(s => s?.id === id)
    const prezzoUnita = Number(svc?.price) || 0
    const aGiorno = svc?.unit === 'per_day'
    out.push({
      id,
      nome: String(svc?.name || id).trim(),
      quantita,
      prezzoUnita,
      aGiorno,
      giorni,
      totale: aGiorno ? prezzoUnita * giorni * quantita : prezzoUnita * quantita,
    })
  }

  // Formato storico: booking_details.extras = ['nome'] o [{ name }]
  const legacy = Array.isArray(bd.extras) ? bd.extras : []
  for (const e of legacy) {
    const nome = typeof e === 'string' ? e : String(e?.name || e?.label || '')
    if (!nome.trim()) continue
    const prezzo = typeof e === 'object' ? Number(e?.price) || 0 : 0
    out.push({ id: nome.trim(), nome: nome.trim(), quantita: 1, prezzoUnita: prezzo, aGiorno: false, giorni, totale: prezzo })
  }
  return out
}

export function haServiziExtra(booking: BookingConExtra | null | undefined): boolean {
  return serviziExtraPrenotati(booking).length > 0
}

/** "Bouquet di rose x 6 (€47,40)" — per testi brevi (allarmi). */
export function serviziExtraInBreve(righe: ServizioExtraPrenotato[]): string {
  return righe
    .map(r => `${r.nome} x ${r.quantita}${r.totale > 0 ? ` (€${r.totale.toFixed(2).replace('.', ',')})` : ''}`)
    .join(', ')
}
